const API_BASE = '/api'

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

// Revenue Analytics
export interface TrendData {
  current: number
  previous: number
  change_amount: number
  change_percent: number
  direction: 'up' | 'down' | 'neutral'
}

export interface RevenueMetrics {
  total_arr: number
  total_mrr: number
  account_count: number
  subscription_count: number
  breakdown: {
    by_plan: Record<string, number>
    by_segment: Record<string, number>
  }
  arr_trend?: TrendData
  mrr_trend?: TrendData
  account_trend?: TrendData
}

export interface Discrepancy {
  type: string
  severity: 'high' | 'medium' | 'low'
  entity_type: string
  entity_id: number | null
  source_id: string | null
  description: string
  details: Record<string, unknown>
}

export interface RevenueAnalytics {
  metrics: RevenueMetrics
  confidence_score: number
  discrepancies: Discrepancy[]
}

export async function getRevenueAnalytics(): Promise<RevenueAnalytics> {
  return request('/analytics/revenue')
}

// Accounts
export interface Account {
  id: number
  name: string
  domain: string | null
  source_system: string
  segment: string | null
  industry: string | null
  employee_count: number | null
  plan_tier: string | null
  arr: number | null
  mrr: number | null
}

export interface AccountsResponse {
  accounts: Account[]
  total: number
  has_more: boolean
}

export async function getAccounts(params?: {
  source_system?: string
  segment?: string
  search?: string
  limit?: number
  offset?: number
}): Promise<AccountsResponse> {
  const searchParams = new URLSearchParams()
  if (params?.source_system) searchParams.set('source_system', params.source_system)
  if (params?.segment) searchParams.set('segment', params.segment)
  if (params?.search) searchParams.set('search', params.search)
  if (params?.limit) searchParams.set('limit', params.limit.toString())
  if (params?.offset) searchParams.set('offset', params.offset.toString())

  const query = searchParams.toString()
  return request(`/accounts${query ? `?${query}` : ''}`)
}

export interface AccountDetail extends Account {
  website: string | null
  email_domain: string | null
  created_at: string | null
  subscriptions: Array<{
    id: number
    plan_tier: string
    status: string
    amount: number
    billing_interval: string | null
    start_date: string | null
    discount_percent: number | null
  }>
  invoices: Array<{
    id: number
    amount: number | null
    net_amount: number | null
    status: string
    date: string | null
  }>
  usage: Array<{
    metric_key: string
    metric_value: number
    aggregation_type: string
  }>
  matches: Array<{
    id: number
    matched_account_name: string
    matched_source_system: string
    score: number
    confidence: string
    is_confirmed: boolean
    is_rejected: boolean
  }>
}

export async function getAccountById(id: number): Promise<AccountDetail> {
  return request(`/accounts/${id}`)
}

// Matches
export interface MatchCandidate {
  id: number
  source_account_id: number
  source_account_name: string
  source_system: string
  target_account_id: number
  target_account_name: string
  target_system: string
  overall_score: number
  status: 'pending' | 'confirmed' | 'rejected'
  matched_by: string | null
  explanation: string | null
  confidence_level: string
  field_scores: Array<{
    field: string
    score: number
    value_a: string | null
    value_b: string | null
  }>
}

export interface MatchesResponse {
  matches: MatchCandidate[]
  total: number
  pending_count: number
  confirmed_count: number
  rejected_count: number
}

export async function getMatches(params?: {
  status?: string
  min_score?: number
}): Promise<MatchesResponse> {
  const searchParams = new URLSearchParams()
  if (params?.status) searchParams.set('status', params.status)
  if (params?.min_score) searchParams.set('min_score', params.min_score.toString())

  const query = searchParams.toString()
  return request(`/matches${query ? `?${query}` : ''}`)
}

export async function confirmMatch(matchId: number): Promise<MatchCandidate> {
  return request(`/matches/${matchId}/confirm`, { method: 'POST' })
}

export async function rejectMatch(matchId: number, reason?: string): Promise<MatchCandidate> {
  return request(`/matches/${matchId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

// Pricing
export interface FeatureContribution {
  feature_key: string
  feature_display_name: string
  contribution_amount: number
  direction: 'increase' | 'decrease' | 'neutral'
  explanation_text: string
  display_order: number
}

export interface PricingExplanation {
  base_price: number
  final_price: number
  contributions: FeatureContribution[]
  metadata: {
    plan_tier: string
    segment: string
    contract_length: string
  }
  global_explanation: {
    internal_summary: string
    customer_facing_summary: string
  }
}

export async function explainPricing(params: {
  plan_tier: string
  segment: string
  contract_length: string
  api_calls?: number
  storage_gb?: number
}): Promise<PricingExplanation> {
  return request('/analytics/pricing/explain', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

// Pricing Intelligence (real customer data analysis)
export interface RevenueConcentration {
  total_arr: number
  top_accounts: Array<{
    rank: number
    id: number
    name: string
    segment: string
    arr: number
    percentage: number
  }>
  concentration_risk: 'low' | 'medium' | 'high' | 'unknown'
  top_3_percentage: number
  top_10_percentage: number
  insight_text: string
}

export interface PricingAnomaly {
  account_id: number
  account_name: string
  segment: string
  plan_tier: string
  arr: number
  segment_avg_arr: number
  deviation_percent: number
  direction: 'underpriced' | 'overpriced'
  similar_accounts: Array<{ name: string; arr: number }>
  insight_text: string
}

export interface DiscountAnalysis {
  total_subscriptions: number
  subscriptions_with_discount: number
  discount_rate: number
  avg_discount_percent: number
  high_discount_accounts: Array<{
    account_id: number
    account_name: string
    plan: string
    discount_percent: number
    monthly_discount: number
  }>
  total_discount_amount: number
  insight_text: string
}

export interface SegmentBenchmark {
  segment: string
  account_count: number
  total_arr: number
  avg_arr: number
  median_arr: number
  min_arr: number
  max_arr: number
  range: string
}

export interface UsageRevenueInsight {
  accounts_with_usage: number
  high_usage_low_revenue: Array<{
    account_id: number
    account_name: string
    usage: number
    arr: number
    ratio: number
  }>
  low_usage_high_revenue: Array<{
    account_id: number
    account_name: string
    usage: number
    arr: number
    ratio: number
  }>
  insight_text: string
}

export interface PricingIntelligence {
  revenue_concentration: RevenueConcentration
  pricing_anomalies: PricingAnomaly[]
  discount_analysis: DiscountAnalysis
  segment_benchmarks: SegmentBenchmark[]
  usage_revenue: UsageRevenueInsight | null
  confidence_score: number
  generated_at: string
}

export async function getPricingIntelligence(): Promise<PricingIntelligence> {
  return request('/analytics/pricing-intelligence')
}

// Projects
export interface Project {
  id: number
  name: string
  description: string | null
  created_at: string
  updated_at: string
  upload_count: number
}

export interface Upload {
  id: number
  project_id: number
  file_name: string
  file_type: string
  status: 'pending' | 'processing' | 'completed' | 'completed_with_errors'
  row_count: number | null
  error_message: string | null
  created_at: string
  processed_at: string | null
}

export async function getProjects(): Promise<Project[]> {
  return request('/projects')
}

export async function createProject(data: { name: string; description?: string }): Promise<Project> {
  const params = new URLSearchParams()
  params.set('name', data.name)
  if (data.description) params.set('description', data.description)

  return request(`/projects?${params.toString()}`, {
    method: 'POST',
  })
}

export async function getProjectUploads(projectId: number): Promise<Upload[]> {
  return request(`/projects/${projectId}/uploads`)
}

export async function uploadFile(
  projectId: number,
  file: File,
  options?: {
    fileType?: string
    columnMapping?: Record<string, string>
  }
): Promise<Upload> {
  const formData = new FormData()
  formData.append('file', file)

  const params = new URLSearchParams()
  if (options?.fileType) {
    params.set('file_type', options.fileType)
  }
  if (options?.columnMapping) {
    params.set('column_mapping', JSON.stringify(options.columnMapping))
  }

  const query = params.toString()
  const url = `/api/projects/${projectId}/uploads${query ? `?${query}` : ''}`

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`)
  }

  return response.json()
}

// Export
export async function exportAccounts(format: 'csv' | 'json' = 'csv'): Promise<Blob> {
  const response = await fetch(`${API_BASE}/export/accounts?format=${format}`)
  if (!response.ok) throw new Error('Export failed')
  return response.blob()
}

// Data Status & Onboarding
export type DataMode = 'sample' | 'user' | 'none'

export interface DataStatus {
  has_data: boolean
  data_mode: DataMode
  account_count: number
  upload_count: number
  sample_count: number
}

export async function getDataStatus(): Promise<DataStatus> {
  return request('/data-status')
}

export interface SampleDataResult {
  success: boolean
  message: string
  account_count?: number
  subscription_count?: number
  invoice_count?: number
}

export async function loadSampleData(): Promise<SampleDataResult> {
  return request('/sample-data/load', { method: 'POST' })
}

export async function clearSampleData(): Promise<{ success: boolean; message: string }> {
  return request('/sample-data/clear', { method: 'POST' })
}

export async function downloadTemplate(dataType: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}/templates/${dataType}`)
  if (!response.ok) throw new Error(`Template not found: ${dataType}`)
  return response.blob()
}

export interface ColumnValidation {
  detected_columns: string[]
  expected_columns: string[]
  matched_columns: Record<string, string>
  missing_required: string[]
  is_valid: boolean
  row_count: number
}

export async function validateColumns(file: File, dataType: string): Promise<ColumnValidation> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${API_BASE}/validate-columns?data_type=${dataType}`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Validation failed: ${response.status}`)
  }

  return response.json()
}

// Integrations
export interface Integration {
  provider: string
  name: string
  description: string
  category: string
  data_types: string[]
  available: boolean
  status: 'connected' | 'disconnected' | 'syncing' | 'error'
  connected_at: string | null
  last_sync_at: string | null
  records_synced: number
  account_name: string | null
}

export interface IntegrationsResponse {
  integrations: Integration[]
}

export async function getIntegrations(): Promise<IntegrationsResponse> {
  return request('/integrations')
}

export async function getIntegration(provider: string): Promise<Integration> {
  return request(`/integrations/${provider}`)
}

export async function getStripeAuthUrl(): Promise<{ url: string; state: string }> {
  return request('/integrations/stripe/auth-url')
}

export interface SyncResult {
  success: boolean
  message: string
  accounts_synced: number
  subscriptions_synced: number
  invoices_synced: number
  total_customers: number
  total_subscriptions: number
  total_invoices: number
}

export async function syncStripeData(): Promise<SyncResult> {
  return request('/integrations/stripe/sync', { method: 'POST' })
}

export async function disconnectIntegration(provider: string): Promise<{ success: boolean; message: string }> {
  return request(`/integrations/${provider}`, { method: 'DELETE' })
}

// Integration request types
export interface IntegrationRequestParams {
  email: string
  integration_type: string
  category?: string
  use_cases?: string[]
  other_description?: string
  freeform_notes?: string
}

export interface ComingSoonIntegration {
  provider: string
  name: string
  description: string
  category: string
  data_types: string[]
  available: boolean
  coming_soon: boolean
  use_cases: string[]
}

export interface RequestableIntegrations {
  ai_llm: Array<{ provider: string; name: string }>
  analytics: Array<{ provider: string; name: string }>
  finance_ops: Array<{ provider: string; name: string }>
}

export async function getComingSoonIntegrations(): Promise<{ integrations: ComingSoonIntegration[] }> {
  return request('/integrations/coming-soon')
}

export async function getRequestableIntegrations(): Promise<{ integrations: RequestableIntegrations }> {
  return request('/integrations/requestable')
}

export async function requestIntegration(
  params: IntegrationRequestParams
): Promise<{ success: boolean; message: string; request_id: number }> {
  const searchParams = new URLSearchParams()
  searchParams.set('email', params.email)
  searchParams.set('integration_type', params.integration_type)
  if (params.category) searchParams.set('category', params.category)
  if (params.use_cases?.length) searchParams.set('use_cases', JSON.stringify(params.use_cases))
  if (params.other_description) searchParams.set('other_description', params.other_description)
  if (params.freeform_notes) searchParams.set('freeform_notes', params.freeform_notes)

  return request(`/integrations/request?${searchParams.toString()}`, {
    method: 'POST',
  })
}
