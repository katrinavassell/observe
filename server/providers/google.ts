import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from "./types.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export const googleAdapter: ProviderAdapter = {
  name: "google",

  async send(
    request: ProviderRequest,
    apiKey: string,
    baseUrl?: string,
    timeoutMs = 25000,
  ): Promise<ProviderResponse> {
    const base = baseUrl || DEFAULT_BASE_URL;
    const model = request.model || "gemini-2.5-flash";
    const url = `${base}/models/${model}:generateContent?key=${apiKey}`;
    const start = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Google uses { contents: [{ parts: [{ text }], role }] } format
    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        {
          text:
            typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content),
        },
      ],
    }));

    const body: Record<string, unknown> = { contents };
    if (request.system) {
      body.systemInstruction = { parts: [{ text: request.system }] };
    }
    if (request.temperature !== undefined) {
      body.generationConfig = { temperature: request.temperature };
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = (await response.json()) as Record<string, unknown>;
      const durationMs = Date.now() - start;

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          model,
          inputTokens: 0,
          outputTokens: 0,
          body: data,
          durationMs,
          error:
            (data.error as { message?: string })?.message ||
            `HTTP ${response.status}`,
        };
      }

      const usage = data.usageMetadata as
        | { promptTokenCount?: number; candidatesTokenCount?: number }
        | undefined;
      return {
        ok: true,
        status: response.status,
        model,
        inputTokens: usage?.promptTokenCount || 0,
        outputTokens: usage?.candidatesTokenCount || 0,
        body: data,
        durationMs,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        status: 502,
        model,
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
