/**
 * Sample Data Generator for Pricing Analyzer
 * Generates realistic demo data for testing the analyzer
 */

import type {
  Customer,
  Plan,
  Subscription,
  Invoice,
  UsageRecord,
  CostRecord,
  AnalyzerData,
} from './pricing-analyzer'

// Import curated sample data
import sampleDataJson from '../../files/sample-data.json'

// Type for the curated sample data JSON structure
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
  metadata: {
    source: string
    generated_at: string
    description: string
    customers_count: number
    plans_count: number
    months: string[]
  }
  customers: SampleDataCustomer[]
  costs: Array<{ month: string; provider: string; cost: number }>
  usage: SampleDataUsage[]
  plans: Record<string, SampleDataPlan>
  computed: {
    total_mrr: number
    total_arr: number
    customer_count: number
    plan_count: number
    december_costs: number
    december_margin_percent: number
    july_margin_percent: number
  }
}

// =============================================================================
// SAMPLE PLANS
// =============================================================================

const SAMPLE_PLANS: Plan[] = [
  {
    plan_id: 'plan_free',
    name: 'Free',
    price_amount: 0,
    interval_months: 1,
    billing_model: 'recurring',
  },
  {
    plan_id: 'plan_starter',
    name: 'Starter',
    price_amount: 29,
    interval_months: 1,
    billing_model: 'recurring',
  },
  {
    plan_id: 'plan_pro',
    name: 'Pro',
    price_amount: 99,
    interval_months: 1,
    billing_model: 'recurring',
  },
  {
    plan_id: 'plan_enterprise',
    name: 'Enterprise',
    price_amount: 499,
    interval_months: 1,
    billing_model: 'recurring',
  },
]

// =============================================================================
// SAMPLE CUSTOMER DATA
// =============================================================================

const COMPANY_NAMES = [
  'Acme Corp',
  'TechStart Inc',
  'DataFlow Systems',
  'CloudNine Software',
  'Innovation Labs',
  'Digital Dynamics',
  'SmartScale',
  'NextGen Solutions',
  'Quantum Analytics',
  'PrimeStack',
  'AgileForce',
  'ByteWorks',
  'Synergy Systems',
  'FutureProof Tech',
  'Velocity Partners',
  'Apex Digital',
  'CoreLogic Inc',
  'Streamline Co',
  'Precision Data',
  'Catalyst Group',
]

const SEGMENTS = ['Enterprise', 'Mid-Market', 'SMB', 'Startup']

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
}

function generateCustomers(): Customer[] {
  const now = new Date()
  const oneYearAgo = new Date(now)
  oneYearAgo.setFullYear(now.getFullYear() - 1)

  return COMPANY_NAMES.map((name, idx) => {
    const segment = SEGMENTS[Math.floor(Math.random() * SEGMENTS.length)]
    const createdAt = randomDate(oneYearAgo, now)

    return {
      customer_id: `cust_${(idx + 1).toString().padStart(3, '0')}`,
      email: `billing@${name.toLowerCase().replace(/\s+/g, '')}.com`,
      name,
      segment,
      created_at: createdAt.toISOString(),
    }
  })
}

function generateSubscriptions(customers: Customer[]): Subscription[] {
  const now = new Date()
  const subscriptions: Subscription[] = []

  customers.forEach((customer, idx) => {
    // Determine plan based on segment
    let planId: string
    const segment = customer.segment || 'SMB'

    if (segment === 'Enterprise') {
      planId = Math.random() > 0.3 ? 'plan_enterprise' : 'plan_pro'
    } else if (segment === 'Mid-Market') {
      planId = Math.random() > 0.5 ? 'plan_pro' : 'plan_starter'
    } else if (segment === 'Startup') {
      planId = Math.random() > 0.6 ? 'plan_starter' : 'plan_free'
    } else {
      // SMB
      const rand = Math.random()
      if (rand > 0.7) planId = 'plan_pro'
      else if (rand > 0.3) planId = 'plan_starter'
      else planId = 'plan_free'
    }

    // Some customers churned
    const isActive = Math.random() > 0.15
    const cancelledAt = !isActive ? new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString() : undefined

    // Period dates
    const periodStart = new Date(now)
    periodStart.setMonth(periodStart.getMonth() - 1)
    const periodEnd = new Date(now)

    // Previous MRR for movement calculation
    const plan = SAMPLE_PLANS.find(p => p.plan_id === planId)
    const previousMrr = Math.random() > 0.8 ? (plan?.price_amount || 0) * 0.8 : plan?.price_amount || 0

    subscriptions.push({
      subscription_id: `sub_${(idx + 1).toString().padStart(3, '0')}`,
      customer_id: customer.customer_id,
      plan_id: planId,
      is_active: isActive,
      current_period_start: periodStart.toISOString(),
      current_period_end: periodEnd.toISOString(),
      cancelled_at: cancelledAt,
      previous_mrr: previousMrr,
    })
  })

  return subscriptions
}

function generateInvoices(subscriptions: Subscription[]): Invoice[] {
  const invoices: Invoice[] = []

  subscriptions.forEach((sub, idx) => {
    const plan = SAMPLE_PLANS.find(p => p.plan_id === sub.plan_id)
    if (!plan || plan.price_amount === 0) return

    // Generate 3 months of invoices
    for (let month = 0; month < 3; month++) {
      const dueDate = new Date()
      dueDate.setMonth(dueDate.getMonth() - month)

      const hasDiscount = Math.random() > 0.8
      const discountAmount = hasDiscount ? plan.price_amount * 0.15 : 0

      invoices.push({
        invoice_id: `inv_${idx}_${month}`,
        subscription_id: sub.subscription_id,
        amount: plan.price_amount - discountAmount,
        status: month === 0 ? 'pending' : 'paid',
        due_date: dueDate.toISOString(),
        discount_amount: discountAmount,
      })
    }
  })

  return invoices
}

function generateUsage(customers: Customer[]): UsageRecord[] {
  const usage: UsageRecord[] = []
  const now = new Date()
  const lastMonth = new Date(now)
  lastMonth.setMonth(now.getMonth() - 1)

  customers.forEach(customer => {
    // Random usage percentage
    const usagePercent = Math.floor(Math.random() * 100)

    usage.push({
      customer_id: customer.customer_id,
      metric_key: 'api_calls_percent',
      metric_value: usagePercent,
      period_start: lastMonth.toISOString(),
      period_end: now.toISOString(),
    })
  })

  return usage
}

function generateCosts(customers: Customer[], subscriptions: Subscription[]): CostRecord[] {
  const costs: CostRecord[] = []
  const subMap = new Map(subscriptions.map(s => [s.customer_id, s]))
  const now = new Date()
  const lastMonth = new Date(now)
  lastMonth.setMonth(now.getMonth() - 1)

  customers.forEach(customer => {
    const sub = subMap.get(customer.customer_id)
    if (!sub || !sub.is_active) return

    const plan = SAMPLE_PLANS.find(p => p.plan_id === sub.plan_id)
    if (!plan) return

    // Most customers have reasonable costs, but some have high costs
    let costRatio = 0.3 + Math.random() * 0.3 // 30-60% of revenue
    if (Math.random() > 0.9) {
      costRatio = 1.2 // 10% have negative margin
    }

    costs.push({
      customer_id: customer.customer_id,
      cost_type: 'infrastructure',
      amount: plan.price_amount * costRatio,
      period_start: lastMonth.toISOString(),
      period_end: now.toISOString(),
    })
  })

  return costs
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

export function generateSampleData(): AnalyzerData {
  const customers = generateCustomers()
  const subscriptions = generateSubscriptions(customers)
  const invoices = generateInvoices(subscriptions)
  const usage = generateUsage(customers)
  const costs = generateCosts(customers, subscriptions)

  return {
    customers,
    plans: SAMPLE_PLANS,
    subscriptions,
    invoices,
    usage,
    costs,
  }
}

/**
 * Get sample data summary for display
 */
export function getSampleDataSummary() {
  return {
    customerCount: 30,
    planCount: 4,
    plans: ['Starter ($49)', 'Pro ($199)', 'Business ($499)', 'Enterprise ($1,999)'],
    segments: SEGMENTS,
    description: '6 months of realistic SaaS data with 30 customers across 4 pricing tiers',
  }
}

// =============================================================================
// CURATED SAMPLE DATA LOADER
// =============================================================================

/**
 * Derive segment from plan name for curated data
 */
function deriveSegmentFromPlan(plan: string): string {
  switch (plan) {
    case 'enterprise':
      return 'Enterprise'
    case 'business':
      return 'Mid-Market'
    case 'pro':
      return 'Mid-Market'
    case 'starter':
      return 'SMB'
    default:
      return 'SMB'
  }
}

/**
 * Load curated sample data from static JSON file
 * This data is designed to tell specific stories:
 * - Margin compression (66% → 44%)
 * - 3 negative margin customers (Acme, DataFlow, TinyStartup)
 * - 4 churn risk customers (Globex, Initech, Umbrella, Wonka - declining usage)
 * - 3 upsell opportunities (Stark, Wayne, Aperture - high usage)
 * - 1 usage anomaly (Cyberdyne spike)
 *
 * PRD Numbers:
 * - Total MRR: $11,070
 * - Total ARR: $132,840
 * - Total Costs (Dec): $6,200
 * - Margin: 44% (down from 66% in July)
 */
export function loadCuratedSampleData(): AnalyzerData {
  const data = sampleDataJson as SampleDataJson

  // 1. Transform plans from JSON (correct prices: $1999/$499/$199/$49)
  const plans: Plan[] = Object.entries(data.plans).map(([planId, p]) => ({
    plan_id: `plan_${planId}`,
    name: p.name,
    price_amount: p.price, // Uses JSON prices: 1999, 499, 199, 49
    interval_months: 1,
    billing_model: 'recurring' as const,
  }))

  // 2. Transform customers
  const customers: Customer[] = data.customers.map(c => ({
    customer_id: c.customer_id,
    email: c.email,
    name: c.customer_name,
    segment: deriveSegmentFromPlan(c.plan),
    created_at: c.started_at,
  }))

  // 3. Create subscriptions using MRR from JSON (not plan prices, since JSON has actual MRR)
  const subscriptions: Subscription[] = data.customers.map(c => ({
    subscription_id: `sub_${c.customer_id}`,
    customer_id: c.customer_id,
    plan_id: `plan_${c.plan}`,
    is_active: c.status === 'active',
    current_period_start: '2024-12-01T00:00:00Z',
    current_period_end: '2024-12-31T23:59:59Z',
    previous_mrr: c.mrr,
    // Store the actual MRR from the JSON for calculations
    mrr_override: c.mrr,
  }))

  // 4. Transform ALL usage data (including historical for trend analysis)
  // Group by customer and month for trend detection
  const usage: UsageRecord[] = data.usage.map(u => ({
    customer_id: u.customer_id,
    metric_key: u.metric === 'api_calls' ? 'api_calls' : 'tokens',
    metric_value: u.value,
    metric_limit: u.limit,
    period_start: `${u.month}-01T00:00:00Z`,
    period_end: `${u.month}-28T23:59:59Z`,
  }))

  // 5. Use actual cost data from JSON (has 6 months of historical data)
  // This enables MRR vs Costs trend visualization
  const costs: CostRecord[] = data.costs.map(c => ({
    customer_id: 'aggregate', // Aggregate costs (not per-customer)
    cost_type: c.provider,
    amount: c.cost,
    period_start: `${c.month}-01T00:00:00Z`,
    period_end: `${c.month}-28T23:59:59Z`,
  }))

  // Also add per-customer costs for December (for negative margin analysis)
  // PRD specifies: Acme $2,400, DataFlow $340, TinyStartup $85
  const CUSTOMER_COSTS: Record<string, number> = {
    'cust_001': 2400, // Acme Corp - token overages → -20% margin
    'cust_014': 340,  // DataFlow Inc - heavy usage → -71% margin
    'cust_019': 85,   // TinyStartup - heavy API usage → -73% margin
  }
  const negativeMarginTotal = 2400 + 340 + 85
  const remainingCosts = 6200 - negativeMarginTotal
  const otherCustomerCount = data.customers.length - 3
  const avgOtherCost = remainingCosts / otherCustomerCount

  data.customers.forEach(c => {
    costs.push({
      customer_id: c.customer_id,
      cost_type: 'infrastructure',
      amount: CUSTOMER_COSTS[c.customer_id] ?? avgOtherCost,
      period_start: '2024-12-01T00:00:00Z',
      period_end: '2024-12-31T23:59:59Z',
    })
  })

  return { customers, plans, subscriptions, usage, costs }
}
