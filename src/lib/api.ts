const API_BASE = '/api'

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  })

  if (!response.ok) {
    let errorMessage = `API Error: ${response.status}`
    try {
      const errorData = await response.json()
      if (errorData.error) {
        errorMessage = errorData.error
      }
    } catch {
      // Ignore parse errors
    }
    throw new Error(errorMessage)
  }

  return response.json()
}

export interface SessionResponse {
  visitorId: string
  account: Account | null
}

export async function initSession(): Promise<SessionResponse> {
  return request('/session/init')
}

export interface DataStatus {
  data_mode: 'none' | 'sample' | 'user'
  has_data: boolean
  customer_count: number
  has_revenue: boolean
  has_costs: boolean
  has_usage: boolean
  revenue_customer_count: number
  costs_record_count: number
  usage_record_count: number
  last_sync_at: string | null
}

export async function getDataStatus(): Promise<DataStatus> {
  return request('/data/status')
}

export async function loadSampleData(): Promise<{ success: boolean; message: string }> {
  return request('/data/sample', { method: 'POST' })
}

export async function clearData(): Promise<{ success: boolean }> {
  return request('/data/clear', { method: 'DELETE' })
}

export async function clearRevenueData(): Promise<{ success: boolean }> {
  return request('/data/clear/revenue', { method: 'DELETE' })
}

export async function clearCostData(): Promise<{ success: boolean }> {
  return request('/data/clear/costs', { method: 'DELETE' })
}

export async function clearUsageData(): Promise<{ success: boolean }> {
  return request('/data/clear/usage', { method: 'DELETE' })
}

export interface Customer {
  id: string
  customer_id: string
  name: string
  email: string | null
  segment: string | null
  created_at: string
}

export async function getCustomers(): Promise<Customer[]> {
  const res = await request<{ data: Customer[] }>('/customers')
  return res.data
}

export interface Subscription {
  id: string
  subscription_id: string
  customer_id: string
  plan_id: string
  is_active: boolean
  mrr_override: number | null
  customer_name?: string
  customer_email?: string
  plan_name?: string
  price_amount?: number
}

export async function getSubscriptions(): Promise<Subscription[]> {
  const res = await request<{ data: Subscription[]; total: number; limit: number; offset: number }>('/subscriptions')
  return res.data
}

export interface Plan {
  id: string
  plan_id: string
  name: string
  price_amount: number
  interval_months: number
}

export async function getPlans(): Promise<Plan[]> {
  return request('/plans')
}

export interface MetricsSummary {
  total_customers: number
  active_subscriptions: number
  mrr: number
  arr: number
  arpc: number
}

export async function getMetricsSummary(): Promise<MetricsSummary> {
  return request('/metrics/summary')
}

export interface SourceBreakdown {
  sources: Array<{ source: string; event_count: number; total_cost: number; total_revenue: number }>
  total_events: number
}

export async function getSourceBreakdown(): Promise<SourceBreakdown> {
  return request('/metrics/source-breakdown')
}

// Upload endpoints
export interface CostRecord {
  customer_id?: string
  month: string
  cost: number
  provider?: string
}

export async function uploadCostData(records: CostRecord[]): Promise<{ success: boolean; count: number }> {
  return request('/data/upload/costs', {
    method: 'POST',
    body: JSON.stringify({ records }),
  })
}

// Helicone import
export interface HeliconeEvent {
  request_id?: string
  created_at?: string
  model?: string
  provider?: string
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost?: number
  user_id?: string
  properties?: Record<string, string>
}

export async function importHeliconeData(events: HeliconeEvent[]): Promise<{ success: boolean; imported: number; total: number }> {
  return request('/import/helicone', {
    method: 'POST',
    body: JSON.stringify({ events }),
  })
}

export interface UsageRecord {
  customer_id: string
  month: string
  metric?: string
  metric_key?: string
  value?: number
  metric_value?: number
  limit?: number
  metric_limit?: number
}

export async function uploadUsageData(records: UsageRecord[]): Promise<{ success: boolean; count: number }> {
  return request('/data/upload/usage', {
    method: 'POST',
    body: JSON.stringify({ records }),
  })
}

export interface RevenueUploadData {
  customers: Array<{
    customer_id: string
    name: string
    email?: string
    segment?: string
  }>
  plans: Array<{
    plan_id: string
    name: string
    price_amount: number
    interval_months?: number
  }>
  subscriptions: Array<{
    subscription_id: string
    customer_id: string
    plan_id: string
    is_active?: boolean
    mrr_override?: number
    current_period_start?: string
    current_period_end?: string
  }>
}

export async function uploadRevenueData(data: RevenueUploadData): Promise<{ success: boolean; counts: { customers: number; plans: number; subscriptions: number } }> {
  return request('/data/upload/revenue', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export interface AnalyzerData {
  plans: Array<{
    plan_id: string
    name: string
    price_amount: number
    interval_months: number
    billing_model: 'recurring' | 'usage_based' | 'hybrid'
  }>
  customers: Array<{
    customer_id: string
    name: string
    email?: string
    segment?: string
    created_at: string
  }>
  subscriptions: Array<{
    subscription_id: string
    customer_id: string
    plan_id: string
    is_active: boolean
    mrr_override?: number
    previous_mrr?: number
    current_period_start?: string
    current_period_end?: string
    cancelled_at?: string
  }>
  usage: Array<{
    customer_id: string
    metric_key: string
    metric_value: number
    metric_limit?: number
    period_start: string
    period_end: string
  }>
  costs: Array<{
    customer_id?: string
    cost_type: string
    amount: number
    period_start: string
    period_end: string
  }>
}

export async function fetchAnalyzerData(): Promise<AnalyzerData | null> {
  return request('/data/analyzer')
}

// =============================================================================
// FEATURE ECONOMICS
// =============================================================================

export interface ObserveEvent {
  id: number
  user_id: string
  customer_id: string | null
  customer_name?: string
  feature_key: string | null
  event_name: string | null
  timestamp: string
  cost_amount: number | null
  cost_unit: string | null
  revenue_amount: number | null
  usage_units: number | null
  model: string | null
  model_provider: string | null
  source: string | null
  granularity: string | null
  is_inferred: boolean
  properties: Record<string, unknown> | null
  created_at: string
}

export interface EventsResponse {
  events: ObserveEvent[]
  total: number
  limit: number
  offset: number
}

export interface FeatureSummary {
  feature_key: string
  event_count: number
  customer_count: number
  total_cost: number
  total_revenue: number
  total_usage: number
  avg_cost_per_event: number
  avg_revenue_per_event: number
  margin_pct: number | null
  last_seen: string
}

export interface FeatureDetail extends FeatureSummary {
  recent_events: ObserveEvent[]
  by_customer: Array<{
    customer_id: string
    customer_name: string
    event_count: number
    total_cost: number
    total_revenue: number
  }>
  by_model: Array<{
    model: string
    model_provider: string
    event_count: number
    total_cost: number
    total_revenue: number
  }>
  timeseries: Array<{
    month: string
    event_count: number
    total_cost: number
    total_revenue: number
    total_usage: number
  }>
}

export interface ModelSummary {
  model: string
  model_provider: string | null
  event_count: number
  customer_count: number
  feature_count: number
  total_cost: number
  total_revenue: number
  total_usage: number
  avg_cost_per_event: number
  margin_pct: number | null
  last_seen: string
}

export interface CustomerDetail {
  customer: {
    customer_id: string
    name: string
    email: string | null
    segment: string | null
    created_at: string
  }
  subscriptions: Array<{
    subscription_id: string
    plan_id: string
    plan_name: string
    price_amount: number
    is_active: boolean
    mrr_override: number | null
  }>
  total_cost: number
  total_revenue: number
  margin_pct: number | null
  recent_events: ObserveEvent[]
  by_feature: Array<{
    feature_key: string
    event_count: number
    total_cost: number
    total_revenue: number
    total_usage: number
  }>
}

export interface EventsQuery {
  limit?: number
  offset?: number
  feature_key?: string
  customer_id?: string
  model?: string
  source?: string
  date_from?: string
  date_to?: string
}

export async function getEvents(query: EventsQuery = {}): Promise<EventsResponse> {
  const params = new URLSearchParams()
  if (query.limit) params.set('limit', String(query.limit))
  if (query.offset) params.set('offset', String(query.offset))
  if (query.feature_key) params.set('feature_key', query.feature_key)
  if (query.customer_id) params.set('customer_id', query.customer_id)
  if (query.model) params.set('model', query.model)
  if (query.source) params.set('source', query.source)
  if (query.date_from) params.set('date_from', query.date_from)
  if (query.date_to) params.set('date_to', query.date_to)
  const qs = params.toString()
  return request(`/events${qs ? '?' + qs : ''}`)
}

export interface EventsByFeature {
  feature_key: string
  event_count: number
  total_cost: number
  total_revenue: number
  total_usage: number
  margin_pct: number | null
  last_seen: string
}

export async function getEventsByFeature(): Promise<EventsByFeature[]> {
  return request('/events/by-feature')
}

export interface EventsByCustomer {
  customer_id: string
  customer_name: string
  event_count: number
  total_cost: number
  total_revenue: number
  margin_pct: number | null
  last_seen: string
}

export async function getEventsByCustomer(): Promise<EventsByCustomer[]> {
  return request('/events/by-customer')
}

export interface EventsByModel {
  model: string
  model_provider: string | null
  event_count: number
  total_cost: number
  total_revenue: number
  total_usage: number
  margin_pct: number | null
  last_seen: string
}

export async function getEventsByModel(): Promise<EventsByModel[]> {
  return request('/events/by-model')
}

export async function getFeatures(): Promise<FeatureSummary[]> {
  return request('/features')
}

export async function getFeatureDetail(key: string): Promise<FeatureDetail> {
  return request(`/features/${encodeURIComponent(key)}`)
}

export async function getModels(): Promise<ModelSummary[]> {
  return request('/models')
}

export async function getCustomerDetail(id: string): Promise<CustomerDetail> {
  return request(`/customers/${encodeURIComponent(id)}`)
}

// =============================================================================
// SDK EVENT INGESTION
// =============================================================================

export interface IngestEvent {
  eventName: string
  customerReferenceId: string
  featureKey: string
  timestamp?: string
  costAmount?: number
  costUnit?: string
  revenueAmount?: number
  usageUnits?: number
  model?: string
  modelProvider?: string
  properties?: Record<string, unknown>
  idempotencyKey?: string
}

export interface IngestResponse {
  accepted: number
  rejected: number
  errors: Array<{ index: number; error: string }>
}

export async function ingestEvents(events: IngestEvent[], apiKey?: string): Promise<IngestResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  return request('/events/ingest', {
    method: 'POST',
    headers,
    body: JSON.stringify({ events }),
  })
}

// =============================================================================
// SDK API KEY MANAGEMENT
// =============================================================================

export interface SdkKey {
  id: number
  key_prefix: string
  full_key: string | null
  name: string | null
  created_at: string
  last_used_at: string | null
}

export interface CreateSdkKeyResponse {
  key: string
  prefix: string
  name: string | null
}

export async function createSdkKey(name?: string): Promise<CreateSdkKeyResponse> {
  return request('/sdk-keys', {
    method: 'POST',
    body: JSON.stringify({ name: name || null }),
  })
}

export async function listSdkKeys(): Promise<SdkKey[]> {
  return request('/sdk-keys')
}

export async function revokeSdkKey(id: number): Promise<{ success: boolean }> {
  return request(`/sdk-keys/${id}`, { method: 'DELETE' })
}

export async function resetSdkKey(id: number): Promise<CreateSdkKeyResponse & { id: number }> {
  return request(`/sdk-keys/${id}/reset`, { method: 'POST' })
}

// =============================================================================
// =============================================================================
// TEAM / ORGANIZATION
// =============================================================================

export interface OrgMember {
  id: string
  visitor_id: string | null
  invited_email: string | null
  role: 'admin' | 'viewer'
  status: 'pending' | 'active'
  joined_at: string | null
  created_at: string
}

export interface Organization {
  id: string
  name: string
  owner_visitor_id: string
  created_at: string
}

export interface TeamInfo {
  org: Organization
  members: OrgMember[]
  my_role: 'admin' | 'viewer'
}

export async function getTeamInfo(): Promise<TeamInfo> {
  return request('/team')
}

export async function renameTeam(name: string): Promise<{ success: boolean }> {
  return request('/team/name', {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export interface InviteResult {
  success: boolean
  invite_token: string
}

export async function createInvite(email: string, role: 'admin' | 'viewer'): Promise<InviteResult> {
  return request('/team/invite', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })
}

export interface InviteInfo {
  org_name: string
  invited_email: string | null
  role: 'admin' | 'viewer'
}

export async function getInviteInfo(token: string): Promise<InviteInfo> {
  return request(`/team/invite/${token}`)
}

export async function acceptInvite(token: string): Promise<{ success: boolean; org_id: string; role: string }> {
  return request(`/team/join/${token}`, { method: 'POST' })
}

export async function changeMemberRole(memberId: string, role: 'admin' | 'viewer'): Promise<{ success: boolean }> {
  return request(`/team/members/${memberId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

export async function removeMember(memberId: string): Promise<{ success: boolean }> {
  return request(`/team/members/${memberId}`, { method: 'DELETE' })
}

export async function getMyRole(): Promise<{ role: 'admin' | 'viewer'; org_id: string }> {
  return request('/team/my-role')
}


// REFERRAL SYSTEM
// =============================================================================

export interface ReferralCodeResponse {
  code: string
}

export interface ReferralPromo {
  code: string | null
  used: boolean
  created_at: string
}

export interface ReferralStats {
  code: string | null
  total_referrals: number
  converted_referrals: number
  pending_referrals: number
  promos: ReferralPromo[]
}

export async function getReferralCode(): Promise<ReferralCodeResponse> {
  return request('/referral/code')
}

export async function recordReferral(code: string): Promise<{ success: boolean; already_recorded?: boolean }> {
  return request('/referral/record', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export async function getReferralStats(): Promise<ReferralStats> {
  return request('/referral/stats')
}

// =============================================================================
// ANALYTICS — CUSTOMER P&L & MARGIN ALERTS
// =============================================================================

export interface CustomerPnl {
  customer_id: string
  customer_name: string
  total_revenue: number
  total_cost: number
  margin_pct: number | null
  event_count: number
  unprofitable: boolean
  top_cost_feature: string | null
}

export interface MarginAlert {
  type: string
  severity: 'critical' | 'warning'
  title: string
  description: string
  entity_id: string | null
  metric_value: number | null
}

export async function getCustomerPnl(): Promise<{ customers: CustomerPnl[] }> {
  return request('/analytics/customer-pnl')
}

export async function getMarginAlerts(): Promise<{ alerts: MarginAlert[] }> {
  return request('/analytics/margin-alerts')
}

export interface AiInsight {
  id: string
  insight_type: string
  severity: string
  title: string
  description: string
  feature_key: string | null
  customer_id: string | null
  metric_value: number | null
  tokens_used: number | null
  cost_usd: number | null
  created_at: string
}

export async function listInsights(): Promise<AiInsight[]> {
  return request('/insights')
}

export async function generateInsights(): Promise<{ insights: AiInsight[]; source: string; tokens_used: number; cost_usd: number }> {
  return request('/insights/generate', { method: 'POST' })
}

export async function clearInsights(): Promise<{ success: boolean }> {
  return request('/insights', { method: 'DELETE' })
}

// =============================================================================
// USAGE LIMITS
// =============================================================================

export interface UsageLimits {
  configured: boolean
  ai_insights?: { allowed: boolean; usage?: { used: number; limit: number; remaining: number } }
}

export async function getUsageLimits(): Promise<UsageLimits> {
  try {
    return await request('/usage/limits')
  } catch {
    return { configured: false }
  }
}

export interface TansoPlan {
  id: string
  key: string
  name: string
  description?: string
  priceAmount: string | number
  intervalMonths: number
  status: string
  features?: any[]
}

export interface TansoEntitlement {
  featureKey: string
  featureName?: string
  allowed: boolean
  usageLimit?: number
  currentUsage?: number
  remainingQuota?: number
}

export interface TansoEntitlementCheck {
  allowed: boolean
  usage?: number
  limit?: number
  remaining?: number
}

export async function tansoGetStatus(): Promise<{
  plans: TansoPlan[]
  entitlements: TansoEntitlement[]
  customer: any
  configured: boolean
}> {
  return request('/billing/status')
}

export async function tansoGetPlans(): Promise<{ plans: TansoPlan[]; configured: boolean }> {
  return request('/billing/status')
}

export async function tansoGetFeatures(): Promise<{ features: any[]; configured: boolean }> {
  return request('/billing/status')
}

export async function tansoGetEntitlements(): Promise<{ entitlements: TansoEntitlement[]; configured: boolean }> {
  return request('/billing/status')
}

export async function tansoGetSubscription(): Promise<{ customer: any; configured: boolean }> {
  return request('/billing/status')
}

export async function tansoSubscribe(planId: string): Promise<{ success: boolean; subscription: any }> {
  return request('/billing/subscribe', { method: 'POST', body: JSON.stringify({ planId }) })
}

export async function tansoCheckFeature(featureKey: string): Promise<TansoEntitlementCheck> {
  return request(`/billing/check/${featureKey}`)
}

// Invoice types and API
export interface TansoInvoice {
  id: string
  status: string
  amount: number
  currency: string
  dueDate?: string
  createdAt?: string
  paidAt?: string
}

export async function tansoGetInvoices(): Promise<{ invoices: TansoInvoice[]; configured: boolean }> {
  return request('/tanso/invoices')
}


export interface Account {
  id: number
  email: string
  name: string | null
}

export async function signup(email: string, password: string, name?: string): Promise<{ account: Account }> {
  return request('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  })
}

export async function login(email: string, password: string): Promise<{ account: Account }> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function logout(): Promise<{ success: boolean }> {
  return request('/auth/logout', { method: 'POST' })
}

export async function getMe(): Promise<{ account: Account | null }> {
  return request('/auth/me')
}

// ── Recommendations ──────────────────────────────────────────────────────────

export interface ModelSwapRecommendation {
  feature_key: string
  current_model: string
  current_provider: string | null
  current_avg_cost_per_event: number
  total_cost: number
  event_count: number
  recommendations: Array<{
    model: string
    provider: string
    same_provider: boolean
    estimated_savings_pct: number
    estimated_monthly_savings: number
  }>
}

export interface UnderwaterCustomer {
  customer_id: string
  customer_name: string
  total_ai_cost: number
  total_revenue: number
  loss_amount: number
  margin_pct: number
  event_count: number
}

export async function fetchModelSwapRecommendations(days = 90): Promise<{ recommendations: ModelSwapRecommendation[]; total_potential_savings: number; days: number }> {
  return request(`/recommendations/model-swap?days=${days}`)
}

export async function fetchUnderwaterCustomers(days = 90): Promise<{ customers: UnderwaterCustomer[]; days: number }> {
  return request(`/recommendations/underwater-customers?days=${days}`)
}

// ── Alert Rules ──────────────────────────────────────────────────────────────

export interface AlertRule {
  id: number
  user_id: string
  name: string
  metric: 'daily_cost' | 'margin_percent' | 'cost_per_event'
  operator: 'gt' | 'lt' | 'gte' | 'lte'
  threshold: number
  email: string
  enabled: boolean
  cooldown_minutes: number
  last_triggered_at: string | null
  created_at: string
}

export async function listAlertRules(): Promise<{ rules: AlertRule[]; gated?: boolean }> {
  return request('/alerts')
}

export async function createAlertRule(rule: Pick<AlertRule, 'name' | 'metric' | 'operator' | 'threshold' | 'email'> & { cooldown_minutes?: number }): Promise<AlertRule> {
  return request('/alerts', { method: 'POST', body: JSON.stringify(rule) })
}

export async function updateAlertRule(id: number, updates: Partial<Pick<AlertRule, 'name' | 'enabled' | 'threshold' | 'email' | 'cooldown_minutes'>>): Promise<AlertRule> {
  return request(`/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(updates) })
}

export async function deleteAlertRule(id: number): Promise<{ success: boolean }> {
  return request(`/alerts/${id}`, { method: 'DELETE' })
}

// ── Proxy Cache ───────────────────────────────────────────────────────────────

export interface CacheStats {
  total_cached_entries: number
  tokens_saved: number
  cost_saved: number
  total_proxy_requests: number
  cache_hits: number
  miss_rate_percent: number
}

export async function fetchCacheStats(): Promise<CacheStats> {
  return request('/proxy/cache/stats')
}

// ── Event Detail ──────────────────────────────────────────────────────────────

export interface EventDetail {
  id: number
  user_id: string
  customer_id: string
  customer_name?: string
  feature_key: string
  event_name: string
  timestamp: string
  cost_amount: number
  revenue_amount: number
  usage_units: number
  model?: string
  model_provider?: string
  source: string
  properties?: Record<string, string>
  request_body?: Record<string, unknown> | null
  response_body?: Record<string, unknown> | null
}

export async function getEventDetail(id: number): Promise<EventDetail> {
  return request(`/events/${id}`)
}
