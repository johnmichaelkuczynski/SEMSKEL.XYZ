import { storage } from "./storage";
import { bleachText } from "./bleach";
import type { BatchJob, BatchSection, InsertBatchSection, InsertSentenceEntry } from "@shared/schema";

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

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

export interface BatchProcessorConfig {
  breakDurationMs: number; // Default 60000 (1 minute)
  maxRetries: number; // Default 3
  retryDelayMs: number; // Default 5000
}

const DEFAULT_CONFIG: BatchProcessorConfig = {
  breakDurationMs: 60000, // 1 minute break between sections
  maxRetries: 3,
  retryDelayMs: 5000,
};

class BatchProcessor {
  private isProcessing: boolean = false;
  private processingJobId: number | null = null;
  private config: BatchProcessorConfig = DEFAULT_CONFIG;
  private intervalId: NodeJS.Timeout | null = null;

  constructor() {
    console.log("[BatchProcessor] Initialized");
  }

  start() {
    if (this.intervalId) {
      console.log("[BatchProcessor] Already running");
      return;
    }
    
    console.log("[BatchProcessor] Starting background processor (checks every 10 seconds)");
    this.intervalId = setInterval(() => this.checkAndProcessJobs(), 10000);
    
    this.checkAndProcessJobs();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[BatchProcessor] Stopped");
    }
  }

  private async checkAndProcessJobs() {
    if (this.isProcessing) {
      return;
    }

    try {
      const activeJobs = await storage.getActiveBatchJobs();
      
      for (const job of activeJobs) {
        if (job.status === 'processing') {
          // If nextProcessTime is set, check if it's time to process
          if (job.nextProcessTime) {
            const now = new Date();
            if (new Date(job.nextProcessTime) <= now) {
              await this.processNextSection(job);
              return;
            }
          } else {
            // No nextProcessTime means job was interrupted (e.g., server restart)
            // Reset any "processing" sections back to "pending" so they can be reprocessed
            console.log(`[BatchProcessor] Resuming interrupted job ${job.id}`);
            await storage.resetProcessingSections(job.id);
            await this.processNextSection(job);
            return;
          }
        } else if (job.status === 'pending') {
          await storage.updateBatchJob(job.id, { status: 'processing' });
          await this.processNextSection(job);
          return;
        }
      }
    } catch (error) {
      console.error("[BatchProcessor] Error checking jobs:", error);
    }
  }

  private async processNextSection(job: BatchJob) {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    this.processingJobId = job.id;

    try {
      const section = await storage.getNextPendingSection(job.id);
      
      if (!section) {
        await this.completeJob(job);
        return;
      }

      console.log(`[BatchProcessor] Processing job ${job.id}, section ${section.sectionIndex + 1}/${job.totalSections}`);
      
      await storage.updateBatchSection(section.id, { status: 'processing' });
      await storage.updateBatchJob(job.id, { currentSection: section.sectionIndex + 1 });

      let output: string | null = null;
      let errorMessage: string | null = null;

      try {
        if (job.jobType === 'bleach') {
          output = await this.processBleachSection(section, job.bleachLevel as any);
        } else if (job.jobType === 'jsonl') {
          output = await this.processJsonlSection(section, job.bleachLevel as any);
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[BatchProcessor] Section ${section.sectionIndex} failed:`, errorMessage);
      }

      // Refresh job to get current counters (avoid stale values)
      const currentJob = await storage.getBatchJob(job.id);
      if (!currentJob) {
        console.error(`[BatchProcessor] Job ${job.id} not found after processing`);
        return;
      }

      if (output) {
        await storage.updateBatchSection(section.id, {
          status: 'completed',
          outputText: output,
          processedAt: new Date(),
        });
        await storage.updateBatchJob(job.id, {
          completedSections: currentJob.completedSections + 1,
        });
        console.log(`[BatchProcessor] Section ${section.sectionIndex + 1} completed. Total: ${currentJob.completedSections + 1}/${currentJob.totalSections}`);
      } else {
        await storage.updateBatchSection(section.id, {
          status: 'failed',
          errorMessage: errorMessage || 'Unknown error',
          processedAt: new Date(),
        });
        await storage.updateBatchJob(job.id, {
          failedSections: currentJob.failedSections + 1,
        });
        console.log(`[BatchProcessor] Section ${section.sectionIndex + 1} failed. Total failed: ${currentJob.failedSections + 1}`);
      }

      const nextSection = await storage.getNextPendingSection(job.id);
      
      if (nextSection) {
        const nextTime = new Date(Date.now() + this.config.breakDurationMs);
        await storage.updateBatchJob(job.id, { nextProcessTime: nextTime });
        console.log(`[BatchProcessor] Next section scheduled for ${nextTime.toLocaleTimeString()} (${this.config.breakDurationMs / 1000}s break)`);
      } else {
        // Refresh job again for accurate completion status
        const finalJob = await storage.getBatchJob(job.id);
        if (finalJob) {
          await this.completeJob(finalJob);
        }
      }

    } catch (error) {
      console.error("[BatchProcessor] Error processing section:", error);
    } finally {
      this.isProcessing = false;
      this.processingJobId = null;
    }
  }

  private async processBleachSection(section: BatchSection, level: any): Promise<string> {
    const sentences = splitIntoSentences(section.inputText);
    const bleachedSentences: string[] = [];

    for (const sentence of sentences) {
      for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
        try {
          const bleached = await bleachText(sentence, level);
          bleachedSentences.push(bleached);
          break;
        } catch (error) {
          if (attempt === this.config.maxRetries) {
            bleachedSentences.push(`[FAILED: ${sentence.substring(0, 50)}...]`);
          } else {
            await this.delay(this.config.retryDelayMs);
          }
        }
      }
    }

    return bleachedSentences.join('\n');
  }

  private async processJsonlSection(section: BatchSection, level: any): Promise<string> {
    const sentences = splitIntoSentences(section.inputText);
    const entries: any[] = [];

    for (const sentence of sentences) {
      for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
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
            structure: bleached,
          };
          
          entries.push(entry);
          break;
        } catch (error) {
          if (attempt === this.config.maxRetries) {
            entries.push({
              original: sentence,
              bleached: "[FAILED]",
              char_length: sentence.length,
              token_length: countTokens(sentence),
              clause_count: countClauses(sentence),
              clause_order: getClauseOrder(sentence),
              punctuation_pattern: extractPunctuationPattern(sentence),
              structure: "[FAILED]",
              error: true,
            });
          } else {
            await this.delay(this.config.retryDelayMs);
          }
        }
      }
      
      await this.delay(500);
    }

    return entries.map(e => JSON.stringify(e)).join('\n');
  }

  private async completeJob(job: BatchJob) {
    const updatedJob = await storage.getBatchJob(job.id);
    const finalStatus = (updatedJob?.failedSections || 0) === updatedJob?.totalSections ? 'failed' : 'completed';
    
    await storage.updateBatchJob(job.id, {
      status: finalStatus,
      completedAt: new Date(),
      nextProcessTime: null,
    });
    
    console.log(`[BatchProcessor] Job ${job.id} ${finalStatus}. Completed: ${updatedJob?.completedSections}, Failed: ${updatedJob?.failedSections}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isJobProcessing(jobId: number): boolean {
    return this.processingJobId === jobId;
  }

  setConfig(config: Partial<BatchProcessorConfig>) {
    this.config = { ...this.config, ...config };
    console.log("[BatchProcessor] Config updated:", this.config);
  }
}

export const batchProcessor = new BatchProcessor();

export function splitTextIntoSections(text: string, targetWordCount: number = 1000): { text: string; wordCount: number; sentenceCount: number }[] {
  const sentences = splitIntoSentences(text);
  const sections: { text: string; wordCount: number; sentenceCount: number }[] = [];
  
  let currentSectionSentences: string[] = [];
  let currentWordCount = 0;
  
  for (const sentence of sentences) {
    const sentenceWordCount = countWords(sentence);
    
    if (currentWordCount > 0 && currentWordCount + sentenceWordCount > targetWordCount) {
      sections.push({
        text: currentSectionSentences.join(' '),
        wordCount: currentWordCount,
        sentenceCount: currentSectionSentences.length,
      });
      currentSectionSentences = [sentence];
      currentWordCount = sentenceWordCount;
    } else {
      currentSectionSentences.push(sentence);
      currentWordCount += sentenceWordCount;
    }
  }
  
  if (currentSectionSentences.length > 0) {
    sections.push({
      text: currentSectionSentences.join(' '),
      wordCount: currentWordCount,
      sentenceCount: currentSectionSentences.length,
    });
  }
  
  return sections;
}

export async function createBatchJob(
  text: string,
  jobType: 'bleach' | 'jsonl',
  level: string,
  provider: string = 'anthropic',
  userId?: number,
  sectionSize: number = 1000,
  breakDurationMs: number = 60000
): Promise<{ job: BatchJob; sections: BatchSection[] }> {
  const textSections = splitTextIntoSections(text, sectionSize);
  
  console.log(`[BatchProcessor] Creating ${jobType} job with ${textSections.length} sections (~${sectionSize} words each)`);
  
  const job = await storage.createBatchJob({
    jobType,
    status: 'pending',
    totalSections: textSections.length,
    completedSections: 0,
    failedSections: 0,
    currentSection: 0,
    bleachLevel: level,
    provider,
    nextProcessTime: null,
    userId: userId || null,
  });

  const sectionInserts: InsertBatchSection[] = textSections.map((section, index) => ({
    jobId: job.id,
    sectionIndex: index,
    inputText: section.text,
    outputText: null,
    status: 'pending',
    wordCount: section.wordCount,
    sentenceCount: section.sentenceCount,
    errorMessage: null,
    processedAt: null,
  }));

  const sections = await storage.createBatchSections(sectionInserts);

  batchProcessor.setConfig({ breakDurationMs });
  batchProcessor.start();

  return { job, sections };
}
