import { request } from "./base";

export interface Integration {
  provider: string;
  name: string;
  description: string;
  category: string;
  data_types: string[];
  available: boolean;
  status: "connected" | "disconnected" | "syncing" | "error";
  connected_at: string | null;
  last_sync_at: string | null;
  records_synced: number;
  account_name: string | null;
}

export interface StripeStatus {
  connected: boolean;
  account_id: string | null;
  account_name: string | null;
  is_live_mode?: boolean;
  connected_at?: string;
  last_synced_at?: string;
  api_key_prefix?: string;
}

export interface ConnectStripeResult {
  success: boolean;
  message: string;
  account_name: string;
  account_id: string;
}

export interface SyncResult {
  success: boolean;
  message: string;
  accounts_synced: number;
  subscriptions_synced: number;
  invoices_synced: number;
  total_customers: number;
  total_subscriptions: number;
  total_invoices: number;
}

export interface OpenAIConnectResult {
  success: boolean;
  message: string;
  has_usage_access: boolean;
  cost_synced: number;
  months_synced?: number;
}

export interface OpenAIStatus {
  connected: boolean;
  has_usage_access: boolean;
  api_key_prefix?: string;
  connected_at?: string;
  last_synced_at?: string | null;
}

export interface AnthropicConnectResult {
  success: boolean;
  message: string;
  has_usage_access: boolean;
  cost_synced: number;
  months_synced?: number;
}

export interface AnthropicStatus {
  connected: boolean;
  has_usage_access: boolean;
  api_key_prefix?: string;
  connected_at?: string;
  last_synced_at?: string | null;
}

export interface ComingSoonIntegration {
  provider: string;
  name: string;
  description: string;
  category: string;
  data_types: string[];
  available: boolean;
  coming_soon: boolean;
  use_cases: string[];
}

export interface RequestableIntegrations {
  ai_llm: Array<{ provider: string; name: string }>;
  analytics: Array<{ provider: string; name: string }>;
  finance_ops: Array<{ provider: string; name: string }>;
}

export interface IntegrationRequestParams {
  email: string;
  integration_type: string;
  category?: string;
  use_cases?: string[];
  other_description?: string;
  freeform_notes?: string;
}

export async function getIntegrations(): Promise<{
  integrations: Integration[];
}> {
  return request("/integrations");
}

export async function connectStripeWithApiKey(
  apiKey: string,
): Promise<ConnectStripeResult> {
  return request("/integrations/stripe/connect", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey }),
  });
}

export async function getStripeStatus(): Promise<StripeStatus> {
  return request("/integrations/stripe/status");
}

export async function syncStripeData(): Promise<SyncResult> {
  return request("/integrations/stripe/sync", { method: "POST" });
}

export async function disconnectStripe(
  clearData = false,
): Promise<{ success: boolean; message: string }> {
  return request("/integrations/stripe/disconnect", {
    method: "POST",
    body: JSON.stringify({ clear_data: clearData }),
  });
}

export async function connectOpenAI(
  apiKey: string,
): Promise<OpenAIConnectResult> {
  return request("/integrations/openai/connect", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey }),
  });
}

export async function getOpenAIStatus(): Promise<OpenAIStatus> {
  return request("/integrations/openai/status");
}

export async function connectAnthropic(
  apiKey: string,
): Promise<AnthropicConnectResult> {
  return request("/integrations/anthropic/connect", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey }),
  });
}

export async function getAnthropicStatus(): Promise<AnthropicStatus> {
  return request("/integrations/anthropic/status");
}

export async function getRequestableIntegrations(): Promise<{
  integrations: RequestableIntegrations;
}> {
  return request("/integrations/requestable");
}

export async function requestIntegration(
  params: IntegrationRequestParams,
): Promise<{ success: boolean; message: string; request_id: number }> {
  const searchParams = new URLSearchParams();
  searchParams.set("email", params.email);
  searchParams.set("integration_type", params.integration_type);
  if (params.category) searchParams.set("category", params.category);
  if (params.use_cases?.length)
    searchParams.set("use_cases", JSON.stringify(params.use_cases));
  if (params.other_description)
    searchParams.set("other_description", params.other_description);
  if (params.freeform_notes)
    searchParams.set("freeform_notes", params.freeform_notes);

  return request(`/integrations/request?${searchParams.toString()}`, {
    method: "POST",
  });
}
