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
// Simpler approach: replace content words in original with AI content words
// preserving exact punctuation and structure from original human sentence
// ============================================

interface ContentWordInfo {
  word: string;
  index: number;
  leadingPunct: string;
  trailingPunct: string;
  isCapitalized: boolean;
}

// Identify content word positions in original sentence
function findContentWordPositions(sentence: string): ContentWordInfo[] {
  const words = sentence.split(/\s+/);
  const positions: ContentWordInfo[] = [];
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // Extract leading/trailing punctuation, preserve internal hyphens, digits, apostrophes
    const leadingPunct = word.match(/^[^a-zA-Z0-9]*/)?.[0] || "";
    const trailingPunct = word.match(/[^a-zA-Z0-9]*$/)?.[0] || "";
    // Keep full word content including digits, hyphens, apostrophes (e.g., F-16, COVID-19, can't)
    const cleanWord = word.replace(/^[^a-zA-Z0-9]*/, "").replace(/[^a-zA-Z0-9]*$/, "");
    // For function word check, use only letters
    const lowerWordForCheck = cleanWord.replace(/[^a-zA-Z]/g, "").toLowerCase();
    
    // Check if it's a content word (not a function word, not too short)
    if (lowerWordForCheck.length > 2 && !FUNCTION_WORDS.has(lowerWordForCheck)) {
      positions.push({
        word: cleanWord,
        index: i,
        leadingPunct,
        trailingPunct,
        isCapitalized: /^[A-Z]/.test(cleanWord),
      });
    }
  }
  
  return positions;
}

// Extract content words from AI sentence (preserving order, casing, and internal punctuation)
function extractAIContentWords(sentence: string): string[] {
  const words = sentence.split(/\s+/);
  const contentWords: string[] = [];
  
  for (const word of words) {
    // Only remove leading/trailing punctuation, preserve internal (apostrophes, hyphens, digits)
    const cleanWord = word.replace(/^[^a-zA-Z0-9]+/, "").replace(/[^a-zA-Z0-9]+$/, "");
    // For function word check, use only letters
    const lowerWordForCheck = cleanWord.replace(/[^a-zA-Z]/g, "").toLowerCase();
    
    if (lowerWordForCheck.length > 2 && !FUNCTION_WORDS.has(lowerWordForCheck)) {
      contentWords.push(cleanWord);
    }
  }
  
  return contentWords;
}

function deterministicSlotFill(
  aiSentence: string,
  humanPattern: SentenceBankEntry
): string {
  const original = humanPattern.original;
  
  // Find content word positions in the original human sentence
  const humanContentPositions = findContentWordPositions(original);
  
  // Extract content words from AI sentence (preserving original casing and internal punctuation)
  const aiContentWords = extractAIContentWords(aiSentence);
  
  if (humanContentPositions.length === 0) {
    // No content words to replace - return original as-is
    return original;
  }
  
  if (aiContentWords.length === 0) {
    // No AI content words - return original as-is  
    return original;
  }
  
  // Build the result by replacing content words
  const originalWords = original.split(/\s+/);
  const resultWords = [...originalWords];
  
  // Distribute AI content words across human content positions
  const numSlots = humanContentPositions.length;
  const numAI = aiContentWords.length;
  
  // Calculate how many AI words per slot (at least 1 per slot)
  const wordsPerSlot = Math.max(1, Math.floor(numAI / numSlots));
  let aiIdx = 0;
  
  for (let i = 0; i < numSlots && aiIdx < numAI; i++) {
    const pos = humanContentPositions[i];
    
    // Calculate how many AI words to use for this slot
    // For the last slot, use all remaining words
    const isLastSlot = i === numSlots - 1;
    const wordsToUse = isLastSlot ? numAI - aiIdx : Math.min(wordsPerSlot, numAI - aiIdx);
    
    // Collect AI words for this slot
    const slotWords: string[] = [];
    for (let j = 0; j < wordsToUse && aiIdx < numAI; j++) {
      slotWords.push(aiContentWords[aiIdx]);
      aiIdx++;
    }
    
    if (slotWords.length > 0) {
      // Join AI words - preserve their original casing and internal punctuation
      let replacement = slotWords.join(" ");
      
      // Only apply sentence-start capitalization if this is the first word
      // Otherwise preserve AI word casing (for proper nouns like NASA, OpenAI)
      if (pos.index === 0 && replacement.length > 0 && /^[a-z]/.test(replacement)) {
        replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      
      // Preserve leading/trailing punctuation from original position
      resultWords[pos.index] = pos.leadingPunct + replacement + pos.trailingPunct;
    }
  }
  
  // Join back into sentence
  let result = resultWords.join(" ");
  
  // Clean up any double spaces
  result = result.replace(/\s+/g, " ").trim();
  
  // Preserve original ending punctuation - only add period if original had one and we lost it
  const originalEndPunct = original.match(/[.!?;:—\-–]$/)?.[0];
  const resultEndPunct = result.match(/[.!?;:—\-–]$/)?.[0];
  
  if (originalEndPunct && !resultEndPunct) {
    // Original had ending punctuation but result lost it - restore it
    result += originalEndPunct;
  } else if (!originalEndPunct && !resultEndPunct) {
    // Neither had ending punctuation - don't add one
    // (the original human sentence may have been a fragment or had special formatting)
  }
  
  return result;
}

// ============================================
// CONTENT-PRESERVING REWRITE
// Uses pattern STRUCTURE only, keeps AI content EXACTLY
// ============================================

function extractContentWords(sentence: string): string[] {
  const words = sentence.split(/\s+/);
  const contentWords: string[] = [];
  
  for (const word of words) {
    const cleanWord = word.replace(/^[^a-zA-Z0-9]+/, "").replace(/[^a-zA-Z0-9]+$/, "");
    const lowerWordForCheck = cleanWord.replace(/[^a-zA-Z]/g, "").toLowerCase();
    
    if (lowerWordForCheck.length > 2 && !FUNCTION_WORDS.has(lowerWordForCheck)) {
      contentWords.push(cleanWord);
    }
  }
  
  return contentWords;
}

function contentPreservingRewrite(
  aiSentence: string,
  humanPattern: SentenceBankEntry
): string {
  // Extract the BLEACHED structure (with variable slots) from the pattern
  const bleachedStructure = humanPattern.bleached;
  
  // Extract content words from the AI sentence (what we want to preserve)
  const aiContentWords = extractContentWords(aiSentence);
  
  if (aiContentWords.length === 0) {
    return aiSentence; // Nothing to rewrite
  }
  
  // Parse the bleached structure to find variable slots
  const varPattern = /\b[A-Z](?:-[a-z]+)?(?:'s?)?\b/g;
  const words = bleachedStructure.split(/\s+/);
  
  // Find indices of variable slots in the bleached structure
  const slotIndices: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (varPattern.test(words[i])) {
      slotIndices.push(i);
    }
    varPattern.lastIndex = 0; // Reset regex
  }
  
  if (slotIndices.length === 0) {
    // No variable slots found - use fallback method
    return deterministicSlotFill(aiSentence, humanPattern);
  }
  
  // Distribute AI content words into the slots
  const resultWords = [...words];
  const numSlots = slotIndices.length;
  const numContent = aiContentWords.length;
  const wordsPerSlot = Math.max(1, Math.floor(numContent / numSlots));
  let contentIdx = 0;
  
  for (let i = 0; i < numSlots && contentIdx < numContent; i++) {
    const slotIdx = slotIndices[i];
    const isLastSlot = i === numSlots - 1;
    const wordsToUse = isLastSlot ? numContent - contentIdx : Math.min(wordsPerSlot, numContent - contentIdx);
    
    const slotWords: string[] = [];
    for (let j = 0; j < wordsToUse && contentIdx < numContent; j++) {
      slotWords.push(aiContentWords[contentIdx]);
      contentIdx++;
    }
    
    if (slotWords.length > 0) {
      let replacement = slotWords.join(" ");
      
      // Capitalize first word of sentence if needed
      if (slotIdx === 0 && /^[a-z]/.test(replacement)) {
        replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      
      // Preserve any punctuation attached to the original slot
      const originalWord = words[slotIdx];
      const leadingPunct = originalWord.match(/^[^a-zA-Z]*/)?.[0] || "";
      const trailingPunct = originalWord.match(/[^a-zA-Z]*$/)?.[0] || "";
      
      resultWords[slotIdx] = leadingPunct + replacement + trailingPunct;
    }
  }
  
  let result = resultWords.join(" ").replace(/\s+/g, " ").trim();
  
  // Ensure proper ending punctuation from original AI sentence
  const aiEndPunct = aiSentence.match(/[.!?;:—\-–]$/)?.[0];
  const resultEndPunct = result.match(/[.!?;:—\-–]$/)?.[0];
  
  if (aiEndPunct && !resultEndPunct) {
    result += aiEndPunct;
  }
  
  return result;
}

// Polish with Claude - ONLY for grammar/flow, NEVER changes meaning
async function polishWithClaude(
  roughRewrite: string,
  aiSentence: string
): Promise<string> {
  const prompt = `You are a copy editor. Your ONLY job is to fix grammar and improve flow.

ORIGINAL CONTENT (the meaning to preserve EXACTLY):
"${aiSentence}"

ROUGH REWRITE (needs grammar/flow polish):
"${roughRewrite}"

CRITICAL RULES:
1. The rough rewrite contains ALL the correct content from the original
2. You may ONLY fix grammar, word order, and flow
3. You MUST NOT add any new ideas, claims, or qualifiers
4. You MUST NOT remove or change any assertions
5. You MUST NOT add hedging words like "tends to", "seems to", "appears"
6. You MUST NOT negate or reverse any claims
7. If the rough rewrite is already grammatical, return it unchanged

OUTPUT: Provide ONLY the polished sentence. No explanations.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    if (content.type === "text") {
      const polished = content.text.trim();
      if (polished.length > 0) {
        return polished;
      }
    }
    return roughRewrite;
  } catch (error) {
    console.error("Polish error, using rough rewrite:", error);
    return roughRewrite;
  }
}

async function rewriteWithPattern(
  aiSentence: string,
  humanPattern: SentenceBankEntry
): Promise<string> {
  // STEP 1: Create content-preserving rewrite using pattern STRUCTURE
  // This guarantees the AI sentence's meaning is preserved
  const roughRewrite = contentPreservingRewrite(aiSentence, humanPattern);
  
  // STEP 2: Polish for grammar/flow (optional, won't change meaning)
  const polished = await polishWithClaude(roughRewrite, aiSentence);
  
  return polished;
}

// ============================================
// MAIN HUMANIZE FUNCTION
// ============================================

// Helper to normalize a candidate with all required fields
function normalizeCandidate(candidate: Partial<SentenceBankEntry>): SentenceBankEntry {
  const original = candidate.original || "";
  const bleached = candidate.bleached || original;
  
  return {
    original,
    bleached,
    structure: candidate.structure || bleached,
    charLength: candidate.charLength ?? original.length,
    tokenLength: candidate.tokenLength ?? original.split(/\s+/).filter(Boolean).length,
    clauseCount: candidate.clauseCount ?? 1,
    clauseOrder: candidate.clauseOrder || "main → subordinate",
    punctuationPattern: candidate.punctuationPattern || (original.match(/[.,;:!?'"()\-—]/g) || []).join(""),
    // Alias fields for compatibility
    char_length: candidate.charLength ?? original.length,
    token_length: candidate.tokenLength ?? original.split(/\s+/).filter(Boolean).length,
    clause_count: candidate.clauseCount ?? 1,
    clause_order: candidate.clauseOrder || "main → subordinate",
    punctuation_pattern: candidate.punctuationPattern || (original.match(/[.,;:!?'"()\-—]/g) || []).join(""),
  };
}

export async function humanizeText(
  inputText: string,
  level: BleachingLevel = "Heavy",
  prefilteredCandidates?: SentenceBankEntry[]
): Promise<HumanizeResult> {
  // Use prefiltered candidates if provided, otherwise load full bank
  let bank: SentenceBankEntry[];
  
  if (prefilteredCandidates && prefilteredCandidates.length > 0) {
    // Normalize candidates to ensure all required fields exist
    bank = prefilteredCandidates.map(normalizeCandidate);
    console.log(`Using ${bank.length} normalized prefiltered candidates from Layer 2`);
  } else {
    bank = await loadSentenceBank();
    console.log(`Loaded full sentence bank with ${bank.length} patterns`);
  }
  
  if (bank.length === 0) {
    throw new Error("Sentence bank is empty. Please add human text patterns first.");
  }

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
