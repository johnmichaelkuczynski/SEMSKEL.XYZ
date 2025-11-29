// Step 3: Humanizer Module
// Pattern matching + slot-fill rewriting to humanize AI text

import Anthropic from "@anthropic-ai/sdk";
import { loadSentenceBank, computeMetadata, type SentenceMetadata } from "./matcher";
import type { BleachingLevel, SentenceBankEntry } from "@shared/schema";

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

interface ScoredEntry {
  entry: SentenceBankEntry;
  score: number;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const CLAUSE_TRIGGERS = ["when", "because", "although", "if", "while", "since", "but"];

const FUNCTION_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "to", "of", "in",
  "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "above", "below", "between", "under",
  "again", "further", "then", "once", "here", "there", "when", "where",
  "why", "how", "all", "each", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "than",
  "too", "very", "just", "and", "but", "if", "or", "because", "until",
  "while", "although", "since", "that", "this", "these", "those", "it",
  "its", "their", "they", "them", "we", "us", "our", "you", "your",
  "he", "she", "him", "her", "his", "hers"
]);

// ============================================
// SKELETON EXTRACTION FOR GEOMETRIC COMPARISON
// ============================================

interface SkeletonFeatures {
  variableCount: number;
  variablePositions: number[];
  clauseMarkers: string[];
  clauseMarkerPositions: number[];
  functionWordSequence: string;
  wordCount: number;
}

function extractSkeletonFeatures(bleached: string, original: string): SkeletonFeatures {
  const varPattern = /\b[A-Z](?:-[a-z]+)?\b|\b[A-Z]\d+\b|[αβγδεζηθικλμνξπρστυφχψω]|Ω\d+/g;
  const variables = [...bleached.matchAll(varPattern)];
  
  const variablePositions = variables.map((m) => 
    Math.round((m.index! / Math.max(bleached.length, 1)) * 100)
  );

  const lowerOriginal = original.toLowerCase();
  const clauseMarkers: string[] = [];
  const clauseMarkerPositions: number[] = [];
  
  for (const trigger of CLAUSE_TRIGGERS) {
    const regex = new RegExp(`\\b${trigger}\\b`, "gi");
    let match;
    while ((match = regex.exec(lowerOriginal)) !== null) {
      clauseMarkers.push(trigger);
      clauseMarkerPositions.push(Math.round((match.index / Math.max(original.length, 1)) * 100));
    }
  }

  const words = bleached.toLowerCase().split(/\s+/);
  const functionWordSequence = words
    .filter((w) => FUNCTION_WORDS.has(w))
    .slice(0, 10)
    .join(" ");

  return {
    variableCount: variables.length,
    variablePositions,
    clauseMarkers,
    clauseMarkerPositions,
    functionWordSequence,
    wordCount: words.length,
  };
}

// ============================================
// WEIGHTED SIMILARITY SCORING
// ============================================

const WEIGHTS = {
  skeleton: 40,
  token_length: 15,
  clause_count: 15,
  clause_order: 15,
  punctuation: 15,
};

function comparePositionArrays(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  
  let positionDiffSum = 0;
  for (let i = 0; i < minLen; i++) {
    positionDiffSum += Math.abs(a[i] - b[i]);
  }
  
  const avgDiff = positionDiffSum / minLen;
  const positionScore = 1 - avgDiff / 100;
  const countRatio = minLen / maxLen;
  
  return positionScore * countRatio;
}

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

  const inputSkeleton = extractSkeletonFeatures(inputMeta.bleached, inputMeta.original);
  const entrySkeleton = extractSkeletonFeatures(
    entry.structure || entry.bleached,
    entry.original
  );

  const varPosScore = comparePositionArrays(
    inputSkeleton.variablePositions,
    entrySkeleton.variablePositions
  );
  
  const clausePosScore = comparePositionArrays(
    inputSkeleton.clauseMarkerPositions,
    entrySkeleton.clauseMarkerPositions
  );
  
  const funcWordScore = normalizedStringSimilarity(
    inputSkeleton.functionWordSequence,
    entrySkeleton.functionWordSequence
  );
  
  const varCountDiff = Math.abs(inputSkeleton.variableCount - entrySkeleton.variableCount);
  const maxVarCount = Math.max(inputSkeleton.variableCount, entrySkeleton.variableCount, 1);
  const varCountScore = 1 - Math.min(varCountDiff / maxVarCount, 1);
  
  score += (varPosScore * 15 + clausePosScore * 10 + funcWordScore * 10 + varCountScore * 5);

  const tokenDiff = Math.abs(inputMeta.token_length - entry.token_length);
  const maxTokens = Math.max(inputMeta.token_length, entry.token_length, 1);
  const tokenSimilarity = 1 - Math.min(tokenDiff / maxTokens, 1);
  score += tokenSimilarity * WEIGHTS.token_length;

  if (inputMeta.clause_count === entry.clause_count) {
    score += WEIGHTS.clause_count;
  } else {
    const clauseDiff = Math.abs(inputMeta.clause_count - entry.clause_count);
    const maxClauses = Math.max(inputMeta.clause_count, entry.clause_count, 1);
    score += Math.max(0, WEIGHTS.clause_count * (1 - clauseDiff / maxClauses));
  }

  if (inputMeta.clause_order === entry.clause_order) {
    score += WEIGHTS.clause_order;
  }

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
  const scored: ScoredEntry[] = bank.map((entry) => ({
    entry,
    score: calculateWeightedSimilarity(inputMeta, entry),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.entry.clause_count - a.entry.clause_count;
  });

  return scored.slice(0, topN);
}

// ============================================
// DETERMINISTIC SLOT-FILL FALLBACK
// Uses the structure template with variable placeholders
// Maps AI content to template slots, preserving human skeleton
// ============================================

interface SlotInfo {
  placeholder: string;
  startIndex: number;
  endIndex: number;
}

function findSlotPositions(structure: string): SlotInfo[] {
  // Find all variable placeholders in the structure
  const varPattern = /\b[A-Z](?:-[a-z]+)?(?:\d+)?\b|[αβγδεζηθικλμνξπρστυφχψω]|Ω\d+/g;
  const slots: SlotInfo[] = [];
  let match;
  
  while ((match = varPattern.exec(structure)) !== null) {
    slots.push({
      placeholder: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }
  
  return slots;
}

function alignStructureToOriginal(
  structure: string,
  original: string
): Map<string, string> {
  // Align the bleached structure with the original to find what each variable maps to
  const mapping = new Map<string, string>();
  
  const structWords = structure.split(/\s+/);
  const origWords = original.split(/\s+/);
  
  // Build alignment based on matching function words
  let origIdx = 0;
  
  for (let i = 0; i < structWords.length; i++) {
    const structWord = structWords[i];
    const varMatch = structWord.match(/^([^a-zA-Z]*)?([A-Z](?:-[a-z]+)?(?:\d+)?|[αβγδεζηθικλμνξπρστυφχψω]|Ω\d+)([^a-zA-Z]*)?$/);
    
    if (varMatch) {
      // This is a variable placeholder
      const placeholder = varMatch[2];
      if (origIdx < origWords.length) {
        mapping.set(placeholder, origWords[origIdx]);
        origIdx++;
      }
    } else {
      // Function word - advance original pointer to align
      while (origIdx < origWords.length) {
        const origClean = origWords[origIdx].toLowerCase().replace(/[^a-z]/g, "");
        const structClean = structWord.toLowerCase().replace(/[^a-z]/g, "");
        if (origClean === structClean || origIdx >= origWords.length - 1) {
          origIdx++;
          break;
        }
        origIdx++;
      }
    }
  }
  
  return mapping;
}

function extractContentPhrases(sentence: string): string[] {
  // Extract meaningful content words (nouns, verbs, adjectives)
  const words = sentence.match(/\S+/g) || [];
  return words.filter((word) => {
    const clean = word.toLowerCase().replace(/[^a-z]/g, "");
    return clean.length > 2 && !FUNCTION_WORDS.has(clean);
  });
}

function deterministicSlotFill(
  aiSentence: string,
  humanPattern: SentenceBankEntry
): string {
  const structure = humanPattern.structure || humanPattern.bleached;
  const original = humanPattern.original;
  
  // Extract content words from AI sentence (these carry the meaning to preserve)
  const aiContent = extractContentPhrases(aiSentence);
  
  if (aiContent.length === 0) {
    // No content words in AI sentence - still transform using pattern structure
    // Replace variables in structure with original pattern's content words
    return buildFromStructure(structure, extractContentPhrases(original));
  }

  // Find slots in the structure
  const slots = findSlotPositions(structure);
  
  if (slots.length === 0) {
    // No variable slots found - pattern is already fully function words
    // Append key AI content to convey meaning
    const keyTerms = aiContent.slice(0, 3).join(", ");
    return `${original.replace(/[.!?]$/, "")} involving ${keyTerms}.`;
  }

  // Get unique placeholder names in order
  const placeholders = [...new Set(slots.map((s) => s.placeholder))];
  const numSlots = placeholders.length;
  const numAiWords = aiContent.length;
  
  // Strategy: distribute AI content across slots
  // If more AI words than slots, group them into phrases
  const replacements = new Map<string, string>();
  
  if (numAiWords <= numSlots) {
    // Fewer or equal AI words than slots: one-to-one mapping
    for (let i = 0; i < numAiWords; i++) {
      replacements.set(placeholders[i], aiContent[i]);
    }
    // Fill remaining slots with original pattern content
    const origContent = extractContentPhrases(original);
    for (let i = numAiWords; i < numSlots; i++) {
      const origWord = origContent[i % origContent.length] || "element";
      replacements.set(placeholders[i], origWord);
    }
  } else {
    // More AI words than slots: group AI words into slot-sized chunks
    const wordsPerSlot = Math.ceil(numAiWords / numSlots);
    for (let i = 0; i < numSlots; i++) {
      const startIdx = i * wordsPerSlot;
      const endIdx = Math.min(startIdx + wordsPerSlot, numAiWords);
      const chunk = aiContent.slice(startIdx, endIdx);
      // Join with space to form a phrase, clean up punctuation
      const phrase = chunk.map((w) => w.replace(/[.,;:!?]/g, "")).join(" ");
      replacements.set(placeholders[i], phrase);
    }
  }

  // Build result by replacing placeholders in structure
  let result = structure;
  
  for (const [placeholder, replacement] of replacements) {
    const regex = new RegExp(
      placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "g"
    );
    result = result.replace(regex, replacement);
  }

  // Clean up any remaining variable patterns (shouldn't be many after above)
  result = result.replace(/\b[A-Z]\d+\b/g, "item");
  result = result.replace(/\b[A-Z](?:-[a-z]+)?\b/g, "element");
  result = result.replace(/[αβγδεζηθικλμνξπρστυφχψω]/g, "aspect");
  result = result.replace(/Ω\d+/g, "factor");

  // Clean up formatting
  result = result.replace(/\s+/g, " ").trim();
  result = result.replace(/\s+([.,;:!?])/g, "$1");
  
  // Capitalize first letter
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }
  
  // Ensure proper ending punctuation
  if (!/[.!?]$/.test(result)) {
    result += ".";
  }

  return result;
}

// Helper: build sentence from structure template using content words
function buildFromStructure(structure: string, contentWords: string[]): string {
  const slots = findSlotPositions(structure);
  const placeholders = [...new Set(slots.map((s) => s.placeholder))];
  
  let result = structure;
  for (let i = 0; i < placeholders.length; i++) {
    const replacement = contentWords[i % Math.max(contentWords.length, 1)] || "element";
    const regex = new RegExp(
      placeholders[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "g"
    );
    result = result.replace(regex, replacement);
  }
  
  // Clean up remaining placeholders
  result = result.replace(/\b[A-Z]\d+\b/g, "item");
  result = result.replace(/\b[A-Z](?:-[a-z]+)?\b/g, "element");
  result = result.replace(/[αβγδεζηθικλμνξπρστυφχψω]/g, "aspect");
  result = result.replace(/Ω\d+/g, "factor");
  
  result = result.replace(/\s+/g, " ").trim();
  result = result.replace(/\s+([.,;:!?])/g, "$1");
  
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }
  
  if (!/[.!?]$/.test(result)) {
    result += ".";
  }
  
  return result;
}

// ============================================
// SLOT-FILL REWRITING WITH CLAUDE
// Falls back to deterministic fill if Claude fails
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
      const rewrite = content.text.trim();
      if (rewrite.length > 0 && rewrite !== aiSentence) {
        return rewrite;
      }
    }

    console.log("Claude returned empty/unchanged, using deterministic fallback");
    return deterministicSlotFill(aiSentence, humanPattern);
  } catch (error: any) {
    console.error("Rewrite error, using deterministic fallback:", error.message);
    return deterministicSlotFill(aiSentence, humanPattern);
  }
}

// ============================================
// MAIN HUMANIZE FUNCTION
// ============================================

export async function humanizeText(
  inputText: string,
  level: BleachingLevel = "Heavy"
): Promise<HumanizeResult> {
  const bank = await loadSentenceBank();
  
  if (bank.length === 0) {
    throw new Error("Sentence bank is empty. Please add human text patterns first.");
  }

  console.log(`Humanizing text against ${bank.length} patterns...`);

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
          const metadata = await computeMetadata(sentence, level);
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

          const bestMatch = topMatches[0];
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
          if (bank.length > 0) {
            const fallbackPattern = bank[0];
            return {
              aiSentence: sentence,
              matchedPatterns: [{
                original: fallbackPattern.original,
                bleached: fallbackPattern.bleached,
                score: 0,
                rank: 1,
              }],
              humanizedRewrite: deterministicSlotFill(sentence, fallbackPattern),
              bestPattern: {
                original: fallbackPattern.original,
                bleached: fallbackPattern.bleached,
                score: 0,
              },
            };
          }
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
