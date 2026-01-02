// Simulation Engine - Core calculation logic
// Runs margin simulations with different pricing models

import type {
  SimulationInput,
  SimulationResult,
  PricingModelConfig,
  CustomerMargin,
  ModelCost,
  MonthlyProjection,
  DataSourceSummary,
  PricingRecommendation,
  SimulationSummary,
  SimulationAssumptions,
} from './types.ts'

export function runSimulationEngine(
  input: SimulationInput,
  pricingModel: PricingModelConfig,
  dataSources: DataSourceSummary[]
): SimulationResult {
  const { usageData, billingData, dateRange } = input

  // 1. Calculate current metrics from historical data
  const currentMetrics = calculateCurrentMetrics(usageData, billingData)

  // 2. Calculate per-customer margins
  const customerBreakdown = calculateCustomerMargins(usageData, billingData, currentMetrics)

  // 3. Calculate model breakdown
  const modelBreakdown = calculateModelBreakdown(usageData, currentMetrics.totalCost)

  // 4. Generate 12-month projections
  const monthlyData = generateMonthlyProjections(currentMetrics, pricingModel)

  // 5. Calculate pricing recommendations
  const recommendations = calculateRecommendations(currentMetrics)

  // 6. Calculate summary totals from projections
  const summary = calculateSummary(monthlyData, pricingModel, customerBreakdown)

  // 7. Build assumptions
  const assumptions: SimulationAssumptions = {
    growthRate: pricingModel.growthRate,
    dataSources,
    dateRange,
    simulatedAt: new Date().toISOString(),
  }

  return {
    summary,
    monthlyData,
    customerBreakdown,
    modelBreakdown,
    recommendations,
    assumptions,
  }
}

interface CurrentMetrics {
  totalRevenue: number
  totalCost: number
  totalTokens: number
  currentMargin: number
  customerCount: number
  avgRevenuePerCustomer: number
  avgCostPerCustomer: number
  avgUsagePerCustomer: number
}

function calculateCurrentMetrics(
  usageData: SimulationInput['usageData'],
  billingData: SimulationInput['billingData']
): CurrentMetrics {
  // Calculate total costs from usage
  const totalCost = usageData.reduce((sum, r) => sum + r.costUsd, 0)
  const totalTokens = usageData.reduce((sum, r) => sum + r.totalTokens, 0)

  // Calculate total revenue from billing
  const totalRevenue = billingData
    .filter((r) => r.status === 'paid')
    .reduce((sum, r) => sum + r.amount, 0)

  // Calculate current margin
  const currentMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0

  // Count unique customers
  const uniqueCustomers = new Set([
    ...billingData.map((r) => r.customerId || r.customerEmail),
    ...usageData.map((r) => r.customerId || r.customerEmail),
  ].filter(Boolean))

  const customerCount = uniqueCustomers.size || 1

  return {
    totalRevenue,
    totalCost,
    totalTokens,
    currentMargin,
    customerCount,
    avgRevenuePerCustomer: totalRevenue / customerCount,
    avgCostPerCustomer: totalCost / customerCount,
    avgUsagePerCustomer: totalTokens / customerCount,
  }
}

function calculateCustomerMargins(
  usageData: SimulationInput['usageData'],
  billingData: SimulationInput['billingData'],
  metrics: CurrentMetrics
): CustomerMargin[] {
  // Group revenue by customer
  const customerRevenue: Record<string, { revenue: number; email?: string; name?: string }> = {}
  billingData
    .filter((r) => r.status === 'paid')
    .forEach((r) => {
      const key = r.customerId || r.customerEmail || 'unknown'
      if (!customerRevenue[key]) {
        customerRevenue[key] = { revenue: 0, email: r.customerEmail }
      }
      customerRevenue[key].revenue += r.amount
    })

  // Group costs by customer (if available) or estimate proportionally
  const customerCosts: Record<string, number> = {}
  usageData.forEach((r) => {
    const key = r.customerId || r.customerEmail || 'unknown'
    customerCosts[key] = (customerCosts[key] || 0) + r.costUsd
  })

  // Calculate per-customer margins
  const customers: CustomerMargin[] = Object.entries(customerRevenue).map(([customerId, data]) => {
    const revenue = data.revenue
    // Use actual cost if available, otherwise estimate proportionally
    const cost =
      customerCosts[customerId] ||
      (metrics.totalRevenue > 0 ? (revenue / metrics.totalRevenue) * metrics.totalCost : 0)

    const margin = revenue - cost
    const marginPercent = revenue > 0 ? (margin / revenue) * 100 : 0

    return {
      customerId,
      customerEmail: data.email,
      customerName: data.name,
      revenue,
      cost,
      margin,
      marginPercent,
      profitable: margin > 0,
    }
  })

  // Sort by margin (lowest first to highlight at-risk customers)
  return customers.sort((a, b) => a.marginPercent - b.marginPercent)
}

function calculateModelBreakdown(
  usageData: SimulationInput['usageData'],
  totalCost: number
): ModelCost[] {
  // Group by model/cost_type
  const modelCosts: Record<string, { tokens: number; cost: number }> = {}
  usageData.forEach((r) => {
    const model = r.model || 'unknown'
    if (!modelCosts[model]) {
      modelCosts[model] = { tokens: 0, cost: 0 }
    }
    modelCosts[model].tokens += r.totalTokens
    modelCosts[model].cost += r.costUsd
  })

  return Object.entries(modelCosts)
    .map(([model, data]) => ({
      model,
      tokens: data.tokens,
      cost: data.cost,
      percentOfTotal: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
    }))
    .sort((a, b) => b.cost - a.cost)
}

function generateMonthlyProjections(
  metrics: CurrentMetrics,
  pricingModel: PricingModelConfig
): MonthlyProjection[] {
  const months: MonthlyProjection[] = []
  const growthRate = pricingModel.growthRate

  // Base values (monthly averages from current data)
  const baseCustomers = metrics.customerCount
  const baseUsage = metrics.totalTokens
  const baseCost = metrics.totalCost

  // Starting date for projections
  const startDate = new Date()

  for (let i = 0; i < 12; i++) {
    const growthFactor = Math.pow(1 + growthRate, i)
    const monthDate = new Date(startDate)
    monthDate.setMonth(startDate.getMonth() + i)

    const projectedCustomers = Math.floor(baseCustomers * growthFactor)
    const projectedUsage = Math.floor(baseUsage * growthFactor)
    const projectedCost = baseCost * growthFactor * 0.9 // Assume some economies of scale

    // Calculate revenue based on pricing model
    let projectedRevenue = 0

    switch (pricingModel.type) {
      case 'per_seat':
        projectedRevenue = projectedCustomers * (pricingModel.seatPrice || 50)
        break

      case 'usage_based': {
        const freeTier = pricingModel.freeTier || 0
        const billedUsage = Math.max(0, projectedUsage - freeTier * projectedCustomers)
        projectedRevenue = billedUsage * (pricingModel.usagePricePerUnit || 0.01)
        break
      }

      case 'hybrid': {
        const seatRevenue = projectedCustomers * (pricingModel.seatPrice || 50)
        const freeTier = pricingModel.freeTier || 0
        const billedUsage = Math.max(0, projectedUsage - freeTier * projectedCustomers)
        const usageRevenue = billedUsage * (pricingModel.usagePricePerUnit || 0.01)
        projectedRevenue = seatRevenue + usageRevenue
        break
      }

      case 'flat_rate':
        projectedRevenue = projectedCustomers * (pricingModel.monthlyFee || 100)
        break

      default:
        // Default to current implied pricing
        projectedRevenue = metrics.avgRevenuePerCustomer * projectedCustomers
    }

    // Adjust for billing period
    if (pricingModel.billingPeriod === 'quarterly') {
      projectedRevenue = projectedRevenue * 3
      if (i % 3 !== 0) projectedRevenue = 0 // Only recognize quarterly
    } else if (pricingModel.billingPeriod === 'annual') {
      if (i === 0) {
        projectedRevenue = projectedRevenue * 12
      } else {
        projectedRevenue = 0 // Annual recognized upfront
      }
    }

    const margin = projectedRevenue - projectedCost
    const marginPercent = projectedRevenue > 0 ? (margin / projectedRevenue) * 100 : 0

    months.push({
      month: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`,
      monthLabel: `Month ${i + 1}`,
      revenue: Math.round(projectedRevenue * 100) / 100,
      cost: Math.round(projectedCost * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      marginPercent: Math.round(marginPercent * 100) / 100,
      customers: projectedCustomers,
      usage: projectedUsage,
      projectedGrowth: i === 0 ? 0 : growthRate,
    })
  }

  return months
}

function calculateRecommendations(metrics: CurrentMetrics): PricingRecommendation {
  const { totalCost, totalTokens, totalRevenue } = metrics

  // Break-even price per token (in dollars per million tokens)
  const breakEvenPrice = totalTokens > 0 ? (totalCost / totalTokens) * 1000000 : 0

  // Current implied price
  const currentImpliedPrice = totalTokens > 0 ? (totalRevenue / totalTokens) * 1000000 : 0

  // Recommended prices for target margins
  const costPerMillionTokens = breakEvenPrice

  return {
    breakEvenPrice: Math.round(breakEvenPrice * 100) / 100,
    currentImpliedPrice: Math.round(currentImpliedPrice * 100) / 100,
    recommendedPriceFor20Percent: Math.round((costPerMillionTokens / 0.8) * 100) / 100,
    recommendedPriceFor30Percent: Math.round((costPerMillionTokens / 0.7) * 100) / 100,
    recommendedPriceFor40Percent: Math.round((costPerMillionTokens / 0.6) * 100) / 100,
    recommendedPriceFor50Percent: Math.round((costPerMillionTokens / 0.5) * 100) / 100,
  }
}

function calculateSummary(
  monthlyData: MonthlyProjection[],
  pricingModel: PricingModelConfig,
  customerBreakdown: CustomerMargin[]
): SimulationSummary {
  const totalRevenue = monthlyData.reduce((sum, m) => sum + m.revenue, 0)
  const totalCost = monthlyData.reduce((sum, m) => sum + m.cost, 0)
  const totalMargin = totalRevenue - totalCost
  const avgMarginPercent = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0

  const totalTokens = monthlyData.reduce((sum, m) => sum + m.usage, 0)
  const customerCount = customerBreakdown.length
  const profitableCustomers = customerBreakdown.filter((c) => c.profitable).length
  const unprofitableCustomers = customerBreakdown.filter((c) => !c.profitable).length

  // Format pricing model label
  const pricingModelLabels: Record<string, string> = {
    per_seat: 'Per Seat',
    usage_based: 'Usage Based',
    hybrid: 'Hybrid',
    flat_rate: 'Flat Rate',
  }

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    totalMargin: Math.round(totalMargin * 100) / 100,
    avgMarginPercent: Math.round(avgMarginPercent * 100) / 100,
    customerCount,
    profitableCustomers,
    unprofitableCustomers,
    totalTokens,
    pricingModel: pricingModelLabels[pricingModel.type] || pricingModel.type,
    billingPeriod: pricingModel.billingPeriod.charAt(0).toUpperCase() + pricingModel.billingPeriod.slice(1),
  }
}
