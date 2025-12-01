import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type LLMProvider = "anthropic" | "openai" | "grok" | "perplexity" | "deepseek";

export interface LLMProviderInfo {
  id: LLMProvider;
  name: string;
  maxContextTokens: number;
  maxOutputTokens: number;
  recommendedChunkSize: number;
  available: boolean;
  description: string;
}

export const LLM_PROVIDERS: LLMProviderInfo[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    maxContextTokens: 64000,
    maxOutputTokens: 8192,
    recommendedChunkSize: 3000,
    available: !!process.env.DEEPSEEK_API_KEY,
    description: "Best for large texts - 64K context, very cost-effective"
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    maxContextTokens: 200000,
    maxOutputTokens: 4096,
    recommendedChunkSize: 2000,
    available: !!process.env.ANTHROPIC_API_KEY,
    description: "200K context but conservative output - good balance"
  },
  {
    id: "openai",
    name: "OpenAI GPT",
    maxContextTokens: 128000,
    maxOutputTokens: 8192,
    recommendedChunkSize: 2500,
    available: !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY),
    description: "128K context, fast responses, reliable"
  },
  {
    id: "grok",
    name: "xAI Grok",
    maxContextTokens: 131072,
    maxOutputTokens: 8192,
    recommendedChunkSize: 2500,
    available: !!process.env.GROK_API_KEY,
    description: "131K context - good for medium-large texts"
  },
  {
    id: "perplexity",
    name: "Perplexity",
    maxContextTokens: 127072,
    maxOutputTokens: 4096,
    recommendedChunkSize: 2000,
    available: !!process.env.PERPLEXITY_API_KEY,
    description: "127K context - balanced performance"
  }
];

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openaiClient = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL 
  ? new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
    })
  : null;

const grokClient = process.env.GROK_API_KEY 
  ? new OpenAI({
      baseURL: "https://api.x.ai/v1",
      apiKey: process.env.GROK_API_KEY
    })
  : null;

const perplexityClient = process.env.PERPLEXITY_API_KEY
  ? new OpenAI({
      baseURL: "https://api.perplexity.ai",
      apiKey: process.env.PERPLEXITY_API_KEY
    })
  : null;

const deepseekClient = process.env.DEEPSEEK_API_KEY
  ? new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY
    })
  : null;

export function getAvailableProviders(): LLMProviderInfo[] {
  return LLM_PROVIDERS.map(p => ({
    ...p,
    available: checkProviderAvailability(p.id)
  }));
}

function checkProviderAvailability(provider: LLMProvider): boolean {
  switch (provider) {
    case "anthropic":
      return !!process.env.ANTHROPIC_API_KEY;
    case "openai":
      return !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
    case "grok":
      return !!process.env.GROK_API_KEY;
    case "perplexity":
      return !!process.env.PERPLEXITY_API_KEY;
    case "deepseek":
      return !!process.env.DEEPSEEK_API_KEY;
    default:
      return false;
  }
}

export function getProviderInfo(provider: LLMProvider): LLMProviderInfo | undefined {
  const info = LLM_PROVIDERS.find(p => p.id === provider);
  if (info) {
    return { ...info, available: checkProviderAvailability(provider) };
  }
  return undefined;
}

export async function callLLM(
  provider: LLMProvider,
  prompt: string,
  systemPrompt?: string,
  maxTokens: number = 4096,
  timeoutMs: number = 25000
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    switch (provider) {
      case "anthropic":
        return await callAnthropic(prompt, systemPrompt, maxTokens);
      
      case "openai":
        return await callOpenAI(prompt, systemPrompt, maxTokens);
      
      case "grok":
        return await callGrok(prompt, systemPrompt, maxTokens);
      
      case "perplexity":
        return await callPerplexity(prompt, systemPrompt, maxTokens);
      
      case "deepseek":
        return await callDeepSeek(prompt, systemPrompt, maxTokens);
      
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callAnthropic(prompt: string, systemPrompt?: string, maxTokens: number = 4096): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
  });

  const content = message.content[0];
  if (content.type === "text") {
    return content.text.trim();
  }
  throw new Error("Unexpected response type from Anthropic");
}

async function callOpenAI(prompt: string, systemPrompt?: string, maxTokens: number = 4096): Promise<string> {
  if (!openaiClient) {
    throw new Error("OpenAI not configured");
  }
  
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await openaiClient.chat.completions.create({
    model: "gpt-5",
    messages,
    max_completion_tokens: maxTokens,
  });

  return response.choices[0]?.message?.content?.trim() || "";
}

async function callGrok(prompt: string, systemPrompt?: string, maxTokens: number = 4096): Promise<string> {
  if (!grokClient) {
    throw new Error("Grok not configured - add GROK_API_KEY");
  }
  
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await grokClient.chat.completions.create({
    model: "grok-3",
    messages,
    max_tokens: maxTokens,
  });

  return response.choices[0]?.message?.content?.trim() || "";
}

async function callPerplexity(prompt: string, systemPrompt?: string, maxTokens: number = 4096): Promise<string> {
  if (!perplexityClient) {
    throw new Error("Perplexity not configured - add PERPLEXITY_API_KEY");
  }
  
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await perplexityClient.chat.completions.create({
    model: "llama-3.1-sonar-large-128k-online",
    messages,
    max_tokens: maxTokens,
  });

  return response.choices[0]?.message?.content?.trim() || "";
}

async function callDeepSeek(prompt: string, systemPrompt?: string, maxTokens: number = 4096): Promise<string> {
  if (!deepseekClient) {
    throw new Error("DeepSeek not configured - add DEEPSEEK_API_KEY");
  }
  
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await deepseekClient.chat.completions.create({
    model: "deepseek-chat",
    messages,
    max_tokens: maxTokens,
  });

  return response.choices[0]?.message?.content?.trim() || "";
}
