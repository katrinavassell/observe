import { request } from "./base";

export interface Organization {
  id: string;
  name: string;
  owner_visitor_id: string;
  created_at: string;
}

export interface OrgMember {
  id: string;
  visitor_id: string | null;
  invited_email: string | null;
  status: "pending" | "active";
  joined_at: string | null;
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

export interface ReferralCodeResponse {
  code: string;
}

export interface ReferralPromo {
  code: string | null;
  used: boolean;
  created_at: string;
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

export interface ReferralStats {
  code: string | null;
  total_referrals: number;
  converted_referrals: number;
  pending_referrals: number;
  promos: ReferralPromo[];
}

export async function getReferralStats(): Promise<ReferralStats> {
  return request("/referral/stats");
}

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

export async function testAlertRule(
  id: number,
): Promise<{ delivered: Record<string, string> }> {
  return request(`/alerts/${id}/test`, { method: "POST" });
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
