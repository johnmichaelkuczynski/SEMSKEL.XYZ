// Anthropic integration for semantic bleaching
// Using Replit's AI Integrations service (blueprint:javascript_anthropic_ai_integrations)
import Anthropic from "@anthropic-ai/sdk";
import type { BleachingLevel } from "@shared/schema";

// Initialize Anthropic client with Replit AI Integrations
const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

// Build level-specific prompts based on specification
function buildBleachingPrompt(text: string, level: BleachingLevel): string {
  const baseRules = `You are a semantic bleaching engine. Your task is to replace content words with variable placeholders while preserving ALL syntax, punctuation, and grammatical structure EXACTLY.

CRITICAL RULES:
1. This is MECHANICAL SUBSTITUTION only. Do NOT rewrite, rephrase, or restructure anything.
2. Every comma, period, dash, semicolon, parenthesis, and quotation mark must remain EXACTLY where it is.
3. Word order must remain EXACTLY the same.
4. When you replace a word, preserve its grammatical form:
   - Plural nouns: "cats" → "X's" 
   - Gerunds: "running" → "X-ing"
   - Past tense: "jumped" → "X-ed"
   - Derived forms: "rationalize" → "R" but "rationalization" → "R-ation"
5. Same word = same variable throughout. If "doubt" = P, then every "doubt" becomes "P".
6. NEVER add words. NEVER remove words. NEVER change punctuation.

BLEACHING LEVEL: ${level}

`;

  let levelInstructions = "";

  switch (level) {
    case "Light":
      levelInstructions = `LIGHT BLEACHING - Replace ONLY:
- Named entities (people, places, schools of thought): "Hume" → "A", "Cartesian" → "C-ian"
- Domain-specific category nouns: "philosopher" → "A-type", "obsessive-compulsive" → "B-type"

PRESERVE: All common nouns, verbs, adjectives, adverbs`;
      break;

    case "Moderate":
      levelInstructions = `MODERATE BLEACHING - Replace everything in Light, PLUS:
- Key domain nouns: "world" → "X-domain", "mind" → "Y-domain", "thought" → "Y-activity"
- Key domain verbs: "doubt" → "P", "believe" → "Q"
- Key domain adjectives: "impotent" → "S", "fearful" → "T"
- Psychological/technical vocabulary

PRESERVE: Common descriptive words, basic verbs, everyday nouns`;
      break;

    case "Heavy":
      levelInstructions = `HEAVY BLEACHING (DEFAULT) - Replace everything in Moderate, PLUS:
- Most content nouns: "person" → "F", "material" → "O"
- Most content adjectives: "invidious" → "E", "primal" → "Ω8"
- Most content verbs

PRESERVE: Only function words (articles, prepositions, conjunctions, pronouns), basic copulas (is, are, being, have, has), logical connectives`;
      break;

    case "Very Heavy":
      levelInstructions = `VERY HEAVY BLEACHING - Replace virtually ALL content words:
- Every noun, verb, adjective, adverb with semantic weight
- Use Greek letters (α, β, γ, δ, ε, ζ, η, θ, ι, κ, λ, μ, ν, ξ, π, ρ, σ, τ, υ, φ, χ, ψ, ω) and indexed Omegas (Ω1, Ω2, etc.) when Latin alphabet exhausted

PRESERVE ONLY: 
- Articles (a, an, the)
- Prepositions (of, in, to, by, on, with, for, at, from)
- Conjunctions (and, but, or, that, which, when, where, if, because, although)
- Pronouns (they, their, it, one, oneself, themselves, this, that)
- Basic copulas and auxiliaries (is, are, was, were, being, have, has, had, do, does, did, can, could, would, should, must)
- Quantifiers (all, some, any, both, neither, more, less, most, few, many, much, every, each)
- Logical/discourse markers (indeed, of course, in fact, however, therefore, thus, hence)
- Demonstratives and deictics (here, there, now, then)`;
      break;
  }

  return `${baseRules}
${levelInstructions}

INPUT TEXT:
"""
${text}
"""

OUTPUT: Provide ONLY the bleached text. No explanations, no commentary, no introductory text. Just the bleached result.`;
}

// Perform semantic bleaching using Claude
export async function bleachText(
  text: string,
  level: BleachingLevel
): Promise<string> {
  try {
    const prompt = buildBleachingPrompt(text, level);

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    if (content.type === "text") {
      return content.text.trim();
    }

    throw new Error("Unexpected response type from Claude");
  } catch (error: any) {
    console.error("Bleaching error:", error);
    throw new Error(
      `Failed to bleach text: ${error.message || "Unknown error"}`
    );
  }
}
