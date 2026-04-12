export const OPENAI_PRICING: Record<string, { input: number; output: number }> =
  {
    "gpt-4o": { input: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
    "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
    "gpt-4-turbo": { input: 10.0 / 1_000_000, output: 30.0 / 1_000_000 },
    "gpt-4": { input: 30.0 / 1_000_000, output: 60.0 / 1_000_000 },
    "gpt-3.5-turbo": { input: 0.5 / 1_000_000, output: 1.5 / 1_000_000 },
    o1: { input: 15.0 / 1_000_000, output: 60.0 / 1_000_000 },
    "o1-mini": { input: 3.0 / 1_000_000, output: 12.0 / 1_000_000 },
    "o1-pro": { input: 150.0 / 1_000_000, output: 600.0 / 1_000_000 },
    o3: { input: 10.0 / 1_000_000, output: 40.0 / 1_000_000 },
    "o3-mini": { input: 1.1 / 1_000_000, output: 4.4 / 1_000_000 },
    "o4-mini": { input: 1.1 / 1_000_000, output: 4.4 / 1_000_000 },
    "text-embedding-3-small": { input: 0.02 / 1_000_000, output: 0 },
    "text-embedding-3-large": { input: 0.13 / 1_000_000, output: 0 },
    "text-embedding-ada-002": { input: 0.1 / 1_000_000, output: 0 },
  };

export const ANTHROPIC_PRICING: Record<
  string,
  { input: number; output: number }
> = {
  "claude-sonnet-4-5": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  "claude-opus-4": { input: 15.0 / 1_000_000, output: 75.0 / 1_000_000 },
  "claude-sonnet-4": { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  "claude-sonnet-4-20250514": {
    input: 3.0 / 1_000_000,
    output: 15.0 / 1_000_000,
  },
  "claude-haiku-4-20250414": {
    input: 0.8 / 1_000_000,
    output: 4.0 / 1_000_000,
  },
  "claude-3-5-sonnet-20241022": {
    input: 3.0 / 1_000_000,
    output: 15.0 / 1_000_000,
  },
  "claude-3-5-haiku-20241022": {
    input: 0.8 / 1_000_000,
    output: 4.0 / 1_000_000,
  },
  "claude-3-opus-20240229": {
    input: 15.0 / 1_000_000,
    output: 75.0 / 1_000_000,
  },
  "claude-3-haiku-20240307": {
    input: 0.25 / 1_000_000,
    output: 1.25 / 1_000_000,
  },
};

// Detect provider from a model string.
//
// Strategy (matches LiteLLM / Helicone / OpenRouter convention):
//   1. `provider/model` slug prefix wins (e.g. "openai/gpt-4o")
//   2. Exact lookup against known model keys (derived from pricing maps)
//   3. Keyword scan with word boundaries — order-independent, so
//      "open-ai-gpt-o3" and "o3-open-ai-gpt" both match openai
//   4. null if nothing matches — callers must handle, never default silently

const KNOWN_PROVIDER_PREFIXES = new Set([
  "openai",
  "anthropic",
  "google",
  "mistral",
  "meta",
  "meta-llama",
  "cohere",
  "azure",
  "bedrock",
  "vertex_ai",
  "vertex",
]);

const PROVIDER_PREFIX_ALIASES: Record<string, string> = {
  "meta-llama": "meta",
  azure: "openai",
  vertex_ai: "google",
  vertex: "google",
};

const KNOWN_MODELS: Record<string, string> = {
  ...Object.fromEntries(
    Object.keys(OPENAI_PRICING).map((k) => [k.toLowerCase(), "openai"]),
  ),
  "dall-e-3": "openai",
  "dall-e-2": "openai",
  ...Object.fromEntries(
    Object.keys(ANTHROPIC_PRICING).map((k) => [k.toLowerCase(), "anthropic"]),
  ),
};

const PROVIDER_KEYWORDS: Array<[RegExp, string]> = [
  [/\b(anthropic|claude)\b/i, "anthropic"],
  [/\b(openai|gpt|dall-e|text-embedding|o1|o3|o4)\b/i, "openai"],
  [/\b(google|gemini|palm|bison)\b/i, "google"],
  [/\b(mistral|mixtral|codestral)\b/i, "mistral"],
  [/\b(meta|llama)\b/i, "meta"],
  [/\b(cohere|command)\b/i, "cohere"],
];

export function inferModelProvider(
  model: string | undefined | null,
): string | null {
  if (!model) return null;
  const raw = model.trim();
  if (!raw) return null;

  const slashIdx = raw.indexOf("/");
  if (slashIdx > 0) {
    const prefix = raw.slice(0, slashIdx).toLowerCase();
    if (KNOWN_PROVIDER_PREFIXES.has(prefix)) {
      return PROVIDER_PREFIX_ALIASES[prefix] ?? prefix;
    }
  }

  const lower = raw.toLowerCase();
  if (KNOWN_MODELS[lower]) return KNOWN_MODELS[lower];

  for (const [re, provider] of PROVIDER_KEYWORDS) {
    if (re.test(lower)) return provider;
  }

  return null;
}
