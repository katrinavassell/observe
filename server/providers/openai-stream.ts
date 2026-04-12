// Shared OpenAI-format SSE streaming. Used by the openai adapter and the
// openai-compatible factory (Together, Nebius, Groq, Fireworks, Deepseek).
//
// Responsibilities:
// - Force stream_options.include_usage so the provider sends a final chunk
//   with token counts. Without this, streaming responses have zero usage.
// - Proxy raw SSE bytes to the sink in the same order they arrive.
// - Parse each data: line to extract final usage + model without
//   reconstructing the full message (we just pass the bytes through).
// - Handle pre-commit failures (HTTP 4xx/5xx with JSON body) by NOT writing
//   to the sink, so the gateway can fall back to another target.
// - Handle post-commit failures (network error mid-stream) by writing an
//   OpenAI-shaped error chunk and closing — fallback is no longer possible
//   once any bytes have been committed.

import type { ProviderRequest, ProviderResponse, StreamSink } from "./types.js";

const DONE_MARKER = "data: [DONE]";

interface ParsedUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

function tryParseChunk(
  line: string,
): { usage?: ParsedUsage; model?: string } | null {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const obj = JSON.parse(payload) as {
      usage?: ParsedUsage;
      model?: string;
    };
    return { usage: obj.usage, model: obj.model };
  } catch {
    // Malformed chunk — ignore, keep streaming. OpenAI has been known to
    // send partial keepalive lines that fail to parse; don't crash the stream.
    return null;
  }
}

export async function streamOpenAIFormat(
  request: ProviderRequest,
  apiKey: string,
  sink: StreamSink,
  url: string,
  timeoutMs: number,
): Promise<ProviderResponse> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Force include_usage so we can record tokens for billing.
  const streamRequest = {
    ...request,
    stream: true,
    stream_options: {
      ...(request.stream_options as Record<string, unknown> | undefined),
      include_usage: true,
    },
  };

  let finalModel = request.model;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(streamRequest),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Pre-commit failure. Caller can still fall back — don't write to sink.
      const errorBody = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      return {
        ok: false,
        status: response.status,
        model: request.model,
        inputTokens: 0,
        outputTokens: 0,
        body: errorBody,
        durationMs: Date.now() - start,
        error:
          (errorBody.error as { message?: string })?.message ||
          `HTTP ${response.status}`,
      };
    }

    if (!response.body) {
      return {
        ok: false,
        status: 502,
        model: request.model,
        inputTokens: 0,
        outputTokens: 0,
        body: {},
        durationMs: Date.now() - start,
        error: "Provider returned no body",
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      // Pass raw bytes straight through to the client — no transformation.
      sink.write(value);

      // Also parse line-by-line for usage extraction. Keep a buffer across
      // chunks since SSE events can split mid-line.
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line === DONE_MARKER) continue;
        const parsed = tryParseChunk(line);
        if (!parsed) continue;
        if (parsed.model) finalModel = parsed.model;
        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens ?? inputTokens;
          outputTokens = parsed.usage.completion_tokens ?? outputTokens;
        }
      }
    }

    sink.end();

    return {
      ok: true,
      status: 200,
      model: finalModel,
      inputTokens,
      outputTokens,
      body: {},
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Provider stream failed";

    if (sink.committed) {
      // Already writing to client — we can't fall back. Write an
      // OpenAI-shaped error event so SDKs can surface it, then close.
      const errorEvent =
        `data: ${JSON.stringify({ error: { message, type: "stream_error" } })}\n\n` +
        `data: [DONE]\n\n`;
      sink.write(new TextEncoder().encode(errorEvent));
      sink.end();
      return {
        ok: false,
        status: 200, // headers already 200 at this point
        model: finalModel,
        inputTokens,
        outputTokens,
        body: {},
        durationMs: Date.now() - start,
        error: message,
      };
    }

    return {
      ok: false,
      status: 502,
      model: request.model,
      inputTokens: 0,
      outputTokens: 0,
      body: {},
      durationMs: Date.now() - start,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}
