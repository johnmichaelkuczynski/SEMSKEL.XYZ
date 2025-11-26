# Semantic Bleacher — GPT-Bypass Humanizer (Layer 1)

## Overview

This project is building a **GPT-bypass humanizer** — a system that rewrites AI text using REAL HUMAN sentence geometry so it passes detectors while preserving meaning.

The project has **three layers**:

### Layer 1 — Bleaching Tool (CURRENT)
The bleaching tool extracts structural patterns from human-written text. It:
- Splits text into individual sentences
- Bleaches each sentence (replaces content words with variables)
- Computes sentence metadata (length, tokens, clause count, punctuation, etc.)
- Returns each sentence as a JSON object

**Purpose**: Build a growing library of human sentence patterns stored as `sentence_bank.jsonl` inside the app.

### Layer 2 — Matching Engine (NEXT)
A matching system that takes one AI sentence and finds the closest human sentence pattern in the bank by:
- Similar length
- Identical clause count  
- Identical punctuation
- Similar bleached structure

This finds a human sentence with the same "shape" as the AI sentence to prevent distortion.

### Layer 3 — Final Humanizer (FUTURE)
After a match is found:
- Takes the human sentence pattern
- Takes the original AI sentence meaning
- Asks the LLM to rewrite the AI sentence INTO that pattern while keeping meaning intact

This produces human-like, detector-safe text with full content preservation.

## Current Status (November 26, 2025)

**LAYER 1 COMPLETE**

Features:
- Single-page UI with split panels (input | output)
- Text input via typing, pasting, OR drag-and-drop .txt file upload
- Five bleaching levels: Light, Moderate, Moderate-Heavy, Heavy (default), Very Heavy
- Two output modes (tabs): Bleached Text | JSONL Output
- "Bleach Text" button → displays bleached text
- "Generate JSONL" button → generates sentence bank entries with metadata
- Copy, Download, Clear operations
- Anthropic Claude integration via Replit AI Integrations

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

### Key Files
- `client/src/pages/home.tsx` — Main UI (all features on one page)
- `server/bleach.ts` — Bleaching logic + Claude integration
- `server/routes.ts` — API endpoints
- `shared/schema.ts` — Types and validation schemas

### Important Notes
- `apiRequest` returns a Response object that must be parsed with `.json()`
- Replit AI Integration uses `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` and `AI_INTEGRATIONS_ANTHROPIC_API_KEY`
- Max input: 50,000 characters
