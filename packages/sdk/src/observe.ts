/**
 * Observe — RevenueCat-inspired singleton for AI cost tracking.
 *
 * Usage:
 *   Observe.configure({ apiKey: "obs_xxx" })
 *   Observe.identify({ customerId: "cus_123" })
 *   const openai = Observe.wrap(new OpenAI())
 */

interface ObserveConfig {
  apiKey: string;
  baseUrl?: string;
}

interface CustomerContext {
  customerId: string;
  name?: string;
  email?: string;
}

interface WrapOverrides {
  customerId?: string;
  featureKey?: string;
  agentId?: string;
}

let _config: { apiKey: string; baseUrl: string } | null = null;
let _customer: CustomerContext | null = null;
let _featureKey: string | null = null;
let _agentId: string | null = null;

const DEFAULT_BASE_URL = "https://app.tanso.io";

function assertConfigured(): { apiKey: string; baseUrl: string } {
  if (!_config)
    throw new Error("Observe.configure() must be called before wrap()");
  return _config;
}

function resolveHeaders(overrides?: WrapOverrides): Record<string, string> {
  const config = assertConfigured();
  const customerId = overrides?.customerId ?? _customer?.customerId;
  const featureKey = overrides?.featureKey ?? _featureKey;
  const agentId = overrides?.agentId ?? _agentId;
  const headers: Record<string, string> = {
    "x-tanso-key": config.apiKey,
  };
  if (customerId) headers["x-tanso-customer"] = customerId;
  if (featureKey) headers["x-tanso-feature"] = featureKey;
  if (agentId) headers["x-tanso-agent"] = agentId;
  return headers;
}

function isOpenAIClient(client: unknown): boolean {
  return (
    typeof client === "object" &&
    client !== null &&
    "chat" in client &&
    typeof (client as Record<string, unknown>).chat === "object"
  );
}

function isAnthropicClient(client: unknown): boolean {
  return (
    typeof client === "object" &&
    client !== null &&
    "messages" in client &&
    typeof (client as Record<string, unknown>).messages === "object"
  );
}

export const Observe = {
  configure(options: ObserveConfig): void {
    _config = {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
    };
  },

  identify(customer: CustomerContext): void {
    _customer = customer;
  },

  feature(featureKey: string): void {
    _featureKey = featureKey;
  },

  agent(agentId: string): void {
    _agentId = agentId;
  },

  wrap<T>(client: T, overrides?: WrapOverrides): T {
    const config = assertConfigured();
    const headers = resolveHeaders(overrides);
    const proxyUrl = `${config.baseUrl}/v1`;

    if (isOpenAIClient(client)) {
      const c = client as Record<string, unknown>;
      c.baseURL = proxyUrl;
      c.defaultHeaders = { ...(c.defaultHeaders as object), ...headers };
      return client;
    }

    if (isAnthropicClient(client)) {
      const c = client as Record<string, unknown>;
      c.baseURL = proxyUrl;
      c.defaultHeaders = { ...(c.defaultHeaders as object), ...headers };
      return client;
    }

    throw new Error(
      "Observe.wrap(): unrecognized client. Expected OpenAI or Anthropic instance.",
    );
  },

  /** Reset all state — for tests only. */
  _reset(): void {
    _config = null;
    _customer = null;
    _featureKey = null;
    _agentId = null;
  },
} as const;
