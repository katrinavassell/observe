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

export interface Customer {
  id: string
  customer_id: string
  name: string
  email: string | null
  segment: string | null
  created_at: string
}

export async function getCustomers(): Promise<Customer[]> {
  return request('/customers')
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
  return request('/subscriptions')
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
