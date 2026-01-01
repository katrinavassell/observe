/**
 * Supabase Data API
 * Functions for loading, saving, and clearing pricing analyzer data
 */

import { supabase } from './supabase'
import type { AnalyzerData } from './pricing-analyzer'
import { withRetry, isOnline } from './utils'
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

/**
 * Get a relative month string (YYYY-MM) based on offset from current month
 * @param monthsAgo - Number of months ago (0 = current month, 1 = last month, etc.)
 * @returns Month string in YYYY-MM format
 */
function getRelativeMonth(monthsAgo: number): string {
  const now = new Date()
  const targetDate = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1)
  return `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Convert sample data month (2024-07 through 2024-12) to relative month
 * Sample data covers 6 months ending in December 2024
 * We map these to the 6 months ending in current month
 * @param sampleMonth - Month from sample data (e.g., "2024-07")
 * @returns Relative month string
 */
function mapSampleMonthToRelative(sampleMonth: string): string {
  // Sample data months: 2024-07 (oldest) to 2024-12 (current)
  // Map to: 5 months ago to current month
  const sampleMonthMap: Record<string, number> = {
    '2024-07': 5,
    '2024-08': 4,
    '2024-09': 3,
    '2024-10': 2,
    '2024-11': 1,
    '2024-12': 0,
  }
  const monthsAgo = sampleMonthMap[sampleMonth] ?? 0
  return getRelativeMonth(monthsAgo)
}

/**
 * Get current period dates for subscriptions
 */
function getCurrentPeriodDates(): { start: string; end: string } {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  return {
    start: startOfMonth.toISOString(),
    end: endOfMonth.toISOString(),
  }
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
  last_sync_at: string | null
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
      last_sync_at: null,
    }
  }

  // Get counts from each table in parallel
  // Note: .single() may return null for new users with no data_status row yet
  const [
    statusResult,
    customersResult,
    costsResult,
    usageResult,
  ] = await Promise.all([
    supabase
      .from('user_data_status')
      .select('data_mode, has_revenue, has_costs, has_usage, revenue_customer_count, costs_record_count, usage_record_count, last_sync_at')
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

  // Handle potential errors - .single() returns PGRST116 when no row found (expected for new users)
  const status = statusResult.error?.code === 'PGRST116' ? null : statusResult.data
  const customerCount = customersResult.error ? 0 : (customersResult.count ?? 0)
  const costsCount = costsResult.error ? 0 : (costsResult.count ?? 0)
  const usageCount = usageResult.error ? 0 : (usageResult.count ?? 0)

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
    last_sync_at: status?.last_sync_at ?? null,
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

  // 3. Insert subscriptions with MRR override (using current period dates)
  // Add realistic MRR movement data for demo purposes
  const currentPeriod = getCurrentPeriodDates()
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  // Define MRR movement scenarios for demo
  const mrrMovement: Record<string, { previous: number; current: number; isNew?: boolean; churned?: boolean }> = {
    // New customers (started recently, no previous MRR) - $147 new MRR
    'cust_029': { previous: 0, current: 49, isNew: true },  // Vandelay Industries - new
    'cust_030': { previous: 0, current: 49, isNew: true },  // Rekall Inc - new
    'cust_026': { previous: 0, current: 49, isNew: true },  // Sterling Cooper - new
    // Expansion (upgraded plans) - $599 expansion MRR
    'cust_009': { previous: 199, current: 499 },  // Globex upgraded Pro→Business (+$300)
    'cust_012': { previous: 199, current: 499 },  // Pied Piper upgraded Pro→Business (+$300)
    // Contraction (downgraded) - $150 contraction MRR
    'cust_022': { previous: 199, current: 49 },   // Wonka downgraded Pro→Starter (-$150)
    // Churned - $98 churned MRR (2 starter customers)
    'cust_024': { previous: 49, current: 0, churned: true },  // Paddy's Pub - churned
    'cust_028': { previous: 49, current: 0, churned: true },  // Prestige Worldwide - churned
  }

  const subscriptions = data.customers.map(c => {
    const movement = mrrMovement[c.customer_id]
    const isChurned = movement?.churned === true

    return {
      user_id: user.id,
      subscription_id: `sub_${c.customer_id}`,
      customer_id: c.customer_id,
      plan_id: `plan_${c.plan}`,
      is_active: !isChurned && c.status === 'active',
      current_period_start: currentPeriod.start,
      current_period_end: currentPeriod.end,
      cancelled_at: isChurned ? new Date(thirtyDaysAgo.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString() : null,
      previous_mrr: movement?.previous ?? c.mrr,
      mrr_override: isChurned ? 0 : (movement?.current ?? c.mrr),
    }
  })

  const { error: subsError } = await supabase.from('subscriptions').insert(subscriptions)
  if (subsError) throw subsError

  // 4. Insert usage records (with relative months)
  const usageRecords = data.usage.map(u => {
    const relativeMonth = mapSampleMonthToRelative(u.month)
    return {
      user_id: user.id,
      customer_id: u.customer_id,
      metric_key: u.metric === 'api_calls' ? 'api_calls' : 'tokens',
      metric_value: u.value,
      metric_limit: u.limit,
      period_start: `${relativeMonth}-01T00:00:00Z`,
      period_end: getLastDayOfMonth(relativeMonth),
    }
  })

  const { error: usageError } = await supabase.from('usage_records').insert(usageRecords)
  if (usageError) throw usageError

  // 5. Insert cost records (allocated per PRD, using current month)
  const CUSTOMER_COSTS: Record<string, number> = {
    'cust_001': 2400, // Acme Corp
    'cust_014': 340,  // DataFlow Inc
    'cust_019': 85,   // TinyStartup
  }
  const negativeMarginTotal = 2400 + 340 + 85
  const remainingCosts = 6200 - negativeMarginTotal
  const otherCustomerCount = data.customers.length - 3
  const avgOtherCost = remainingCosts / otherCustomerCount
  const currentMonth = getRelativeMonth(0)

  const costRecords = data.customers.map(c => ({
    user_id: user.id,
    customer_id: c.customer_id,
    cost_type: 'infrastructure',
    amount: CUSTOMER_COSTS[c.customer_id] ?? avgOtherCost,
    period_start: `${currentMonth}-01T00:00:00Z`,
    period_end: getLastDayOfMonth(currentMonth),
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
      last_sync_at: new Date().toISOString(),
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

  // Insert subscriptions (using current period dates with MRR movement)
  const currentPeriod = getCurrentPeriodDates()
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  // Define MRR movement scenarios for demo
  const mrrMovement: Record<string, { previous: number; current: number; isNew?: boolean; churned?: boolean }> = {
    'cust_029': { previous: 0, current: 49, isNew: true },
    'cust_030': { previous: 0, current: 49, isNew: true },
    'cust_026': { previous: 0, current: 49, isNew: true },
    'cust_009': { previous: 199, current: 499 },
    'cust_012': { previous: 199, current: 499 },
    'cust_022': { previous: 199, current: 49 },
    'cust_024': { previous: 49, current: 0, churned: true },
    'cust_028': { previous: 49, current: 0, churned: true },
  }

  const subscriptions = data.customers.map(c => {
    const movement = mrrMovement[c.customer_id]
    const isChurned = movement?.churned === true

    return {
      user_id: user.id,
      subscription_id: `sub_${c.customer_id}`,
      customer_id: c.customer_id,
      plan_id: `plan_${c.plan}`,
      is_active: !isChurned && c.status === 'active',
      current_period_start: currentPeriod.start,
      current_period_end: currentPeriod.end,
      cancelled_at: isChurned ? new Date(thirtyDaysAgo.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString() : null,
      previous_mrr: movement?.previous ?? c.mrr,
      mrr_override: isChurned ? 0 : (movement?.current ?? c.mrr),
    }
  })

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
      last_sync_at: new Date().toISOString(),
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

  // Allocate costs per PRD (using current month)
  const CUSTOMER_COSTS: Record<string, number> = {
    'cust_001': 2400,
    'cust_014': 340,
    'cust_019': 85,
  }
  const negativeMarginTotal = 2400 + 340 + 85
  const remainingCosts = 6200 - negativeMarginTotal
  const otherCustomerCount = data.customers.length - 3
  const avgOtherCost = remainingCosts / otherCustomerCount
  const currentMonth = getRelativeMonth(0)

  const costRecords = data.customers.map(c => ({
    user_id: user.id,
    customer_id: c.customer_id,
    cost_type: 'infrastructure',
    amount: CUSTOMER_COSTS[c.customer_id] ?? avgOtherCost,
    period_start: `${currentMonth}-01T00:00:00Z`,
    period_end: getLastDayOfMonth(currentMonth),
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
      last_sync_at: new Date().toISOString(),
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

  const usageRecords = data.usage.map(u => {
    const relativeMonth = mapSampleMonthToRelative(u.month)
    return {
      user_id: user.id,
      customer_id: u.customer_id,
      metric_key: u.metric === 'api_calls' ? 'api_calls' : 'tokens',
      metric_value: u.value,
      metric_limit: u.limit,
      period_start: `${relativeMonth}-01T00:00:00Z`,
      period_end: getLastDayOfMonth(relativeMonth),
    }
  })

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
      last_sync_at: new Date().toISOString(),
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
      last_sync_at: new Date().toISOString(),
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
      last_sync_at: new Date().toISOString(),
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
  // Check if online before attempting fetch
  if (!isOnline()) {
    throw new Error('You appear to be offline. Please check your connection and try again.')
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Check if user has data
  const status = await getDataStatus()
  if (!status.has_data) return null

  // Fetch all data in parallel with retry logic for network failures
  const [
    { data: plans },
    { data: customers },
    { data: subscriptions },
    { data: usageRecords },
    { data: costRecords },
  ] = await withRetry(
    () => Promise.all([
      supabase.from('plans').select('*').eq('user_id', user.id),
      supabase.from('customers').select('*').eq('user_id', user.id),
      supabase.from('subscriptions').select('*').eq('user_id', user.id),
      supabase.from('usage_records').select('*').eq('user_id', user.id),
      supabase.from('cost_records').select('*').eq('user_id', user.id),
    ]),
    { maxRetries: 3, baseDelayMs: 1000 }
  )

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
