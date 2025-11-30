import type { Express } from "express";
import { createServer, type Server } from "http";
import { bleachText } from "./bleach";
import { storage } from "./storage";
import { 
  bleachRequestSchema, 
  sentenceBankRequestSchema, 
  matchRequestSchema,
  loginRequestSchema,
  uploadJsonlRequestSchema,
  sentenceBankEntrySchema,
  humanizeRequestSchema,
  gptzeroRequestSchema,
  rewriteStyleRequestSchema,
  contentSimilarityRequestSchema,
  createAuthorStyleRequestSchema,
  addAuthorSentencesRequestSchema,
  rewriteWithAuthorStyleRequestSchema,
  chunkPreviewRequestSchema,
  bleachChunkedRequestSchema,
  sentenceBankChunkedRequestSchema,
  type InsertSentenceEntry,
  type ChunkMetadata,
} from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";
import { findBestMatch, loadSentenceBank, computeMetadata } from "./matcher";
import { humanizeText } from "./humanizer";
import { rewriteInStyle } from "./rewriteInStyle";
import { z } from "zod";

// GPTZero API configuration
const GPTZERO_API_URL = "https://api.gptzero.me/v2/predict/text";
const GPTZERO_API_KEY = process.env.GPTZERO_API_KEY;

const CLAUSE_TRIGGERS = ['when', 'because', 'although', 'if', 'while', 'since', 'but'];

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// Split text into chunks of approximately targetWordCount words, preserving sentence boundaries
function splitIntoWordChunks(text: string, targetWordCount: number = 2000): string[] {
  const sentences = splitIntoSentences(text);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentWordCount = 0;
  
  for (const sentence of sentences) {
    const sentenceWordCount = sentence.split(/\s+/).filter(w => w.length > 0).length;
    
    // If adding this sentence would exceed target and we have content, start new chunk
    if (currentWordCount > 0 && currentWordCount + sentenceWordCount > targetWordCount) {
      chunks.push(currentChunk.join(' '));
      currentChunk = [sentence];
      currentWordCount = sentenceWordCount;
    } else {
      currentChunk.push(sentence);
      currentWordCount += sentenceWordCount;
    }
  }
  
  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }
  
  return chunks;
}

function countClauses(sentence: string): number {
  const lowerSentence = sentence.toLowerCase();
  let count = 0;
  for (const trigger of CLAUSE_TRIGGERS) {
    const regex = new RegExp(`\\b${trigger}\\b`, 'gi');
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
    if (lowerSentence.startsWith(trigger + ' ') || lowerSentence.startsWith(trigger + ',')) {
      return 'subordinate → main';
    }
  }
  return 'main → subordinate';
}

function extractPunctuationPattern(sentence: string): string {
  return sentence.replace(/[^.,;:!?'"()\-—]/g, '');
}

function countTokens(sentence: string): number {
  return sentence.split(/\s+/).filter(t => t.length > 0).length;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Helper: delay function
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Helper: process a single sentence with retry logic
  async function processSentenceWithRetry(
    sentence: string,
    level: any,
    maxRetries = 3
  ): Promise<InsertSentenceEntry | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const bleached = await bleachText(sentence, level);
        
        return {
          original: sentence,
          bleached: bleached,
          charLength: sentence.length,
          tokenLength: countTokens(sentence),
          clauseCount: countClauses(sentence),
          clauseOrder: getClauseOrder(sentence),
          punctuationPattern: extractPunctuationPattern(sentence),
          structure: bleached,
          userId: null,
        };
      } catch (error: any) {
        const errorMessage = (error?.message || '').toLowerCase();
        const isRateLimit = error?.status === 429 || 
          errorMessage.includes('rate') || 
          errorMessage.includes('limit') ||
          errorMessage.includes('overloaded');
        
        if (isRateLimit && attempt < maxRetries) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
          await delay(waitTime);
        } else if (attempt === maxRetries) {
          console.error(`Failed after ${maxRetries} attempts: ${sentence.substring(0, 50)}...`, error);
          return null;
        }
      }
    }
    return null;
  }

  // ==================== AUTH ENDPOINTS ====================

  // Login/Register endpoint (simple username-only auth)
  app.post("/api/login", async (req, res) => {
    try {
      const { username } = loginRequestSchema.parse(req.body);
      
      // Check if user exists, create if not
      let user = await storage.getUserByUsername(username);
      
      if (!user) {
        user = await storage.createUser({ username });
        console.log(`Created new user: ${username}`);
      } else {
        console.log(`User logged in: ${username}`);
      }
      
      res.json({
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
      });
    } catch (error) {
      console.error("Login error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Login failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // Get user stats
  app.get("/api/user/:username/stats", async (req, res) => {
    try {
      const user = await storage.getUserByUsername(req.params.username);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const sentenceCount = await storage.getUserSentenceCount(user.id);
      
      res.json({
        username: user.username,
        sentenceCount,
        createdAt: user.createdAt,
      });
    } catch (error) {
      console.error("User stats error:", error);
      res.status(500).json({ error: "Failed to get user stats" });
    }
  });

  // ==================== BLEACHING ENDPOINTS ====================

  // Bleaching API endpoint with automatic chunking for large texts
  app.post("/api/bleach", async (req, res) => {
    try {
      const validatedData = bleachRequestSchema.parse(req.body);

      if (validatedData.text.length > 5000000) {
        return res.status(400).json({
          error: "Text too long",
          message: "Please limit your text to 5 million characters or less.",
        });
      }

      // Check word count to determine if chunking is needed
      const wordCount = validatedData.text.split(/\s+/).filter(w => w.length > 0).length;
      const CHUNK_SIZE = 2000; // words per chunk
      
      if (wordCount <= CHUNK_SIZE) {
        // Small text - process directly
        const bleachedText = await bleachText(validatedData.text, validatedData.level);
        return res.json({
          bleachedText,
          originalFilename: validatedData.filename,
          chunksProcessed: 1,
          totalChunks: 1,
        });
      }
      
      // Large text - split into chunks and process sequentially
      const chunks = splitIntoWordChunks(validatedData.text, CHUNK_SIZE);
      const totalChunks = chunks.length;
      console.log(`Bleaching large text: ${wordCount} words split into ${totalChunks} chunks`);
      
      const bleachedChunks: string[] = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunkNum = i + 1;
        console.log(`Processing chunk ${chunkNum}/${totalChunks}...`);
        
        // Retry logic for each chunk
        let retries = 3;
        let bleachedChunk = null;
        
        while (retries > 0 && !bleachedChunk) {
          try {
            bleachedChunk = await bleachText(chunks[i], validatedData.level);
          } catch (error: any) {
            retries--;
            if (retries > 0) {
              const waitTime = Math.pow(2, 3 - retries) * 1000;
              console.log(`Chunk ${chunkNum} failed, retrying in ${waitTime}ms...`);
              await delay(waitTime);
            } else {
              throw error;
            }
          }
        }
        
        if (bleachedChunk) {
          bleachedChunks.push(bleachedChunk);
        }
        
        // Small delay between chunks to avoid rate limits
        if (i < chunks.length - 1) {
          await delay(500);
        }
      }
      
      console.log(`Completed bleaching all ${totalChunks} chunks`);
      
      res.json({
        bleachedText: bleachedChunks.join('\n\n\n'), // Triple newline to preserve paragraph separation between chunks
        originalFilename: validatedData.filename,
        chunksProcessed: bleachedChunks.length,
        totalChunks,
      });
    } catch (error) {
      console.error("Bleaching API error:", error);

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }

      res.status(500).json({
        error: "Bleaching failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // ==================== CHUNK PREVIEW ENDPOINTS ====================
  
  // Generate chunk preview for large texts - lets users select which chunks to process
  app.post("/api/chunk-preview", async (req, res) => {
    try {
      const validatedData = chunkPreviewRequestSchema.parse(req.body);
      const text = validatedData.text;
      const chunkSize = validatedData.chunkSize || 2000;
      
      // Split text into sentences first
      const sentences = splitIntoSentences(text);
      const totalWords = text.split(/\s+/).filter(w => w.length > 0).length;
      const totalSentences = sentences.length;
      
      // Determine if chunking is needed
      const needsChunking = totalWords > chunkSize;
      
      if (!needsChunking) {
        // Return single chunk for small texts
        const preview = text.substring(0, 150) + (text.length > 150 ? "..." : "");
        const chunks: ChunkMetadata[] = [{
          id: 0,
          text: text,
          preview,
          wordCount: totalWords,
          sentenceCount: totalSentences,
          charStart: 0,
          charEnd: text.length,
        }];
        
        return res.json({
          chunks,
          totalWords,
          totalSentences,
          needsChunking: false,
        });
      }
      
      // Split into chunks by word count while preserving sentence boundaries
      const chunks: ChunkMetadata[] = [];
      let currentChunkSentences: string[] = [];
      let currentWordCount = 0;
      let chunkId = 0;
      let charStart = 0;
      
      for (const sentence of sentences) {
        const sentenceWordCount = sentence.split(/\s+/).filter(w => w.length > 0).length;
        
        // If adding this sentence would exceed target and we have content, start new chunk
        if (currentWordCount > 0 && currentWordCount + sentenceWordCount > chunkSize) {
          const chunkText = currentChunkSentences.join(' ');
          const charEnd = charStart + chunkText.length;
          const preview = chunkText.substring(0, 100) + (chunkText.length > 100 ? "..." : "");
          
          chunks.push({
            id: chunkId++,
            text: chunkText,
            preview,
            wordCount: currentWordCount,
            sentenceCount: currentChunkSentences.length,
            charStart,
            charEnd,
          });
          
          charStart = charEnd + 1; // +1 for space between chunks
          currentChunkSentences = [sentence];
          currentWordCount = sentenceWordCount;
        } else {
          currentChunkSentences.push(sentence);
          currentWordCount += sentenceWordCount;
        }
      }
      
      // Don't forget the last chunk
      if (currentChunkSentences.length > 0) {
        const chunkText = currentChunkSentences.join(' ');
        const charEnd = charStart + chunkText.length;
        const preview = chunkText.substring(0, 100) + (chunkText.length > 100 ? "..." : "");
        
        chunks.push({
          id: chunkId,
          text: chunkText,
          preview,
          wordCount: currentWordCount,
          sentenceCount: currentChunkSentences.length,
          charStart,
          charEnd,
        });
      }
      
      console.log(`Text chunked into ${chunks.length} chunks (${totalWords} words, ${totalSentences} sentences)`);
      
      res.json({
        chunks,
        totalWords,
        totalSentences,
        needsChunking: true,
      });
    } catch (error) {
      console.error("Chunk preview error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Chunk preview failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });
  
  // Bleach selected chunks only
  app.post("/api/bleach-chunks", async (req, res) => {
    try {
      const validatedData = bleachChunkedRequestSchema.parse(req.body);
      const { chunks, level } = validatedData;
      
      if (chunks.length === 0) {
        return res.status(400).json({
          error: "No chunks selected",
          message: "Please select at least one chunk to process.",
        });
      }
      
      console.log(`Bleaching ${chunks.length} selected chunks...`);
      
      const bleachedChunks: string[] = [];
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`Bleaching chunk ${i + 1}/${chunks.length} (${chunk.text.split(/\s+/).length} words)`);
        
        // Use retry logic for rate limits
        let bleachedChunk: string | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            bleachedChunk = await bleachText(chunk.text, level);
            break;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg.includes("rate_limit") || errorMsg.includes("overloaded")) {
              console.log(`Rate limited on chunk ${i + 1}, attempt ${attempt}/3. Waiting...`);
              await delay(3000 * attempt);
            } else {
              throw error;
            }
          }
        }
        
        if (bleachedChunk) {
          bleachedChunks.push(bleachedChunk);
        }
        
        // Small delay between chunks
        if (i < chunks.length - 1) {
          await delay(500);
        }
      }
      
      console.log(`Completed bleaching ${chunks.length} chunks`);
      
      res.json({
        bleachedText: bleachedChunks.join('\n\n\n'),
        chunksProcessed: bleachedChunks.length,
        totalChunks: chunks.length,
      });
    } catch (error) {
      console.error("Bleach chunks error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Bleaching failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });
  
  // Build sentence bank from selected chunks only
  app.post("/api/build-sentence-bank-chunks", async (req, res) => {
    try {
      const validatedData = sentenceBankChunkedRequestSchema.parse(req.body);
      const { chunks, level, userId } = validatedData;
      
      if (chunks.length === 0) {
        return res.status(400).json({
          error: "No chunks selected",
          message: "Please select at least one chunk to process.",
        });
      }
      
      console.log(`Building sentence bank from ${chunks.length} selected chunks...`);
      
      const SENTENCE_BATCH_SIZE = 5;
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const allEntries: InsertSentenceEntry[] = [];
      
      for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        const chunk = chunks[chunkIdx];
        const sentences = splitIntoSentences(chunk.text);
        
        console.log(`Processing chunk ${chunkIdx + 1}/${chunks.length} (${sentences.length} sentences)`);
        
        for (let i = 0; i < sentences.length; i += SENTENCE_BATCH_SIZE) {
          const batch = sentences.slice(i, i + SENTENCE_BATCH_SIZE);
          
          const batchResults = await Promise.all(
            batch.map(sentence => processSentenceWithRetry(sentence, level))
          );
          
          for (const result of batchResults) {
            if (result) {
              allEntries.push({
                original: result.original,
                bleached: result.bleached,
                charLength: result.charLength,
                tokenLength: result.tokenLength,
                clauseCount: result.clauseCount,
                clauseOrder: result.clauseOrder || "main → subordinate",
                punctuationPattern: result.punctuationPattern || "",
                structure: result.structure || result.bleached,
                userId: userId || null,
              });
            }
          }
          
          // Delay between batches
          if (i + SENTENCE_BATCH_SIZE < sentences.length) {
            await delay(500);
          }
        }
        
        // Delay between chunks
        if (chunkIdx < chunks.length - 1) {
          await delay(500);
        }
      }
      
      // Generate JSONL output
      const jsonlOutput = allEntries.map(entry => JSON.stringify({
        original: entry.original,
        bleached: entry.bleached,
        char_length: entry.charLength,
        token_length: entry.tokenLength,
        clause_count: entry.clauseCount,
        clause_order: entry.clauseOrder,
        punctuation_pattern: entry.punctuationPattern,
        structure: entry.structure,
      })).join('\n');
      
      // Save to database if userId provided
      let savedCount = 0;
      if (userId && allEntries.length > 0) {
        savedCount = await storage.addSentenceEntries(allEntries);
        console.log(`Saved ${savedCount} entries to user's bank`);
      }
      
      console.log(`Completed building sentence bank: ${allEntries.length} entries from ${chunks.length} chunks`);
      
      res.json({
        jsonl: jsonlOutput,
        entries: allEntries.length,
        chunksProcessed: chunks.length,
        savedToBank: savedCount,
      });
    } catch (error) {
      console.error("Build sentence bank chunks error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Sentence bank build failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // ==================== SENTENCE BANK ENDPOINTS ====================

  // Sentence Bank API endpoint (build from text) with automatic chunking for large texts
  app.post("/api/build-sentence-bank", async (req, res) => {
    try {
      const validatedData = sentenceBankRequestSchema.parse(req.body);
      const userId = req.body.userId ? parseInt(req.body.userId) : null;
      
      // First check if text has sentences
      const allSentences = splitIntoSentences(validatedData.text);
      if (allSentences.length === 0) {
        return res.status(400).json({
          error: "No sentences found",
          message: "Could not find any sentences in the provided text.",
        });
      }
      
      // Calculate word count for chunking
      const wordCount = validatedData.text.split(/\s+/).filter(w => w.length > 0).length;
      const WORD_CHUNK_SIZE = 2000;
      
      const SENTENCE_BATCH_SIZE = 5;
      const DELAY_BETWEEN_BATCHES = 500;
      const allEntries: InsertSentenceEntry[] = [];
      let totalWordChunks = 1;
      
      // For small texts (< 2000 words), skip chunking and process directly
      if (wordCount <= WORD_CHUNK_SIZE) {
        console.log(`Processing ${wordCount} words (${allSentences.length} sentences) directly...`);
        
        for (let i = 0; i < allSentences.length; i += SENTENCE_BATCH_SIZE) {
          const batch = allSentences.slice(i, i + SENTENCE_BATCH_SIZE);
          const batchNum = Math.floor(i / SENTENCE_BATCH_SIZE) + 1;
          const totalBatches = Math.ceil(allSentences.length / SENTENCE_BATCH_SIZE);
          
          console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} sentences)`);
          
          const batchResults = await Promise.all(
            batch.map(sentence => processSentenceWithRetry(sentence, validatedData.level))
          );
          
          const validResults = batchResults.filter((r): r is InsertSentenceEntry => r !== null);
          
          if (userId) {
            validResults.forEach(entry => entry.userId = userId);
          }
          
          allEntries.push(...validResults);
          
          if (i + SENTENCE_BATCH_SIZE < allSentences.length) {
            await delay(DELAY_BETWEEN_BATCHES);
          }
        }
      } else {
        // Large text - split into word-based chunks
        const wordChunks = splitIntoWordChunks(validatedData.text, WORD_CHUNK_SIZE);
        totalWordChunks = wordChunks.length;
        
        console.log(`Processing ${wordCount} words in ${totalWordChunks} chunk(s) for JSONL generation...`);
        
        // Process each word chunk
        for (let chunkIndex = 0; chunkIndex < wordChunks.length; chunkIndex++) {
          const chunk = wordChunks[chunkIndex];
          const chunkNum = chunkIndex + 1;
          
          console.log(`\n=== Processing word chunk ${chunkNum}/${totalWordChunks} ===`);
          
          const sentences = splitIntoSentences(chunk);
          
          if (sentences.length === 0) {
            console.log(`Chunk ${chunkNum}: No sentences found, skipping`);
            continue;
          }
          
          const totalSentences = sentences.length;
          console.log(`Chunk ${chunkNum}: ${totalSentences} sentences to process`);
          
          // Process sentences in batches within this chunk
          for (let i = 0; i < sentences.length; i += SENTENCE_BATCH_SIZE) {
            const batch = sentences.slice(i, i + SENTENCE_BATCH_SIZE);
            const batchNum = Math.floor(i / SENTENCE_BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(sentences.length / SENTENCE_BATCH_SIZE);
            
            console.log(`  Chunk ${chunkNum}/${totalWordChunks} - Batch ${batchNum}/${totalBatches}`);
            
            const batchResults = await Promise.all(
              batch.map(sentence => processSentenceWithRetry(sentence, validatedData.level))
            );
            
            const validResults = batchResults.filter((r): r is InsertSentenceEntry => r !== null);
            
            // Associate with user if logged in
            if (userId) {
              validResults.forEach(entry => entry.userId = userId);
            }
            
            allEntries.push(...validResults);
            
            if (i + SENTENCE_BATCH_SIZE < sentences.length) {
              await delay(DELAY_BETWEEN_BATCHES);
            }
          }
          
          // Delay between word chunks
          if (chunkIndex < wordChunks.length - 1) {
            console.log(`Chunk ${chunkNum} complete. Brief pause before next chunk...`);
            await delay(1000);
          }
        }
      }
      
      console.log(`\nCompleted processing. Total entries: ${allEntries.length}`);
      
      // Save to database
      let totalBankSize = 0;
      try {
        await storage.addSentenceEntries(allEntries);
        totalBankSize = await storage.getSentenceEntryCount();
        console.log(`Saved ${allEntries.length} entries to database. Total bank size: ${totalBankSize}`);
      } catch (dbError) {
        console.error("Error saving to database:", dbError);
      }
      
      // Generate JSONL for display
      const jsonlContent = allEntries.map(entry => JSON.stringify({
        original: entry.original,
        bleached: entry.bleached,
        char_length: entry.charLength,
        token_length: entry.tokenLength,
        clause_count: entry.clauseCount,
        clause_order: entry.clauseOrder,
        punctuation_pattern: entry.punctuationPattern,
        structure: entry.structure,
      })).join('\n');
      
      res.json({
        jsonlContent,
        sentenceCount: allEntries.length,
        totalBankSize,
        chunksProcessed: totalWordChunks,
        totalChunks: totalWordChunks,
      });
    } catch (error) {
      console.error("Sentence bank API error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Sentence bank generation failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // Upload JSONL file to sentence bank
  // Helper: Parse TXT format (readable format with "--- Pattern X ---")
  function parseTxtFormat(content: string): { entries: InsertSentenceEntry[], errors: string[] } {
    const entries: InsertSentenceEntry[] = [];
    const errors: string[] = [];
    
    // Split by pattern markers
    const patternBlocks = content.split(/---\s*Pattern\s*\d+\s*---/i).filter(block => block.trim());
    
    for (let i = 0; i < patternBlocks.length; i++) {
      const block = patternBlocks[i];
      
      // Extract fields from each block
      const originalMatch = block.match(/Original:\s*(.+?)(?:\n|$)/i);
      const bleachedMatch = block.match(/Bleached:\s*(.+?)(?:\n|$)/i);
      const statsMatch = block.match(/Chars:\s*(\d+)\s*\|\s*Tokens:\s*(\d+)\s*\|\s*Clauses:\s*(\d+)/i);
      const clauseOrderMatch = block.match(/Clause Order:\s*(.+?)(?:\n|$)/i);
      const punctMatch = block.match(/Punctuation:\s*(.+?)(?:\n|$)/i);
      
      if (originalMatch && bleachedMatch) {
        const original = originalMatch[1].trim();
        const bleached = bleachedMatch[1].trim();
        
        entries.push({
          original,
          bleached,
          charLength: statsMatch ? parseInt(statsMatch[1]) : original.length,
          tokenLength: statsMatch ? parseInt(statsMatch[2]) : original.split(/\s+/).length,
          clauseCount: statsMatch ? parseInt(statsMatch[3]) : 1,
          clauseOrder: clauseOrderMatch ? clauseOrderMatch[1].trim() : 'main → subordinate',
          punctuationPattern: punctMatch && punctMatch[1].trim() !== '(none)' ? punctMatch[1].trim() : '',
          structure: bleached,
          userId: null,
        });
      } else if (block.trim() && !block.includes('SENTENCE BANK') && !block.includes('Total Patterns')) {
        errors.push(`Block ${i + 1}: Missing Original or Bleached field`);
      }
    }
    
    return { entries, errors };
  }

  app.post("/api/sentence-bank/upload", async (req, res) => {
    try {
      const { jsonlContent, filename } = uploadJsonlRequestSchema.parse(req.body);
      const userId = req.body.userId ? parseInt(req.body.userId) : null;
      
      const entries: InsertSentenceEntry[] = [];
      const errors: string[] = [];
      
      // Detect format: JSONL or TXT
      const isJsonl = jsonlContent.trim().startsWith('{') || 
        (jsonlContent.split('\n').filter(l => l.trim()).some(line => {
          try { JSON.parse(line); return true; } catch { return false; }
        }));
      
      if (isJsonl) {
        // Parse JSONL content
        const lines = jsonlContent.split('\n').filter(line => line.trim());
        
        for (let i = 0; i < lines.length; i++) {
          try {
            const parsed = JSON.parse(lines[i]);
            const validated = sentenceBankEntrySchema.parse(parsed);
            
            entries.push({
              original: validated.original,
              bleached: validated.bleached,
              charLength: validated.char_length,
              tokenLength: validated.token_length,
              clauseCount: validated.clause_count,
              clauseOrder: validated.clause_order || 'main → subordinate',
              punctuationPattern: validated.punctuation_pattern || '',
              structure: validated.structure || validated.bleached,
              userId: userId,
            });
          } catch (parseError) {
            errors.push(`Line ${i + 1}: Invalid entry`);
          }
        }
      } else {
        // Parse TXT format
        const result = parseTxtFormat(jsonlContent);
        entries.push(...result.entries.map(e => ({ ...e, userId })));
        errors.push(...result.errors);
      }
      
      if (entries.length === 0) {
        return res.status(400).json({
          error: "No valid entries",
          message: "Could not parse any valid entries from the file.",
          errors,
        });
      }
      
      // Save to database
      const insertedCount = await storage.addSentenceEntries(entries);
      const totalBankSize = await storage.getSentenceEntryCount();
      
      console.log(`Uploaded ${insertedCount} entries from ${filename || 'file'}. Total: ${totalBankSize}`);
      
      res.json({
        message: "Upload successful",
        uploadedCount: entries.length,
        totalBankSize,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Upload error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Upload failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // Get sentence bank status
  app.get("/api/sentence-bank/status", async (req, res) => {
    try {
      const count = await storage.getSentenceEntryCount();
      res.json({ count });
    } catch (error) {
      console.error("Error getting bank status:", error);
      res.json({ count: 0 });
    }
  });

  // Get full sentence bank content
  app.get("/api/sentence-bank", async (req, res) => {
    try {
      const entries = await storage.getAllSentenceEntries();
      
      // Convert to expected format
      const formattedEntries = entries.map(entry => ({
        original: entry.original,
        bleached: entry.bleached,
        char_length: entry.charLength,
        token_length: entry.tokenLength,
        clause_count: entry.clauseCount,
        clause_order: entry.clauseOrder,
        punctuation_pattern: entry.punctuationPattern,
        structure: entry.structure,
      }));
      
      res.json({ entries: formattedEntries, count: entries.length });
    } catch (error) {
      console.error("Error reading sentence bank:", error);
      res.status(500).json({ error: "Failed to read sentence bank" });
    }
  });

  // Get user's sentence bank entries
  app.get("/api/sentence-bank/user/:username", async (req, res) => {
    try {
      const user = await storage.getUserByUsername(req.params.username);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const entries = await storage.getSentenceEntriesByUser(user.id);
      
      const formattedEntries = entries.map(entry => ({
        original: entry.original,
        bleached: entry.bleached,
        char_length: entry.charLength,
        token_length: entry.tokenLength,
        clause_count: entry.clauseCount,
        clause_order: entry.clauseOrder,
        punctuation_pattern: entry.punctuationPattern,
        structure: entry.structure,
      }));
      
      res.json({ 
        username: user.username,
        entries: formattedEntries, 
        count: entries.length 
      });
    } catch (error) {
      console.error("Error reading user sentence bank:", error);
      res.status(500).json({ error: "Failed to read user sentence bank" });
    }
  });

  // ==================== MATCHING ENDPOINTS ====================

  // Match AI text to human patterns (Step 2)
  app.post("/api/match", async (req, res) => {
    try {
      const validatedData = matchRequestSchema.parse(req.body);
      
      // Check sentence bank exists
      const bank = await loadSentenceBank();
      if (bank.length === 0) {
        return res.status(400).json({
          error: "Empty sentence bank",
          message: "Please add human text patterns to the sentence bank first.",
        });
      }
      
      // Split text into sentences
      const sentences = splitIntoSentences(validatedData.text);
      
      if (sentences.length === 0) {
        return res.status(400).json({
          error: "No sentences found",
          message: "Could not find any sentences in the provided text.",
        });
      }
      
      console.log(`Matching ${sentences.length} AI sentences against ${bank.length} patterns...`);
      
      const BATCH_SIZE = 5;
      const matches: Array<{
        original: string;
        pattern: string | null;
        matchedEntry: any | null;
        inputMetadata: {
          char_length: number;
          token_length: number;
          clause_count: number;
          punctuation_pattern: string;
          bleached: string;
        };
      }> = [];
      
      for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
        const batch = sentences.slice(i, i + BATCH_SIZE);
        console.log(`Matching batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(sentences.length/BATCH_SIZE)}`);
        
        const batchResults = await Promise.all(
          batch.map(async (sentence) => {
            try {
              const metadata = await computeMetadata(sentence, validatedData.level);
              const match = await findBestMatch(sentence, validatedData.level);
              
              return {
                original: sentence,
                pattern: match?.bleached || null,
                matchedEntry: match,
                inputMetadata: {
                  char_length: metadata.char_length,
                  token_length: metadata.token_length,
                  clause_count: metadata.clause_count,
                  punctuation_pattern: metadata.punctuation_pattern,
                  bleached: metadata.bleached,
                },
              };
            } catch (error) {
              console.error(`Error matching sentence: ${sentence.substring(0, 50)}...`, error);
              return {
                original: sentence,
                pattern: null,
                matchedEntry: null,
                inputMetadata: {
                  char_length: sentence.length,
                  token_length: countTokens(sentence),
                  clause_count: countClauses(sentence),
                  punctuation_pattern: extractPunctuationPattern(sentence),
                  bleached: "",
                },
              };
            }
          })
        );
        
        matches.push(...batchResults);
      }
      
      const matchedCount = matches.filter(m => m.pattern !== null).length;
      console.log(`Matched ${matchedCount}/${sentences.length} sentences`);
      
      res.json({
        matches,
        totalSentences: sentences.length,
        matchedCount,
        bankSize: bank.length,
      });
    } catch (error) {
      console.error("Match API error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Matching failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // ==================== HUMANIZER ENDPOINTS (Step 3) ====================

  // Humanize AI text using matched human patterns
  app.post("/api/humanize", async (req, res) => {
    try {
      const validatedData = humanizeRequestSchema.parse(req.body);
      
      // Check text length
      if (validatedData.text.length > 5000000) {
        return res.status(400).json({
          error: "Text too long",
          message: "Please limit your text to 5 million characters or less.",
        });
      }
      
      // Convert prefiltered candidates to SentenceBankEntry format if provided
      const prefilteredCandidates = validatedData.prefilteredCandidates?.map((c) => ({
        original: c.original,
        bleached: c.bleached,
        structure: c.structure || c.bleached,
        charLength: c.charLength,
        tokenLength: c.tokenLength,
        clauseCount: c.clauseCount,
        clauseOrder: c.clauseOrder,
        punctuationPattern: c.punctuationPattern,
        char_length: c.charLength,
        token_length: c.tokenLength,
        clause_count: c.clauseCount,
        clause_order: c.clauseOrder,
        punctuation_pattern: c.punctuationPattern,
      }));
      
      if (prefilteredCandidates) {
        console.log(`Humanizing text (${validatedData.text.length} chars) with ${prefilteredCandidates.length} prefiltered candidates`);
      } else {
        console.log(`Humanizing text (${validatedData.text.length} chars) with level: ${validatedData.level}`);
      }
      
      const result = await humanizeText(validatedData.text, validatedData.level, prefilteredCandidates);
      
      res.json(result);
    } catch (error) {
      console.error("Humanize API error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Humanization failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // ==================== GPTZERO AI DETECTION ====================

  // GPTZero AI detection endpoint
  app.post("/api/detect-ai", async (req, res) => {
    try {
      if (!GPTZERO_API_KEY) {
        return res.status(500).json({
          error: "GPTZero API key not configured",
          message: "Please add your GPTZERO_API_KEY to secrets.",
        });
      }

      const { text } = gptzeroRequestSchema.parse(req.body);

      console.log(`Running GPTZero detection on ${text.length} chars`);

      const response = await fetch(GPTZERO_API_URL, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "x-api-key": GPTZERO_API_KEY,
        },
        body: JSON.stringify({
          document: text,
          multilingual: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("GPTZero API error:", response.status, errorText);
        return res.status(response.status).json({
          error: "GPTZero API error",
          message: `API returned ${response.status}: ${errorText}`,
        });
      }

      const data = await response.json();
      console.log("GPTZero response:", JSON.stringify(data).substring(0, 200));

      // Extract relevant fields from GPTZero response
      const result = {
        documentClassification: data.documents?.[0]?.class_probabilities ? 
          (data.documents[0].completely_generated_prob > 0.7 ? "AI_ONLY" :
           data.documents[0].completely_generated_prob > 0.3 ? "MIXED" : "HUMAN_ONLY") :
          (data.completely_generated_prob > 0.7 ? "AI_ONLY" :
           data.completely_generated_prob > 0.3 ? "MIXED" : "HUMAN_ONLY"),
        averageGeneratedProb: data.documents?.[0]?.average_generated_prob ?? data.average_generated_prob ?? 0,
        completelyGeneratedProb: data.documents?.[0]?.completely_generated_prob ?? data.completely_generated_prob ?? 0,
        confidenceCategory: data.documents?.[0]?.confidence_category ?? data.confidence_category ?? "unknown",
        sentences: data.documents?.[0]?.sentences?.map((s: any) => ({
          sentence: s.sentence,
          generatedProb: s.generated_prob,
          perplexity: s.perplexity,
          highlightForAi: s.highlight_sentence_for_ai ?? (s.generated_prob > 0.5),
        })) ?? [],
      };

      res.json(result);
    } catch (error) {
      console.error("AI detection error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "AI detection failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // ==================== REWRITE IN STYLE ENDPOINT ====================

  app.post("/api/rewrite-style", async (req, res) => {
    try {
      console.log("Received rewrite-style request");
      
      const validatedData = rewriteStyleRequestSchema.parse(req.body);
      
      const targetWordCount = validatedData.targetText.split(/\s+/).filter(w => w.length > 0).length;
      console.log(`Target: ${targetWordCount} words`);
      
      let result;
      let authorStyleName: string | null = null;
      
      // Check if using author style patterns
      if (validatedData.authorStyleId) {
        console.log(`Using author style ID: ${validatedData.authorStyleId}`);
        
        // Fetch author style
        const authorStyle = await storage.getAuthorStyle(validatedData.authorStyleId);
        if (!authorStyle) {
          return res.status(404).json({
            error: "Author style not found",
            message: `No author style found with ID ${validatedData.authorStyleId}`,
          });
        }
        
        authorStyleName = authorStyle.name;
        console.log(`Using patterns from author: ${authorStyleName}`);
        
        // Fetch patterns for this author
        const authorPatterns = await storage.getAuthorStyleSentences(validatedData.authorStyleId);
        
        if (authorPatterns.length === 0) {
          return res.status(400).json({
            error: "No patterns available",
            message: `Author "${authorStyleName}" has no sentence patterns in their library. Add patterns first.`,
          });
        }
        
        console.log(`Found ${authorPatterns.length} patterns for author ${authorStyleName}`);
        
        // Convert database entries to SentenceBankEntry format
        const prebuiltPatterns = authorPatterns.map(entry => ({
          original: entry.original,
          bleached: entry.bleached,
          char_length: entry.charLength,
          token_length: entry.tokenLength,
          clause_count: entry.clauseCount,
          clause_order: entry.clauseOrder,
          punctuation_pattern: entry.punctuationPattern,
          structure: entry.structure || entry.bleached,
        }));
        
        // Call rewriteInStyle with prebuilt patterns (passing empty styleSample since we have patterns)
        result = await rewriteInStyle(
          validatedData.targetText,
          "", // Empty style sample - not needed when using prebuilt patterns
          validatedData.level,
          prebuiltPatterns
        );
      } else {
        // Using custom style sample
        const styleWordCount = validatedData.styleSample.split(/\s+/).filter(w => w.length > 0).length;
        console.log(`Style sample: ${styleWordCount} words`);
        
        // Warn if style sample is shorter than target
        if (styleWordCount < targetWordCount) {
          console.warn("Style sample is shorter than target - may result in pattern reuse");
        }
        
        result = await rewriteInStyle(
          validatedData.targetText,
          validatedData.styleSample,
          validatedData.level
        );
      }
      
      // If user is logged in and using custom style sample (not author style), save the extracted patterns to their personal bank
      let patternsSaved = 0;
      if (!validatedData.authorStyleId && validatedData.userId && result.extractedPatterns.length > 0) {
        console.log(`Saving ${result.extractedPatterns.length} patterns for user ${validatedData.userId}`);
        
        // First, deduplicate within the request itself (by bleached text)
        const seenBleached = new Set<string>();
        const uniquePatterns = result.extractedPatterns.filter(p => {
          if (seenBleached.has(p.bleached)) return false;
          seenBleached.add(p.bleached);
          return true;
        });
        
        // Get existing bleached texts for this user to avoid duplicates in DB
        const bleachedTexts = uniquePatterns.map(p => p.bleached);
        const existingBleached = await storage.getExistingBleachedTexts(validatedData.userId, bleachedTexts);
        
        // Filter out duplicates that already exist in DB
        const newPatterns = uniquePatterns.filter(p => !existingBleached.has(p.bleached));
        
        if (newPatterns.length > 0) {
          // Convert SentenceBankEntry to InsertSentenceEntry format
          const entriesToInsert = newPatterns.map(pattern => ({
            original: pattern.original,
            bleached: pattern.bleached,
            charLength: pattern.char_length,
            tokenLength: pattern.token_length,
            clauseCount: pattern.clause_count,
            clauseOrder: pattern.clause_order || "main → subordinate",
            punctuationPattern: pattern.punctuation_pattern || "",
            structure: pattern.structure || pattern.bleached,
            userId: validatedData.userId,
          }));
          
          patternsSaved = await storage.addSentenceEntries(entriesToInsert);
          console.log(`Saved ${patternsSaved} new patterns to user's bank (skipped ${result.extractedPatterns.length - patternsSaved} duplicates)`);
        } else {
          console.log("All patterns already exist in user's bank - no new patterns saved");
        }
      }
      
      // Return response with patternsSavedToBank count
      res.json({
        sentences: result.sentences,
        combinedRewrite: result.combinedRewrite,
        totalSentences: result.totalSentences,
        successfulRewrites: result.successfulRewrites,
        stylePatternsExtracted: result.stylePatternsExtracted,
        patternsSavedToBank: patternsSaved,
      });
    } catch (error) {
      console.error("Rewrite style error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Style rewrite failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // ==================== AUTHOR STYLES ENDPOINTS ====================

  // Get all author styles with sentence counts
  app.get("/api/author-styles", async (_req, res) => {
    try {
      const styles = await storage.getAllAuthorStyles();
      res.json(styles);
    } catch (error) {
      console.error("Get author styles error:", error);
      res.status(500).json({
        error: "Failed to get author styles",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // Create a new author style
  app.post("/api/author-styles", async (req, res) => {
    try {
      const validatedData = createAuthorStyleRequestSchema.parse(req.body);
      
      // Check if author already exists
      const existing = await storage.getAuthorStyleByName(validatedData.name);
      if (existing) {
        return res.status(400).json({
          error: "Author style already exists",
          message: `An author style with the name "${validatedData.name}" already exists.`,
        });
      }
      
      const style = await storage.createAuthorStyle(validatedData);
      res.json(style);
    } catch (error) {
      console.error("Create author style error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Failed to create author style",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // Add sentences to an author style
  app.post("/api/author-styles/:id/sentences", async (req, res) => {
    try {
      const authorStyleId = parseInt(req.params.id, 10);
      if (isNaN(authorStyleId)) {
        return res.status(400).json({
          error: "Invalid author style ID",
          message: "Author style ID must be a number.",
        });
      }
      
      // Verify author style exists
      const authorStyle = await storage.getAuthorStyle(authorStyleId);
      if (!authorStyle) {
        return res.status(404).json({
          error: "Author style not found",
          message: `No author style found with ID ${authorStyleId}.`,
        });
      }
      
      const validatedData = addAuthorSentencesRequestSchema.parse(req.body);
      
      // Check for duplicates within the request
      const uniqueSentences = new Map<string, typeof validatedData.sentences[0]>();
      for (const sentence of validatedData.sentences) {
        if (!uniqueSentences.has(sentence.bleached)) {
          uniqueSentences.set(sentence.bleached, sentence);
        }
      }
      
      // Check for existing sentences in this author's bank
      const bleachedTexts = Array.from(uniqueSentences.keys());
      const existingBleached = await storage.getExistingBleachedTextsForAuthor(authorStyleId, bleachedTexts);
      
      // Filter out duplicates
      const newSentences: InsertSentenceEntry[] = [];
      for (const [bleached, sentence] of Array.from(uniqueSentences.entries())) {
        if (!existingBleached.has(bleached)) {
          newSentences.push({
            original: sentence.original,
            bleached: sentence.bleached,
            charLength: sentence.char_length,
            tokenLength: sentence.token_length,
            clauseCount: sentence.clause_count,
            clauseOrder: sentence.clause_order || 'main → subordinate',
            punctuationPattern: sentence.punctuation_pattern || '',
            structure: sentence.structure || sentence.bleached,
          });
        }
      }
      
      // Insert new sentences
      const insertedCount = await storage.addSentenceEntriesToAuthorStyle(authorStyleId, newSentences);
      const totalCount = await storage.getAuthorStyleSentenceCount(authorStyleId);
      
      res.json({
        authorStyleId,
        authorName: authorStyle.name,
        sentencesReceived: validatedData.sentences.length,
        duplicatesSkipped: validatedData.sentences.length - insertedCount,
        sentencesAdded: insertedCount,
        totalSentences: totalCount,
      });
    } catch (error) {
      console.error("Add author sentences error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Failed to add sentences to author style",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // Get sentences for an author style
  app.get("/api/author-styles/:id/sentences", async (req, res) => {
    try {
      const authorStyleId = parseInt(req.params.id, 10);
      if (isNaN(authorStyleId)) {
        return res.status(400).json({
          error: "Invalid author style ID",
          message: "Author style ID must be a number.",
        });
      }
      
      const authorStyle = await storage.getAuthorStyle(authorStyleId);
      if (!authorStyle) {
        return res.status(404).json({
          error: "Author style not found",
          message: `No author style found with ID ${authorStyleId}.`,
        });
      }
      
      const sentences = await storage.getAuthorStyleSentences(authorStyleId);
      res.json({
        authorStyleId,
        authorName: authorStyle.name,
        sentenceCount: sentences.length,
        sentences: sentences.map(s => ({
          original: s.original,
          bleached: s.bleached,
          char_length: s.charLength,
          token_length: s.tokenLength,
          clause_count: s.clauseCount,
          clause_order: s.clauseOrder,
          punctuation_pattern: s.punctuationPattern,
          structure: s.structure,
        })),
      });
    } catch (error) {
      console.error("Get author sentences error:", error);
      res.status(500).json({
        error: "Failed to get author sentences",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // Rewrite text using an author's style
  app.post("/api/rewrite-with-author-style", async (req, res) => {
    try {
      console.log("Received rewrite with author style request");
      
      const validatedData = rewriteWithAuthorStyleRequestSchema.parse(req.body);
      
      // Verify author style exists
      const authorStyle = await storage.getAuthorStyle(validatedData.authorStyleId);
      if (!authorStyle) {
        return res.status(404).json({
          error: "Author style not found",
          message: `No author style found with ID ${validatedData.authorStyleId}.`,
        });
      }
      
      // Get the author's sentence patterns
      const authorSentences = await storage.getAuthorStyleSentences(validatedData.authorStyleId);
      if (authorSentences.length === 0) {
        return res.status(400).json({
          error: "No patterns available",
          message: `The author style "${authorStyle.name}" has no sentence patterns yet.`,
        });
      }
      
      // Convert to sentence bank entry format
      const authorPatterns = authorSentences.map(s => ({
        original: s.original,
        bleached: s.bleached,
        char_length: s.charLength,
        token_length: s.tokenLength,
        clause_count: s.clauseCount,
        clause_order: s.clauseOrder,
        punctuation_pattern: s.punctuationPattern,
        structure: s.structure,
      }));
      
      // Use the rewriteInStyle function with author patterns
      const result = await rewriteInStyle(
        validatedData.targetText,
        "", // Empty style sample - we're using pre-built patterns
        validatedData.level,
        authorPatterns // Pass author patterns directly
      );
      
      res.json({
        sentences: result.sentences,
        combinedRewrite: result.combinedRewrite,
        totalSentences: result.totalSentences,
        successfulRewrites: result.successfulRewrites,
        authorStyleId: validatedData.authorStyleId,
        authorName: authorStyle.name,
        patternsUsed: authorPatterns.length,
      });
    } catch (error) {
      console.error("Rewrite with author style error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Style rewrite failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  // ==================== CONTENT SIMILARITY ENDPOINT ====================

  const anthropicClient = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  app.post("/api/content-similarity", async (req, res) => {
    try {
      console.log("Received content similarity request");
      
      const validatedData = contentSimilarityRequestSchema.parse(req.body);
      
      const prompt = `You are a content similarity analyzer. Compare the following two texts and determine how similar they are in MEANING and CONTENT (not style or wording).

ORIGINAL TEXT:
"${validatedData.originalText}"

REWRITTEN TEXT:
"${validatedData.rewrittenText}"

Analyze the semantic similarity between these texts. Focus on:
1. Are the same facts, ideas, and concepts present in both?
2. Is any important information missing from the rewrite?
3. Has any meaning been distorted or changed?

Respond with ONLY a valid JSON object in this exact format (no markdown, no code blocks):
{
  "similarityScore": <number from 0 to 100>,
  "agreementSummary": "<brief description of what content is preserved>",
  "discrepancies": "<brief description of any missing or changed content, or 'None' if fully preserved>"
}

Score guidelines:
- 95-100: Perfect or near-perfect content preservation
- 85-94: Minor omissions or slight rewording that doesn't change meaning
- 70-84: Some content differences but main ideas preserved
- 50-69: Significant content changes or omissions
- Below 50: Major meaning differences`;

      const message = await anthropicClient.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response format from Claude");
      }

      // Parse the JSON response
      let result;
      try {
        // Clean up the response in case it has markdown code blocks
        let jsonText = content.text.trim();
        if (jsonText.startsWith("```json")) {
          jsonText = jsonText.slice(7);
        }
        if (jsonText.startsWith("```")) {
          jsonText = jsonText.slice(3);
        }
        if (jsonText.endsWith("```")) {
          jsonText = jsonText.slice(0, -3);
        }
        jsonText = jsonText.trim();
        
        result = JSON.parse(jsonText);
      } catch (parseError) {
        console.error("Failed to parse Claude response:", content.text);
        throw new Error("Failed to parse similarity analysis");
      }

      // Validate the result has required fields
      if (typeof result.similarityScore !== "number" || 
          result.similarityScore < 0 || 
          result.similarityScore > 100) {
        result.similarityScore = 75; // Default fallback
      }
      
      if (!result.agreementSummary) {
        result.agreementSummary = "Analysis completed";
      }
      
      if (!result.discrepancies) {
        result.discrepancies = "None identified";
      }

      res.json({
        similarityScore: Math.round(result.similarityScore),
        agreementSummary: result.agreementSummary,
        discrepancies: result.discrepancies,
      });
    } catch (error) {
      console.error("Content similarity error:", error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Validation error",
          message: error.errors.map((e) => e.message).join(", "),
        });
      }
      
      res.status(500).json({
        error: "Content similarity analysis failed",
        message: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
