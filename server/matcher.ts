// Matching Engine for finding best human sentence pattern
// Step 2 of the humanizer pipeline

import * as fs from "fs";
import * as path from "path";
import { bleachText } from "./bleach";
import type { BleachingLevel, SentenceBankEntry } from "@shared/schema";

// Re-export for convenience
export type { SentenceBankEntry };

// Metadata computed for input sentence
export interface SentenceMetadata {
  original: string;
  bleached: string;
  char_length: number;
  token_length: number;
  clause_count: number;
  clause_order: string;
  punctuation_pattern: string;
}

// Clause triggers (same as in routes.ts for consistency)
const CLAUSE_TRIGGERS = ["when", "because", "although", "if", "while", "since", "but"];

// ============================================
// UTILITY FUNCTIONS (reused from routes.ts)
// ============================================

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
// SENTENCE BANK LOADING
// ============================================

const SENTENCE_BANK_PATH = path.join(process.cwd(), "sentence_bank.jsonl");

export function loadSentenceBank(): SentenceBankEntry[] {
  try {
    if (!fs.existsSync(SENTENCE_BANK_PATH)) {
      console.warn("sentence_bank.jsonl not found. Creating empty bank.");
      return [];
    }

    const content = fs.readFileSync(SENTENCE_BANK_PATH, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    return lines.map((line) => JSON.parse(line) as SentenceBankEntry);
  } catch (error) {
    console.error("Error loading sentence bank:", error);
    return [];
  }
}

// ============================================
// METADATA COMPUTATION
// ============================================

export async function computeMetadata(
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
// SIMILARITY SCORING (Filter D)
// ============================================

function countVariables(bleached: string): number {
  // Count unique variable patterns like X, Y, Z, A, B, etc.
  const varPattern = /\b[A-Z](?:-[a-z]+)?\b|\b[A-Z]\d+\b|[αβγδεζηθικλμνξπρστυφχψω]|Ω\d+/g;
  const matches = bleached.match(varPattern) || [];
  return new Set(matches).size;
}

function extractClauseMarkers(text: string): string[] {
  const lowerText = text.toLowerCase();
  return CLAUSE_TRIGGERS.filter((trigger) => {
    const regex = new RegExp(`\\b${trigger}\\b`, "i");
    return regex.test(lowerText);
  });
}

function getPunctuationPositions(text: string): number[] {
  const positions: number[] = [];
  const punctuation = /[.,;:!?'"()\-—]/g;
  let match;
  while ((match = punctuation.exec(text)) !== null) {
    // Normalize position as percentage of total length
    positions.push(Math.round((match.index / text.length) * 100));
  }
  return positions;
}

function calculateSimilarityScore(
  inputMeta: SentenceMetadata,
  entry: SentenceBankEntry
): number {
  let score = 0;

  // 1. Variable count similarity (0-25 points)
  const inputVars = countVariables(inputMeta.bleached);
  const entryVars = countVariables(entry.bleached);
  const varDiff = Math.abs(inputVars - entryVars);
  score += Math.max(0, 25 - varDiff * 5);

  // 2. Clause marker overlap (0-25 points)
  const inputMarkers = extractClauseMarkers(inputMeta.original);
  const entryMarkers = extractClauseMarkers(entry.original);
  const markerOverlap = inputMarkers.filter((m) => entryMarkers.includes(m)).length;
  const markerTotal = new Set([...inputMarkers, ...entryMarkers]).size;
  if (markerTotal > 0) {
    score += (markerOverlap / markerTotal) * 25;
  } else {
    score += 25; // Both have no markers = perfect match
  }

  // 3. Clause order match (0-25 points)
  if (inputMeta.clause_order === entry.clause_order) {
    score += 25;
  }

  // 4. Punctuation position similarity (0-25 points)
  const inputPuncPos = getPunctuationPositions(inputMeta.original);
  const entryPuncPos = getPunctuationPositions(entry.original);

  if (inputPuncPos.length === 0 && entryPuncPos.length === 0) {
    score += 25; // Both have no punctuation = perfect match
  } else if (inputPuncPos.length > 0 && entryPuncPos.length > 0) {
    // Calculate average position difference
    const minLen = Math.min(inputPuncPos.length, entryPuncPos.length);
    let posDiffSum = 0;
    for (let i = 0; i < minLen; i++) {
      posDiffSum += Math.abs(inputPuncPos[i] - entryPuncPos[i]);
    }
    // Add penalty for different count
    const countDiff = Math.abs(inputPuncPos.length - entryPuncPos.length);
    const avgDiff = minLen > 0 ? posDiffSum / minLen : 0;
    score += Math.max(0, 25 - avgDiff / 2 - countDiff * 3);
  }

  return score;
}

// ============================================
// MATCHING FILTERS
// ============================================

function filterByLength(
  entries: SentenceBankEntry[],
  inputCharLength: number
): SentenceBankEntry[] {
  // Filter A: Keep entries within 10% of input length
  const tolerance = 0.1 * inputCharLength;
  return entries.filter(
    (entry) => Math.abs(entry.char_length - inputCharLength) <= tolerance
  );
}

function filterByClauseCount(
  entries: SentenceBankEntry[],
  inputClauseCount: number
): SentenceBankEntry[] {
  // Filter B: Exact clause count match
  return entries.filter((entry) => entry.clause_count === inputClauseCount);
}

function filterByPunctuation(
  entries: SentenceBankEntry[],
  inputPunctuationPattern: string
): { candidates: SentenceBankEntry[]; exactMatch: boolean } {
  // Filter C: Try exact punctuation match first
  const exactMatches = entries.filter(
    (entry) => entry.punctuation_pattern === inputPunctuationPattern
  );

  if (exactMatches.length > 0) {
    return { candidates: exactMatches, exactMatch: true };
  }

  // Fall back to all candidates from Filter B
  return { candidates: entries, exactMatch: false };
}

function selectBestCandidate(
  entries: SentenceBankEntry[],
  inputMeta: SentenceMetadata
): SentenceBankEntry | null {
  // Filter D: Choose by syntactic skeleton similarity
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0];

  let bestEntry: SentenceBankEntry | null = null;
  let bestScore = -1;

  for (const entry of entries) {
    const score = calculateSimilarityScore(inputMeta, entry);
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return bestEntry;
}

// ============================================
// MAIN MATCHING FUNCTION
// ============================================

export async function findBestMatch(
  sentence: string,
  level: BleachingLevel = "Heavy"
): Promise<SentenceBankEntry | null> {
  // Step 1: Load the sentence bank
  const bank = loadSentenceBank();

  if (bank.length === 0) {
    console.warn("Sentence bank is empty. Cannot find match.");
    return null;
  }

  console.log(`Loaded ${bank.length} entries from sentence bank`);

  // Step 2: Compute metadata for input sentence
  const inputMeta = await computeMetadata(sentence, level);
  console.log("Input metadata:", {
    char_length: inputMeta.char_length,
    token_length: inputMeta.token_length,
    clause_count: inputMeta.clause_count,
    punctuation_pattern: inputMeta.punctuation_pattern,
  });

  // Step 3: Apply filters in order

  // Filter A: Length match (mandatory)
  let candidates = filterByLength(bank, inputMeta.char_length);
  console.log(`After length filter: ${candidates.length} candidates`);

  if (candidates.length === 0) {
    console.warn("No candidates after length filter");
    return null;
  }

  // Filter B: Clause count match (mandatory)
  candidates = filterByClauseCount(candidates, inputMeta.clause_count);
  console.log(`After clause count filter: ${candidates.length} candidates`);

  if (candidates.length === 0) {
    console.warn("No candidates after clause count filter");
    return null;
  }

  // Filter C: Punctuation pattern (prefer exact, fall back to Filter B results)
  const { candidates: punctCandidates, exactMatch } = filterByPunctuation(
    candidates,
    inputMeta.punctuation_pattern
  );
  console.log(
    `After punctuation filter: ${punctCandidates.length} candidates (exact match: ${exactMatch})`
  );

  // Filter D: Select best by syntactic skeleton similarity
  const bestMatch = selectBestCandidate(punctCandidates, inputMeta);

  if (bestMatch) {
    console.log("Best match found:", {
      original: bestMatch.original.substring(0, 50) + "...",
      score: calculateSimilarityScore(inputMeta, bestMatch),
    });
  }

  return bestMatch;
}

// ============================================
// APPEND TO SENTENCE BANK (utility for saving)
// ============================================

export function appendToSentenceBank(entries: SentenceBankEntry[]): void {
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n");
  const content = fs.existsSync(SENTENCE_BANK_PATH)
    ? fs.readFileSync(SENTENCE_BANK_PATH, "utf-8")
    : "";

  const newContent = content ? content + "\n" + lines : lines;
  fs.writeFileSync(SENTENCE_BANK_PATH, newContent, "utf-8");
  console.log(`Appended ${entries.length} entries to sentence bank`);
}
