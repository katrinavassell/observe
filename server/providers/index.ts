import type { ProviderAdapter } from "./types.js";
import { openaiAdapter } from "./openai.js";
import { anthropicAdapter } from "./anthropic.js";
import { googleAdapter } from "./google.js";
import { createOpenAICompatibleAdapter } from "./openai-compatible.js";

const togetherAdapter = createOpenAICompatibleAdapter(
  "togetherai",
  "https://api.together.xyz",
);

const nebiusAdapter = createOpenAICompatibleAdapter(
  "nebius",
  "https://api.studio.nebius.ai",
);

const groqAdapter = createOpenAICompatibleAdapter(
  "groq",
  "https://api.groq.com/openai",
);

const fireworksAdapter = createOpenAICompatibleAdapter(
  "fireworks",
  "https://api.fireworks.ai/inference",
);

const deepseekAdapter = createOpenAICompatibleAdapter(
  "deepseek",
  "https://api.deepseek.com",
);

const providers: Record<string, ProviderAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  google: googleAdapter,
  togetherai: togetherAdapter,
  nebius: nebiusAdapter,
  groq: groqAdapter,
  fireworks: fireworksAdapter,
  deepseek: deepseekAdapter,
};

export function getProvider(name: string): ProviderAdapter | undefined {
  return providers[name.toLowerCase()];
}

export function listProviders(): string[] {
  return Object.keys(providers);
}

export type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from "./types.js";
