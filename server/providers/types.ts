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

export interface ProviderAdapter {
  name: string;
  send(
    request: ProviderRequest,
    apiKey: string,
    baseUrl?: string,
    timeoutMs?: number,
  ): Promise<ProviderResponse>;
}
