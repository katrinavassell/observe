import { request } from "./base";

export interface ObserveEvent {
  id: number;
  user_id: string;
  customer_id: string | null;
  customer_name?: string;
  feature_key: string | null;
  event_name: string | null;
  timestamp: string;
  cost_amount: number | null;
  cost_unit: string | null;
  revenue_amount: number | null;
  usage_units: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  input_cost: number | null;
  output_cost: number | null;
  tokens_source: "direct" | "estimated" | null;
  revenue_source:
    | "explicit"
    | "feature_pricing"
    | "per_unit"
    | "tiered"
    | "allocated"
    | "hybrid"
    | "subscription"
    | "none"
    | null;
  model: string | null;
  model_provider: string | null;
  source: string | null;
  granularity: string | null;
  is_inferred: boolean;
  properties: Record<string, unknown> | null;
  created_at: string;
  trace_id?: string | null;
  span_id?: string | null;
  parent_span_id?: string | null;
  duration_ms?: number | null;
  cost_type?: string | null;
}

export interface EventsResponse {
  events: ObserveEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface EventsQuery {
  limit?: number;
  offset?: number;
  feature_key?: string;
  customer_id?: string;
  model?: string;
  source?: string;
  date_from?: string;
  date_to?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
}

export async function getEvents(
  query: EventsQuery = {},
): Promise<EventsResponse> {
  const params = new URLSearchParams();
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  if (query.feature_key) params.set("feature_key", query.feature_key);
  if (query.customer_id) params.set("customer_id", query.customer_id);
  if (query.model) params.set("model", query.model);
  if (query.source) params.set("source", query.source);
  if (query.sort_by) params.set("sort_by", query.sort_by);
  if (query.sort_dir) params.set("sort_dir", query.sort_dir);
  if (query.date_from) params.set("date_from", query.date_from);
  if (query.date_to) params.set("date_to", query.date_to);
  const qs = params.toString();
  return request(`/events${qs ? "?" + qs : ""}`);
}

export interface EventsByFeature {
  feature_key: string;
  event_count: number;
  total_cost: number;
  total_revenue: number;
  total_usage: number;
  margin_pct: number | null;
  last_seen: string;
}

export async function getEventsByFeature(): Promise<EventsByFeature[]> {
  return request("/events/by-feature");
}

export interface EventsByCustomer {
  customer_id: string;
  customer_name: string;
  event_count: number;
  total_cost: number;
  total_revenue: number;
  margin_pct: number | null;
  last_seen: string;
}

export async function getEventsByCustomer(): Promise<EventsByCustomer[]> {
  return request("/events/by-customer");
}

export interface EventsByAgent {
  agent_id: string;
  event_count: number;
  total_cost: number;
  total_revenue: number;
  total_usage: number;
  margin_pct: number | null;
  last_seen: string;
}

export async function getEventsByAgent(): Promise<EventsByAgent[]> {
  return request("/events/by-agent");
}

export interface EventsByModel {
  model: string;
  model_provider: string | null;
  event_count: number;
  total_cost: number;
  total_revenue: number;
  total_usage: number;
  margin_pct: number | null;
  last_seen: string;
}

export async function getEventsByModel(): Promise<EventsByModel[]> {
  return request("/events/by-model");
}

export interface EventDetail {
  id: number;
  user_id: string;
  customer_id: string;
  customer_name?: string;
  feature_key: string;
  event_name: string;
  timestamp: string;
  cost_amount: number;
  revenue_amount: number;
  usage_units: number;
  input_tokens: number | null;
  output_tokens: number | null;
  input_cost: number | null;
  output_cost: number | null;
  revenue_source?: string | null;
  model?: string;
  model_provider?: string;
  source: string;
  properties?: Record<string, string>;
  request_body?: Record<string, unknown> | null;
  response_body?: Record<string, unknown> | null;
  trace_id?: string | null;
  span_id?: string | null;
  parent_span_id?: string | null;
  duration_ms?: number | null;
  cost_type?: string | null;
}

export async function getEventDetail(id: number): Promise<EventDetail> {
  return request(`/events/${id}`);
}

export async function sendTestEvent(featureKey: string): Promise<ObserveEvent> {
  return request("/events/test", {
    method: "POST",
    body: JSON.stringify({ featureKey }),
  });
}

export interface TraceListItem {
  trace_id: string;
  start_time: string;
  span_count: number;
  total_cost: number;
  total_revenue: number;
  total_duration_ms: number | null;
  root_event: string;
  cost_types: string[];
}

export interface TraceDetail {
  trace_id: string;
  spans: EventDetail[];
}

export interface CostTypeBreakdown {
  cost_type: string;
  event_count: number;
  total_cost: number;
  total_revenue: number;
  total_usage: number;
}

export async function getTraces(
  limit = 50,
  offset = 0,
): Promise<{ traces: TraceListItem[] }> {
  return request(`/events/traces?limit=${limit}&offset=${offset}`);
}

export async function getTrace(traceId: string): Promise<TraceDetail> {
  return request(`/events/trace/${traceId}`);
}

export async function getEventsByCostType(
  days = 30,
): Promise<{ breakdown: CostTypeBreakdown[] }> {
  return request(`/events/by-cost-type?days=${days}`);
}

export interface IngestEvent {
  eventName: string;
  customerReferenceId: string;
  featureKey: string;
  timestamp?: string;
  costAmount?: number;
  costUnit?: string;
  revenueAmount?: number;
  usageUnits?: number;
  model?: string;
  modelProvider?: string;
  properties?: Record<string, unknown>;
  meta?: Record<string, string>;
  idempotencyKey?: string;
}

export interface IngestResponse {
  accepted: number;
  rejected: number;
  errors: Array<{ index: number; error: string }>;
}

export async function ingestEvents(
  events: IngestEvent[],
  apiKey?: string,
): Promise<IngestResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return request("/events/ingest", {
    method: "POST",
    headers,
    body: JSON.stringify({ events }),
  });
}

export interface SdkKey {
  id: number;
  key_prefix: string;
  full_key: string | null;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface CreateSdkKeyResponse {
  key: string;
  prefix: string;
  name: string | null;
}

export async function createSdkKey(
  name?: string,
): Promise<CreateSdkKeyResponse> {
  return request("/sdk-keys", {
    method: "POST",
    body: JSON.stringify({ name: name || null }),
  });
}

export async function listSdkKeys(): Promise<SdkKey[]> {
  return request("/sdk-keys");
}

export async function revokeSdkKey(id: number): Promise<{ success: boolean }> {
  return request(`/sdk-keys/${id}`, { method: "DELETE" });
}

export async function resetSdkKey(
  id: number,
): Promise<CreateSdkKeyResponse & { id: number }> {
  return request(`/sdk-keys/${id}/reset`, { method: "POST" });
}
