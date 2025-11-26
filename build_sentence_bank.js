const fs = require('fs');
const path = require('path');

const INPUT_FILE = 'input_document.txt';
const OUTPUT_FILE = 'sentence_bank.jsonl';
const BLEACH_API_URL = 'http://localhost:5000/api/bleach';
const BLEACH_LEVEL = 'Heavy';

const CLAUSE_TRIGGERS = ['when', 'because', 'although', 'if', 'while', 'since', 'but'];

async function bleach(sentence) {
  const response = await fetch(BLEACH_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: sentence, level: BLEACH_LEVEL })
  });
  
  if (!response.ok) {
    throw new Error(`Bleach API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.bleachedText;
}

function splitIntoSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function countClauses(sentence) {
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

function getClauseOrder(sentence) {
  const lowerSentence = sentence.toLowerCase().trim();
  for (const trigger of CLAUSE_TRIGGERS) {
    if (lowerSentence.startsWith(trigger + ' ') || lowerSentence.startsWith(trigger + ',')) {
      return 'subordinate → main';
    }
  }
  return 'main → subordinate';
}

function extractPunctuationPattern(sentence) {
  return sentence.replace(/[^.,;:!?'"()\-—]/g, '');
}

function countTokens(sentence) {
  return sentence.split(/\s+/).filter(t => t.length > 0).length;
}

async function processSentence(sentence) {
  const bleached = await bleach(sentence);
  
  return {
    original: sentence,
    bleached: bleached,
    char_length: sentence.length,
    token_length: countTokens(sentence),
    clause_count: countClauses(sentence),
    clause_order: getClauseOrder(sentence),
    punctuation_pattern: extractPunctuationPattern(sentence),
    structure: bleached
  };
}

async function main() {
  const inputPath = path.join(process.cwd(), INPUT_FILE);
  
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: ${INPUT_FILE} not found in project root.`);
    console.error('Please upload input_document.txt first.');
    process.exit(1);
  }
  
  const text = fs.readFileSync(inputPath, 'utf-8');
  const sentences = splitIntoSentences(text);
  
  console.log(`Found ${sentences.length} sentences to process...`);
  
  const outputPath = path.join(process.cwd(), OUTPUT_FILE);
  const writeStream = fs.createWriteStream(outputPath);
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    console.log(`Processing sentence ${i + 1}/${sentences.length}...`);
    
    try {
      const result = await processSentence(sentence);
      writeStream.write(JSON.stringify(result) + '\n');
    } catch (error) {
      console.error(`Error processing sentence ${i + 1}: ${error.message}`);
      console.error(`Sentence: "${sentence}"`);
    }
  }
  
  writeStream.end();
  
  console.log(`\nFinished. Output written to ${OUTPUT_FILE}`);
  console.log('Finished. Run: node build_sentence_bank.js');
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
