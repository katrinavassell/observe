export interface ProviderRequest {
  model: string;
  messages: Array<{ role: string; content: string | unknown }>;
  system?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

export interface ProviderResponse {
  ok: boolean;
  status: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  body: Record<string, unknown>;
  durationMs: number;
  error?: string;
}

// Sink for streaming bytes to the downstream client. The gateway wraps the
// Express response in one of these so adapters don't need to know about
// Express. First call to write() implies headers have been committed —
// after that, a mid-stream failure can no longer fall back to another target.
export interface StreamSink {
  write(chunk: Uint8Array): void;
  end(): void;
  // True once any bytes have been written (headers committed).
  get committed(): boolean;
}

export interface ProviderAdapter {
  name: string;
  send(
    request: ProviderRequest,
    apiKey: string,
    baseUrl?: string,
    timeoutMs?: number,
  ): Promise<ProviderResponse>;
  // Optional streaming path. Adapters that implement it pipe SSE bytes
  // directly to the sink and resolve the returned promise once the stream
  // has closed with final token counts and status. If not implemented, the
  // gateway returns 501 when a client asks for stream: true.
  sendStream?(
    request: ProviderRequest,
    apiKey: string,
    sink: StreamSink,
    baseUrl?: string,
    timeoutMs?: number,
  ): Promise<ProviderResponse>;
}
