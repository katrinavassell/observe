const API_BASE = "/api";

const CURRENT_ACCOUNT_ID_KEY = "observe:current_account_id";

function getAnonVisitorId(): string {
  let id = localStorage.getItem("observe_visitor_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("observe_visitor_id", id);
  }
  return id;
}

export function getCurrentAccountId(): number | null {
  const raw = localStorage.getItem(CURRENT_ACCOUNT_ID_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function setCurrentAccountId(id: number): void {
  localStorage.setItem(CURRENT_ACCOUNT_ID_KEY, String(id));
  window.dispatchEvent(
    new CustomEvent("observe:account-changed", { detail: id }),
  );
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const { getAuthToken, isAuthenticated } = await import("@/lib/clerk");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (isAuthenticated()) {
    const token = await getAuthToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const accountId = getCurrentAccountId();
    if (accountId !== null && !("X-Account-Id" in headers)) {
      headers["X-Account-Id"] = String(accountId);
    }
  } else {
    headers["x-visitor-id"] = getAnonVisitorId();
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    let errorMessage = `API Error: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.error) {
        errorMessage = errorData.error;
      }
    } catch {
      // Ignore parse errors
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

export interface DataStatus {
  data_mode: "none" | "sample" | "user";
  has_data: boolean;
  customer_count: number;
  has_revenue: boolean;
  has_costs: boolean;
  has_usage: boolean;
  revenue_customer_count: number;
  costs_record_count: number;
  usage_record_count: number;
  last_sync_at: string | null;
}

export async function getDataStatus(): Promise<DataStatus> {
  return request("/data/status");
}

export async function clearData(): Promise<{ success: boolean }> {
  return request("/data/clear", { method: "DELETE" });
}

export async function clearRevenueData(): Promise<{ success: boolean }> {
  return request("/data/clear/revenue", { method: "DELETE" });
}

export async function clearCostData(): Promise<{ success: boolean }> {
  return request("/data/clear/costs", { method: "DELETE" });
}

export async function clearUsageData(): Promise<{ success: boolean }> {
  return request("/data/clear/usage", { method: "DELETE" });
}

export interface Customer {
  id: string;
  customer_id: string;
  name: string;
  email: string | null;
  segment: string | null;
  created_at: string;
}

export async function getCustomers(): Promise<Customer[]> {
  const res = await request<{ data: Customer[] }>("/customers");
  return res.data;
}

export interface Subscription {
  id: string;
  subscription_id: string;
  customer_id: string;
  plan_id: string;
  is_active: boolean;
  mrr_override: number | null;
  customer_name?: string;
  customer_email?: string;
  plan_name?: string;
  price_amount?: number;
}

export async function getSubscriptions(): Promise<Subscription[]> {
  const res = await request<{
    data: Subscription[];
    total: number;
    limit: number;
    offset: number;
  }>("/subscriptions");
  return res.data;
}

export interface Plan {
  id: string;
  plan_id: string;
  name: string;
  price_amount: number;
  interval_months: number;
}

export async function getPlans(): Promise<Plan[]> {
  return request("/plans");
}

export interface MetricsSummary {
  total_customers: number;
  active_subscriptions: number;
  mrr: number;
  arr: number;
  arpc: number;
}

export async function getMetricsSummary(): Promise<MetricsSummary> {
  return request("/metrics/summary");
}

export interface SourceBreakdown {
  sources: Array<{
    source: string;
    event_count: number;
    total_cost: number;
    total_revenue: number;
  }>;
  total_events: number;
}

export async function getSourceBreakdown(): Promise<SourceBreakdown> {
  return request("/metrics/source-breakdown");
}

// Upload endpoints
export interface CostRecord {
  customer_id?: string;
  month: string;
  cost: number;
  provider?: string;
}

export async function uploadCostData(
  records: CostRecord[],
): Promise<{ success: boolean; count: number }> {
  return request("/data/upload/costs", {
    method: "POST",
    body: JSON.stringify({ records }),
  });
}

// Helicone import
export interface HeliconeEvent {
  request_id?: string;
  created_at?: string;
  model?: string;
  provider?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  user_id?: string;
  properties?: Record<string, string>;
}

export async function importHeliconeData(
  events: HeliconeEvent[],
): Promise<{ success: boolean; imported: number; total: number }> {
  return request("/import/helicone", {
    method: "POST",
    body: JSON.stringify({ events }),
  });
}

export interface UsageRecord {
  customer_id: string;
  month: string;
  metric?: string;
  metric_key?: string;
  value?: number;
  metric_value?: number;
  limit?: number;
  metric_limit?: number;
}

export async function uploadUsageData(
  records: UsageRecord[],
): Promise<{ success: boolean; count: number }> {
  return request("/data/upload/usage", {
    method: "POST",
    body: JSON.stringify({ records }),
  });
}

export interface RevenueUploadData {
  customers: Array<{
    customer_id: string;
    name: string;
    email?: string;
    segment?: string;
  }>;
  plans: Array<{
    plan_id: string;
    name: string;
    price_amount: number;
    interval_months?: number;
  }>;
  subscriptions: Array<{
    subscription_id: string;
    customer_id: string;
    plan_id: string;
    is_active?: boolean;
    mrr_override?: number;
    current_period_start?: string;
    current_period_end?: string;
  }>;
}

export async function uploadRevenueData(data: RevenueUploadData): Promise<{
  success: boolean;
  counts: { customers: number; plans: number; subscriptions: number };
}> {
  return request("/data/upload/revenue", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export interface AnalyzerData {
  plans: Array<{
    plan_id: string;
    name: string;
    price_amount: number;
    interval_months: number;
    billing_model: "recurring" | "usage_based" | "hybrid";
  }>;
  customers: Array<{
    customer_id: string;
    name: string;
    email?: string;
    segment?: string;
    created_at: string;
  }>;
  subscriptions: Array<{
    subscription_id: string;
    customer_id: string;
    plan_id: string;
    is_active: boolean;
    mrr_override?: number;
    previous_mrr?: number;
    current_period_start?: string;
    current_period_end?: string;
    cancelled_at?: string;
  }>;
  usage: Array<{
    customer_id: string;
    metric_key: string;
    metric_value: number;
    metric_limit?: number;
    period_start: string;
    period_end: string;
  }>;
  costs: Array<{
    customer_id?: string;
    cost_type: string;
    amount: number;
    period_start: string;
    period_end: string;
  }>;
}

export async function fetchAnalyzerData(): Promise<AnalyzerData | null> {
  return request("/data/analyzer");
}

// ======================================================================// FEATURE ECONOMICS
// ======================================================================
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

export interface FeatureSummary {
  feature_key: string;
  event_count: number;
  customer_count: number;
  total_cost: number;
  total_revenue: number;
  total_usage: number;
  avg_cost_per_event: number;
  avg_revenue_per_event: number;
  margin_pct: number | null;
  last_seen: string;
}

export interface FeatureDetail extends FeatureSummary {
  recent_events: ObserveEvent[];
  by_customer: Array<{
    customer_id: string;
    customer_name: string;
    event_count: number;
    total_cost: number;
    total_revenue: number;
  }>;
  by_model: Array<{
    model: string;
    model_provider: string;
    event_count: number;
    total_cost: number;
    total_revenue: number;
  }>;
  timeseries: Array<{
    month: string;
    event_count: number;
    total_cost: number;
    total_revenue: number;
    total_usage: number;
  }>;
}

export interface ModelSummary {
  model: string;
  model_provider: string | null;
  event_count: number;
  customer_count: number;
  feature_count: number;
  total_cost: number;
  total_revenue: number;
  total_usage: number;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  avg_cost_per_event: number;
  margin_pct: number | null;
  last_seen: string;
}

export interface CustomerDetail {
  customer: {
    customer_id: string;
    name: string;
    email: string | null;
    segment: string | null;
    created_at: string;
  };
  subscriptions: Array<{
    subscription_id: string;
    plan_id: string;
    plan_name: string;
    price_amount: number;
    is_active: boolean;
    mrr_override: number | null;
  }>;
  total_cost: number;
  total_revenue: number;
  margin_pct: number | null;
  recent_events: ObserveEvent[];
  by_model: Array<{
    model: string;
    model_provider: string | null;
    event_count: number;
    total_cost: number;
    total_revenue: number;
    total_usage: number;
  }>;
  by_feature: Array<{
    feature_key: string;
    event_count: number;
    total_cost: number;
    total_revenue: number;
    total_usage: number;
    total_input_tokens: number | null;
    total_output_tokens: number | null;
  }>;
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

export async function getFeatures(): Promise<FeatureSummary[]> {
  return request("/features");
}

export async function getFeatureDetail(key: string): Promise<FeatureDetail> {
  return request(`/features/${encodeURIComponent(key)}`);
}

export async function getModels(): Promise<ModelSummary[]> {
  return request("/models");
}

export async function getCustomerDetail(
  id: string,
  period?: { period_start?: string; period_end?: string },
): Promise<CustomerDetail> {
  const params = new URLSearchParams();
  if (period?.period_start) params.set("period_start", period.period_start);
  if (period?.period_end) params.set("period_end", period.period_end);
  const qs = params.toString();
  return request(`/customers/${encodeURIComponent(id)}${qs ? "?" + qs : ""}`);
}

export interface CustomerTimeseriesPoint {
  month: string;
  event_count: number;
  total_cost: number;
  total_revenue: number;
  total_usage: number;
}

export async function getCustomerTimeseries(
  id: string,
): Promise<{ timeseries: CustomerTimeseriesPoint[] }> {
  return request(`/customers/${encodeURIComponent(id)}/timeseries`);
}

// ======================================================================// SDK EVENT INGESTION
// ======================================================================
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

// ======================================================================// SDK API KEY MANAGEMENT
// ======================================================================
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

// ======================================================================// FEATURE PRICING
// ======================================================================
export interface FeaturePricingRule {
  feature_key: string;
  revenue_per_unit: number;
  unit_label: string;
  effective_from: string;
  created_at: string;
}

export async function listFeaturePricing(): Promise<FeaturePricingRule[]> {
  const data = await request<{ rules: FeaturePricingRule[] }>(
    "/feature-pricing",
  );
  return data.rules;
}

export async function upsertFeaturePricing(
  feature_key: string,
  revenue_per_unit: number,
  unit_label?: string,
): Promise<{ ok: boolean }> {
  return request("/feature-pricing", {
    method: "POST",
    body: JSON.stringify({ feature_key, revenue_per_unit, unit_label }),
  });
}

export async function deleteFeaturePricing(
  featureKey: string,
): Promise<{ ok: boolean }> {
  return request(`/feature-pricing/${encodeURIComponent(featureKey)}`, {
    method: "DELETE",
  });
}

export async function listFeatureKeys(): Promise<string[]> {
  const data = await request<{ features: string[] }>(
    "/feature-pricing/features",
  );
  return data.features;
}

// ── Historical token backfill ────────────────────────────────────────────────
export interface BackfillTokensSummary {
  buckets_processed: number;
  rows_updated: number;
  rows_skipped_no_data: number;
  rows_out_of_retention: number;
}

export async function backfillTokens(
  provider: "openai" | "anthropic",
): Promise<BackfillTokensSummary> {
  return request("/backfill/tokens", {
    method: "POST",
    body: JSON.stringify({ provider }),
  });
}

export interface BackfillRevenueSummary {
  events_updated: number;
  events_skipped: number;
  events_checked: number;
  customers_resolved: number;
  customers_checked: number;
}

export async function backfillRevenue(): Promise<BackfillRevenueSummary> {
  return request("/backfill/revenue", { method: "POST" });
}

// ======================================================================// TEAM / ORGANIZATION
// ======================================================================
export interface OrgMember {
  id: string;
  visitor_id: string | null;
  invited_email: string | null;
  status: "pending" | "active";
  joined_at: string | null;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  owner_visitor_id: string;
  created_at: string;
}

export interface TeamInfo {
  org: Organization;
  members: OrgMember[];
  invite_token: string;
}

export async function getTeamInfo(): Promise<TeamInfo> {
  return request("/team");
}

export async function renameTeam(name: string): Promise<{ success: boolean }> {
  return request("/team/name", {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export interface InviteResult {
  success: boolean;
  invite_token: string;
}

export async function rotateInviteToken(): Promise<InviteResult> {
  return request("/team/invite/rotate", { method: "POST" });
}

export interface InviteInfo {
  org_name: string;
  invited_email: string | null;
}

export async function getInviteInfo(token: string): Promise<InviteInfo> {
  return request(`/team/invite/${token}`);
}

export async function acceptInvite(
  token: string,
): Promise<{ success: boolean; org_id: string }> {
  return request(`/team/join/${token}`, { method: "POST" });
}

export async function removeMember(
  memberId: string,
): Promise<{ success: boolean }> {
  return request(`/team/members/${memberId}`, { method: "DELETE" });
}

// REFERRAL SYSTEM
// ======================================================================
export interface ReferralCodeResponse {
  code: string;
}

export interface ReferralPromo {
  code: string | null;
  used: boolean;
  created_at: string;
}

export interface ReferralStats {
  code: string | null;
  total_referrals: number;
  converted_referrals: number;
  pending_referrals: number;
  promos: ReferralPromo[];
}

export async function getReferralCode(): Promise<ReferralCodeResponse> {
  return request("/referral/code");
}

export async function recordReferral(
  code: string,
): Promise<{ success: boolean; already_recorded?: boolean }> {
  return request("/referral/record", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function getReferralStats(): Promise<ReferralStats> {
  return request("/referral/stats");
}

// ======================================================================// ANALYTICS — CUSTOMER P&L & MARGIN ALERTS
// ======================================================================
export interface CustomerPnl {
  customer_id: string;
  customer_name: string;
  total_revenue: number;
  total_cost: number;
  margin_pct: number | null;
  event_count: number;
  unprofitable: boolean;
  top_cost_feature: string | null;
}

export interface MarginAlert {
  type: string;
  severity: "critical" | "warning";
  title: string;
  description: string;
  entity_id: string | null;
  metric_value: number | null;
}

export async function getCustomerPnl(): Promise<{ customers: CustomerPnl[] }> {
  return request("/analytics/customer-pnl");
}

export async function getMarginAlerts(): Promise<{ alerts: MarginAlert[] }> {
  return request("/analytics/margin-alerts");
}

export interface RetentionCohort {
  cohort_month: string;
  size: number;
  retention: number[];
}

export async function getRetentionCohorts(): Promise<{
  cohorts: RetentionCohort[];
}> {
  return request("/analytics/retention");
}

export interface MonthlyTrend {
  month: string;
  cost: number;
  revenue: number;
  margin_pct: number | null;
  event_count: number;
  active_customers: number;
  active_features: number;
  models_used: number;
}

export async function getMarginTrends(months?: number): Promise<{
  months: MonthlyTrend[];
  period_months: number;
}> {
  const params = months ? `?months=${months}` : "";
  return request(`/analytics/trends${params}`);
}

export interface RevenueConfidenceBreakdown {
  source: string;
  event_count: number;
  revenue: number;
  cost: number;
  pct_of_revenue: number;
}

export interface RevenueConfidence {
  breakdown: RevenueConfidenceBreakdown[];
  confidence_score: number;
  confidence_label: string;
  total_revenue: number;
  total_cost: number;
}

export async function getRevenueConfidence(): Promise<RevenueConfidence> {
  return request("/analytics/revenue-confidence");
}

export interface CostByTokenTypePoint {
  date: string;
  input_cost: number;
  output_cost: number;
}

export async function getCostByTokenType(
  days?: number,
): Promise<{ series: CostByTokenTypePoint[] }> {
  const params = days ? `?days=${days}` : "";
  return request(`/analytics/cost-by-token-type${params}`);
}

// ======================================================================// MRR MOVEMENTS
// ======================================================================
export interface MrrMovement {
  customer_id: string;
  customer_name: string;
  category: "new" | "expansion" | "contraction" | "churned" | "stable";
  current_mrr: number;
  prior_mrr: number;
  change: number;
}

export interface MrrSummary {
  new_mrr: number;
  expansion_mrr: number;
  contraction_mrr: number;
  churned_mrr: number;
  net_new_mrr: number;
}

export async function getMrrMovements(): Promise<{
  movements: MrrMovement[];
  summary: MrrSummary;
}> {
  return request("/analytics/mrr-movements");
}

// ======================================================================// COHORTS
// ======================================================================
export type CohortLabel =
  | "unprofitable"
  | "champion"
  | "inactive"
  | "rising_cost";

export type MrrMovementCategory =
  | "new"
  | "expansion"
  | "contraction"
  | "churned"
  | "stable";

export interface ModelSwapSuggestion {
  suggested_model: string;
  current_cost_per_event: number;
  suggested_cost_per_event: number;
  potential_savings_pct: number;
}

export async function setCustomerInternal(
  customerId: string,
  isInternal: boolean,
): Promise<{ customer_id: string; is_internal: boolean }> {
  return request(`/customers/${customerId}/internal`, {
    method: "PATCH",
    body: JSON.stringify({ is_internal: isInternal }),
  });
}

export interface CohortCustomer {
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  segment: string | null;
  is_internal: boolean;
  total_revenue: number;
  total_cost: number;
  margin_pct: number | null;
  event_count: number;
  feature_count: number;
  model_count: number;
  adoption_depth: number;
  first_seen: string;
  last_seen: string;
  cost_trend: "up" | "down" | "stable" | "new";
  cost_trend_pct: number | null;
  active_days_30d: number;
  active_days_prior_avg: number | null;
  health_score: number;
  top_model: string | null;
  top_model_cost: number | null;
  model_swap_suggestion: ModelSwapSuggestion | null;
  mrr_movement: MrrMovementCategory | null;
  pricing_model: string | null;
  cohort: CohortLabel | null;
}

export interface CohortSummary {
  count: number;
  total_revenue: number;
  total_cost: number;
}

export interface CohortTotals {
  customers: number;
  revenue: number;
  cost: number;
  margin_pct: number | null;
  avg_health_score: number;
}

export interface DiscoveredCluster {
  name: string;
  description: string;
  customer_ids: string[];
  severity: "critical" | "warning" | "info" | "positive";
  recommended_action: string;
}

export async function discoverCohorts(): Promise<{
  clusters: DiscoveredCluster[];
  source: "ai" | "deterministic";
}> {
  return request("/cohorts/discover", { method: "POST" });
}

export interface HealthSnapshot {
  snapshot_date: string;
  health_score: number;
  margin_pct: number | null;
  adoption_depth: number;
  active_days: number;
}

export async function getHealthHistory(
  customerId: string,
): Promise<{ history: HealthSnapshot[] }> {
  return request(`/cohorts/${encodeURIComponent(customerId)}/health-history`);
}

export async function getCohorts(
  opts: {
    showInternal?: boolean;
    periodStart?: string;
    periodEnd?: string;
  } = {},
): Promise<{
  customers: CohortCustomer[];
  summary: Record<CohortLabel, CohortSummary>;
  totals: CohortTotals;
}> {
  const params = new URLSearchParams();
  if (opts.showInternal) params.set("show_internal", "true");
  if (opts.periodStart) params.set("period_start", opts.periodStart);
  if (opts.periodEnd) params.set("period_end", opts.periodEnd);
  const qs = params.toString();
  return request(`/cohorts${qs ? `?${qs}` : ""}`);
}

// ======================================================================// STRIPE INVOICES
// ======================================================================
export async function syncStripeInvoices(): Promise<{
  success: boolean;
  invoices: number;
  line_items: number;
}> {
  return request("/stripe/sync-invoices", { method: "POST" });
}

// ======================================================================// AI PRICING SUGGESTIONS
// ======================================================================
export interface PricingSuggestion {
  feature_key: string;
  suggested_price: number;
  unit_label: string;
  rationale: string;
  current_cost_per_unit: number;
  target_margin_pct: number;
}

export async function suggestPricing(): Promise<{
  suggestions: PricingSuggestion[];
}> {
  return request("/analytics/suggest-pricing", { method: "POST" });
}

// ======================================================================// PROVIDER CSV IMPORT
// ======================================================================
export async function uploadProviderCsv(rawCsv: string): Promise<{
  success: boolean;
  provider: string;
  rows: number;
  models: string[];
}> {
  return request("/data/upload/provider-csv", {
    method: "POST",
    body: JSON.stringify({ raw_csv: rawCsv }),
  });
}

export interface AiInsight {
  id: string;
  insight_type: string;
  severity: string;
  title: string;
  description: string;
  feature_key: string | null;
  customer_id: string | null;
  metric_value: number | null;
  tokens_used: number | null;
  cost_usd: number | null;
  created_at: string;
}

export async function listInsights(): Promise<AiInsight[]> {
  return request("/insights");
}

export async function generateInsights(): Promise<{
  insights: AiInsight[];
  source: string;
  tokens_used: number;
  cost_usd: number;
}> {
  return request("/insights/generate", { method: "POST" });
}

export async function clearInsights(): Promise<{ success: boolean }> {
  return request("/insights", { method: "DELETE" });
}

// ======================================================================// USAGE LIMITS
// ======================================================================
export interface UsageLimits {
  configured: boolean;
  ai_insights?: {
    allowed: boolean;
    usage?: { used: number; limit: number; remaining: number };
  };
  event_ingest?: {
    allowed: boolean;
    usage: { used: number; limit: number; remaining: number };
  };
}

export async function getUsageLimits(): Promise<UsageLimits> {
  return request("/usage/limits");
}

// ======================================================================// BILLING
// ======================================================================
export interface BillingStatus {
  plan: "free" | "growth";
  hasStripeCustomer: boolean;
}

export async function getBillingStatus(): Promise<BillingStatus> {
  return request("/billing/status");
}

export async function createCheckout(
  plan: string = "growth",
): Promise<{ url: string }> {
  return request("/billing/create-checkout", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
}

export async function createPortalSession(): Promise<{ url: string }> {
  return request("/billing/portal", { method: "POST" });
}

// ======================================================================// BONUS CREDITS
// ======================================================================
export interface CreditsInfo {
  bonus_credits: number;
  rewards: { feedback: number; invite_accepted: number };
  earned: { feedback: boolean; invite_accepted: number };
}

export async function getCreditsInfo(): Promise<CreditsInfo> {
  return request("/credits");
}

export async function submitFeedback(
  message: string,
): Promise<{ success: boolean; granted: number; bonus_credits: number }> {
  return request("/credits/feedback", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export interface Account {
  id: number;
  email: string;
  name: string | null;
}

export async function signupComplete(
  name?: string,
  email?: string,
): Promise<{ account: Account; sdkKey?: string }> {
  return request("/auth/signup-complete", {
    method: "POST",
    body: JSON.stringify({ name, email }),
  });
}

export async function getMe(): Promise<{ account: Account | null }> {
  return request("/auth/me");
}

export interface AccountMembership {
  id: number;
  name: string;
  role: "owner" | "admin" | "viewer";
  status: "active" | "pending";
  joined_at: string | null;
  is_current: boolean;
}

export async function listMyAccounts(): Promise<{
  accounts: AccountMembership[];
  current_account_id: number | null;
}> {
  return request("/me/accounts");
}

// ── Recommendations ──────────────────────────────────────────────────────────

export interface ModelSwapRecommendation {
  feature_key: string;
  current_model: string;
  current_provider: string | null;
  current_avg_cost_per_event: number;
  total_cost: number;
  event_count: number;
  recommendations: Array<{
    model: string;
    provider: string;
    same_provider: boolean;
    estimated_savings_pct: number;
    estimated_monthly_savings: number;
  }>;
}

export interface UnderwaterCustomer {
  customer_id: string;
  customer_name: string;
  total_ai_cost: number;
  total_revenue: number;
  loss_amount: number;
  margin_pct: number;
  event_count: number;
}

export async function fetchModelSwapRecommendations(days = 90): Promise<{
  recommendations: ModelSwapRecommendation[];
  total_potential_savings: number;
  days: number;
}> {
  return request(`/recommendations/model-swap?days=${days}`);
}

export async function fetchUnderwaterCustomers(
  days = 90,
): Promise<{ customers: UnderwaterCustomer[]; days: number }> {
  return request(`/recommendations/underwater-customers?days=${days}`);
}

// ── Alert Rules ──────────────────────────────────────────────────────────────

export interface AlertRule {
  id: number;
  user_id: string;
  name: string;
  metric:
    | "daily_cost"
    | "margin_percent"
    | "customer_margin"
    | "customer_concentration";
  operator: "gt" | "lt";
  threshold: number;
  email: string | null;
  webhook_url: string | null;
  enabled: boolean;
  cooldown_minutes: number;
  last_triggered_at: string | null;
  created_at: string;
  trigger_type: string;
  segment_type: "all" | "cohort" | "specific";
  segment_value: string | null;
  evaluation: "aggregate" | "per_customer";
}

export interface AlertHistoryEntry {
  id: number;
  user_id: string;
  alert_rule_id: number;
  rule_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  trigger_type: string;
  current_value: number;
  threshold: number;
  fired_at: string;
  delivery_status: Record<string, string>;
}

export async function listAlertRules(): Promise<{
  rules: AlertRule[];
  gated?: boolean;
}> {
  return request("/alerts");
}

export async function createAlertRule(
  rule: Pick<AlertRule, "name" | "metric" | "operator" | "threshold"> & {
    email?: string;
    webhook_url?: string;
    cooldown_minutes?: number;
    trigger_type?: string;
    segment_type?: string;
    segment_value?: string;
    evaluation?: string;
  },
): Promise<AlertRule> {
  return request("/alerts", { method: "POST", body: JSON.stringify(rule) });
}

export async function updateAlertRule(
  id: number,
  updates: Partial<{
    name: string;
    enabled: boolean;
    threshold: number;
    email: string;
    webhook_url: string;
    cooldown_minutes: number;
  }>,
): Promise<AlertRule> {
  return request(`/alerts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteAlertRule(
  id: number,
): Promise<{ success: boolean }> {
  return request(`/alerts/${id}`, { method: "DELETE" });
}

export async function listAlertHistory(params?: {
  customer_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ history: AlertHistoryEntry[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.customer_id) qs.set("customer_id", params.customer_id);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const q = qs.toString();
  return request(`/alerts/history${q ? "?" + q : ""}`);
}

export async function getAlertHistoryCount(): Promise<{ count: number }> {
  return request("/alerts/history/count");
}

// ── Proxy Cache ───────────────────────────────────────────────────────────────

export interface CacheStats {
  total_cached_entries: number;
  tokens_saved: number;
  cost_saved: number;
  total_proxy_requests: number;
  cache_hits: number;
  miss_rate_percent: number;
}

export async function fetchCacheStats(): Promise<CacheStats> {
  return request("/proxy/cache/stats");
}

// ── Event Detail ──────────────────────────────────────────────────────────────

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

// =============================================================================
// CLOUD COST IMPORTS (AWS / GCP)
// =============================================================================

export interface CloudIntegrationStatus {
  provider: string;
  connected: boolean;
  last_sync_at: string | null;
  connected_at: string | null;
}

export async function getCloudCostStatus(): Promise<CloudIntegrationStatus[]> {
  return request("/cloud-costs/status");
}

export async function connectCloudProvider(
  provider: string,
  credentials: Record<string, string>,
): Promise<{ success: boolean }> {
  return request("/cloud-costs/connect", {
    method: "POST",
    body: JSON.stringify({ provider, credentials }),
  });
}

export async function syncCloudCosts(
  provider: string,
): Promise<{ message: string }> {
  return request(`/cloud-costs/sync/${provider}`, { method: "POST" });
}

export async function disconnectCloudProvider(
  provider: string,
): Promise<{ success: boolean }> {
  return request(`/cloud-costs/disconnect/${provider}`, { method: "DELETE" });
}

// ======================================================================// ADMIN
// ======================================================================
export async function runDataCleanup(): Promise<{
  cleaned: number;
  deleted_events: number;
}> {
  return request("/admin/cleanup", { method: "POST" });
}

export async function getAdminEmails(): Promise<{
  emails: Array<{
    id: string;
    to: string[];
    subject: string;
    status: string;
    created_at: string;
  }>;
}> {
  return request("/admin/emails");
}

export async function getAdminActivity(): Promise<{
  events: Array<{
    email: string;
    name: string;
    event_name: string;
    model: string;
    model_provider: string;
    customer_id: string;
    feature_key: string;
    source: string;
    cost_amount: string;
    revenue_amount: string;
    timestamp: string;
    properties: Record<string, unknown>;
  }>;
  signups: Array<{ email: string; name: string; created_at: string }>;
  recommendation_activity: Array<{
    type: string;
    title: string;
    severity: string;
    status: string;
    created_at: string;
    applied_at: string | null;
    dismissed_at: string | null;
    email: string;
  }>;
}> {
  return request("/admin/activity");
}

// ── Routing / Gateway ────────────────────────────────────────────────────────

export interface RoutingTarget {
  id: number;
  priority: number;
  provider: string;
  model: string;
  api_base_url: string | null;
  max_retries: number;
  timeout_ms: number;
  weight: number;
  enabled: boolean;
  created_at: string;
}

export interface RoutingRule {
  id: number;
  field: string;
  operator: string;
  value: string;
  target_id: number | null;
  priority: number;
  created_at: string;
}

export interface RoutingConfig {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  target_count?: number;
  targets?: RoutingTarget[];
  rules?: RoutingRule[];
}

export async function listRoutingConfigs(): Promise<{
  configs: RoutingConfig[];
}> {
  return request("/gateway/configs");
}

export async function getRoutingConfig(id: number): Promise<RoutingConfig> {
  return request(`/gateway/configs/${id}`);
}

export async function createRoutingConfig(data: {
  name: string;
  description?: string;
}): Promise<RoutingConfig> {
  return request("/gateway/configs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateRoutingConfig(
  id: number,
  data: Partial<Pick<RoutingConfig, "name" | "description" | "is_active">>,
): Promise<RoutingConfig> {
  return request(`/gateway/configs/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteRoutingConfig(
  id: number,
): Promise<{ deleted: boolean }> {
  return request(`/gateway/configs/${id}`, { method: "DELETE" });
}

export async function addRoutingTarget(
  configId: number,
  target: {
    provider: string;
    model: string;
    api_key?: string;
    api_base_url?: string;
    priority?: number;
    max_retries?: number;
    timeout_ms?: number;
    weight?: number;
  },
): Promise<RoutingTarget> {
  return request(`/gateway/configs/${configId}/targets`, {
    method: "POST",
    body: JSON.stringify(target),
  });
}

export async function updateRoutingTarget(
  configId: number,
  targetId: number,
  updates: Partial<{
    provider: string;
    model: string;
    api_key: string;
    api_base_url: string;
    priority: number;
    max_retries: number;
    timeout_ms: number;
    weight: number;
    enabled: boolean;
  }>,
): Promise<RoutingTarget> {
  return request(`/gateway/configs/${configId}/targets/${targetId}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteRoutingTarget(
  configId: number,
  targetId: number,
): Promise<{ deleted: boolean }> {
  return request(`/gateway/configs/${configId}/targets/${targetId}`, {
    method: "DELETE",
  });
}

export async function addRoutingRule(
  configId: number,
  rule: {
    field: string;
    operator: string;
    value: string;
    target_id?: number;
    priority?: number;
  },
): Promise<RoutingRule> {
  return request(`/gateway/configs/${configId}/rules`, {
    method: "POST",
    body: JSON.stringify(rule),
  });
}

export async function deleteRoutingRule(
  configId: number,
  ruleId: number,
): Promise<{ deleted: boolean }> {
  return request(`/gateway/configs/${configId}/rules/${ruleId}`, {
    method: "DELETE",
  });
}

export async function testRoutingConfig(
  configId: number,
  metadata: Record<string, string>,
): Promise<{
  config: string;
  metadata: Record<string, string>;
  matched_rule: RoutingRule | null;
  target_order: Array<{
    id: number;
    provider: string;
    model: string;
    priority: number;
  }>;
}> {
  return request(`/gateway/configs/${configId}/test`, {
    method: "POST",
    body: JSON.stringify({ metadata }),
  });
}

export async function listGatewayProviders(): Promise<{ providers: string[] }> {
  return request("/gateway/providers");
}

// ── Recommendations ──────────────────────────────────────────────────────────

export interface Recommendation {
  id: number;
  user_id: string;
  type: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  action_type: string;
  action_payload: Record<string, unknown>;
  context: Record<string, unknown>;
  status: "pending" | "applied" | "dismissed";
  created_at: string;
  applied_at: string | null;
  dismissed_at: string | null;
}

export async function listRecommendations(
  status = "pending",
): Promise<{ recommendations: Recommendation[] }> {
  return request(`/recommendations?status=${status}`);
}

export async function getRecommendationCount(): Promise<{ count: number }> {
  return request("/recommendations/count");
}

export async function computeRecommendations(): Promise<{
  computed: boolean;
  pending_count: number;
}> {
  return request("/recommendations/compute", { method: "POST" });
}

export async function applyRecommendation(
  id: number,
): Promise<{ applied: boolean; action_result: Record<string, unknown> }> {
  return request(`/recommendations/${id}/apply`, { method: "POST" });
}

export async function dismissRecommendation(
  id: number,
): Promise<{ dismissed: boolean }> {
  return request(`/recommendations/${id}/dismiss`, { method: "POST" });
}

// ── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatAction {
  type: string;
  [key: string]: unknown;
}

export async function sendChatMessage(messages: ChatMessage[]): Promise<{
  message: string;
  action: ChatAction | null;
  usage: { prompt_tokens: number; completion_tokens: number };
}> {
  return request("/chat", {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
}

export async function executeChatAction(
  action: ChatAction,
): Promise<{ success: boolean; message: string }> {
  return request("/chat/execute", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

// ── Custom Cohorts ───────────────────────────────────────────────────────────

export interface CohortRule {
  field: string;
  operator: string;
  value: number | string;
}

export interface CustomCohort {
  id: number;
  name: string;
  description: string | null;
  color: string;
  cohort_type: "static" | "dynamic";
  rules: CohortRule[] | null;
  member_count: number;
  created_at: string;
  members?: Array<{
    customer_id: string;
    customer_name: string | null;
    added_at?: string;
  }>;
}

export async function listCustomCohorts(): Promise<{
  cohorts: CustomCohort[];
}> {
  return request("/cohorts/custom");
}

export async function getCustomCohort(id: number): Promise<CustomCohort> {
  return request(`/cohorts/custom/${id}`);
}

export async function createCustomCohort(data: {
  name: string;
  description?: string;
  color?: string;
  customer_ids?: string[];
  cohort_type?: "static" | "dynamic";
  rules?: CohortRule[];
}): Promise<CustomCohort> {
  return request("/cohorts/custom", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function addCohortMembers(
  cohortId: number,
  customerIds: string[],
): Promise<{ added: number }> {
  return request(`/cohorts/custom/${cohortId}/members`, {
    method: "POST",
    body: JSON.stringify({ customer_ids: customerIds }),
  });
}

export async function removeCohortMember(
  cohortId: number,
  customerId: string,
): Promise<{ removed: boolean }> {
  return request(`/cohorts/custom/${cohortId}/members/${customerId}`, {
    method: "DELETE",
  });
}

export async function deleteCustomCohort(
  id: number,
): Promise<{ deleted: boolean }> {
  return request(`/cohorts/custom/${id}`, { method: "DELETE" });
}

// ======================================================================
// FEATURE DEFINITIONS — user-declared catalog of what to measure
// ======================================================================

export type FeatureDefinitionKind = "cost" | "value" | "outcome";

export interface FeatureDefinition {
  id: number;
  name: string;
  feature_key: string;
  kind: FeatureDefinitionKind;
  description: string | null;
  code_location: string | null;
  created_at: string;
  updated_at: string;
  event_count: number;
  total_cost: number;
  last_seen: string | null;
  revenue_per_unit: number | null;
  unit_label: string | null;
}

export interface FeatureDefinitionInput {
  name: string;
  feature_key?: string;
  kind?: FeatureDefinitionKind;
  description?: string | null;
  code_location?: string | null;
}

export async function listFeatureDefinitions(): Promise<{
  definitions: FeatureDefinition[];
}> {
  return request("/feature-definitions");
}

export async function createFeatureDefinition(
  input: FeatureDefinitionInput,
): Promise<{ definition: FeatureDefinition }> {
  return request("/feature-definitions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateFeatureDefinition(
  id: number,
  input: Partial<Omit<FeatureDefinitionInput, "feature_key">>,
): Promise<{ definition: FeatureDefinition }> {
  return request(`/feature-definitions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteFeatureDefinition(id: number): Promise<void> {
  await request(`/feature-definitions/${id}`, { method: "DELETE" });
}

// ======================================================================// DATA QUALITY
// ======================================================================
export interface DataQualityAdvisory {
  type: string;
  severity: "warning" | "info";
  title: string;
  description: string;
  affected_ids: string[];
}

export interface DataQualityResult {
  advisories: DataQualityAdvisory[];
  summary: string | null;
}

export async function getDataQuality(
  includeLlm = false,
): Promise<DataQualityResult> {
  return request(
    `/insights/data-quality${includeLlm ? "?include_llm=true" : ""}`,
  );
}
