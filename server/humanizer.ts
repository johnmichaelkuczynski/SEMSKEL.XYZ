// Step 3: Humanizer Module
// Pattern matching + slot-fill rewriting to humanize AI text

import Anthropic from "@anthropic-ai/sdk";
import { bleachText } from "./bleach";
import { storage } from "./storage";
import type { BleachingLevel, SentenceBankEntry, SentenceEntry } from "@shared/schema";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ============================================
// TYPES
// ============================================

export interface HumanizedSentence {
  aiSentence: string;
  matchedPatterns: Array<{
    original: string;
    bleached: string;
    score: number;
    rank: number;
  }>;
  humanizedRewrite: string;
  bestPattern: {
    original: string;
    bleached: string;
    score: number;
  };
}

export interface HumanizeResult {
  sentences: HumanizedSentence[];
  totalSentences: number;
  successfulRewrites: number;
  bankSize: number;
}

interface SentenceMetadata {
  original: string;
  bleached: string;
  char_length: number;
  token_length: number;
  clause_count: number;
  clause_order: string;
  punctuation_pattern: string;
}

interface ScoredEntry {
  entry: SentenceBankEntry;
  score: number;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

const CLAUSE_TRIGGERS = ["when", "because", "although", "if", "while", "since", "but"];

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countTokens(sentence: string): number {
  return sentence.split(/\s+/).filter((t) => t.length > 0).length;
}

function countClauses(sentence: string): number {
  const lowerSentence = sentence.toLowerCase();
  let count = 0;
  for (const trigger of CLAUSE_TRIGGERS) {
    const regex = new RegExp(`\\b${trigger}\\b`, "gi");
    const matches = lowerSentence.match(regex);
    if (matches) {
      count += matches.length;
    }
  }
  return Math.max(1, count);
}

function getClauseOrder(sentence: string): string {
  const lowerSentence = sentence.toLowerCase().trim();
  for (const trigger of CLAUSE_TRIGGERS) {
    if (lowerSentence.startsWith(trigger + " ") || lowerSentence.startsWith(trigger + ",")) {
      return "subordinate → main";
    }
  }
  return "main → subordinate";
}

function extractPunctuationPattern(sentence: string): string {
  return sentence.replace(/[^.,;:!?'"()\-—]/g, "");
}

// ============================================
// DATABASE LOADING
// ============================================

function dbEntryToSentenceBankEntry(entry: SentenceEntry): SentenceBankEntry {
  return {
    original: entry.original,
    bleached: entry.bleached,
    char_length: entry.charLength,
    token_length: entry.tokenLength,
    clause_count: entry.clauseCount,
    clause_order: entry.clauseOrder,
    punctuation_pattern: entry.punctuationPattern,
    structure: entry.structure,
  };
}

async function loadSentenceBank(): Promise<SentenceBankEntry[]> {
  try {
    const entries = await storage.getAllSentenceEntries();
    return entries.map(dbEntryToSentenceBankEntry);
  } catch (error) {
    console.error("Error loading sentence bank from database:", error);
    return [];
  }
}

// ============================================
// METADATA COMPUTATION
// ============================================

async function computeMetadata(
  sentence: string,
  level: BleachingLevel = "Heavy"
): Promise<SentenceMetadata> {
  const bleached = await bleachText(sentence, level);

  return {
    original: sentence,
    bleached: bleached,
    char_length: sentence.length,
    token_length: countTokens(sentence),
    clause_count: countClauses(sentence),
    clause_order: getClauseOrder(sentence),
    punctuation_pattern: extractPunctuationPattern(sentence),
  };
}

// ============================================
// WEIGHTED SIMILARITY SCORING
// ============================================

// Weights for similarity scoring (total = 100)
const WEIGHTS = {
  structure: 40,      // Structure string match (highest weight)
  token_length: 15,   // Token length range
  clause_count: 15,   // Clause count
  clause_order: 15,   // Clause order
  punctuation: 15,    // Punctuation pattern
};

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function normalizedStringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  const maxLen = Math.max(a.length, b.length);
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

function calculateWeightedSimilarity(
  inputMeta: SentenceMetadata,
  entry: SentenceBankEntry
): number {
  let score = 0;

  // 1. Structure string match (highest weight - 40 points)
  const structureSimilarity = normalizedStringSimilarity(
    inputMeta.bleached,
    entry.structure || entry.bleached
  );
  score += structureSimilarity * WEIGHTS.structure;

  // 2. Token length range (15 points) - within 20% gets full score
  const tokenDiff = Math.abs(inputMeta.token_length - entry.token_length);
  const tokenTolerance = Math.max(inputMeta.token_length, entry.token_length) * 0.2;
  if (tokenDiff <= tokenTolerance) {
    score += WEIGHTS.token_length;
  } else {
    const tokenPenalty = Math.min(tokenDiff / Math.max(1, inputMeta.token_length), 1);
    score += Math.max(0, WEIGHTS.token_length * (1 - tokenPenalty));
  }

  // 3. Clause count (15 points) - exact match or partial
  if (inputMeta.clause_count === entry.clause_count) {
    score += WEIGHTS.clause_count;
  } else {
    const clauseDiff = Math.abs(inputMeta.clause_count - entry.clause_count);
    score += Math.max(0, WEIGHTS.clause_count * (1 - clauseDiff * 0.25));
  }

  // 4. Clause order (15 points) - exact match only
  if (inputMeta.clause_order === entry.clause_order) {
    score += WEIGHTS.clause_order;
  }

  // 5. Punctuation pattern (15 points)
  const punctSimilarity = normalizedStringSimilarity(
    inputMeta.punctuation_pattern,
    entry.punctuation_pattern
  );
  score += punctSimilarity * WEIGHTS.punctuation;

  return score;
}

// ============================================
// PATTERN MATCHING - FIND TOP 3
// ============================================

function findTopMatches(
  inputMeta: SentenceMetadata,
  bank: SentenceBankEntry[],
  topN: number = 3
): ScoredEntry[] {
  // Score ALL entries in the bank
  const scored: ScoredEntry[] = bank.map((entry) => ({
    entry,
    score: calculateWeightedSimilarity(inputMeta, entry),
  }));

  // Sort by score descending, then by clause_count descending (tiebreaker)
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    // Tiebreaker: pick longest (highest clause_count)
    return b.entry.clause_count - a.entry.clause_count;
  });

  // Return top N (always return at least the best match even if low score)
  return scored.slice(0, topN);
}

// ============================================
// SLOT-FILL REWRITING (THE MAGIC)
// ============================================

async function rewriteWithPattern(
  aiSentence: string,
  humanPattern: SentenceBankEntry
): Promise<string> {
  const prompt = `You are a sentence rewriter. Your task is to rewrite an AI-generated sentence using the rhetorical structure of a human-written pattern.

HUMAN PATTERN (template to follow):
Original: "${humanPattern.original}"
Bleached structure: "${humanPattern.bleached}"

AI SENTENCE (content to preserve):
"${aiSentence}"

INSTRUCTIONS:
1. Keep the MEANING and KEY CONTENT of the AI sentence
2. Adopt the SENTENCE STRUCTURE, RHYTHM, and RHETORICAL PATTERNS of the human pattern
3. Match the clause order: ${humanPattern.clause_order}
4. Match the punctuation style: ${humanPattern.punctuation_pattern || 'standard'}
5. Target similar length: approximately ${humanPattern.token_length} words

Your goal is to make the AI sentence sound like it was written by the same human who wrote the pattern, while preserving the AI sentence's meaning.

OUTPUT: Provide ONLY the rewritten sentence. No explanations, no quotes, no commentary. Just the rewritten sentence.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    if (content.type === "text") {
      return content.text.trim();
    }

    throw new Error("Unexpected response type from Claude");
  } catch (error: any) {
    console.error("Rewrite error:", error);
    // Fallback: return original AI sentence
    return aiSentence;
  }
}

// ============================================
// MAIN HUMANIZE FUNCTION
// ============================================

export async function humanizeText(
  inputText: string,
  level: BleachingLevel = "Heavy"
): Promise<HumanizeResult> {
  // Load the sentence bank
  const bank = await loadSentenceBank();
  
  if (bank.length === 0) {
    throw new Error("Sentence bank is empty. Please add human text patterns first.");
  }

  console.log(`Humanizing text against ${bank.length} patterns...`);

  // Split into sentences
  const sentences = splitIntoSentences(inputText);
  
  if (sentences.length === 0) {
    throw new Error("No sentences found in the input text.");
  }

  console.log(`Processing ${sentences.length} sentences...`);

  const results: HumanizedSentence[] = [];
  const BATCH_SIZE = 3;
  const DELAY_BETWEEN_BATCHES = 500;

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
    const batch = sentences.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(sentences.length / BATCH_SIZE)}`);

    const batchResults = await Promise.all(
      batch.map(async (sentence) => {
        try {
          // Step 1: Compute metadata (bleach the AI sentence)
          const metadata = await computeMetadata(sentence, level);

          // Step 2: Find top 3 matching patterns
          const topMatches = findTopMatches(metadata, bank, 3);

          if (topMatches.length === 0) {
            return {
              aiSentence: sentence,
              matchedPatterns: [],
              humanizedRewrite: sentence,
              bestPattern: {
                original: "",
                bleached: "",
                score: 0,
              },
            };
          }

          // Step 3: Use the best pattern for rewriting
          const bestMatch = topMatches[0];
          
          // Step 4: Rewrite the AI sentence using the human pattern
          const humanizedRewrite = await rewriteWithPattern(sentence, bestMatch.entry);

          return {
            aiSentence: sentence,
            matchedPatterns: topMatches.map((m, idx) => ({
              original: m.entry.original,
              bleached: m.entry.bleached,
              score: Math.round(m.score * 100) / 100,
              rank: idx + 1,
            })),
            humanizedRewrite,
            bestPattern: {
              original: bestMatch.entry.original,
              bleached: bestMatch.entry.bleached,
              score: Math.round(bestMatch.score * 100) / 100,
            },
          };
        } catch (error) {
          console.error(`Error processing sentence: ${sentence.substring(0, 50)}...`, error);
          return {
            aiSentence: sentence,
            matchedPatterns: [],
            humanizedRewrite: sentence,
            bestPattern: {
              original: "",
              bleached: "",
              score: 0,
            },
          };
        }
      })
    );

    results.push(...batchResults);

    // Delay between batches to avoid rate limits
    if (i + BATCH_SIZE < sentences.length) {
      await delay(DELAY_BETWEEN_BATCHES);
    }
  }

  const successfulRewrites = results.filter(
    (r) => r.matchedPatterns.length > 0 && r.humanizedRewrite !== r.aiSentence
  ).length;

  console.log(`Humanization complete: ${successfulRewrites}/${sentences.length} sentences rewritten`);

  return {
    sentences: results,
    totalSentences: sentences.length,
    successfulRewrites,
    bankSize: bank.length,
  };
}

// Export for use in routes
export { loadSentenceBank, computeMetadata, findTopMatches, calculateWeightedSimilarity };
