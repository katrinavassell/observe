/**
 * Stripe CSV Import Service
 * Handles parsing Stripe-exported CSV files and uploading to Supabase
 */

import Papa from 'papaparse'
import { supabase } from './supabase'

// =============================================================================
// TYPES
// =============================================================================

export interface StripeCustomer {
  id: string
  email: string
  name: string
  description?: string
  created: string
}

export interface StripeSubscription {
  id: string
  customer: string
  status: string
  plan_id: string
  plan_amount: number // in cents
  plan_interval: string // 'month' | 'year'
  plan_name?: string
  created: string
  canceled_at?: string
  current_period_start: string
  current_period_end: string
}

export interface StripeInvoice {
  id: string
  customer: string
  subscription?: string
  amount_paid: number // in cents
  status: string
  created: string
  period_start: string
  period_end: string
}

export interface ReconciliationReport {
  customersTotal: number
  subscriptionsTotal: number
  invoicesTotal: number
  subscriptionsMatched: number
  subscriptionsOrphaned: number
  activeSubscriptions: number
  canceledSubscriptions: number
  totalMrr: number
  warnings: string[]
}

export interface UnifiedSubscriptionData {
  subscription: StripeSubscription
  customer?: StripeCustomer
  mrr: number // calculated in dollars
  status: 'active' | 'churned'
  plan_name: string
  churn_date?: string
}

export type StripeFileType = 'customers' | 'subscriptions' | 'invoices' | 'unknown'

// =============================================================================
// FILE TYPE DETECTION
// =============================================================================

/**
 * Detect Stripe file type by examining CSV headers
 * Handles both API exports and Dashboard exports which have different column names
 */
export function detectStripeFileType(headers: string[]): StripeFileType {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim())

  // Subscriptions detection:
  // API export: customer, plan.id, plan.amount, plan.interval
  // Dashboard export: customer id, plan, amount, interval, status
  const hasSubscriptionHeaders =
    (normalizedHeaders.some(h => h === 'customer' || h === 'customer id')) &&
    (normalizedHeaders.some(h => h === 'plan' || h.includes('plan.') || h.includes('plan_') || h === 'price')) &&
    (normalizedHeaders.some(h => h === 'interval' || h === 'plan.interval' || h === 'plan_interval')) &&
    (normalizedHeaders.some(h => h === 'status'))

  if (hasSubscriptionHeaders) {
    return 'subscriptions'
  }

  // Invoices: has customer/customer id, amount_paid or amount paid
  const hasInvoiceHeaders =
    normalizedHeaders.some(h => h === 'customer' || h === 'customer id') &&
    normalizedHeaders.some(h => h === 'amount_paid' || h === 'amount paid' || h === 'amount due')

  if (hasInvoiceHeaders) {
    return 'invoices'
  }

  // Customers: has id, email, name, created - but NOT subscription/invoice specific columns
  const hasCustomerHeaders =
    normalizedHeaders.some(h => h === 'id') &&
    normalizedHeaders.some(h => h === 'email' || h === 'customer email') &&
    normalizedHeaders.some(h => h === 'name' || h === 'customer name') &&
    normalizedHeaders.some(h => h.includes('created')) &&
    !normalizedHeaders.some(h => h === 'interval' || h === 'plan' || h === 'amount due' || h === 'subscription')

  if (hasCustomerHeaders) {
    return 'customers'
  }

  return 'unknown'
}

// =============================================================================
// CSV PARSING
// =============================================================================

/**
 * Parse a CSV file using Papa Parse
 */
export function parseCSVFile<T>(file: File): Promise<{ data: T[]; headers: string[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || []
        resolve({
          data: results.data as T[],
          headers,
        })
      },
      error: (error) => {
        reject(new Error(`CSV parsing failed: ${error.message}`))
      },
    })
  })
}

/**
 * Parse Stripe customers CSV
 * Handles Dashboard export columns: id, Name, Email, Description, Created (UTC)
 */
export function parseStripeCustomers(rows: Record<string, unknown>[]): StripeCustomer[] {
  return rows
    .filter(row => row.id) // Skip rows without ID
    .map(row => ({
      id: String(row.id || ''),
      email: String(row['Email'] || row['email'] || row['Customer Email'] || ''),
      name: String(row['Name'] || row['name'] || row['Customer Name'] || row['customer_name'] || ''),
      description: row['Description'] || row['description'] ? String(row['Description'] || row['description']) : undefined,
      created: String(row['Created (UTC)'] || row['created'] || ''),
    }))
}

/**
 * Parse Stripe subscriptions CSV
 * Handles various column naming conventions from Stripe exports:
 * - API exports: customer, plan.id, plan.amount, plan.interval
 * - Dashboard exports: Customer ID, Plan, Amount, Interval, Customer Name
 */
export function parseStripeSubscriptions(rows: Record<string, unknown>[]): StripeSubscription[] {
  return rows
    .filter(row => row.id) // Skip rows without ID
    .map(row => {
      // Handle nested column names like "plan.id" or Dashboard names like "Plan"
      const planId = String(
        row['plan.id'] || row['plan_id'] || row['Plan'] || row['price.id'] || row['price_id'] || ''
      )

      // Amount: Dashboard uses "Amount" (as string like "33.00"), API uses plan.amount (in cents)
      let planAmount = 0
      const amountValue = row['Amount'] || row['plan.amount'] || row['plan_amount'] || row['price.unit_amount']
      if (amountValue !== undefined && amountValue !== null && amountValue !== '') {
        const parsed = parseFloat(String(amountValue))
        if (!isNaN(parsed)) {
          // Dashboard exports amounts in dollars, API exports in cents
          // If it looks like a dollar amount (has decimal or is small), convert to cents
          planAmount = parsed < 1000 ? parsed * 100 : parsed
        }
      }

      const planInterval = String(
        row['Interval'] || row['plan.interval'] || row['plan_interval'] || row['price.recurring.interval'] || 'month'
      )

      const planName = row['plan.nickname'] || row['plan_name'] || row['price.nickname'] || row['Plan'] || undefined

      // Customer ID: Dashboard uses "Customer ID", API uses "customer"
      const customerId = String(row['Customer ID'] || row['customer'] || row['customer_id'] || '')

      return {
        id: String(row.id || ''),
        customer: customerId,
        status: String(row['Status'] || row['status'] || 'active').toLowerCase(),
        plan_id: planId,
        plan_amount: planAmount,
        plan_interval: planInterval.toLowerCase(),
        plan_name: planName ? String(planName) : undefined,
        created: String(row['Created (UTC)'] || row['created'] || ''),
        canceled_at: row['canceled_at'] ? String(row['canceled_at']) : undefined,
        current_period_start: String(row['Current Period Start (UTC)'] || row['current_period_start'] || ''),
        current_period_end: String(row['Current Period End (UTC)'] || row['current_period_end'] || ''),
      }
    })
}

/**
 * Parse Stripe invoices CSV
 * Handles Dashboard export columns: Customer, Amount Paid, Status, Date (UTC), Subscription
 */
export function parseStripeInvoices(rows: Record<string, unknown>[]): StripeInvoice[] {
  return rows
    .filter(row => row.id)
    .map(row => {
      // Amount Paid can be a string like "9.90" - convert to cents
      let amountPaid = 0
      const amountValue = row['Amount Paid'] || row['amount_paid'] || row['amount paid']
      if (amountValue !== undefined && amountValue !== null && amountValue !== '') {
        const parsed = parseFloat(String(amountValue))
        if (!isNaN(parsed)) {
          amountPaid = parsed * 100 // Convert dollars to cents
        }
      }

      return {
        id: String(row.id || ''),
        customer: String(row['Customer'] || row['customer'] || row['customer_id'] || ''),
        subscription: row['Subscription'] || row['subscription'] ? String(row['Subscription'] || row['subscription']) : undefined,
        amount_paid: amountPaid,
        status: String(row['Status'] || row['status'] || '').toLowerCase(),
        created: String(row['Date (UTC)'] || row['created'] || ''),
        period_start: String(row['period_start'] || row['period start'] || ''),
        period_end: String(row['period_end'] || row['period end'] || ''),
      }
    })
}

// =============================================================================
// RECONCILIATION
// =============================================================================

/**
 * Calculate MRR from subscription
 * - amount is stored in cents (normalized during parsing)
 * - if yearly, divide by 12
 */
function calculateMrr(subscription: StripeSubscription): number {
  const amountInDollars = subscription.plan_amount / 100
  if (subscription.plan_interval === 'year') {
    return amountInDollars / 12
  }
  return amountInDollars
}

/**
 * Reconcile Stripe data from multiple files
 * - Joins subscriptions to customers
 * - Calculates MRR
 * - Identifies orphaned subscriptions
 * - Identifies churned customers
 */
export function reconcileStripeData(
  customers: StripeCustomer[],
  subscriptions: StripeSubscription[],
  invoices: StripeInvoice[]
): { unified: UnifiedSubscriptionData[]; report: ReconciliationReport } {
  const customerMap = new Map<string, StripeCustomer>()
  customers.forEach(c => customerMap.set(c.id, c))

  const warnings: string[] = []
  let subscriptionsMatched = 0
  let subscriptionsOrphaned = 0
  let activeSubscriptions = 0
  let canceledSubscriptions = 0
  let totalMrr = 0

  const unified: UnifiedSubscriptionData[] = subscriptions.map(sub => {
    const customer = customerMap.get(sub.customer)

    if (customer) {
      subscriptionsMatched++
    } else {
      subscriptionsOrphaned++
    }

    const isActive = sub.status === 'active' || sub.status === 'trialing'
    const isCanceled = sub.status === 'canceled' || !!sub.canceled_at

    if (isActive && !isCanceled) {
      activeSubscriptions++
    }
    if (isCanceled) {
      canceledSubscriptions++
    }

    const mrr = isActive && !isCanceled ? calculateMrr(sub) : 0
    totalMrr += mrr

    return {
      subscription: sub,
      customer,
      mrr,
      status: isCanceled ? 'churned' : 'active',
      plan_name: sub.plan_name || sub.plan_id || 'Unknown Plan',
      churn_date: sub.canceled_at,
    }
  })

  // Add warnings
  if (subscriptionsOrphaned > 0) {
    warnings.push(`${subscriptionsOrphaned} subscription(s) have no matching customer record`)
  }
  if (customers.length > 0 && subscriptions.length === 0) {
    warnings.push('No subscriptions found - MRR cannot be calculated')
  }

  return {
    unified,
    report: {
      customersTotal: customers.length,
      subscriptionsTotal: subscriptions.length,
      invoicesTotal: invoices.length,
      subscriptionsMatched,
      subscriptionsOrphaned,
      activeSubscriptions,
      canceledSubscriptions,
      totalMrr,
      warnings,
    },
  }
}

// =============================================================================
// DATABASE UPLOAD
// =============================================================================

interface DatabaseInsertData {
  plans: Array<{
    user_id: string
    plan_id: string
    name: string
    price_amount: number
    interval_months: number
    billing_model: string
  }>
  customers: Array<{
    user_id: string
    customer_id: string
    name: string
    email?: string
    segment?: string
    created_at?: string
  }>
  subscriptions: Array<{
    user_id: string
    subscription_id: string
    customer_id: string
    plan_id: string
    is_active: boolean
    current_period_start?: string
    current_period_end?: string
    cancelled_at?: string
    mrr_override?: number
  }>
}

/**
 * Convert unified data to database format
 */
export function convertToDatabaseFormat(
  unified: UnifiedSubscriptionData[],
  userId: string
): DatabaseInsertData {
  // Extract unique plans
  const planMap = new Map<string, { name: string; price: number; interval: string }>()
  unified.forEach(u => {
    if (!planMap.has(u.subscription.plan_id)) {
      planMap.set(u.subscription.plan_id, {
        name: u.plan_name,
        price: u.subscription.plan_amount / 100, // Convert cents to dollars
        interval: u.subscription.plan_interval,
      })
    }
  })

  const plans = Array.from(planMap.entries()).map(([planId, plan]) => ({
    user_id: userId,
    plan_id: planId,
    name: plan.name,
    price_amount: plan.price,
    interval_months: plan.interval === 'year' ? 12 : 1,
    billing_model: 'recurring',
  }))

  // Extract unique customers
  const customerMap = new Map<string, StripeCustomer>()
  unified.forEach(u => {
    if (u.customer && !customerMap.has(u.customer.id)) {
      customerMap.set(u.customer.id, u.customer)
    }
  })

  // Also add customers from subscriptions that don't have customer records
  unified.forEach(u => {
    if (!u.customer && !customerMap.has(u.subscription.customer)) {
      // Create a placeholder customer entry using the customer ID
      customerMap.set(u.subscription.customer, {
        id: u.subscription.customer,
        email: '',
        name: u.subscription.customer, // Use customer ID as name
        created: u.subscription.created,
      })
    }
  })

  const customers = Array.from(customerMap.values()).map(c => ({
    user_id: userId,
    customer_id: c.id,
    name: c.name || c.id,
    email: c.email || undefined,
    segment: deriveSegmentFromMrr(unified.find(u => u.subscription.customer === c.id)?.mrr || 0),
    created_at: c.created || undefined,
  }))

  // Create subscriptions
  const subscriptions = unified.map(u => ({
    user_id: userId,
    subscription_id: u.subscription.id,
    customer_id: u.subscription.customer,
    plan_id: u.subscription.plan_id,
    is_active: u.status === 'active',
    current_period_start: u.subscription.current_period_start || undefined,
    current_period_end: u.subscription.current_period_end || undefined,
    cancelled_at: u.churn_date || undefined,
    mrr_override: u.mrr,
  }))

  return { plans, customers, subscriptions }
}

/**
 * Derive customer segment from MRR
 */
function deriveSegmentFromMrr(mrr: number): string {
  if (mrr >= 1000) return 'Enterprise'
  if (mrr >= 200) return 'Mid-Market'
  return 'SMB'
}

/**
 * Upload Stripe data to Supabase
 * Only clears revenue tables (plans, customers, subscriptions)
 * Preserves cost_records and usage_records
 */
export async function uploadStripeData(data: DatabaseInsertData): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Only clear revenue tables - preserve costs and usage
  await supabase.from('subscriptions').delete().eq('user_id', user.id)
  await supabase.from('customers').delete().eq('user_id', user.id)
  await supabase.from('plans').delete().eq('user_id', user.id)

  // Insert plans
  if (data.plans.length > 0) {
    const { error: plansError } = await supabase.from('plans').insert(data.plans)
    if (plansError) throw new Error(`Failed to insert plans: ${plansError.message}`)
  }

  // Insert customers
  if (data.customers.length > 0) {
    const { error: customersError } = await supabase.from('customers').insert(data.customers)
    if (customersError) throw new Error(`Failed to insert customers: ${customersError.message}`)
  }

  // Insert subscriptions
  if (data.subscriptions.length > 0) {
    const { error: subsError } = await supabase.from('subscriptions').insert(data.subscriptions)
    if (subsError) throw new Error(`Failed to insert subscriptions: ${subsError.message}`)
  }

  // Update data status - only update revenue-related fields
  const { error: statusError } = await supabase
    .from('user_data_status')
    .upsert({
      user_id: user.id,
      data_mode: 'user',
      has_revenue: true,
      revenue_customer_count: data.customers.length,
    }, { onConflict: 'user_id' })

  if (statusError) throw new Error(`Failed to update data status: ${statusError.message}`)
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}
