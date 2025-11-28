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
  type InsertSentenceEntry,
} from "@shared/schema";
import { findBestMatch, loadSentenceBank, computeMetadata } from "./matcher";
import { z } from "zod";

const CLAUSE_TRIGGERS = ['when', 'because', 'although', 'if', 'while', 'since', 'but'];

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
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

  // Bleaching API endpoint
  app.post("/api/bleach", async (req, res) => {
    try {
      const validatedData = bleachRequestSchema.parse(req.body);

      if (validatedData.text.length > 5000000) {
        return res.status(400).json({
          error: "Text too long",
          message: "Please limit your text to 5 million characters or less.",
        });
      }

      const bleachedText = await bleachText(
        validatedData.text,
        validatedData.level
      );

      res.json({
        bleachedText,
        originalFilename: validatedData.filename,
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

  // ==================== SENTENCE BANK ENDPOINTS ====================

  // Sentence Bank API endpoint (build from text)
  app.post("/api/build-sentence-bank", async (req, res) => {
    try {
      const validatedData = sentenceBankRequestSchema.parse(req.body);
      const userId = req.body.userId ? parseInt(req.body.userId) : null;
      
      const sentences = splitIntoSentences(validatedData.text);
      
      if (sentences.length === 0) {
        return res.status(400).json({
          error: "No sentences found",
          message: "Could not find any sentences in the provided text.",
        });
      }
      
      const totalSentences = sentences.length;
      console.log(`Processing ${totalSentences} sentences in chunked batches...`);
      
      const BATCH_SIZE = 5;
      const DELAY_BETWEEN_BATCHES = 500;
      const entries: InsertSentenceEntry[] = [];
      
      for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
        const batch = sentences.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(sentences.length / BATCH_SIZE);
        
        console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} sentences, ${entries.length}/${totalSentences} complete)`);
        
        const batchResults = await Promise.all(
          batch.map(sentence => processSentenceWithRetry(sentence, validatedData.level))
        );
        
        const validResults = batchResults.filter((r): r is InsertSentenceEntry => r !== null);
        
        // Associate with user if logged in
        if (userId) {
          validResults.forEach(entry => entry.userId = userId);
        }
        
        entries.push(...validResults);
        
        if (i + BATCH_SIZE < sentences.length) {
          await delay(DELAY_BETWEEN_BATCHES);
        }
      }
      
      console.log(`Completed processing ${entries.length}/${totalSentences} sentences`);
      
      // Save to database
      let totalBankSize = 0;
      try {
        await storage.addSentenceEntries(entries);
        totalBankSize = await storage.getSentenceEntryCount();
        console.log(`Saved ${entries.length} entries to database. Total: ${totalBankSize}`);
      } catch (dbError) {
        console.error("Error saving to database:", dbError);
      }
      
      // Generate JSONL for display
      const jsonlContent = entries.map(entry => JSON.stringify({
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
        sentenceCount: entries.length,
        totalBankSize,
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
              clauseOrder: validated.clause_order,
              punctuationPattern: validated.punctuation_pattern,
              structure: validated.structure,
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

  const httpServer = createServer(app);

  return httpServer;
}
