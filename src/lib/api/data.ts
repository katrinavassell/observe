import { request } from "./base";

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
