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
    customerCount: 20,
    planCount: 4,
    plans: ['Free', 'Starter ($29)', 'Pro ($99)', 'Enterprise ($499)'],
    segments: SEGMENTS,
    description: 'Realistic SaaS data with 20 customers across 4 pricing tiers',
  }
}
