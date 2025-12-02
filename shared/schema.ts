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

// Author styles table - stores predefined author styles (Bertrand Russell, Plato, etc.)
export const authorStyles = pgTable("author_styles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAuthorStyleSchema = createInsertSchema(authorStyles).omit({ id: true, createdAt: true });
export type InsertAuthorStyle = z.infer<typeof insertAuthorStyleSchema>;
export type AuthorStyle = typeof authorStyles.$inferSelect;

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
  authorStyleId: integer("author_style_id").references(() => authorStyles.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSentenceEntrySchema = createInsertSchema(sentenceEntries).omit({ id: true, createdAt: true });
export type InsertSentenceEntry = z.infer<typeof insertSentenceEntrySchema>;
export type SentenceEntry = typeof sentenceEntries.$inferSelect;

// ==================== API SCHEMAS ====================

// LLM Provider options - ranked by text processing capacity
export const llmProviders = ["deepseek", "anthropic", "openai", "grok", "perplexity"] as const;
export type LLMProvider = typeof llmProviders[number];

// Bleaching level options
export const bleachingLevels = ["Light", "Moderate", "Moderate-Heavy", "Heavy", "Very Heavy"] as const;
export type BleachingLevel = typeof bleachingLevels[number];

// Request schema for bleaching API
export const bleachRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
  level: z.enum(bleachingLevels),
  provider: z.enum(llmProviders).optional().default("anthropic"),
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
  provider: z.enum(llmProviders).optional().default("anthropic"),
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
  styleSample: z.string().optional().default(""), // Optional when using authorStyleId
  level: z.enum(bleachingLevels).optional().default("Heavy"),
  provider: z.enum(llmProviders).optional().default("anthropic"),
  userId: z.number().optional(), // If logged in, patterns will be saved to user's bank
  authorStyleId: z.number().optional(), // If provided, use patterns from this author instead of styleSample
}).refine(
  (data) => data.styleSample.length > 0 || data.authorStyleId !== undefined,
  { message: "Either styleSample or authorStyleId must be provided" }
);

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

// ==================== AUTHOR STYLES SCHEMAS ====================

// Create author style request schema
export const createAuthorStyleRequestSchema = z.object({
  name: z.string().min(1, "Author name is required").max(100),
  description: z.string().optional(),
});

export type CreateAuthorStyleRequest = z.infer<typeof createAuthorStyleRequestSchema>;

// Add sentences to author style request schema
export const addAuthorSentencesRequestSchema = z.object({
  sentences: z.array(sentenceBankEntrySchema).min(1, "At least one sentence is required"),
});

export type AddAuthorSentencesRequest = z.infer<typeof addAuthorSentencesRequestSchema>;

// Author style with sentence count (for listing)
export const authorStyleWithCountSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  sentenceCount: z.number(),
  createdAt: z.date(),
});

export type AuthorStyleWithCount = z.infer<typeof authorStyleWithCountSchema>;

// Rewrite using author style request schema
export const rewriteWithAuthorStyleRequestSchema = z.object({
  targetText: z.string().min(1, "Target text is required"),
  authorStyleId: z.number().min(1, "Author style ID is required"),
  level: z.enum(bleachingLevels).optional().default("Heavy"),
});

// ==================== ALL DAY MODE BATCH JOB SCHEMAS ====================

// Batch job types
export const batchJobTypes = ["bleach", "jsonl"] as const;
export type BatchJobType = typeof batchJobTypes[number];

// Batch job statuses
export const batchJobStatuses = ["pending", "processing", "paused", "completed", "failed"] as const;
export type BatchJobStatus = typeof batchJobStatuses[number];

// Batch jobs table - stores the overall job
export const batchJobs = pgTable("batch_jobs", {
  id: serial("id").primaryKey(),
  jobType: varchar("job_type", { length: 20 }).notNull(), // "bleach" or "jsonl"
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  totalSections: integer("total_sections").notNull(),
  completedSections: integer("completed_sections").notNull().default(0),
  failedSections: integer("failed_sections").notNull().default(0),
  currentSection: integer("current_section").notNull().default(0),
  bleachLevel: varchar("bleach_level", { length: 20 }).notNull(),
  provider: varchar("provider", { length: 20 }).default("anthropic"),
  nextProcessTime: timestamp("next_process_time"), // When to process next section (after 1 min break)
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  userId: integer("user_id").references(() => users.id),
});

export const insertBatchJobSchema = createInsertSchema(batchJobs).omit({ id: true, startedAt: true, completedAt: true });
export type InsertBatchJob = z.infer<typeof insertBatchJobSchema>;
export type BatchJob = typeof batchJobs.$inferSelect;

// Batch sections table - stores each 1000-word section
export const batchSections = pgTable("batch_sections", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => batchJobs.id).notNull(),
  sectionIndex: integer("section_index").notNull(), // 0-based section number
  inputText: text("input_text").notNull(), // Original text for this section
  outputText: text("output_text"), // Bleached text or JSONL output
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, processing, completed, failed
  wordCount: integer("word_count").notNull(),
  sentenceCount: integer("sentence_count").notNull().default(0),
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBatchSectionSchema = createInsertSchema(batchSections).omit({ id: true, createdAt: true });
export type InsertBatchSection = z.infer<typeof insertBatchSectionSchema>;
export type BatchSection = typeof batchSections.$inferSelect;

// API request to start an All Day Mode batch job
export const startBatchJobRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
  jobType: z.enum(batchJobTypes),
  level: z.enum(bleachingLevels).optional().default("Heavy"),
  provider: z.enum(llmProviders).optional().default("anthropic"),
  userId: z.number().optional(),
  sectionSize: z.number().optional().default(1000), // Words per section
  breakDurationMs: z.number().optional().default(60000), // 1 minute default break
});

export type StartBatchJobRequest = z.infer<typeof startBatchJobRequestSchema>;

// Batch job status response
export const batchJobStatusResponseSchema = z.object({
  id: z.number(),
  jobType: z.enum(batchJobTypes),
  status: z.enum(batchJobStatuses),
  totalSections: z.number(),
  completedSections: z.number(),
  failedSections: z.number(),
  currentSection: z.number(),
  progress: z.number(), // 0-100 percentage
  estimatedTimeRemaining: z.string().optional(), // Human readable
  nextProcessTime: z.date().nullable(),
  startedAt: z.date(),
  completedAt: z.date().nullable(),
  sections: z.array(z.object({
    id: z.number(),
    sectionIndex: z.number(),
    status: z.string(),
    wordCount: z.number(),
    hasOutput: z.boolean(),
    errorMessage: z.string().nullable(),
  })).optional(),
});

export type BatchJobStatusResponse = z.infer<typeof batchJobStatusResponseSchema>;

// ==================== CHUNK PREVIEW SCHEMAS ====================

// Individual chunk metadata
export const chunkMetadataSchema = z.object({
  id: z.number(),
  text: z.string(),
  preview: z.string(),
  wordCount: z.number(),
  sentenceCount: z.number(),
  charStart: z.number(),
  charEnd: z.number(),
});

export type ChunkMetadata = z.infer<typeof chunkMetadataSchema>;

// Chunk preview request schema
export const chunkPreviewRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
  chunkSize: z.number().optional().default(2000), // words per chunk
});

export type ChunkPreviewRequest = z.infer<typeof chunkPreviewRequestSchema>;

// Chunk preview response schema
export const chunkPreviewResponseSchema = z.object({
  chunks: z.array(chunkMetadataSchema),
  totalWords: z.number(),
  totalSentences: z.number(),
  needsChunking: z.boolean(),
});

export type ChunkPreviewResponse = z.infer<typeof chunkPreviewResponseSchema>;

// Modified bleach request that accepts selected chunks
export const bleachChunkedRequestSchema = z.object({
  chunks: z.array(z.object({
    id: z.number(),
    text: z.string(),
  })),
  level: z.enum(bleachingLevels),
});

export type BleachChunkedRequest = z.infer<typeof bleachChunkedRequestSchema>;

// Sentence bank request with chunks
export const sentenceBankChunkedRequestSchema = z.object({
  chunks: z.array(z.object({
    id: z.number(),
    text: z.string(),
  })),
  level: z.enum(bleachingLevels),
  userId: z.number().optional(),
});

export type SentenceBankChunkedRequest = z.infer<typeof sentenceBankChunkedRequestSchema>;
