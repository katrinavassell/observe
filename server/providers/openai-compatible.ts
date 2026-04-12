import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
  StreamSink,
} from "./types.js";
import { streamOpenAIFormat } from "./openai-stream.js";

/**
 * Creates a provider adapter for any OpenAI-compatible API.
 * Together AI, Nebius, Groq, Fireworks, etc. all use the same format.
 */
export function createOpenAICompatibleAdapter(
  name: string,
  defaultBaseUrl: string,
): ProviderAdapter {
  return {
    name,

    async sendStream(
      request: ProviderRequest,
      apiKey: string,
      sink: StreamSink,
      baseUrl?: string,
      timeoutMs = 25000,
    ): Promise<ProviderResponse> {
      const base = baseUrl || defaultBaseUrl;
      return streamOpenAIFormat(
        request,
        apiKey,
        sink,
        `${base}/v1/chat/completions`,
        timeoutMs,
      );
    },

    async send(
      request: ProviderRequest,
      apiKey: string,
      baseUrl?: string,
      timeoutMs = 25000,
    ): Promise<ProviderResponse> {
      const base = baseUrl || defaultBaseUrl;
      const url = `${base}/v1/chat/completions`;
      const start = Date.now();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
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
          | { prompt_tokens?: number; completion_tokens?: number }
          | undefined;
        return {
          ok: true,
          status: response.status,
          model: (data.model as string) || request.model,
          inputTokens: usage?.prompt_tokens || 0,
          outputTokens: usage?.completion_tokens || 0,
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
}
