import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";

export const anthropicAdapter: ProviderAdapter = {
  name: "anthropic",

  async send(
    request: ProviderRequest,
    apiKey: string,
    baseUrl?: string,
    timeoutMs = 25000,
  ): Promise<ProviderResponse> {
    const base = baseUrl || DEFAULT_BASE_URL;
    const url = `${base}/v1/messages`;
    const start = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Anthropic uses a different request shape: system is top-level, not in messages
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      max_tokens: request.max_tokens || 4096,
    };
    if (request.system) body.system = request.system;
    if (request.temperature !== undefined)
      body.temperature = request.temperature;
    if (request.stream !== undefined) body.stream = request.stream;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = (await response.json()) as Record<string, unknown>;
      const durationMs = Date.now() - start;

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          model: request.model,
          inputTokens: 0,
          outputTokens: 0,
          body: data,
          durationMs,
          error:
            (data.error as { message?: string })?.message ||
            `HTTP ${response.status}`,
        };
      }

      const usage = data.usage as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
      return {
        ok: true,
        status: response.status,
        model: (data.model as string) || request.model,
        inputTokens: usage?.input_tokens || 0,
        outputTokens: usage?.output_tokens || 0,
        body: data,
        durationMs,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        status: 502,
        model: request.model,
        inputTokens: 0,
        outputTokens: 0,
        body: {},
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : "Provider request failed",
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
