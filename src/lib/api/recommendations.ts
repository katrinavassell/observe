import { request } from "./base";

export type RecommendationSeverity = "critical" | "warning" | "info";
export type RecommendationStatus = "pending" | "applied" | "dismissed";

/**
 * Shape of a recommendation row returned by GET /api/recommendations.
 *
 * Matches the schema written by `INSERT INTO recommendations (...)` in
 * `server/routes/recommendations.ts`. Fields like `action_payload` and
 * `context` carry rule-specific JSON — kept loosely typed because each
 * rule (underwater, churn_risk, revenue_leakage, feature_underpricing, etc.)
 * populates them differently.
 */
export interface Recommendation {
  id: number;
  user_id: string;
  account_id: number;
  type: string;
  title: string;
  description: string;
  severity: RecommendationSeverity;
  status: RecommendationStatus;
  action_type: string | null;
  action_payload: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  customer_id?: string | null;
  customer_name?: string | null;
  feature_key?: string | null;
  created_at: string;
  applied_at: string | null;
  dismissed_at: string | null;
}

interface ListResponse {
  recommendations?: Recommendation[];
  data?: Recommendation[];
}

/**
 * Fetch recommendations. Defaults to pending.
 */
export async function listRecommendations(
  status: RecommendationStatus = "pending",
): Promise<Recommendation[]> {
  const res = await request<ListResponse | Recommendation[]>(
    `/recommendations?status=${encodeURIComponent(status)}`,
  );
  // Backend may return either { recommendations: [...] } or a bare array
  if (Array.isArray(res)) return res;
  return res.recommendations ?? res.data ?? [];
}

export async function countPendingRecommendations(): Promise<number> {
  const res = await request<{ count: number }>("/recommendations/count");
  return res.count ?? 0;
}

export async function computeRecommendations(): Promise<{ count: number }> {
  return request("/recommendations/compute", { method: "POST" });
}

export async function applyRecommendation(id: number): Promise<void> {
  await request(`/recommendations/${id}/apply`, { method: "POST" });
}

export async function dismissRecommendation(id: number): Promise<void> {
  await request(`/recommendations/${id}/dismiss`, { method: "POST" });
}

/**
 * Helper: extract a stable customer key from a recommendation so a row in
 * the customer table can be matched to its recommendation. Falls back
 * across the schema variants the rules emit.
 */
export function recommendationCustomerKey(rec: Recommendation): string | null {
  if (rec.customer_id) return rec.customer_id;
  const payload = rec.action_payload ?? {};
  const ctx = rec.context ?? {};
  return (
    (payload.customer_id as string | undefined) ??
    (ctx.customer_id as string | undefined) ??
    (payload.customerId as string | undefined) ??
    null
  );
}

/**
 * Helper: extract a feature key from a recommendation similarly.
 */
export function recommendationFeatureKey(rec: Recommendation): string | null {
  if (rec.feature_key) return rec.feature_key;
  const payload = rec.action_payload ?? {};
  const ctx = rec.context ?? {};
  return (
    (payload.feature_key as string | undefined) ??
    (ctx.feature_key as string | undefined) ??
    null
  );
}
