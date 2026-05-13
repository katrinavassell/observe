import { request } from "./base";

// ── BI Overview ─────────────────────────────────────────────────────────────

export interface OverviewSummary {
  total_cost: number;
  total_revenue: number;
  margin_pct: number | null;
  total_usage: number;
  event_count: number;
  customer_count: number;
}

export interface OverviewTrend {
  month: string;
  cost: number;
  revenue: number;
  usage: number;
  margin_pct: number | null;
  event_count: number;
  customer_count: number;
}

export interface OverviewFeatureROI {
  feature_key: string;
  cost: number;
  revenue: number;
  usage: number;
  margin_pct: number | null;
  cost_per_unit: number;
  revenue_per_unit: number;
  event_count: number;
  customer_count: number;
}

export interface OverviewCustomerPnL {
  customer_id: string;
  customer_name: string;
  cost: number;
  revenue: number;
  margin_pct: number | null;
  event_count: number;
  usage: number;
}

export interface OverviewProvider {
  provider: string;
  model: string;
  cost: number;
  event_count: number;
  avg_cost_per_call: number;
}

export interface OverviewRecommendation {
  type: string;
  title: string;
  severity: string;
}

export interface AnalyticsOverview {
  summary: OverviewSummary;
  margin_trend: OverviewTrend[];
  feature_roi: OverviewFeatureROI[];
  customer_pnl: OverviewCustomerPnL[];
  provider_breakdown: OverviewProvider[];
  active_alert_count: number;
  pending_recommendation_count: number;
  top_recommendations: OverviewRecommendation[];
}

export type SpendType = "all" | "customer_facing" | "internal";

export async function getAnalyticsOverview(
  spendType?: SpendType,
): Promise<AnalyticsOverview> {
  const params =
    spendType && spendType !== "all" ? `?spend_type=${spendType}` : "";
  return request(`/analytics/overview${params}`);
}

// ── Cost-to-Serve ───────────────────────────────────────────────────────────

export interface CostToServeCustomer {
  customer_id: string;
  customer_name: string;
  contract_value: number;
  contract_type: string | null;
  contract_start: string | null;
  contract_end: string | null;
  total_cost: number;
  total_revenue: number;
  cost_to_serve_pct: number | null;
  event_count: number;
}

export async function getCostToServe(): Promise<{
  customers: CostToServeCustomer[];
}> {
  return request("/analytics/cost-to-serve");
}

export async function uploadContracts(
  contracts: Array<{
    customer_id: string;
    contract_value: number;
    contract_type?: string;
    contract_start?: string;
    contract_end?: string;
  }>,
): Promise<{ updated: number; total: number }> {
  return request("/customers/contracts/bulk", {
    method: "POST",
    body: JSON.stringify(contracts),
  });
}

export interface FeatureStickinessWeek {
  week: string;
  active_customers: number;
  retention_pct: number;
}

export interface FeatureStickiness {
  feature_key: string;
  total_customers: number;
  weekly_retention: FeatureStickinessWeek[];
}

export async function getFeatureStickiness(): Promise<{
  features: FeatureStickiness[];
}> {
  return request("/analytics/feature-stickiness");
}

// ── Retention ───────────────────────────────────────────────────────────────

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
  cost_change_pct: number | null;
  revenue_change_pct: number | null;
  event_count_change_pct: number | null;
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

export async function syncStripeInvoices(): Promise<{
  success: boolean;
  invoices: number;
  line_items: number;
}> {
  return request("/stripe/sync-invoices", { method: "POST" });
}

export interface DailySummaryPoint {
  day: string;
  cost: number;
  revenue: number;
  event_count: number;
}

export async function getDailySummary(
  days?: number,
  spendType?: SpendType,
): Promise<{ data: DailySummaryPoint[] }> {
  const p = new URLSearchParams();
  if (days) p.set("days", String(days));
  if (spendType && spendType !== "all") p.set("spend_type", spendType);
  const qs = p.toString();
  return request(`/analytics/daily-summary${qs ? `?${qs}` : ""}`);
}

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

export interface CohortRule {
  field: string;
  operator: string;
  value: number | string;
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
