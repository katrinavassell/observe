import type { Pool } from "pg";

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

const PRICE_PER_TOKEN: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.00000015, output: 0.0000006 },
  "gpt-4o": { input: 0.0000025, output: 0.00001 },
};

export function trackSelfLLM(
  pool: Pool,
  params: {
    userId: string;
    featureKey: string;
    eventName: string;
    model: string;
    usage?: OpenAIUsage;
  },
): void {
  const price = PRICE_PER_TOKEN[params.model] || PRICE_PER_TOKEN["gpt-4o-mini"];
  const promptTokens = params.usage?.prompt_tokens || 0;
  const completionTokens = params.usage?.completion_tokens || 0;
  const cost = (
    promptTokens * price.input +
    completionTokens * price.output
  ).toFixed(6);
  const totalTokens = promptTokens + completionTokens;

  pool
    .query(
      `INSERT INTO observe_events
       (user_id, feature_key, event_name, timestamp, cost_amount, cost_unit, usage_units, model, model_provider, source, granularity, is_inferred)
       VALUES ($1, $2, $3, NOW(), $4, 'usd', $5, $6, 'openai', 'internal', 'event', false)`,
      [
        params.userId,
        params.featureKey,
        params.eventName,
        cost,
        totalTokens,
        params.model,
      ],
    )
    .catch((err) => console.error("trackSelfLLM insert failed:", err));
}
