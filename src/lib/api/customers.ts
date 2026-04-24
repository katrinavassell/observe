import { request } from "./base";
import type { ObserveEvent } from "./events";

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

export interface CustomerTimeseriesPoint {
  month: string;
  event_count: number;
  total_cost: number;
  total_revenue: number;
  total_usage: number;
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

export async function getCustomerTimeseries(
  id: string,
): Promise<{ timeseries: CustomerTimeseriesPoint[] }> {
  return request(`/customers/${encodeURIComponent(id)}/timeseries`);
}

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

export async function setCustomerInternal(
  customerId: string,
  isInternal: boolean,
): Promise<{ customer_id: string; is_internal: boolean }> {
  return request(`/customers/${customerId}/internal`, {
    method: "PATCH",
    body: JSON.stringify({ is_internal: isInternal }),
  });
}
