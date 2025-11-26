import type { Express } from "express";
import { createServer, type Server } from "http";
import * as fs from "fs";
import * as path from "path";
import { bleachText } from "./bleach";
import { bleachRequestSchema, sentenceBankRequestSchema, matchRequestSchema } from "@shared/schema";
import { findBestMatch, loadSentenceBank, computeMetadata } from "./matcher";
import { z } from "zod";

const SENTENCE_BANK_PATH = path.join(process.cwd(), "sentence_bank.jsonl");

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
  // Bleaching API endpoint
  app.post("/api/bleach", async (req, res) => {
    try {
      // Validate request body
      const validatedData = bleachRequestSchema.parse(req.body);

      // Check text length
      if (validatedData.text.length > 5000000) {
        return res.status(400).json({
          error: "Text too long",
          message: "Please limit your text to 5 million characters or less.",
        });
      }

      // Perform bleaching
      const bleachedText = await bleachText(
        validatedData.text,
        validatedData.level
      );

      // Return result
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
        message:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred.",
      });
    }
  });

  // Helper: delay function
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Helper: process a single sentence with retry logic
  async function processSentenceWithRetry(
    sentence: string,
    level: any,
    maxRetries = 3
  ): Promise<string | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const bleached = await bleachText(sentence, level);
        
        const entry = {
          original: sentence,
          bleached: bleached,
          char_length: sentence.length,
          token_length: countTokens(sentence),
          clause_count: countClauses(sentence),
          clause_order: getClauseOrder(sentence),
          punctuation_pattern: extractPunctuationPattern(sentence),
          structure: bleached
        };
        
        return JSON.stringify(entry);
      } catch (error: any) {
        const isRateLimit = error?.status === 429 || error?.message?.includes('rate');
        
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

  // Sentence Bank API endpoint
  app.post("/api/build-sentence-bank", async (req, res) => {
    try {
      const validatedData = sentenceBankRequestSchema.parse(req.body);
      
      const sentences = splitIntoSentences(validatedData.text);
      
      if (sentences.length === 0) {
        return res.status(400).json({
          error: "No sentences found",
          message: "Could not find any sentences in the provided text.",
        });
      }
      
      const totalSentences = sentences.length;
      console.log(`Processing ${totalSentences} sentences in chunked batches...`);
      
      // Process in smaller batches with delays to avoid rate limits
      // Use batch size of 5 for better rate limit handling
      const BATCH_SIZE = 5;
      const DELAY_BETWEEN_BATCHES = 500; // 500ms between batches
      const results: string[] = [];
      
      for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
        const batch = sentences.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(sentences.length / BATCH_SIZE);
        
        console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} sentences, ${results.length}/${totalSentences} complete)`);
        
        // Process batch in parallel
        const batchResults = await Promise.all(
          batch.map(sentence => processSentenceWithRetry(sentence, validatedData.level))
        );
        
        results.push(...batchResults.filter((r): r is string => r !== null));
        
        // Add delay between batches to avoid rate limits (except for last batch)
        if (i + BATCH_SIZE < sentences.length) {
          await delay(DELAY_BETWEEN_BATCHES);
        }
      }
      
      console.log(`Completed processing ${results.length}/${totalSentences} sentences`);
      const jsonlContent = results.join('\n');
      
      // Save to sentence bank file (append)
      let totalBankSize = results.length;
      try {
        if (fs.existsSync(SENTENCE_BANK_PATH)) {
          fs.appendFileSync(SENTENCE_BANK_PATH, '\n' + jsonlContent, 'utf-8');
          const content = fs.readFileSync(SENTENCE_BANK_PATH, 'utf-8');
          totalBankSize = content.split('\n').filter(line => line.trim()).length;
        } else {
          fs.writeFileSync(SENTENCE_BANK_PATH, jsonlContent, 'utf-8');
        }
        console.log(`Saved ${results.length} entries to sentence bank. Total: ${totalBankSize}`);
      } catch (fileError) {
        console.error("Error saving to sentence bank file:", fileError);
      }
      
      res.json({
        jsonlContent,
        sentenceCount: results.length,
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

  // Get sentence bank status
  app.get("/api/sentence-bank/status", (req, res) => {
    try {
      if (!fs.existsSync(SENTENCE_BANK_PATH)) {
        return res.json({ count: 0 });
      }
      const content = fs.readFileSync(SENTENCE_BANK_PATH, 'utf-8');
      const count = content.split('\n').filter(line => line.trim()).length;
      res.json({ count });
    } catch (error) {
      res.json({ count: 0 });
    }
  });

  // Get full sentence bank content
  app.get("/api/sentence-bank", (req, res) => {
    try {
      if (!fs.existsSync(SENTENCE_BANK_PATH)) {
        return res.json({ entries: [], count: 0 });
      }
      const content = fs.readFileSync(SENTENCE_BANK_PATH, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      const entries = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
      res.json({ entries, count: entries.length });
    } catch (error) {
      console.error("Error reading sentence bank:", error);
      res.status(500).json({ error: "Failed to read sentence bank" });
    }
  });

  // Match AI text to human patterns (Step 2)
  app.post("/api/match", async (req, res) => {
    try {
      const validatedData = matchRequestSchema.parse(req.body);
      
      // Check sentence bank exists
      const bank = loadSentenceBank();
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
      
      // Process sentences in parallel batches
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
