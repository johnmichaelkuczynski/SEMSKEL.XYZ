// Rewrite in Same Style Module
// Takes target text and rewrites it using sentence patterns extracted from a style sample

import Anthropic from "@anthropic-ai/sdk";
import { bleachText } from "./bleach";
import { computeMetadata, type SentenceMetadata } from "./matcher";
import type { BleachingLevel, SentenceBankEntry, RewrittenSentence } from "@shared/schema";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface RewriteStyleResult {
  sentences: RewrittenSentence[];
  combinedRewrite: string;
  totalSentences: number;
  successfulRewrites: number;
  stylePatternsExtracted: number;
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
    if (matches) count += matches.length;
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
  const variablePositions: number[] = [];
  let match;
  while ((match = varPattern.exec(bleached)) !== null) {
    variablePositions.push(Math.round((match.index / Math.max(bleached.length, 1)) * 100));
  }
  const variableCount = variablePositions.length;

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
    variableCount,
    variablePositions,
    clauseMarkers,
    clauseMarkerPositions,
    functionWordSequence,
    wordCount: words.length,
  };
}

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

interface ScoredEntry {
  entry: SentenceBankEntry;
  score: number;
}

function findBestMatch(
  inputMeta: SentenceMetadata,
  patterns: SentenceBankEntry[]
): ScoredEntry | null {
  if (patterns.length === 0) return null;

  const scored: ScoredEntry[] = patterns.map((entry) => ({
    entry,
    score: calculateWeightedSimilarity(inputMeta, entry),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored[0];
}

interface ContentWordInfo {
  word: string;
  index: number;
  leadingPunct: string;
  trailingPunct: string;
  isCapitalized: boolean;
}

function findContentWordPositions(sentence: string): ContentWordInfo[] {
  const words = sentence.split(/\s+/);
  const positions: ContentWordInfo[] = [];
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const leadingPunct = word.match(/^[^a-zA-Z0-9]*/)?.[0] || "";
    const trailingPunct = word.match(/[^a-zA-Z0-9]*$/)?.[0] || "";
    const cleanWord = word.replace(/^[^a-zA-Z0-9]*/, "").replace(/[^a-zA-Z0-9]*$/, "");
    const lowerWordForCheck = cleanWord.replace(/[^a-zA-Z]/g, "").toLowerCase();
    
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

function deterministicSlotFill(
  targetSentence: string,
  stylePattern: SentenceBankEntry
): string {
  const original = stylePattern.original;
  const styleContentPositions = findContentWordPositions(original);
  const targetContentWords = extractContentWords(targetSentence);
  
  if (styleContentPositions.length === 0 || targetContentWords.length === 0) {
    return original;
  }
  
  const originalWords = original.split(/\s+/);
  const resultWords = [...originalWords];
  
  const numSlots = styleContentPositions.length;
  const numTarget = targetContentWords.length;
  const wordsPerSlot = Math.max(1, Math.floor(numTarget / numSlots));
  let targetIdx = 0;
  
  for (let i = 0; i < numSlots && targetIdx < numTarget; i++) {
    const pos = styleContentPositions[i];
    const isLastSlot = i === numSlots - 1;
    const wordsToUse = isLastSlot ? numTarget - targetIdx : Math.min(wordsPerSlot, numTarget - targetIdx);
    
    const slotWords: string[] = [];
    for (let j = 0; j < wordsToUse && targetIdx < numTarget; j++) {
      slotWords.push(targetContentWords[targetIdx]);
      targetIdx++;
    }
    
    if (slotWords.length > 0) {
      let replacement = slotWords.join(" ");
      
      if (pos.index === 0 && replacement.length > 0 && /^[a-z]/.test(replacement)) {
        replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      
      resultWords[pos.index] = pos.leadingPunct + replacement + pos.trailingPunct;
    }
  }
  
  let result = resultWords.join(" ").replace(/\s+/g, " ").trim();
  
  const originalEndPunct = original.match(/[.!?;:—\-–]$/)?.[0];
  const resultEndPunct = result.match(/[.!?;:—\-–]$/)?.[0];
  
  if (originalEndPunct && !resultEndPunct) {
    result += originalEndPunct;
  }
  
  return result;
}

async function rewriteWithStylePattern(
  targetSentence: string,
  stylePattern: SentenceBankEntry
): Promise<string> {
  const prompt = `You are a style transfer engine. Your task is to rewrite a target sentence using the rhetorical structure and style of a pattern sentence.

STYLE PATTERN (template to follow):
Original: "${stylePattern.original}"
Bleached structure: "${stylePattern.bleached}"

TARGET SENTENCE (content to preserve):
"${targetSentence}"

INSTRUCTIONS:
1. Keep the MEANING and KEY CONTENT of the target sentence
2. Adopt the SENTENCE STRUCTURE, RHYTHM, and STYLE of the pattern
3. Match the clause order: ${stylePattern.clause_order}
4. Match the punctuation style: ${stylePattern.punctuation_pattern || 'standard'}
5. Keep approximately the same length as the target sentence

Your goal is to make the target sentence sound like it was written by the same person who wrote the pattern, while preserving the target's meaning.

OUTPUT: Provide ONLY the rewritten sentence. No explanations, no quotes, no commentary.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    if (content.type === "text") {
      const rewrite = content.text.trim();
      if (rewrite.length > 0 && rewrite !== targetSentence) {
        return rewrite;
      }
    }

    console.log("Claude returned empty/unchanged, using deterministic fallback");
    return deterministicSlotFill(targetSentence, stylePattern);
  } catch (error: any) {
    console.error("Rewrite error, using deterministic fallback:", error.message);
    return deterministicSlotFill(targetSentence, stylePattern);
  }
}

async function bleachAndCreatePattern(
  sentence: string,
  level: BleachingLevel
): Promise<SentenceBankEntry> {
  const bleached = await bleachText(sentence, level);
  
  return {
    original: sentence,
    bleached,
    char_length: sentence.length,
    token_length: countTokens(sentence),
    clause_count: countClauses(sentence),
    clause_order: getClauseOrder(sentence),
    punctuation_pattern: extractPunctuationPattern(sentence),
    structure: bleached,
  };
}

export async function rewriteInStyle(
  targetText: string,
  styleSample: string,
  level: BleachingLevel = "Heavy"
): Promise<RewriteStyleResult> {
  console.log("Starting style transfer...");
  
  const targetSentences = splitIntoSentences(targetText);
  const styleSentences = splitIntoSentences(styleSample);
  
  if (targetSentences.length === 0) {
    throw new Error("No sentences found in the target text.");
  }
  
  if (styleSentences.length === 0) {
    throw new Error("No sentences found in the style sample.");
  }
  
  console.log(`Target: ${targetSentences.length} sentences, Style sample: ${styleSentences.length} sentences`);
  
  console.log("Bleaching style sample to extract patterns...");
  const stylePatterns: SentenceBankEntry[] = [];
  const BATCH_SIZE = 5;
  const DELAY = 500;
  
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  
  for (let i = 0; i < styleSentences.length; i += BATCH_SIZE) {
    const batch = styleSentences.slice(i, i + BATCH_SIZE);
    console.log(`Bleaching style batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(styleSentences.length / BATCH_SIZE)}`);
    
    const batchPatterns = await Promise.all(
      batch.map(async (sentence) => {
        try {
          return await bleachAndCreatePattern(sentence, level);
        } catch (error) {
          console.error(`Error bleaching style sentence: ${sentence.substring(0, 50)}...`);
          return null;
        }
      })
    );
    
    stylePatterns.push(...batchPatterns.filter((p): p is SentenceBankEntry => p !== null));
    
    if (i + BATCH_SIZE < styleSentences.length) {
      await delay(DELAY);
    }
  }
  
  console.log(`Extracted ${stylePatterns.length} style patterns`);
  
  if (stylePatterns.length === 0) {
    throw new Error("Failed to extract any patterns from the style sample.");
  }
  
  console.log("Rewriting target sentences using style patterns...");
  const results: RewrittenSentence[] = [];
  
  for (let i = 0; i < targetSentences.length; i += BATCH_SIZE) {
    const batch = targetSentences.slice(i, i + BATCH_SIZE);
    console.log(`Rewriting batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(targetSentences.length / BATCH_SIZE)}`);
    
    const batchResults = await Promise.all(
      batch.map(async (sentence) => {
        try {
          const metadata = await computeMetadata(sentence, level);
          const bestMatch = findBestMatch(metadata, stylePatterns);
          
          if (!bestMatch) {
            return {
              original: sentence,
              rewrite: sentence,
              matchedPattern: null,
            };
          }
          
          const rewrite = await rewriteWithStylePattern(sentence, bestMatch.entry);
          
          return {
            original: sentence,
            rewrite,
            matchedPattern: {
              original: bestMatch.entry.original,
              bleached: bestMatch.entry.bleached,
              score: Math.round(bestMatch.score * 100) / 100,
            },
          };
        } catch (error) {
          console.error(`Error rewriting sentence: ${sentence.substring(0, 50)}...`);
          return {
            original: sentence,
            rewrite: sentence,
            matchedPattern: null,
          };
        }
      })
    );
    
    results.push(...batchResults);
    
    if (i + BATCH_SIZE < targetSentences.length) {
      await delay(DELAY);
    }
  }
  
  const successfulRewrites = results.filter(
    (r) => r.matchedPattern !== null && r.rewrite !== r.original
  ).length;
  
  const combinedRewrite = results.map((r) => r.rewrite).join(" ");
  
  console.log(`Style transfer complete: ${successfulRewrites}/${targetSentences.length} sentences rewritten`);
  
  return {
    sentences: results,
    combinedRewrite,
    totalSentences: targetSentences.length,
    successfulRewrites,
    stylePatternsExtracted: stylePatterns.length,
  };
}
