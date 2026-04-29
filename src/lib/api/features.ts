import { request } from "./base";
import type { ObserveEvent } from "./events";

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

export async function getFeatures(): Promise<FeatureSummary[]> {
  return request("/features");
}

export async function getFeatureDetail(key: string): Promise<FeatureDetail> {
  return request(`/features/${encodeURIComponent(key)}`);
}

export async function getModels(): Promise<ModelSummary[]> {
  return request("/models");
}

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
