/**
 * Stripe Data Analyzer with Claude AI
 *
 * This module provides AI-powered analysis of Stripe subscription data.
 * It uses an optimized prompt to extract insights about:
 * - Pricing optimization opportunities
 * - Customer segmentation
 * - Usage patterns and correlation with revenue
 * - Metadata-based insights
 * - Churn risk and expansion opportunities
 */

import type {
  EnhancedSyncResult,
  ClaudeAnalysisResult,
  PricingInsight,
  CustomerSegmentAnalysis,
  UsagePatternAnalysis,
} from '@/api/client'

const API_BASE = '/api'

// =============================================================================
// OPTIMIZED CLAUDE PROMPT FOR STRIPE ANALYSIS
// =============================================================================

/**
 * Generate an optimized prompt for Claude to analyze Stripe data
 */
export function generateStripeAnalysisPrompt(
  data: EnhancedSyncResult,
  focusAreas?: string[]
): string {
  const { summary, customers, subscriptions, invoices, usage, products, prices } = data

  // Build context about the data
  const dataContext = buildDataContext(data)

  // Build specific analysis sections
  const metadataContext = buildMetadataContext(customers, subscriptions)
  const usageContext = buildUsageContext(usage, subscriptions)
  const pricingContext = buildPricingContext(prices, products, subscriptions)
  const invoiceContext = buildInvoiceContext(invoices)

  const focusSection = focusAreas?.length
    ? `\n## Focus Areas\nPlease pay special attention to: ${focusAreas.join(', ')}`
    : ''

  return `You are an expert SaaS pricing and revenue analyst. Analyze the following Stripe subscription data and provide actionable insights.

## Business Context
${dataContext}

## Customer Metadata Patterns
${metadataContext}

## Usage Data
${usageContext}

## Pricing Structure
${pricingContext}

## Invoice History
${invoiceContext}
${focusSection}

## Analysis Requirements

Provide your analysis in the following JSON structure. Be specific, data-driven, and actionable.

{
  "health_score": <number 0-100 based on overall subscription health>,
  "key_metrics": {
    "mrr": ${summary.total_mrr},
    "arr": ${summary.total_arr},
    "customer_count": ${summary.total_customers},
    "avg_revenue_per_customer": ${summary.average_revenue_per_customer.toFixed(2)},
    "churn_rate": <calculated from data>,
    "growth_rate": <estimated from invoice history>
  },
  "top_insights": [
    <3-5 most important insights as strings>
  ],
  "pricing_insights": [
    {
      "type": "opportunity" | "risk" | "observation",
      "category": "pricing" | "packaging" | "discounting" | "billing",
      "title": "<short title>",
      "description": "<detailed description>",
      "impact": "high" | "medium" | "low",
      "affected_customers": <number>,
      "potential_revenue_impact": <dollar amount>,
      "recommended_action": "<specific action>"
    }
  ],
  "segment_analysis": [
    {
      "segment": "<segment name based on metadata or MRR>",
      "customer_count": <number>,
      "total_mrr": <number>,
      "avg_mrr": <number>,
      "churn_rate": <percentage>,
      "growth_rate": <percentage>,
      "top_products": [<product names>],
      "common_metadata": {<key>: [<common values>]},
      "insights": [<segment-specific insights>]
    }
  ],
  "usage_analysis": [
    {
      "metric": "<usage metric name>",
      "total_usage": <number>,
      "avg_usage_per_customer": <number>,
      "high_usage_customers": [<customer IDs>],
      "low_usage_customers": [<customer IDs>],
      "usage_trend": "increasing" | "decreasing" | "stable",
      "correlation_with_revenue": <-1 to 1>,
      "insights": [<usage-specific insights>]
    }
  ],
  "metadata_insights": {
    "common_keys": [<most used metadata keys>],
    "valuable_patterns": [<patterns that correlate with revenue or retention>],
    "segmentation_opportunities": [<ways to segment using metadata>]
  },
  "recommendations": {
    "immediate_actions": [<actions for next 30 days>],
    "short_term_improvements": [<actions for next quarter>],
    "strategic_initiatives": [<longer-term strategic changes>]
  }
}

Important guidelines:
1. Base all insights on the actual data provided
2. Calculate churn rate from canceled vs total subscriptions
3. Identify underpriced customers (high usage, low revenue)
4. Identify expansion opportunities (active customers with room to grow)
5. Look for discount abuse or inconsistent pricing
6. Analyze metadata for segmentation opportunities
7. Correlate usage patterns with revenue and retention
8. Identify at-risk customers (high usage drop, payment failures)
9. Suggest specific pricing experiments based on data
10. Consider billing frequency optimization

Return ONLY the JSON object, no additional text.`
}

/**
 * Build general data context
 */
function buildDataContext(data: EnhancedSyncResult): string {
  const { summary, customers, subscriptions } = data

  const activeCustomers = customers.filter(c => c.subscription_count > 0).length
  const avgSubscriptionsPerCustomer = activeCustomers > 0
    ? subscriptions.filter(s => s.status === 'active').length / activeCustomers
    : 0

  const canceledLast30Days = subscriptions.filter(s => {
    if (!s.canceled_at) return false
    const cancelDate = new Date(s.canceled_at)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    return cancelDate >= thirtyDaysAgo
  }).length

  const trialingCustomers = subscriptions.filter(s => s.status === 'trialing').length

  return `
- Total Customers: ${summary.total_customers}
- Active Customers (with subscriptions): ${activeCustomers}
- Total MRR: $${summary.total_mrr.toFixed(2)}
- Total ARR: $${summary.total_arr.toFixed(2)}
- Active Subscriptions: ${summary.active_subscriptions}
- Churned Subscriptions: ${summary.churned_subscriptions}
- Trialing Subscriptions: ${trialingCustomers}
- Avg Subscriptions per Customer: ${avgSubscriptionsPerCustomer.toFixed(2)}
- Avg Revenue per Customer: $${summary.average_revenue_per_customer.toFixed(2)}
- Total Revenue (all time): $${summary.total_revenue.toFixed(2)}
- Paid Invoices: ${summary.total_invoices_paid}
- Cancellations (last 30 days): ${canceledLast30Days}
`
}

/**
 * Build metadata context for analysis
 */
function buildMetadataContext(
  customers: EnhancedSyncResult['customers'],
  subscriptions: EnhancedSyncResult['subscriptions']
): string {
  // Collect all metadata keys and their frequency
  const customerMetadataKeys = new Map<string, number>()
  const subscriptionMetadataKeys = new Map<string, number>()

  for (const customer of customers) {
    for (const key of Object.keys(customer.metadata)) {
      customerMetadataKeys.set(key, (customerMetadataKeys.get(key) || 0) + 1)
    }
  }

  for (const subscription of subscriptions) {
    for (const key of Object.keys(subscription.metadata)) {
      subscriptionMetadataKeys.set(key, (subscriptionMetadataKeys.get(key) || 0) + 1)
    }
  }

  // Get sample values for top metadata keys
  const topCustomerKeys = [...customerMetadataKeys.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  const topSubscriptionKeys = [...subscriptionMetadataKeys.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  // Build sample metadata entries
  const customerSamples = customers.slice(0, 5).map(c => ({
    id: c.id,
    segment: c.segment,
    mrr: customers.length > 0 ? c.total_spend / Math.max(1, monthsSinceCreation(c.created)) : 0,
    metadata: c.metadata,
  }))

  return `
### Customer Metadata Keys (frequency):
${topCustomerKeys.map(([key, count]) => `- ${key}: ${count} customers`).join('\n') || 'No metadata found'}

### Subscription Metadata Keys (frequency):
${topSubscriptionKeys.map(([key, count]) => `- ${key}: ${count} subscriptions`).join('\n') || 'No metadata found'}

### Sample Customer Metadata:
${JSON.stringify(customerSamples, null, 2)}
`
}

/**
 * Calculate months since a date
 */
function monthsSinceCreation(dateStr: string): number {
  const created = new Date(dateStr)
  const now = new Date()
  const months = (now.getFullYear() - created.getFullYear()) * 12 +
    (now.getMonth() - created.getMonth())
  return Math.max(1, months)
}

/**
 * Build usage context for analysis
 */
function buildUsageContext(
  usage: EnhancedSyncResult['usage'],
  subscriptions: EnhancedSyncResult['subscriptions']
): string {
  if (usage.length === 0) {
    return 'No metered usage data available. All subscriptions use licensed (fixed) billing.'
  }

  // Group usage by metric
  const usageByMetric = new Map<string, {
    total: number
    customers: Set<string>
    records: typeof usage
  }>()

  for (const record of usage) {
    const existing = usageByMetric.get(record.metric) || {
      total: 0,
      customers: new Set<string>(),
      records: [],
    }
    existing.total += record.total_usage
    existing.customers.add(record.customer_id)
    existing.records.push(record)
    usageByMetric.set(record.metric, existing)
  }

  // Find metered subscriptions
  const meteredSubscriptions = subscriptions.filter(s =>
    s.items.some(i => i.usage_type === 'metered')
  )

  const usageSummary = [...usageByMetric.entries()].map(([metric, data]) => ({
    metric,
    totalUsage: data.total,
    uniqueCustomers: data.customers.size,
    avgPerCustomer: data.total / data.customers.size,
  }))

  return `
### Metered Billing Summary:
- Subscriptions with metered billing: ${meteredSubscriptions.length}
- Usage metrics tracked: ${usageByMetric.size}

### Usage by Metric:
${usageSummary.map(u => `
- ${u.metric}:
  - Total Usage: ${u.totalUsage.toLocaleString()}
  - Unique Customers: ${u.uniqueCustomers}
  - Avg per Customer: ${u.avgPerCustomer.toFixed(2)}
`).join('')}

### High Usage Customers (sample):
${usage.slice(0, 10).map(u => `- ${u.customer_id}: ${u.total_usage} ${u.metric}`).join('\n')}
`
}

/**
 * Build pricing context for analysis
 */
function buildPricingContext(
  prices: EnhancedSyncResult['prices'],
  products: EnhancedSyncResult['products'],
  subscriptions: EnhancedSyncResult['subscriptions']
): string {
  // Group subscriptions by price to understand popularity
  const pricePopularity = new Map<string, number>()
  for (const sub of subscriptions) {
    for (const item of sub.items) {
      pricePopularity.set(item.price_id, (pricePopularity.get(item.price_id) || 0) + 1)
    }
  }

  // Build product/price tree
  const productMap = new Map(products.map(p => [p.id, p]))

  const pricingTree = prices.map(price => {
    const product = productMap.get(price.product_id)
    return {
      product: product?.name || price.product_id,
      priceId: price.id,
      amount: price.unit_amount ? `$${(price.unit_amount / 100).toFixed(2)}` : 'Custom',
      interval: price.recurring_interval || 'one-time',
      usageType: price.usage_type || 'licensed',
      subscribers: pricePopularity.get(price.id) || 0,
      nickname: price.nickname,
    }
  }).sort((a, b) => b.subscribers - a.subscribers)

  // Calculate discount statistics
  const discountedSubs = subscriptions.filter(s => s.discount_percent || s.discount_amount)
  const avgDiscountPercent = discountedSubs.length > 0
    ? discountedSubs.reduce((sum, s) => sum + (s.discount_percent || 0), 0) / discountedSubs.length
    : 0

  return `
### Products and Prices:
${pricingTree.slice(0, 20).map(p => `
- ${p.product} (${p.nickname || p.priceId}):
  - Price: ${p.amount}/${p.interval}
  - Billing: ${p.usageType}
  - Active Subscribers: ${p.subscribers}
`).join('')}

### Discounting:
- Subscriptions with Discounts: ${discountedSubs.length} (${((discountedSubs.length / subscriptions.length) * 100).toFixed(1)}%)
- Average Discount: ${avgDiscountPercent.toFixed(1)}%
`
}

/**
 * Build invoice context for analysis
 */
function buildInvoiceContext(invoices: EnhancedSyncResult['invoices']): string {
  // Group invoices by month
  const invoicesByMonth = new Map<string, {
    count: number
    total: number
    paid: number
    failed: number
  }>()

  for (const invoice of invoices) {
    const date = new Date(invoice.created)
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

    const existing = invoicesByMonth.get(monthKey) || {
      count: 0,
      total: 0,
      paid: 0,
      failed: 0,
    }

    existing.count++
    existing.total += invoice.total
    if (invoice.status === 'paid') {
      existing.paid++
    } else if (invoice.status === 'open' || invoice.status === 'uncollectible') {
      existing.failed++
    }

    invoicesByMonth.set(monthKey, existing)
  }

  // Get last 6 months
  const sortedMonths = [...invoicesByMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)

  const failedInvoices = invoices.filter(i =>
    i.status === 'uncollectible' || (i.status === 'open' && i.attempt_count > 1)
  )

  return `
### Invoice History (last 6 months):
${sortedMonths.map(([month, data]) => `
- ${month}:
  - Invoices: ${data.count}
  - Revenue: $${data.total.toFixed(2)}
  - Success Rate: ${((data.paid / data.count) * 100).toFixed(1)}%
`).join('')}

### Payment Issues:
- Failed/Uncollectible Invoices: ${failedInvoices.length}
- Total at Risk: $${failedInvoices.reduce((sum, i) => sum + i.amount_remaining, 0).toFixed(2)}
`
}

// =============================================================================
// ANALYSIS EXECUTION
// =============================================================================

/**
 * Parse Claude's response into structured analysis result
 */
export function parseClaudeResponse(response: string): Partial<ClaudeAnalysisResult> {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }

    const parsed = JSON.parse(jsonMatch[0])

    return {
      success: true,
      generated_at: new Date().toISOString(),
      summary: {
        health_score: parsed.health_score || 0,
        key_metrics: parsed.key_metrics || {},
        top_insights: parsed.top_insights || [],
      },
      pricing_insights: parsed.pricing_insights || [],
      segment_analysis: parsed.segment_analysis || [],
      usage_analysis: parsed.usage_analysis || [],
      metadata_insights: parsed.metadata_insights || {
        common_keys: [],
        valuable_patterns: [],
        segmentation_opportunities: [],
      },
      recommendations: parsed.recommendations || {
        immediate_actions: [],
        short_term_improvements: [],
        strategic_initiatives: [],
      },
      raw_analysis: response,
    }
  } catch {
    return {
      success: false,
      generated_at: new Date().toISOString(),
      summary: {
        health_score: 0,
        key_metrics: {
          mrr: 0,
          arr: 0,
          customer_count: 0,
          avg_revenue_per_customer: 0,
          churn_rate: 0,
          growth_rate: 0,
        },
        top_insights: ['Failed to parse analysis response'],
      },
      pricing_insights: [],
      segment_analysis: [],
      usage_analysis: [],
      metadata_insights: {
        common_keys: [],
        valuable_patterns: [],
        segmentation_opportunities: [],
      },
      recommendations: {
        immediate_actions: [],
        short_term_improvements: [],
        strategic_initiatives: [],
      },
      raw_analysis: response,
    }
  }
}

/**
 * Run Claude analysis on Stripe data
 */
export async function analyzeWithClaude(
  data: EnhancedSyncResult,
  focusAreas?: string[]
): Promise<ClaudeAnalysisResult> {
  const prompt = generateStripeAnalysisPrompt(data, focusAreas)

  try {
    const response = await fetch(`${API_BASE}/analytics/claude/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        data_summary: data.summary,
      }),
    })

    if (!response.ok) {
      throw new Error(`Analysis failed: ${response.statusText}`)
    }

    const result = await response.json()

    if (result.analysis) {
      const parsed = parseClaudeResponse(result.analysis)
      return {
        ...parsed,
        success: true,
        generated_at: new Date().toISOString(),
      } as ClaudeAnalysisResult
    }

    return result as ClaudeAnalysisResult
  } catch (error) {
    return {
      success: false,
      generated_at: new Date().toISOString(),
      summary: {
        health_score: 0,
        key_metrics: {
          mrr: data.summary.total_mrr,
          arr: data.summary.total_arr,
          customer_count: data.summary.total_customers,
          avg_revenue_per_customer: data.summary.average_revenue_per_customer,
          churn_rate: 0,
          growth_rate: 0,
        },
        top_insights: [`Analysis error: ${(error as Error).message}`],
      },
      pricing_insights: [],
      segment_analysis: [],
      usage_analysis: [],
      metadata_insights: {
        common_keys: [],
        valuable_patterns: [],
        segmentation_opportunities: [],
      },
      recommendations: {
        immediate_actions: [],
        short_term_improvements: [],
        strategic_initiatives: [],
      },
    }
  }
}

// =============================================================================
// LOCAL ANALYSIS (without Claude API)
// =============================================================================

/**
 * Perform basic analysis locally without Claude API
 * Useful as a fallback or for quick insights
 */
export function performLocalAnalysis(data: EnhancedSyncResult): ClaudeAnalysisResult {
  const { summary, customers, subscriptions, usage } = data

  // Calculate churn rate
  const totalSubs = subscriptions.length
  const canceledSubs = subscriptions.filter(s => s.status === 'canceled').length
  const churnRate = totalSubs > 0 ? (canceledSubs / totalSubs) * 100 : 0

  // Calculate health score
  let healthScore = 100
  if (churnRate > 10) healthScore -= 20
  if (churnRate > 20) healthScore -= 20
  if (summary.active_subscriptions < summary.total_customers * 0.5) healthScore -= 15
  if (summary.average_revenue_per_customer < 50) healthScore -= 10
  healthScore = Math.max(0, healthScore)

  // Generate pricing insights
  const pricingInsights: PricingInsight[] = []

  // Check for high discounting
  const discountedSubs = subscriptions.filter(s => s.discount_percent && s.discount_percent > 20)
  if (discountedSubs.length > subscriptions.length * 0.2) {
    pricingInsights.push({
      type: 'risk',
      category: 'discounting',
      title: 'High Discount Rate',
      description: `${discountedSubs.length} subscriptions (${((discountedSubs.length / subscriptions.length) * 100).toFixed(1)}%) have discounts over 20%`,
      impact: 'high',
      affected_customers: discountedSubs.length,
      recommended_action: 'Review discount policies and consider value-based pricing',
    })
  }

  // Check for pricing tiers opportunity
  const mrrDistribution = subscriptions
    .filter(s => s.status === 'active')
    .map(s => s.mrr)
    .sort((a, b) => a - b)

  if (mrrDistribution.length > 10) {
    const q1Index = Math.floor(mrrDistribution.length * 0.25)
    const q3Index = Math.floor(mrrDistribution.length * 0.75)
    const q1 = mrrDistribution[q1Index] ?? 0
    const q3 = mrrDistribution[q3Index] ?? 0
    const spread = q3 - q1

    if (q1 > 0 && spread > q1 * 2) {
      pricingInsights.push({
        type: 'opportunity',
        category: 'packaging',
        title: 'Pricing Tier Opportunity',
        description: 'Large spread in customer MRR suggests opportunity for more granular pricing tiers',
        impact: 'medium',
        recommended_action: `Consider adding tiers between $${q1.toFixed(0)} and $${q3.toFixed(0)}`,
      })
    }
  }

  // Segment analysis
  const segmentAnalysis: CustomerSegmentAnalysis[] = []
  const segmentGroups = new Map<string, typeof customers>()

  for (const customer of customers) {
    const segment = customer.segment
    if (!segmentGroups.has(segment)) {
      segmentGroups.set(segment, [])
    }
    segmentGroups.get(segment)!.push(customer)
  }

  for (const [segment, segmentCustomers] of segmentGroups) {
    const segmentSubs = subscriptions.filter(s =>
      segmentCustomers.some(c => c.id === s.customer_id) && s.status === 'active'
    )
    const segmentMrr = segmentSubs.reduce((sum, s) => sum + s.mrr, 0)
    const canceledInSegment = subscriptions.filter(s =>
      segmentCustomers.some(c => c.id === s.customer_id) && s.status === 'canceled'
    ).length
    const totalInSegment = subscriptions.filter(s =>
      segmentCustomers.some(c => c.id === s.customer_id)
    ).length

    // Find common metadata
    const metadataFreq = new Map<string, Map<string, number>>()
    for (const customer of segmentCustomers) {
      for (const [key, value] of Object.entries(customer.metadata)) {
        if (!metadataFreq.has(key)) {
          metadataFreq.set(key, new Map())
        }
        const valueMap = metadataFreq.get(key)!
        valueMap.set(value, (valueMap.get(value) || 0) + 1)
      }
    }

    const commonMetadata: Record<string, string[]> = {}
    for (const [key, values] of metadataFreq) {
      const topValues = [...values.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([v]) => v)
      if (topValues.length > 0) {
        commonMetadata[key] = topValues
      }
    }

    segmentAnalysis.push({
      segment,
      customer_count: segmentCustomers.length,
      total_mrr: segmentMrr,
      avg_mrr: segmentCustomers.length > 0 ? segmentMrr / segmentCustomers.length : 0,
      churn_rate: totalInSegment > 0 ? (canceledInSegment / totalInSegment) * 100 : 0,
      growth_rate: 0, // Would need historical data
      top_products: [...new Set(segmentSubs.flatMap(s => s.items.map(i => i.product_name)))].slice(0, 5),
      common_metadata: commonMetadata,
      insights: [],
    })
  }

  // Usage analysis
  const usageAnalysis: UsagePatternAnalysis[] = []
  const usageByMetric = new Map<string, typeof usage>()

  for (const record of usage) {
    if (!usageByMetric.has(record.metric)) {
      usageByMetric.set(record.metric, [])
    }
    usageByMetric.get(record.metric)!.push(record)
  }

  for (const [metric, records] of usageByMetric) {
    const totalUsage = records.reduce((sum, r) => sum + r.total_usage, 0)
    const customerIds = [...new Set(records.map(r => r.customer_id))]
    const avgUsage = customerIds.length > 0 ? totalUsage / customerIds.length : 0

    // Find high and low usage customers
    const usageByCustomer = new Map<string, number>()
    for (const record of records) {
      usageByCustomer.set(
        record.customer_id,
        (usageByCustomer.get(record.customer_id) || 0) + record.total_usage
      )
    }

    const sortedByUsage = [...usageByCustomer.entries()].sort((a, b) => b[1] - a[1])
    const highUsage = sortedByUsage.slice(0, 5).map(([id]) => id)
    const lowUsage = sortedByUsage.slice(-5).map(([id]) => id)

    usageAnalysis.push({
      metric,
      total_usage: totalUsage,
      avg_usage_per_customer: avgUsage,
      high_usage_customers: highUsage,
      low_usage_customers: lowUsage,
      usage_trend: 'stable', // Would need historical data
      correlation_with_revenue: 0, // Would need more analysis
      insights: [],
    })
  }

  // Metadata insights
  const allMetadataKeys = new Map<string, number>()
  for (const customer of customers) {
    for (const key of Object.keys(customer.metadata)) {
      allMetadataKeys.set(key, (allMetadataKeys.get(key) || 0) + 1)
    }
  }
  for (const sub of subscriptions) {
    for (const key of Object.keys(sub.metadata)) {
      allMetadataKeys.set(key, (allMetadataKeys.get(key) || 0) + 1)
    }
  }

  const commonKeys = [...allMetadataKeys.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key]) => key)

  // Generate recommendations
  const immediateActions: string[] = []
  const shortTermImprovements: string[] = []
  const strategicInitiatives: string[] = []

  if (churnRate > 15) {
    immediateActions.push('Investigate high churn rate - consider implementing win-back campaigns')
  }
  if (discountedSubs.length > subscriptions.length * 0.3) {
    immediateActions.push('Audit discount policies to prevent revenue leakage')
  }
  if (usage.length > 0) {
    shortTermImprovements.push('Implement usage-based pricing tiers to capture value from high-usage customers')
  }
  if (segmentAnalysis.some(s => s.churn_rate > 20)) {
    shortTermImprovements.push('Create segment-specific retention programs for high-churn segments')
  }
  if (commonKeys.length > 0) {
    strategicInitiatives.push(`Leverage metadata (${commonKeys.slice(0, 3).join(', ')}) for personalized pricing`)
  }

  // Top insights
  const topInsights: string[] = [
    `MRR: $${summary.total_mrr.toFixed(2)} | ARR: $${summary.total_arr.toFixed(2)}`,
    `Churn rate: ${churnRate.toFixed(1)}% (${canceledSubs} of ${totalSubs} subscriptions)`,
    `Average revenue per customer: $${summary.average_revenue_per_customer.toFixed(2)}`,
  ]

  if (usage.length > 0) {
    topInsights.push(`Metered billing active across ${usageByMetric.size} metrics`)
  }

  if (pricingInsights.length > 0) {
    topInsights.push(`${pricingInsights.length} pricing optimization opportunities identified`)
  }

  return {
    success: true,
    generated_at: new Date().toISOString(),
    summary: {
      health_score: healthScore,
      key_metrics: {
        mrr: summary.total_mrr,
        arr: summary.total_arr,
        customer_count: summary.total_customers,
        avg_revenue_per_customer: summary.average_revenue_per_customer,
        churn_rate: churnRate,
        growth_rate: 0,
      },
      top_insights: topInsights,
    },
    pricing_insights: pricingInsights,
    segment_analysis: segmentAnalysis,
    usage_analysis: usageAnalysis,
    metadata_insights: {
      common_keys: commonKeys,
      valuable_patterns: [],
      segmentation_opportunities: segmentAnalysis.map(s =>
        `${s.segment}: ${s.customer_count} customers, $${s.avg_mrr.toFixed(2)} avg MRR`
      ),
    },
    recommendations: {
      immediate_actions: immediateActions,
      short_term_improvements: shortTermImprovements,
      strategic_initiatives: strategicInitiatives,
    },
  }
}
