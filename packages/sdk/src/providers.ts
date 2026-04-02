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

export function inferModelProvider(model: string | undefined): string | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.startsWith("claude-")) return "anthropic";
  if (m.startsWith("gpt-")) return "openai";
  if (m.startsWith("dall-e-")) return "openai";
  if (m.startsWith("text-embedding-")) return "openai";
  if (m.startsWith("gemini-")) return "google";
  if (m.startsWith("mistral-") || m.startsWith("mixtral-")) return "mistral";
  if (m.startsWith("llama-")) return "meta";
  if (m.startsWith("command-")) return "cohere";
  return null;
}
