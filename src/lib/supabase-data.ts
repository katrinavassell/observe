/**
 * Supabase Data API
 * Functions for loading, saving, and clearing pricing analyzer data
 */

import { supabase } from './supabase'
import type { AnalyzerData } from './pricing-analyzer'
import sampleDataJson from '../../files/sample-data.json'

export type DataMode = 'none' | 'sample' | 'user'

/**
 * Get the last day of a month in ISO format
 * @param month - Month string in YYYY-MM format
 * @returns ISO timestamp for the last day of the month at 23:59:59
 */
function getLastDayOfMonth(month: string): string {
  const [yearStr, monthStr] = month.split('-') as [string, string]
  const year = parseInt(yearStr, 10)
  const monthNum = parseInt(monthStr, 10)
  // Create date for first day of next month, then subtract one day
  const lastDay = new Date(year, monthNum, 0)
  return `${month}-${String(lastDay.getDate()).padStart(2, '0')}T23:59:59Z`
}

export interface DataStatus {
  data_mode: DataMode
  has_data: boolean
  customer_count: number
  has_revenue: boolean
  has_costs: boolean
  has_usage: boolean
  revenue_customer_count: number
  costs_record_count: number
  usage_record_count: number
}

// =============================================================================
// DATA STATUS
// =============================================================================

export async function getDataStatus(): Promise<DataStatus> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return {
      data_mode: 'none',
      has_data: false,
      customer_count: 0,
      has_revenue: false,
      has_costs: false,
      has_usage: false,
      revenue_customer_count: 0,
      costs_record_count: 0,
      usage_record_count: 0,
    }
  }

  // Get counts from each table in parallel
  const [
    { data: status },
    { count: customerCount },
    { count: costsCount },
    { count: usageCount },
  ] = await Promise.all([
    supabase
      .from('user_data_status')
      .select('data_mode, has_revenue, has_costs, has_usage, revenue_customer_count, costs_record_count, usage_record_count')
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('cost_records')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('usage_records')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ])

  const dataMode = (status?.data_mode as DataMode) || 'none'
  const hasRevenue = status?.has_revenue ?? (customerCount ?? 0) > 0
  const hasCosts = status?.has_costs ?? (costsCount ?? 0) > 0
  const hasUsage = status?.has_usage ?? (usageCount ?? 0) > 0

  return {
    data_mode: dataMode,
    has_data: hasRevenue || hasCosts || hasUsage,
    customer_count: customerCount || 0,
    has_revenue: hasRevenue,
    has_costs: hasCosts,
    has_usage: hasUsage,
    revenue_customer_count: status?.revenue_customer_count ?? customerCount ?? 0,
    costs_record_count: status?.costs_record_count ?? costsCount ?? 0,
    usage_record_count: status?.usage_record_count ?? usageCount ?? 0,
  }
}

// =============================================================================
// LOAD SAMPLE DATA
// =============================================================================

interface SampleDataCustomer {
  customer_id: string
  customer_name: string
  email: string
  plan: string
  mrr: number
  status: string
  started_at: string
}

interface SampleDataUsage {
  month: string
  customer_id: string
  metric: string
  value: number
  limit: number
}

interface SampleDataPlan {
  name: string
  price: number
  api_calls_limit: number
  tokens_limit: number
}

interface SampleDataJson {
  customers: SampleDataCustomer[]
  costs: Array<{ month: string; provider: string; cost: number }>
  usage: SampleDataUsage[]
  plans: Record<string, SampleDataPlan>
}

export async function loadSampleData(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const data = sampleDataJson as SampleDataJson

  // Clear existing data first
  await clearUserData()

  // 1. Insert plans
  const plans = Object.entries(data.plans).map(([planId, p]) => ({
    user_id: user.id,
    plan_id: `plan_${planId}`,
    name: p.name,
    price_amount: p.price,
    interval_months: 1,
    billing_model: 'recurring',
    api_calls_limit: p.api_calls_limit,
    tokens_limit: p.tokens_limit,
  }))

  const { error: plansError } = await supabase.from('plans').insert(plans)
  if (plansError) throw plansError

  // 2. Insert customers
  const customers = data.customers.map(c => ({
    user_id: user.id,
    customer_id: c.customer_id,
    name: c.customer_name,
    email: c.email,
    segment: deriveSegmentFromPlan(c.plan),
    created_at: c.started_at,
  }))

  const { error: customersError } = await supabase.from('customers').insert(customers)
  if (customersError) throw customersError

  // 3. Insert subscriptions with MRR override
  const subscriptions = data.customers.map(c => ({
    user_id: user.id,
    subscription_id: `sub_${c.customer_id}`,
    customer_id: c.customer_id,
    plan_id: `plan_${c.plan}`,
    is_active: c.status === 'active',
    current_period_start: '2024-12-01T00:00:00Z',
    current_period_end: '2024-12-31T23:59:59Z',
    previous_mrr: c.mrr,
    mrr_override: c.mrr,
  }))

  const { error: subsError } = await supabase.from('subscriptions').insert(subscriptions)
  if (subsError) throw subsError

  // 4. Insert usage records
  const usageRecords = data.usage.map(u => ({
    user_id: user.id,
    customer_id: u.customer_id,
    metric_key: u.metric === 'api_calls' ? 'api_calls' : 'tokens',
    metric_value: u.value,
    metric_limit: u.limit,
    period_start: `${u.month}-01T00:00:00Z`,
    period_end: getLastDayOfMonth(u.month),
  }))

  const { error: usageError } = await supabase.from('usage_records').insert(usageRecords)
  if (usageError) throw usageError

  // 5. Insert cost records (allocated per PRD)
  const CUSTOMER_COSTS: Record<string, number> = {
    'cust_001': 2400, // Acme Corp
    'cust_014': 340,  // DataFlow Inc
    'cust_019': 85,   // TinyStartup
  }
  const negativeMarginTotal = 2400 + 340 + 85
  const remainingCosts = 6200 - negativeMarginTotal
  const otherCustomerCount = data.customers.length - 3
  const avgOtherCost = remainingCosts / otherCustomerCount

  const costRecords = data.customers.map(c => ({
    user_id: user.id,
    customer_id: c.customer_id,
    cost_type: 'infrastructure',
    amount: CUSTOMER_COSTS[c.customer_id] ?? avgOtherCost,
    period_start: '2024-12-01T00:00:00Z',
    period_end: '2024-12-31T23:59:59Z',
  }))

  const { error: costsError } = await supabase.from('cost_records').insert(costRecords)
  if (costsError) throw costsError

  // 6. Update data status with all section flags
  const { error: statusError } = await supabase
    .from('user_data_status')
    .upsert({
      user_id: user.id,
      data_mode: 'sample',
      has_revenue: true,
      has_costs: true,
      has_usage: true,
      revenue_customer_count: data.customers.length,
      costs_record_count: costRecords.length,
      usage_record_count: usageRecords.length,
    }, { onConflict: 'user_id' })

  if (statusError) throw statusError
}

function deriveSegmentFromPlan(plan: string): string {
  switch (plan) {
    case 'enterprise': return 'Enterprise'
    case 'business': return 'Mid-Market'
    case 'pro': return 'Mid-Market'
    case 'starter': return 'SMB'
    default: return 'SMB'
  }
}

// =============================================================================
// LOAD SAMPLE DATA BY TYPE
// =============================================================================

/**
 * Load only sample revenue data (customers, plans, subscriptions)
 */
export async function loadSampleRevenue(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const data = sampleDataJson as SampleDataJson

  // Insert plans
  const plans = Object.entries(data.plans).map(([planId, p]) => ({
    user_id: user.id,
    plan_id: `plan_${planId}`,
    name: p.name,
    price_amount: p.price,
    interval_months: 1,
    billing_model: 'recurring',
    api_calls_limit: p.api_calls_limit,
    tokens_limit: p.tokens_limit,
  }))

  const { error: plansError } = await supabase.from('plans').upsert(plans, { onConflict: 'user_id,plan_id' })
  if (plansError) throw new Error(`Failed to upsert plans: ${plansError.message}`)

  // Insert customers
  const customers = data.customers.map(c => ({
    user_id: user.id,
    customer_id: c.customer_id,
    name: c.customer_name,
    email: c.email,
    segment: deriveSegmentFromPlan(c.plan),
    created_at: c.started_at,
  }))

  const { error: customersError } = await supabase.from('customers').upsert(customers, { onConflict: 'user_id,customer_id' })
  if (customersError) throw new Error(`Failed to upsert customers: ${customersError.message}`)

  // Insert subscriptions
  const subscriptions = data.customers.map(c => ({
    user_id: user.id,
    subscription_id: `sub_${c.customer_id}`,
    customer_id: c.customer_id,
    plan_id: `plan_${c.plan}`,
    is_active: c.status === 'active',
    current_period_start: '2024-12-01T00:00:00Z',
    current_period_end: '2024-12-31T23:59:59Z',
    previous_mrr: c.mrr,
    mrr_override: c.mrr,
  }))

  const { error: subsError } = await supabase.from('subscriptions').upsert(subscriptions, { onConflict: 'user_id,subscription_id' })
  if (subsError) throw new Error(`Failed to upsert subscriptions: ${subsError.message}`)

  // Update data status - only update revenue-related fields
  const { error: statusError } = await supabase
    .from('user_data_status')
    .upsert({
      user_id: user.id,
      data_mode: 'sample',
      has_revenue: true,
      revenue_customer_count: data.customers.length,
    }, { onConflict: 'user_id' })
  if (statusError) throw new Error(`Failed to update data status: ${statusError.message}`)
}

/**
 * Load only sample cost data
 */
export async function loadSampleCosts(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const data = sampleDataJson as SampleDataJson

  // Allocate costs per PRD
  const CUSTOMER_COSTS: Record<string, number> = {
    'cust_001': 2400,
    'cust_014': 340,
    'cust_019': 85,
  }
  const negativeMarginTotal = 2400 + 340 + 85
  const remainingCosts = 6200 - negativeMarginTotal
  const otherCustomerCount = data.customers.length - 3
  const avgOtherCost = remainingCosts / otherCustomerCount

  const costRecords = data.customers.map(c => ({
    user_id: user.id,
    customer_id: c.customer_id,
    cost_type: 'infrastructure',
    amount: CUSTOMER_COSTS[c.customer_id] ?? avgOtherCost,
    period_start: '2024-12-01T00:00:00Z',
    period_end: '2024-12-31T23:59:59Z',
  }))

  // Delete existing costs first, then insert
  const { error: deleteError } = await supabase.from('cost_records').delete().eq('user_id', user.id)
  if (deleteError) throw new Error(`Failed to clear existing costs: ${deleteError.message}`)

  const { error: insertError } = await supabase.from('cost_records').insert(costRecords)
  if (insertError) throw new Error(`Failed to insert cost records: ${insertError.message}`)

  // Update data status - only update costs-related fields
  const { error: statusError } = await supabase
    .from('user_data_status')
    .upsert({
      user_id: user.id,
      data_mode: 'sample',
      has_costs: true,
      costs_record_count: costRecords.length,
    }, { onConflict: 'user_id' })
  if (statusError) throw new Error(`Failed to update data status: ${statusError.message}`)
}

/**
 * Load only sample usage data
 */
export async function loadSampleUsage(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const data = sampleDataJson as SampleDataJson

  const usageRecords = data.usage.map(u => ({
    user_id: user.id,
    customer_id: u.customer_id,
    metric_key: u.metric === 'api_calls' ? 'api_calls' : 'tokens',
    metric_value: u.value,
    metric_limit: u.limit,
    period_start: `${u.month}-01T00:00:00Z`,
    period_end: getLastDayOfMonth(u.month),
  }))

  // Delete existing usage first, then insert
  const { error: deleteError } = await supabase.from('usage_records').delete().eq('user_id', user.id)
  if (deleteError) throw new Error(`Failed to clear existing usage: ${deleteError.message}`)

  const { error: insertError } = await supabase.from('usage_records').insert(usageRecords)
  if (insertError) throw new Error(`Failed to insert usage records: ${insertError.message}`)

  // Update data status - only update usage-related fields
  const { error: statusError } = await supabase
    .from('user_data_status')
    .upsert({
      user_id: user.id,
      data_mode: 'sample',
      has_usage: true,
      usage_record_count: usageRecords.length,
    }, { onConflict: 'user_id' })
  if (statusError) throw new Error(`Failed to update data status: ${statusError.message}`)
}

// =============================================================================
// UPLOAD USER DATA (CSV)
// =============================================================================

export interface CostRecord {
  month: string
  provider?: string
  customer_id?: string
  cost: number
}

export interface UsageRecord {
  month: string
  customer_id: string
  metric: string
  value: number
  limit?: number
}

/**
 * Upload cost data from CSV
 * Only clears existing cost_records, preserves revenue and usage data
 */
export async function uploadCostData(records: CostRecord[]): Promise<{ count: number }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Only clear cost_records, preserve other data
  const { error: deleteError } = await supabase.from('cost_records').delete().eq('user_id', user.id)
  if (deleteError) throw new Error(`Failed to clear existing cost records: ${deleteError.message}`)

  // Transform and insert
  const costRecords = records.map(r => ({
    user_id: user.id,
    customer_id: r.customer_id || null,
    cost_type: r.provider || 'infrastructure',
    amount: r.cost,
    period_start: `${r.month}-01T00:00:00Z`,
    period_end: getLastDayOfMonth(r.month),
  }))

  const { error } = await supabase.from('cost_records').insert(costRecords)
  if (error) throw new Error(`Failed to insert cost records: ${error.message}`)

  // Update data status - only update costs-related fields
  const { error: statusError } = await supabase
    .from('user_data_status')
    .upsert({
      user_id: user.id,
      data_mode: 'user',
      has_costs: true,
      costs_record_count: records.length,
    }, { onConflict: 'user_id' })
  if (statusError) throw new Error(`Failed to update data status: ${statusError.message}`)

  return { count: records.length }
}

/**
 * Upload usage data from CSV
 * Only clears existing usage_records, preserves revenue and cost data
 */
export async function uploadUsageData(records: UsageRecord[]): Promise<{ count: number }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Only clear usage_records, preserve other data
  const { error: deleteError } = await supabase.from('usage_records').delete().eq('user_id', user.id)
  if (deleteError) throw new Error(`Failed to clear existing usage records: ${deleteError.message}`)

  // Transform and insert
  const usageRecords = records.map(r => ({
    user_id: user.id,
    customer_id: r.customer_id,
    metric_key: r.metric === 'api_calls' ? 'api_calls' : r.metric,
    metric_value: r.value,
    metric_limit: r.limit || null,
    period_start: `${r.month}-01T00:00:00Z`,
    period_end: getLastDayOfMonth(r.month),
  }))

  const { error } = await supabase.from('usage_records').insert(usageRecords)
  if (error) throw new Error(`Failed to insert usage records: ${error.message}`)

  // Update data status - only update usage-related fields
  const { error: statusError } = await supabase
    .from('user_data_status')
    .upsert({
      user_id: user.id,
      data_mode: 'user',
      has_usage: true,
      usage_record_count: records.length,
    }, { onConflict: 'user_id' })
  if (statusError) throw new Error(`Failed to update data status: ${statusError.message}`)

  return { count: records.length }
}

// =============================================================================
// CLEAR INDIVIDUAL DATA TYPES
// =============================================================================

/**
 * Clear cost data only
 * Updates user_data_status to reflect has_costs = false
 */
export async function clearCostData(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error: deleteError } = await supabase.from('cost_records').delete().eq('user_id', user.id)
  if (deleteError) throw new Error(`Failed to clear cost records: ${deleteError.message}`)

  // Update data status
  const { error: statusError } = await supabase
    .from('user_data_status')
    .upsert({
      user_id: user.id,
      has_costs: false,
      costs_record_count: 0,
    }, { onConflict: 'user_id' })
  if (statusError) throw new Error(`Failed to update data status: ${statusError.message}`)
}

/**
 * Clear usage data only
 * Updates user_data_status to reflect has_usage = false
 */
export async function clearUsageData(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error: deleteError } = await supabase.from('usage_records').delete().eq('user_id', user.id)
  if (deleteError) throw new Error(`Failed to clear usage records: ${deleteError.message}`)

  // Update data status
  const { error: statusError } = await supabase
    .from('user_data_status')
    .upsert({
      user_id: user.id,
      has_usage: false,
      usage_record_count: 0,
    }, { onConflict: 'user_id' })
  if (statusError) throw new Error(`Failed to update data status: ${statusError.message}`)
}

/**
 * Clear revenue data only (plans, customers, subscriptions)
 * Updates user_data_status to reflect has_revenue = false
 */
export async function clearRevenueData(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Delete in order to respect foreign key constraints
  const { error: subsError } = await supabase.from('subscriptions').delete().eq('user_id', user.id)
  if (subsError) throw new Error(`Failed to clear subscriptions: ${subsError.message}`)

  const { error: customersError } = await supabase.from('customers').delete().eq('user_id', user.id)
  if (customersError) throw new Error(`Failed to clear customers: ${customersError.message}`)

  const { error: plansError } = await supabase.from('plans').delete().eq('user_id', user.id)
  if (plansError) throw new Error(`Failed to clear plans: ${plansError.message}`)

  // Update data status
  const { error: statusError } = await supabase
    .from('user_data_status')
    .upsert({
      user_id: user.id,
      has_revenue: false,
      revenue_customer_count: 0,
    }, { onConflict: 'user_id' })
  if (statusError) throw new Error(`Failed to update data status: ${statusError.message}`)
}

// =============================================================================
// CLEAR USER DATA
// =============================================================================

export async function clearUserData(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Delete in order to respect foreign key constraints (if any)
  await supabase.from('usage_records').delete().eq('user_id', user.id)
  await supabase.from('cost_records').delete().eq('user_id', user.id)
  await supabase.from('subscriptions').delete().eq('user_id', user.id)
  await supabase.from('customers').delete().eq('user_id', user.id)
  await supabase.from('plans').delete().eq('user_id', user.id)

  // Update status - reset all section flags
  await supabase
    .from('user_data_status')
    .upsert({
      user_id: user.id,
      data_mode: 'none',
      has_revenue: false,
      has_costs: false,
      has_usage: false,
      revenue_customer_count: 0,
      costs_record_count: 0,
      usage_record_count: 0,
    }, { onConflict: 'user_id' })
}

// =============================================================================
// FETCH ANALYZER DATA
// =============================================================================

export async function fetchAnalyzerData(): Promise<AnalyzerData | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Check if user has data
  const status = await getDataStatus()
  if (!status.has_data) return null

  // Fetch all data in parallel
  const [
    { data: plans },
    { data: customers },
    { data: subscriptions },
    { data: usageRecords },
    { data: costRecords },
  ] = await Promise.all([
    supabase.from('plans').select('*').eq('user_id', user.id),
    supabase.from('customers').select('*').eq('user_id', user.id),
    supabase.from('subscriptions').select('*').eq('user_id', user.id),
    supabase.from('usage_records').select('*').eq('user_id', user.id),
    supabase.from('cost_records').select('*').eq('user_id', user.id),
  ])

  if (!plans || !customers || !subscriptions) return null

  // Transform to AnalyzerData format
  return {
    plans: plans.map(p => ({
      plan_id: p.plan_id,
      name: p.name,
      price_amount: Number(p.price_amount),
      interval_months: p.interval_months,
      billing_model: p.billing_model as 'recurring' | 'usage_based' | 'hybrid',
    })),
    customers: customers.map(c => ({
      customer_id: c.customer_id,
      name: c.name,
      email: c.email || undefined,
      segment: c.segment || undefined,
      created_at: c.created_at,
    })),
    subscriptions: subscriptions.map(s => ({
      subscription_id: s.subscription_id,
      customer_id: s.customer_id,
      plan_id: s.plan_id,
      is_active: s.is_active,
      current_period_start: s.current_period_start || undefined,
      current_period_end: s.current_period_end || undefined,
      cancelled_at: s.cancelled_at || undefined,
      previous_mrr: s.previous_mrr ? Number(s.previous_mrr) : undefined,
      mrr_override: s.mrr_override ? Number(s.mrr_override) : undefined,
    })),
    usage: usageRecords?.map(u => ({
      customer_id: u.customer_id,
      metric_key: u.metric_key,
      metric_value: Number(u.metric_value),
      metric_limit: u.metric_limit ? Number(u.metric_limit) : undefined,
      period_start: u.period_start,
      period_end: u.period_end,
    })) || [],
    costs: costRecords?.map(c => ({
      customer_id: c.customer_id || undefined,
      cost_type: c.cost_type,
      amount: Number(c.amount),
      period_start: c.period_start,
      period_end: c.period_end,
    })) || [],
  }
}
