import { z } from "zod";
import { pgTable, text, serial, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// ==================== DATABASE TABLES ====================

// Users table - simple username-only auth
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Sentence entries table - stores sentence bank data
export const sentenceEntries = pgTable("sentence_entries", {
  id: serial("id").primaryKey(),
  original: text("original").notNull(),
  bleached: text("bleached").notNull(),
  charLength: integer("char_length").notNull(),
  tokenLength: integer("token_length").notNull(),
  clauseCount: integer("clause_count").notNull(),
  clauseOrder: text("clause_order").notNull(),
  punctuationPattern: text("punctuation_pattern").notNull(),
  structure: text("structure").notNull(),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSentenceEntrySchema = createInsertSchema(sentenceEntries).omit({ id: true, createdAt: true });
export type InsertSentenceEntry = z.infer<typeof insertSentenceEntrySchema>;
export type SentenceEntry = typeof sentenceEntries.$inferSelect;

// ==================== API SCHEMAS ====================

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
  char_length: z.coerce.number(),
  token_length: z.coerce.number(),
  clause_count: z.coerce.number(),
  clause_order: z.string().optional().default('main → subordinate'),
  punctuation_pattern: z.string().optional().default(''),
  structure: z.string().optional(),
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

// Login request schema
export const loginRequestSchema = z.object({
  username: z.string().min(1, "Username is required").max(100, "Username too long"),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

// ==================== HUMANIZER SCHEMAS (Step 3) ====================

// Prefiltered candidate from Layer 2
export const prefilteredCandidateSchema = z.object({
  original: z.string(),
  bleached: z.string(),
  structure: z.string().optional(),
  charLength: z.number(),
  tokenLength: z.number(),
  clauseCount: z.number(),
  clauseOrder: z.string(),
  punctuationPattern: z.string(),
  score: z.number().optional(),
});

export type PrefilteredCandidate = z.infer<typeof prefilteredCandidateSchema>;

// Humanize request schema
export const humanizeRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
  level: z.enum(bleachingLevels).optional().default("Heavy"),
  // Optional prefiltered candidates from Layer 2 to avoid rescanning entire bank
  prefilteredCandidates: z.array(prefilteredCandidateSchema).optional(),
});

export type HumanizeRequest = z.infer<typeof humanizeRequestSchema>;

// Matched pattern in response
export const matchedPatternSchema = z.object({
  original: z.string(),
  bleached: z.string(),
  score: z.number(),
  rank: z.number(),
});

export type MatchedPattern = z.infer<typeof matchedPatternSchema>;

// Individual humanized sentence result
export const humanizedSentenceSchema = z.object({
  aiSentence: z.string(),
  matchedPatterns: z.array(matchedPatternSchema),
  humanizedRewrite: z.string(),
  bestPattern: z.object({
    original: z.string(),
    bleached: z.string(),
    score: z.number(),
  }),
});

export type HumanizedSentence = z.infer<typeof humanizedSentenceSchema>;

// Humanize response schema
export const humanizeResponseSchema = z.object({
  sentences: z.array(humanizedSentenceSchema),
  totalSentences: z.number(),
  successfulRewrites: z.number(),
  bankSize: z.number(),
});

export type HumanizeResponse = z.infer<typeof humanizeResponseSchema>;

// Upload JSONL request schema  
export const uploadJsonlRequestSchema = z.object({
  jsonlContent: z.string().min(1, "JSONL content is required"),
  filename: z.string().optional(),
});

export type UploadJsonlRequest = z.infer<typeof uploadJsonlRequestSchema>;

// GPTZero AI detection request schema
export const gptzeroRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
});

export type GPTZeroRequest = z.infer<typeof gptzeroRequestSchema>;

// GPTZero AI detection response schema
export const gptzeroResponseSchema = z.object({
  documentClassification: z.enum(["HUMAN_ONLY", "MIXED", "AI_ONLY"]),
  averageGeneratedProb: z.number(),
  completelyGeneratedProb: z.number(),
  confidenceCategory: z.string(),
  sentences: z.array(z.object({
    sentence: z.string(),
    generatedProb: z.number(),
    perplexity: z.number(),
    highlightForAi: z.boolean(),
  })).optional(),
});

export type GPTZeroResponse = z.infer<typeof gptzeroResponseSchema>;

// ==================== REWRITE IN STYLE SCHEMAS ====================

// Rewrite in style request schema
export const rewriteStyleRequestSchema = z.object({
  targetText: z.string().min(1, "Target text is required"),
  styleSample: z.string().min(1, "Style sample is required"),
  level: z.enum(bleachingLevels).optional().default("Heavy"),
  userId: z.number().optional(), // If logged in, patterns will be saved to user's bank
});

export type RewriteStyleRequest = z.infer<typeof rewriteStyleRequestSchema>;

// Individual rewritten sentence
export const rewrittenSentenceSchema = z.object({
  original: z.string(),
  rewrite: z.string(),
  matchedPattern: z.object({
    original: z.string(),
    bleached: z.string(),
    score: z.number(),
  }).nullable(),
});

export type RewrittenSentence = z.infer<typeof rewrittenSentenceSchema>;

// Rewrite in style response schema
export const rewriteStyleResponseSchema = z.object({
  sentences: z.array(rewrittenSentenceSchema),
  combinedRewrite: z.string(),
  totalSentences: z.number(),
  successfulRewrites: z.number(),
  stylePatternsExtracted: z.number(),
  patternsSavedToBank: z.number().optional(), // How many new patterns were saved (for logged-in users)
});

export type RewriteStyleResponse = z.infer<typeof rewriteStyleResponseSchema>;

// ==================== CONTENT SIMILARITY SCHEMAS ====================

// Content similarity request schema
export const contentSimilarityRequestSchema = z.object({
  originalText: z.string().min(1, "Original text is required"),
  rewrittenText: z.string().min(1, "Rewritten text is required"),
});

export type ContentSimilarityRequest = z.infer<typeof contentSimilarityRequestSchema>;

// Content similarity response schema
export const contentSimilarityResponseSchema = z.object({
  similarityScore: z.number().min(0).max(100), // 0-100 percentage
  agreementSummary: z.string(), // What content is preserved
  discrepancies: z.string(), // What content differs or is lost
});

export type ContentSimilarityResponse = z.infer<typeof contentSimilarityResponseSchema>;
