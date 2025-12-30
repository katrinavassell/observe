/**
 * Pricing Analyzer - Client-side CSV analysis for SaaS metrics
 * Compatible with Tanso Core entity schemas
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface Customer {
  customer_id: string
  email: string
  name?: string
  segment?: string
  created_at?: string
}

export interface Plan {
  plan_id: string
  name: string
  price_amount: number
  interval_months?: number
  billing_model?: string
}

export interface Subscription {
  subscription_id: string
  customer_id: string
  plan_id: string
  is_active: boolean
  current_period_start?: string
  current_period_end?: string
  cancelled_at?: string
  previous_mrr?: number // For MRR movement calculation
}

export interface Invoice {
  invoice_id: string
  subscription_id: string
  amount: number
  status: string
  due_date?: string
  discount_amount?: number
}

export interface UsageRecord {
  customer_id: string
  metric_key: string
  metric_value: number
  period_start?: string
  period_end?: string
}

export interface CostRecord {
  customer_id: string
  cost_type: string
  amount: number
  period_start?: string
  period_end?: string
}

export interface AnalyzerData {
  customers: Customer[]
  plans: Plan[]
  subscriptions: Subscription[]
  invoices?: Invoice[]
  usage?: UsageRecord[]
  costs?: CostRecord[]
}

export interface SaaSMetrics {
  mrr: number
  arr: number
  customerCount: number
  arpu: number
  nrr: number
  avgLTV: number
  mrrGrowth: number
  mrrMovement: {
    new: number
    expansion: number
    contraction: number
    churned: number
    netNew: number
  }
  formatted: {
    mrr: string
    arr: string
    arpu: string
    avgLTV: string
    newMRR: string
    expansionMRR: string
    contractionMRR: string
    churnedMRR: string
    netNewMRR: string
  }
}

export interface PlanHealth {
  planName: string
  planId: string
  customerCount: number
  totalMRR: number
  avgMRR: number
  avgUsage: string
  healthScore: number
  churnRiskCount: number
  churnRiskCustomers: string[]
  upsellReadyCount: number
  upsellReadyCustomers: string[]
  negativeMarginCount: number
  negativeMarginCustomers: string[]
}

export interface PriceExperiment {
  title: string
  description: string
  impact: string
  type: 'positive' | 'warning' | 'negative'
  suggestion: string
}

export interface BundlingOpportunity {
  title: string
  description: string
  impact: string
  type: 'positive' | 'warning' | 'negative'
  suggestion: string
}

export interface UsageAnomaly {
  customer: string
  customerId: string
  plan: string
  usage: string
  description: string
  type: 'warning' | 'info'
}

export interface NegativeMarginCustomer {
  customer: string
  customerId: string
  plan: string
  mrr: string
  costs: string
  margin: string
  reason: string
}

export interface CohortData {
  cohort: string
  customerCount: number
  avgMRR: string
  totalMRR: string
  avgTenureMonths?: number
  estimatedLTV?: string
}

export interface AnalysisResult {
  saasMetrics: SaaSMetrics
  planHealth: PlanHealth[]
  priceExperiments: PriceExperiment[]
  bundlingOpportunities: BundlingOpportunity[]
  usageAnomalies: UsageAnomaly[]
  negativeMarginCustomers: NegativeMarginCustomer[]
  cohorts: CohortData[]
  meta: {
    customerCount: number
    planCount: number
    subscriptionCount: number
    hasUsageData: boolean
    hasCostData: boolean
    hasInvoiceData: boolean
  }
}

// =============================================================================
// CSV PARSING
// =============================================================================

export function parseCSV<T>(csvText: string): T[] {
  const lines = csvText.trim().split('\n')
  if (lines.length < 2) return []

  const firstLine = lines[0]
  if (!firstLine) return []
  const headers = parseCSVLine(firstLine)
  const results: T[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const values = parseCSVLine(line)
    if (values.length !== headers.length) continue

    const row: Record<string, unknown> = {}
    headers.forEach((header, idx) => {
      const key = header.trim().toLowerCase().replace(/\s+/g, '_')
      let value: unknown = values[idx]?.trim() ?? ''

      // Type coercion
      if (key.includes('amount') || key.includes('price') || key.includes('value')) {
        value = parseFloat(value as string) || 0
      } else if (key === 'is_active') {
        value = (value as string).toLowerCase() === 'true' || value === '1'
      } else if (key.includes('_months') || key.includes('count')) {
        value = parseInt(value as string, 10) || 0
      }

      row[key] = value
    })
    results.push(row as T)
  }

  return results
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

// =============================================================================
// METRIC CALCULATIONS
// =============================================================================

export function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`
  } else if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}K`
  }
  return `$${amount.toFixed(0)}`
}

export function calculateMRR(subscriptions: Subscription[], plans: Plan[]): number {
  const planMap = new Map(plans.map(p => [p.plan_id, p]))

  return subscriptions
    .filter(s => s.is_active)
    .reduce((total, sub) => {
      const plan = planMap.get(sub.plan_id)
      if (!plan) return total

      // Normalize to monthly
      const intervalMonths = plan.interval_months || 1
      const monthlyAmount = plan.price_amount / intervalMonths
      return total + monthlyAmount
    }, 0)
}

export function calculateMRRMovement(
  subscriptions: Subscription[],
  plans: Plan[]
): SaaSMetrics['mrrMovement'] {
  const planMap = new Map(plans.map(p => [p.plan_id, p]))
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  let newMRR = 0
  let expansionMRR = 0
  let contractionMRR = 0
  let churnedMRR = 0

  subscriptions.forEach(sub => {
    const plan = planMap.get(sub.plan_id)
    if (!plan) return

    const intervalMonths = plan.interval_months || 1
    const currentMRR = plan.price_amount / intervalMonths
    const previousMRR = sub.previous_mrr ?? 0

    // New subscription (created in last 30 days)
    const periodStart = sub.current_period_start ? new Date(sub.current_period_start) : null
    if (periodStart && periodStart > thirtyDaysAgo && previousMRR === 0 && sub.is_active) {
      newMRR += currentMRR
    }
    // Churned
    else if (sub.cancelled_at && !sub.is_active) {
      churnedMRR += previousMRR || currentMRR
    }
    // Expansion
    else if (sub.is_active && previousMRR > 0 && currentMRR > previousMRR) {
      expansionMRR += currentMRR - previousMRR
    }
    // Contraction
    else if (sub.is_active && previousMRR > 0 && currentMRR < previousMRR) {
      contractionMRR += previousMRR - currentMRR
    }
  })

  return {
    new: newMRR,
    expansion: expansionMRR,
    contraction: contractionMRR,
    churned: churnedMRR,
    netNew: newMRR + expansionMRR - contractionMRR - churnedMRR,
  }
}

export function calculatePlanHealth(
  subscriptions: Subscription[],
  plans: Plan[],
  customers: Customer[],
  usage?: UsageRecord[],
  costs?: CostRecord[]
): PlanHealth[] {
  const customerMap = new Map(customers.map(c => [c.customer_id, c]))
  const usageByCustomer = new Map<string, number>()
  const costsByCustomer = new Map<string, number>()

  usage?.forEach(u => {
    const current = usageByCustomer.get(u.customer_id) || 0
    usageByCustomer.set(u.customer_id, current + u.metric_value)
  })

  costs?.forEach(c => {
    const current = costsByCustomer.get(c.customer_id) || 0
    costsByCustomer.set(c.customer_id, current + c.amount)
  })

  return plans.map(plan => {
    const planSubs = subscriptions.filter(s => s.plan_id === plan.plan_id)
    const activeSubs = planSubs.filter(s => s.is_active)
    const intervalMonths = plan.interval_months || 1
    const monthlyPrice = plan.price_amount / intervalMonths

    const totalMRR = activeSubs.length * monthlyPrice
    const avgMRR = activeSubs.length > 0 ? totalMRR / activeSubs.length : 0

    // Calculate health indicators
    const churnRiskCustomers: string[] = []
    const upsellReadyCustomers: string[] = []
    const negativeMarginCustomers: string[] = []

    planSubs.forEach(sub => {
      const customer = customerMap.get(sub.customer_id)
      const customerName = customer?.name || customer?.email || sub.customer_id

      // Churn risk: cancelled or low usage
      if (sub.cancelled_at || !sub.is_active) {
        churnRiskCustomers.push(customerName)
      }

      // Upsell ready: high usage relative to plan
      const customerUsage = usageByCustomer.get(sub.customer_id) || 0
      if (sub.is_active && customerUsage > 80) {
        upsellReadyCustomers.push(customerName)
      }

      // Negative margin
      const customerCost = costsByCustomer.get(sub.customer_id) || 0
      if (sub.is_active && customerCost > monthlyPrice) {
        negativeMarginCustomers.push(customerName)
      }
    })

    // Health score: 100 - penalties
    let healthScore = 100
    const churnPenalty = (churnRiskCustomers.length / Math.max(planSubs.length, 1)) * 30
    const marginPenalty = (negativeMarginCustomers.length / Math.max(activeSubs.length, 1)) * 20
    healthScore -= churnPenalty + marginPenalty
    healthScore = Math.max(0, Math.min(100, healthScore))

    // Average usage
    let totalUsage = 0
    activeSubs.forEach(sub => {
      totalUsage += usageByCustomer.get(sub.customer_id) || 0
    })
    const avgUsage = activeSubs.length > 0 ? totalUsage / activeSubs.length : 0

    return {
      planName: plan.name,
      planId: plan.plan_id,
      customerCount: activeSubs.length,
      totalMRR,
      avgMRR,
      avgUsage: avgUsage > 0 ? `${avgUsage.toFixed(0)}%` : 'N/A',
      healthScore: Math.round(healthScore),
      churnRiskCount: churnRiskCustomers.length,
      churnRiskCustomers,
      upsellReadyCount: upsellReadyCustomers.length,
      upsellReadyCustomers,
      negativeMarginCount: negativeMarginCustomers.length,
      negativeMarginCustomers,
    }
  })
}

export function calculateCohorts(
  customers: Customer[],
  subscriptions: Subscription[],
  plans: Plan[]
): CohortData[] {
  const planMap = new Map(plans.map(p => [p.plan_id, p]))
  const now = new Date()

  // Group customers by signup quarter
  const cohorts = new Map<string, { customers: Customer[], subscriptions: Subscription[] }>()

  customers.forEach(customer => {
    const createdAt = customer.created_at ? new Date(customer.created_at) : now
    const year = createdAt.getFullYear()
    const quarter = Math.floor(createdAt.getMonth() / 3) + 1
    const cohortKey = `Q${quarter} ${year}`

    if (!cohorts.has(cohortKey)) {
      cohorts.set(cohortKey, { customers: [], subscriptions: [] })
    }
    cohorts.get(cohortKey)!.customers.push(customer)
  })

  // Assign subscriptions to cohorts
  subscriptions.forEach(sub => {
    for (const [, cohort] of cohorts) {
      if (cohort.customers.some(c => c.customer_id === sub.customer_id)) {
        cohort.subscriptions.push(sub)
        break
      }
    }
  })

  // Calculate cohort metrics
  const cohortResults: CohortData[] = []

  cohorts.forEach((data, cohortKey) => {
    const activeSubs = data.subscriptions.filter(s => s.is_active)
    let totalMRR = 0

    activeSubs.forEach(sub => {
      const plan = planMap.get(sub.plan_id)
      if (plan) {
        const intervalMonths = plan.interval_months || 1
        totalMRR += plan.price_amount / intervalMonths
      }
    })

    const avgMRR = activeSubs.length > 0 ? totalMRR / activeSubs.length : 0

    // Calculate average tenure
    let totalTenureMonths = 0
    data.customers.forEach(c => {
      const created = c.created_at ? new Date(c.created_at) : now
      const months = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24 * 30)
      totalTenureMonths += months
    })
    const avgTenure = data.customers.length > 0 ? totalTenureMonths / data.customers.length : 0

    // Estimate LTV (assuming 90% retention rate = 10 months average lifespan)
    const estimatedLTV = avgMRR * 10

    cohortResults.push({
      cohort: cohortKey,
      customerCount: data.customers.length,
      avgMRR: formatCurrency(avgMRR),
      totalMRR: formatCurrency(totalMRR),
      avgTenureMonths: Math.round(avgTenure),
      estimatedLTV: formatCurrency(estimatedLTV),
    })
  })

  // Sort by date (most recent first)
  return cohortResults.sort((a, b) => {
    const [aq = '', ay = ''] = a.cohort.split(' ')
    const [bq = '', by = ''] = b.cohort.split(' ')
    if (ay !== by) return parseInt(by || '0') - parseInt(ay || '0')
    return parseInt(bq.substring(1) || '0') - parseInt(aq.substring(1) || '0')
  }).slice(0, 6) // Last 6 cohorts
}

export function generatePriceExperiments(
  subscriptions: Subscription[],
  plans: Plan[],
  customers: Customer[]
): PriceExperiment[] {
  const experiments: PriceExperiment[] = []
  const planMap = new Map(plans.map(p => [p.plan_id, p]))

  // Analyze plan distribution
  const planCounts = new Map<string, number>()
  subscriptions.filter(s => s.is_active).forEach(sub => {
    const count = planCounts.get(sub.plan_id) || 0
    planCounts.set(sub.plan_id, count + 1)
  })

  // Find most popular plan
  let maxCount = 0
  let mostPopularPlan: Plan | null = null
  planCounts.forEach((count, planId) => {
    if (count > maxCount) {
      maxCount = count
      mostPopularPlan = planMap.get(planId) || null
    }
  })

  if (mostPopularPlan && maxCount > 3) {
    const plan = mostPopularPlan as Plan
    experiments.push({
      title: `Test ${plan.name} Price Increase`,
      description: `${maxCount} customers on ${plan.name} suggests strong product-market fit`,
      impact: `+${formatCurrency(plan.price_amount * 0.1 * maxCount)}/mo potential`,
      type: 'positive',
      suggestion: `Consider testing a 10-15% price increase for new customers`,
    })
  }

  // Check for underpriced enterprise segment
  const enterpriseCustomers = customers.filter(c =>
    c.segment?.toLowerCase().includes('enterprise')
  )
  if (enterpriseCustomers.length > 0) {
    experiments.push({
      title: 'Enterprise Pricing Opportunity',
      description: `${enterpriseCustomers.length} enterprise customers may be underpriced`,
      impact: 'High revenue potential',
      type: 'positive',
      suggestion: 'Consider custom enterprise pricing with annual contracts',
    })
  }

  // Check for free tier abuse (if free plan exists)
  const freePlan = plans.find(p => p.price_amount === 0)
  if (freePlan) {
    const freeUsers = subscriptions.filter(s => s.plan_id === freePlan.plan_id && s.is_active).length
    const totalActive = subscriptions.filter(s => s.is_active).length
    const freeRatio = totalActive > 0 ? freeUsers / totalActive : 0

    if (freeRatio > 0.5) {
      experiments.push({
        title: 'Free Tier Conversion',
        description: `${Math.round(freeRatio * 100)}% of users on free tier`,
        impact: 'Conversion opportunity',
        type: 'warning',
        suggestion: 'Add usage limits or feature gates to drive upgrades',
      })
    }
  }

  return experiments
}

export function generateBundlingOpportunities(
  _subscriptions: Subscription[],
  plans: Plan[]
): BundlingOpportunity[] {
  const opportunities: BundlingOpportunity[] = []

  // Check for annual vs monthly pricing
  const monthlyPlans = plans.filter(p => !p.interval_months || p.interval_months === 1)
  const annualPlans = plans.filter(p => p.interval_months && p.interval_months >= 12)

  if (monthlyPlans.length > 0 && annualPlans.length === 0) {
    opportunities.push({
      title: 'Annual Pricing Opportunity',
      description: 'No annual plans detected in your pricing',
      impact: 'Reduce churn, improve cash flow',
      type: 'positive',
      suggestion: 'Offer 15-20% discount for annual commitment',
    })
  }

  // Check for single plan (no tiers)
  if (plans.length === 1) {
    opportunities.push({
      title: 'Add Pricing Tiers',
      description: 'Single pricing tier may limit revenue capture',
      impact: 'Capture more willingness to pay',
      type: 'warning',
      suggestion: 'Consider adding starter/pro/enterprise tiers',
    })
  }

  // Check for large price gaps between tiers
  const sortedPlans = [...plans].sort((a, b) => a.price_amount - b.price_amount)
  for (let i = 1; i < sortedPlans.length; i++) {
    const currentPlan = sortedPlans[i]
    const previousPlan = sortedPlans[i - 1]
    if (!currentPlan || !previousPlan) continue
    const ratio = currentPlan.price_amount / Math.max(previousPlan.price_amount, 1)
    if (ratio > 5) {
      opportunities.push({
        title: 'Large Price Gap Detected',
        description: `${previousPlan.name} → ${currentPlan.name} is a ${ratio.toFixed(0)}x jump`,
        impact: 'May lose customers in between',
        type: 'warning',
        suggestion: 'Consider adding an intermediate tier',
      })
      break
    }
  }

  return opportunities
}

export function analyzeUsageAnomalies(
  usage: UsageRecord[],
  subscriptions: Subscription[],
  plans: Plan[],
  customers: Customer[]
): UsageAnomaly[] {
  if (!usage || usage.length === 0) return []

  const anomalies: UsageAnomaly[] = []
  const planMap = new Map(plans.map(p => [p.plan_id, p]))
  const customerMap = new Map(customers.map(c => [c.customer_id, c]))
  const subMap = new Map(subscriptions.map(s => [s.customer_id, s]))

  // Group usage by customer
  const usageByCustomer = new Map<string, number>()
  usage.forEach(u => {
    const current = usageByCustomer.get(u.customer_id) || 0
    usageByCustomer.set(u.customer_id, current + u.metric_value)
  })

  usageByCustomer.forEach((totalUsage, customerId) => {
    const customer = customerMap.get(customerId)
    const sub = subMap.get(customerId)
    if (!sub || !sub.is_active) return

    const plan = planMap.get(sub.plan_id)
    if (!plan) return

    const customerName = customer?.name || customer?.email || customerId

    // High usage (>80%)
    if (totalUsage > 80) {
      anomalies.push({
        customer: customerName,
        customerId,
        plan: plan.name,
        usage: `${totalUsage}%`,
        description: 'Approaching plan limits - upsell opportunity',
        type: 'warning',
      })
    }
    // Very low usage (<20%)
    else if (totalUsage < 20) {
      anomalies.push({
        customer: customerName,
        customerId,
        plan: plan.name,
        usage: `${totalUsage}%`,
        description: 'Low engagement - potential churn risk',
        type: 'info',
      })
    }
  })

  return anomalies.slice(0, 10) // Top 10
}

export function analyzeNegativeMargins(
  costs: CostRecord[],
  subscriptions: Subscription[],
  plans: Plan[],
  customers: Customer[]
): NegativeMarginCustomer[] {
  if (!costs || costs.length === 0) return []

  const results: NegativeMarginCustomer[] = []
  const planMap = new Map(plans.map(p => [p.plan_id, p]))
  const customerMap = new Map(customers.map(c => [c.customer_id, c]))
  const subMap = new Map(subscriptions.map(s => [s.customer_id, s]))

  // Group costs by customer
  const costsByCustomer = new Map<string, number>()
  costs.forEach(c => {
    const current = costsByCustomer.get(c.customer_id) || 0
    costsByCustomer.set(c.customer_id, current + c.amount)
  })

  costsByCustomer.forEach((totalCost, customerId) => {
    const customer = customerMap.get(customerId)
    const sub = subMap.get(customerId)
    if (!sub || !sub.is_active) return

    const plan = planMap.get(sub.plan_id)
    if (!plan) return

    const intervalMonths = plan.interval_months || 1
    const mrr = plan.price_amount / intervalMonths
    const margin = mrr - totalCost

    if (margin < 0) {
      const customerName = customer?.name || customer?.email || customerId
      results.push({
        customer: customerName,
        customerId,
        plan: plan.name,
        mrr: formatCurrency(mrr),
        costs: formatCurrency(totalCost),
        margin: formatCurrency(margin),
        reason: totalCost > mrr * 2 ? 'Extremely high API/infra costs' : 'Costs exceed revenue',
      })
    }
  })

  return results.sort((a, b) => {
    const marginA = parseFloat(a.margin.replace(/[$,K]/g, ''))
    const marginB = parseFloat(b.margin.replace(/[$,K]/g, ''))
    return marginA - marginB
  }).slice(0, 10)
}

// =============================================================================
// MAIN ANALYSIS FUNCTION
// =============================================================================

export function analyzeData(data: AnalyzerData): AnalysisResult {
  const { customers, plans, subscriptions, invoices, usage, costs } = data

  // Calculate core metrics
  const mrr = calculateMRR(subscriptions, plans)
  const arr = mrr * 12
  const activeCustomers = new Set(
    subscriptions.filter(s => s.is_active).map(s => s.customer_id)
  ).size
  const arpu = activeCustomers > 0 ? mrr / activeCustomers : 0

  // MRR movement
  const mrrMovement = calculateMRRMovement(subscriptions, plans)

  // NRR calculation (simplified - would need historical data for accuracy)
  const previousMRR = mrr - mrrMovement.netNew
  const nrr = previousMRR > 0 ? ((mrr - mrrMovement.new) / previousMRR) * 100 : 100

  // MRR growth
  const mrrGrowth = previousMRR > 0 ? ((mrr - previousMRR) / previousMRR) * 100 : 0

  // Average LTV (assuming 90% retention = ~10 month lifespan)
  const avgLTV = arpu * 10

  const saasMetrics: SaaSMetrics = {
    mrr,
    arr,
    customerCount: activeCustomers,
    arpu,
    nrr: Math.round(nrr),
    avgLTV,
    mrrGrowth: Math.round(mrrGrowth * 10) / 10,
    mrrMovement,
    formatted: {
      mrr: formatCurrency(mrr),
      arr: formatCurrency(arr),
      arpu: formatCurrency(arpu),
      avgLTV: formatCurrency(avgLTV),
      newMRR: formatCurrency(mrrMovement.new),
      expansionMRR: formatCurrency(mrrMovement.expansion),
      contractionMRR: formatCurrency(mrrMovement.contraction),
      churnedMRR: formatCurrency(mrrMovement.churned),
      netNewMRR: formatCurrency(mrrMovement.netNew),
    },
  }

  return {
    saasMetrics,
    planHealth: calculatePlanHealth(subscriptions, plans, customers, usage, costs),
    priceExperiments: generatePriceExperiments(subscriptions, plans, customers),
    bundlingOpportunities: generateBundlingOpportunities(subscriptions, plans),
    usageAnomalies: analyzeUsageAnomalies(usage || [], subscriptions, plans, customers),
    negativeMarginCustomers: analyzeNegativeMargins(costs || [], subscriptions, plans, customers),
    cohorts: calculateCohorts(customers, subscriptions, plans),
    meta: {
      customerCount: customers.length,
      planCount: plans.length,
      subscriptionCount: subscriptions.length,
      hasUsageData: (usage?.length || 0) > 0,
      hasCostData: (costs?.length || 0) > 0,
      hasInvoiceData: (invoices?.length || 0) > 0,
    },
  }
}
