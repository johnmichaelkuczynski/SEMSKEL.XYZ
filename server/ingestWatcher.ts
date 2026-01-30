import * as fs from "fs";
import * as path from "path";
import { db } from "./storage";
import { sentenceEntries } from "../shared/schema";

const INGEST_DIR = "./ingest";
const PROCESSED_DIR = "./ingest/processed";

interface ParsedPattern {
  original: string;
  bleached: string;
  charLength: number;
  tokenLength: number;
  clauseCount: number;
  clauseOrder: string;
  punctuationPattern: string;
}

function parsePatternFile(filePath: string): ParsedPattern[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const patterns: ParsedPattern[] = [];
  
  const patternBlocks = content.split(/--- Pattern \d+ ---/);
  
  for (const block of patternBlocks) {
    if (!block.trim()) continue;
    
    const lines = block.split("\n");
    let original = "";
    let bleached = "";
    let charLength = 0;
    let tokenLength = 0;
    let clauseCount = 1;
    let clauseOrder = "main → subordinate";
    let punctuationPattern = "";
    
    let currentField = "";
    let inCodeBlock = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith("Original:")) {
        currentField = "original";
        original = line.replace("Original:", "").trim();
        if (original === '```') {
          inCodeBlock = true;
          original = "";
        }
      } else if (line.startsWith("Bleached:")) {
        currentField = "bleached";
        bleached = line.replace("Bleached:", "").trim();
        if (bleached === '```') {
          inCodeBlock = true;
          bleached = "";
        }
      } else if (line.startsWith("Chars:")) {
        currentField = "";
        inCodeBlock = false;
        const match = line.match(/Chars:\s*(\d+)\s*\|\s*Tokens:\s*(\d+)\s*\|\s*Clauses:\s*(\d+)/);
        if (match) {
          charLength = parseInt(match[1]);
          tokenLength = parseInt(match[2]);
          clauseCount = parseInt(match[3]);
        }
      } else if (line.startsWith("Clause Order:")) {
        clauseOrder = line.replace("Clause Order:", "").trim();
      } else if (line.startsWith("Punctuation:")) {
        punctuationPattern = line.replace("Punctuation:", "").trim();
        if (punctuationPattern === "(none)") {
          punctuationPattern = "";
        }
      } else if (line === '```') {
        inCodeBlock = false;
      } else if (currentField === "original" && (inCodeBlock || line.startsWith("  "))) {
        original += "\n" + line;
      } else if (currentField === "bleached" && (inCodeBlock || line.startsWith("  "))) {
        bleached += "\n" + line;
      }
    }
    
    if (original && bleached) {
      original = original.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
      bleached = bleached.replace(/^```\n?/, '').replace(/\n?```$/, '').replace(/^"""\n?/, '').replace(/\n?"""$/, '').trim();
      
      patterns.push({
        original,
        bleached,
        charLength: charLength || original.length,
        tokenLength: tokenLength || original.split(/\s+/).length,
        clauseCount,
        clauseOrder,
        punctuationPattern,
      });
    }
  }
  
  return patterns;
}

async function processFile(filePath: string): Promise<number> {
  const fileName = path.basename(filePath);
  console.log(`[IngestWatcher] Processing: ${fileName}`);
  
  try {
    const patterns = parsePatternFile(filePath);
    console.log(`[IngestWatcher] Found ${patterns.length} patterns in ${fileName}`);
    
    if (patterns.length === 0) {
      console.log(`[IngestWatcher] No valid patterns found in ${fileName}`);
      return 0;
    }
    
    const BATCH_SIZE = 500;
    let totalImported = 0;
    
    for (let i = 0; i < patterns.length; i += BATCH_SIZE) {
      const batch = patterns.slice(i, i + BATCH_SIZE);
      
      const entries = batch.map(p => ({
        original: p.original,
        bleached: p.bleached,
        charLength: p.charLength,
        tokenLength: p.tokenLength,
        clauseCount: p.clauseCount,
        clauseOrder: p.clauseOrder,
        punctuationPattern: p.punctuationPattern,
        structure: p.bleached,
        userId: null,
      }));
      
      await db.insert(sentenceEntries).values(entries);
      totalImported += batch.length;
    }
    
    console.log(`[IngestWatcher] Imported ${totalImported} patterns from ${fileName}`);
    
    const processedPath = path.join(PROCESSED_DIR, `${Date.now()}_${fileName}`);
    fs.renameSync(filePath, processedPath);
    console.log(`[IngestWatcher] Moved to processed: ${processedPath}`);
    
    return totalImported;
  } catch (err) {
    console.error(`[IngestWatcher] Error processing ${fileName}:`, err);
    return 0;
  }
}

async function checkIngestFolder() {
  if (!fs.existsSync(INGEST_DIR)) {
    fs.mkdirSync(INGEST_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROCESSED_DIR)) {
    fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  }
  
  const files = fs.readdirSync(INGEST_DIR).filter(f => {
    const filePath = path.join(INGEST_DIR, f);
    return fs.statSync(filePath).isFile() && f.endsWith('.txt');
  });
  
  for (const file of files) {
    const filePath = path.join(INGEST_DIR, file);
    await processFile(filePath);
  }
}

let watcherInterval: NodeJS.Timeout | null = null;

export function startIngestWatcher() {
  console.log("[IngestWatcher] Starting folder watcher for ./ingest/");
  
  if (!fs.existsSync(INGEST_DIR)) {
    fs.mkdirSync(INGEST_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROCESSED_DIR)) {
    fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  }
  
  checkIngestFolder();
  
  watcherInterval = setInterval(() => {
    checkIngestFolder();
  }, 5000);
  
  console.log("[IngestWatcher] Watching ./ingest/ folder (checks every 5 seconds)");
}

export function stopIngestWatcher() {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    console.log("[IngestWatcher] Stopped");
  }
}
