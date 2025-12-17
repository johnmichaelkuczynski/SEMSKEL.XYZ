import { db } from "../server/storage";
import { sentenceEntries } from "../shared/schema";
import * as fs from "fs";

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

async function importPatterns() {
  const files = [
    "attached_assets/35000_SENTENCE_PATTERNS_1765990808646.txt",
    "attached_assets/39000_WORDS_1765990808647.txt",
    "attached_assets/41000_1765990808648.txt",
    "attached_assets/25000_PATTERNS_1765990808649.txt",
  ];
  
  let totalImported = 0;
  const seenPatterns = new Set<string>();
  
  for (const file of files) {
    console.log(`\nParsing ${file}...`);
    
    if (!fs.existsSync(file)) {
      console.log(`  File not found: ${file}`);
      continue;
    }
    
    const patterns = parsePatternFile(file);
    console.log(`  Found ${patterns.length} patterns`);
    
    const uniquePatterns = patterns.filter(p => {
      const key = p.original + "|" + p.bleached;
      if (seenPatterns.has(key)) return false;
      seenPatterns.add(key);
      return true;
    });
    
    console.log(`  ${uniquePatterns.length} unique patterns (after dedup)`);
    
    const BATCH_SIZE = 500;
    let batchCount = 0;
    
    for (let i = 0; i < uniquePatterns.length; i += BATCH_SIZE) {
      const batch = uniquePatterns.slice(i, i + BATCH_SIZE);
      
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
      
      try {
        await db.insert(sentenceEntries).values(entries);
        totalImported += batch.length;
        batchCount++;
        
        if (batchCount % 10 === 0) {
          console.log(`  Imported ${i + batch.length}/${uniquePatterns.length} patterns...`);
        }
      } catch (err) {
        console.error(`  Error importing batch: ${err}`);
      }
    }
    
    console.log(`  Completed: ${uniquePatterns.length} patterns from ${file}`);
  }
  
  console.log(`\n=== IMPORT COMPLETE ===`);
  console.log(`Total patterns imported: ${totalImported}`);
  console.log(`Total unique patterns tracked: ${seenPatterns.size}`);
}

importPatterns()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
