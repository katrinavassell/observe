// Shared model → provider detection. Used by SDK and server routes.
//
// Strategy (matches LiteLLM / Helicone / OpenRouter convention):
//   1. `provider/model` slug prefix wins (e.g. "openai/gpt-4o")
//   2. Exact lookup against known model keys
//   3. Keyword scan with word boundaries — order-independent
//      (handles "open-ai-gpt-o3" and "o3-open-ai-gpt" the same way)
//   4. null if nothing matches — caller must handle, never default silently

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

export const KNOWN_MODELS: Record<string, string> = {
  // OpenAI
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
  "gpt-4-turbo": "openai",
  "gpt-4": "openai",
  "gpt-3.5-turbo": "openai",
  o1: "openai",
  "o1-mini": "openai",
  "o1-pro": "openai",
  o3: "openai",
  "o3-mini": "openai",
  "o4-mini": "openai",
  "text-embedding-3-small": "openai",
  "text-embedding-3-large": "openai",
  "text-embedding-ada-002": "openai",
  "dall-e-3": "openai",
  "dall-e-2": "openai",

  // Anthropic
  "claude-sonnet-4-5": "anthropic",
  "claude-opus-4": "anthropic",
  "claude-sonnet-4": "anthropic",
  "claude-sonnet-4-20250514": "anthropic",
  "claude-haiku-4-20250414": "anthropic",
  "claude-3-5-sonnet-20241022": "anthropic",
  "claude-3-5-haiku-20241022": "anthropic",
  "claude-3-opus-20240229": "anthropic",
  "claude-3-haiku-20240307": "anthropic",
};

// Keyword-based fallback. Word boundaries (\b) make this order-independent:
// "open-ai-gpt-o3" and "o3-open-ai-gpt" both match openai.
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

// Confidence score for inference profiles, based on sample count.
// Smooth curve in [0.3, 0.95] — replaces the previous 0.4/0.65/0.85 step function
// which could never report confidence above 0.85 or below 0.4.
//   n=1   → 0.35
//   n=10  → 0.46
//   n=50  → 0.65
//   n=100 → 0.80
//   n=200 → 0.95 (cap)
export function inferenceConfidence(sampleCount: number): number {
  if (sampleCount <= 0) return 0.3;
  const raw = 0.3 + Math.sqrt(sampleCount) / 20;
  return Math.min(0.95, Math.round(raw * 100) / 100);
}
