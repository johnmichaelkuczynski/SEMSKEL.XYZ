import type { Express } from "express";
import { createServer, type Server } from "http";
import * as fs from "fs";
import * as path from "path";
import { bleachText } from "./bleach";
import { bleachRequestSchema, sentenceBankRequestSchema } from "@shared/schema";
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
      if (validatedData.text.length > 50000) {
        return res.status(400).json({
          error: "Text too long",
          message: "Please limit your text to 50,000 characters or less.",
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
      
      const results: string[] = [];
      
      for (const sentence of sentences) {
        try {
          const bleached = await bleachText(sentence, validatedData.level);
          
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
          
          results.push(JSON.stringify(entry));
        } catch (error) {
          console.error(`Error processing sentence: ${sentence}`, error);
        }
      }
      
      const jsonlContent = results.join('\n');
      
      // Save to sentence bank file (append)
      let totalBankSize = results.length;
      try {
        if (fs.existsSync(SENTENCE_BANK_PATH)) {
          fs.appendFileSync(SENTENCE_BANK_PATH, '\n' + jsonlContent, 'utf-8');
          // Count total lines in bank
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

  const httpServer = createServer(app);

  return httpServer;
}
