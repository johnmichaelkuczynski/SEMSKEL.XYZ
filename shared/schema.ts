import { z } from "zod";

// Bleaching level options
export const bleachingLevels = ["Light", "Moderate", "Moderate-Heavy", "Heavy", "Very Heavy"] as const;
export type BleachingLevel = typeof bleachingLevels[number];

// Request schema for bleaching API
export const bleachRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
  level: z.enum(bleachingLevels),
  filename: z.string().optional(),
});

export type BleachRequest = z.infer<typeof bleachRequestSchema>;

// Response schema for bleaching API
export const bleachResponseSchema = z.object({
  bleachedText: z.string(),
  originalFilename: z.string().optional(),
});

export type BleachResponse = z.infer<typeof bleachResponseSchema>;

// Sentence bank request schema
export const sentenceBankRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
  level: z.enum(bleachingLevels),
});

export type SentenceBankRequest = z.infer<typeof sentenceBankRequestSchema>;

// Sentence bank response schema
export const sentenceBankResponseSchema = z.object({
  jsonlContent: z.string(),
  sentenceCount: z.number(),
  totalBankSize: z.number().optional(),
});

export type SentenceBankResponse = z.infer<typeof sentenceBankResponseSchema>;

// Sentence bank entry schema (single entry in sentence_bank.jsonl)
export const sentenceBankEntrySchema = z.object({
  original: z.string(),
  bleached: z.string(),
  char_length: z.number(),
  token_length: z.number(),
  clause_count: z.number(),
  clause_order: z.string(),
  punctuation_pattern: z.string(),
  structure: z.string(),
});

export type SentenceBankEntry = z.infer<typeof sentenceBankEntrySchema>;

// Match request schema (for Step 2 matching engine)
export const matchRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
  level: z.enum(bleachingLevels).optional().default("Heavy"),
});

export type MatchRequest = z.infer<typeof matchRequestSchema>;

// Individual match result
export const matchResultSchema = z.object({
  original: z.string(),
  pattern: z.string().nullable(),
  matchedEntry: sentenceBankEntrySchema.nullable(),
  inputMetadata: z.object({
    char_length: z.number(),
    token_length: z.number(),
    clause_count: z.number(),
    punctuation_pattern: z.string(),
    bleached: z.string(),
  }),
});

export type MatchResult = z.infer<typeof matchResultSchema>;

// Match response schema
export const matchResponseSchema = z.object({
  matches: z.array(matchResultSchema),
  totalSentences: z.number(),
  matchedCount: z.number(),
  bankSize: z.number(),
});

export type MatchResponse = z.infer<typeof matchResponseSchema>;
