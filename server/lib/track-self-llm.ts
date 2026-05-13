const OBSERVE_URL = process.env.OBSERVE_BASE_URL || "http://localhost:3001";

export function trackSelfLLM(params: {
  featureKey: string;
  eventName: string;
  model: string;
  modelProvider: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  idempotencyKey?: string;
}): void {
  const apiKey = process.env.OBSERVE_SELF_API_KEY;
  if (!apiKey) return;

  fetch(`${OBSERVE_URL}/api/events/ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      events: [
        {
          eventName: params.eventName,
          customerReferenceId: "observe-self",
          featureKey: params.featureKey,
          model: params.model,
          modelProvider: params.modelProvider,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          durationMs: params.durationMs,
          idempotencyKey: params.idempotencyKey,
        },
      ],
    }),
  }).catch((err) => console.error("observe self-track failed:", err));
}
