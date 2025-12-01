# Semantic Bleacher — GPT-Bypass Humanizer

## Overview

This project is building a **GPT-bypass humanizer** — a system that rewrites AI text using REAL HUMAN sentence geometry so it passes detectors while preserving meaning.

The project has **three layers**:

### Layer 1 — Bleaching Tool ✅ COMPLETE
The bleaching tool extracts structural patterns from human-written text. It:
- Splits text into individual sentences
- Bleaches each sentence (replaces content words with variables)
- Computes sentence metadata (length, tokens, clause count, punctuation, etc.)
- Returns each sentence as a JSON object

**Purpose**: Build a growing library of human sentence patterns stored as `sentence_bank.jsonl` inside the app.

### Layer 2 — Matching Engine ✅ COMPLETE
A matching system that takes one AI sentence and finds the closest human sentence pattern in the bank by:
- Filter A: Length ±10%
- Filter B: Identical clause count  
- Filter C: Identical punctuation pattern
- Filter D: Syntactic skeleton similarity scoring

This finds a human sentence with the same "shape" as the AI sentence to prevent distortion.

### Layer 3 — Final Humanizer ✅ COMPLETE
After a match is found:
- Takes the human sentence pattern
- Takes the original AI sentence meaning
- Asks the LLM to rewrite the AI sentence INTO that pattern while keeping meaning intact

This produces human-like, detector-safe text with full content preservation.

## Current Status (December 1, 2025)

**LAYER 1 COMPLETE** ✅
**LAYER 2 COMPLETE** ✅
**LAYER 3 COMPLETE** ✅
**LARGE TEXT HANDLING COMPLETE** ✅
**DATABASE & USER SYSTEM COMPLETE** ✅
**STYLE TRANSFER FEATURE COMPLETE** ✅
**MULTI-LLM PROVIDER SUPPORT** ✅

### Implementation Details:
- **Weighted similarity scoring**: Structure (40%), token length (15%), clause count (15%), clause order (15%), punctuation (15%)
- **Skeleton feature extraction**: Variable positions, clause markers, function word sequences
- **Content-Preserving Rewrite** (Dec 2025 fix):
  - Step 1: Extract content words from original sentence (preserves ALL meaning)
  - Step 2: Map content words into bleached pattern's variable slots
  - Step 3: Claude ONLY polishes grammar/flow (cannot add/remove/negate claims)
  - This fixes the critical bug where Claude was copying pattern wording (like "no more...than") that contradicted original meaning
- **Deterministic fallback**: Content-word replacement preserving:
  - Proper noun casing (NASA, OpenAI stay uppercase)
  - Internal punctuation (apostrophes in can't, COVID-19 hyphens)
  - Original sentence-ending punctuation
  - AI content distributed across human content word slots
- **Layer 2 candidate reuse**: humanize API accepts prefiltered candidates to skip full bank scan
- **Match scores typically 92-95**: High-quality geometric matching
- **GPTZero AI Detection**: Built-in detector to verify humanized text passes AI checks
- **Automatic chunking**: Large texts (>2000 words) are automatically divided into chunks and processed sequentially
- **Manual chunk selection**: For large texts, users can click "Select Chunks" to preview chunks and choose specific ones to process
  - Sentence-aware splitting preserves sentence boundaries  
  - Each chunk shows word count, sentence count, and preview text
  - "Select All" / "Deselect All" buttons for quick selection
  - Action buttons update to show chunk count when chunks are selected

### Database Features:
- PostgreSQL (Neon) database for persistent storage
- Users table (simple username-only login, no password)
- Sentence entries table with user association
- Upload custom JSONL files to append to the bank
- Per-user sentence tracking and stats
- **Installment Downloads**: Large sentence banks (>10,000 patterns) can be downloaded in 10,000-pattern installments to prevent crashes
  - Bank dialog shows download buttons for each installment (e.g., "Part 1 (1-10,000)", "Part 2 (10,001-20,000)")
  - Downloads are paginated via `/api/sentence-bank/download/:installment` endpoint
  - Each installment generates a JSONL file with pattern range in filename

### Layer 1 Features:
- Single-page UI with split panels (input | output)
- Text input via typing, pasting, OR drag-and-drop .txt file upload
- Five bleaching levels: Light, Moderate, Moderate-Heavy, Heavy (default), Very Heavy
- Two output modes (tabs): Bleached Text | JSONL Output
- "Bleach Text" button → displays bleached text
- "Generate JSONL" button → generates sentence bank entries with metadata
- Copy, Download, Clear operations
- Bank viewer dialog with full metadata
- Anthropic Claude integration via Replit AI Integrations

### Layer 2 Features:
- Pattern Matcher section at bottom of page
- AI text input via typing, pasting, OR drag-and-drop .txt file upload
- "Find Matches" button → matches each AI sentence to human patterns
- Displays AI sentence → Human pattern pairs
- Shows match statistics (X of Y sentences matched)
- 4-stage filtering: length → clause count → punctuation → similarity

### Layer 3 Features:
- Humanizer section below Pattern Matcher
- "Humanize Text" button → rewrites AI sentences using matched human patterns
- Weighted similarity scoring: structure (40%), token length (15%), clause count (15%), clause order (15%), punctuation (15%)
- Returns top 3 closest-matching patterns for each sentence
- Slot-fill rewriting via Claude to transfer AI meaning into human sentence structure
- Combined output display with copy/download options
- Sentence-by-sentence breakdown showing: AI sentence → matched pattern → humanized rewrite

### Style Transfer Feature:
- "Rewrite in Same Style" section at bottom of page
- Takes target text (what to rewrite) and style sample (reference for patterns)
- **Author Styles**: Dropdown to select pre-defined authors (Bertrand Russell, Plato, etc.)
  - Each author has their own database of bleached sentence patterns
  - Admin can add sentences to author libraries over time via API
  - Authors with 0 patterns are disabled in the dropdown
  - When author selected, custom style sample input is hidden
  - Button text changes to "Rewrite in Author's Style"
- **Custom Style Sample**: Alternative to author styles
  - Paste or upload any reference text
  - Patterns extracted on-the-fly and matched to target
- **Auto-save patterns**: When logged in and using custom style sample, extracted patterns are automatically saved to user's personal sentence bank (with deduplication)
- Matches target sentences to style patterns using same weighted similarity scoring
- Rewrites target using matched style patterns via Claude slot-fill
- Tip displayed: style sample should be longer than target for better results
- Side-by-side layout: Target Text (left) | Rewritten Text (right)
- Sentence-by-sentence breakdown showing original, matched pattern, and rewrite
- Toast notification shows how many patterns were saved for logged-in users (custom style only)
- **Content Similarity**: Verifies that target text and rewritten text preserve the same meaning
  - Compares semantic content between original and rewritten text
  - Returns 0-100 similarity score with Excellent/Good/Fair/Low rating
  - Shows preserved content summary and any discrepancies
  - Result automatically clears when text changes or new rewrite runs

### Multi-LLM Provider Support:
- **Dropdown selector** in the UI to choose AI provider
- **5 providers supported**:
  - DeepSeek Chat (64K context) - Best for large texts, cost-effective
  - Anthropic Claude Sonnet 4 (200K context) - Default, balanced performance
  - OpenAI GPT-4o (128K context) - Fast, reliable responses
  - xAI Grok 3 (131K context) - Good for medium-large texts
  - Perplexity Llama 3.1 (127K context) - Balanced performance
- **Dynamic availability**: Shows which providers are configured (API key present)
- **API endpoint**: `GET /api/llm-providers` returns list of providers with availability
- **Required secrets**: ANTHROPIC_API_KEY (default), OPENAI_API_KEY, GROK_API_KEY, DEEPSEEK_API_KEY, PERPLEXITY_API_KEY

### Author Style Libraries:
- **Kuczynski**: 1,035 complex philosophical sentence patterns with Greek letters and nested clauses
- **Bertrand Russell**: Classical analytical philosophy patterns
- **Plato**: Ancient philosophical dialogue patterns

## User Preferences

- Simple, everyday language
- Everything on ONE page (no separate pages)
- Text input must support copy/paste/typing (not just file upload)

## Technical Architecture

### Frontend
- React + TypeScript + Vite
- shadcn/ui components (Radix UI primitives)
- Tailwind CSS styling
- TanStack Query for API calls
- Wouter for routing
- React Dropzone for file uploads

### Backend
- Express.js + TypeScript
- Anthropic Claude API (via Replit AI Integrations)
- Zod schema validation
- Drizzle ORM ready (PostgreSQL)

### API Endpoints
- `POST /api/bleach` — Bleaches text, returns bleached string
- `POST /api/build-sentence-bank` — Splits into sentences, bleaches each, returns JSONL
- `POST /api/chunk-preview` — Splits large text into sentence-aware chunks with metadata (word count, sentence count, preview)
- `POST /api/match` — Matches AI text sentences to human patterns from the bank
- `POST /api/humanize` — Humanizes AI text using matched human patterns (Step 3)
- `POST /api/rewrite-style` — Rewrites target text using style patterns (accepts authorStyleId or styleSample)
- `POST /api/content-similarity` — Compares original and rewritten text for semantic similarity (0-100 score)
- `GET /api/sentence-bank/status` — Returns count of entries in the bank
- `GET /api/sentence-bank` — Returns all entries in the bank
- `GET /api/sentence-bank/download/:installment` — Returns paginated entries (10,000 per installment) with metadata
- `GET /api/author-styles` — Returns all author styles with sentence counts
- `POST /api/author-styles` — Creates a new author style (name, description)
- `GET /api/author-styles/:id/sentences` — Returns all sentences for an author
- `POST /api/author-styles/:id/sentences` — Adds sentences to an author's bank (with deduplication)

### Key Files
- `client/src/pages/home.tsx` — Main UI (all features on one page)
- `server/bleach.ts` — Bleaching logic + Claude integration
- `server/matcher.ts` — Pattern matching engine (Layer 2)
- `server/humanizer.ts` — Humanizer module (Layer 3) with weighted similarity and slot-fill rewriting
- `server/rewriteInStyle.ts` — Style Transfer service (ephemeral pattern extraction and rewriting)
- `server/routes.ts` — API endpoints
- `shared/schema.ts` — Types and validation schemas
- `sentence_bank.jsonl` — Stored human sentence patterns (backup file)

### Important Notes
- `apiRequest` returns a Response object that must be parsed with `.json()`
- Uses direct Anthropic API via `ANTHROPIC_API_KEY` secret
- Max input: 5 million characters (10MB payload limit)
- Automatic chunking with rate limit handling for large texts
