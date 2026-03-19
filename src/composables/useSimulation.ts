import { ref, computed } from 'vue'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import * as api from '@/lib/api'
import type {
  SimulationRequest,
  SimulationResult,
  SimulationProgress,
  PricingModelConfig,
  SimulationSummary,
  MonthlyProjection,
  CustomerMargin,
  ModelCost,
  PricingRecommendation,
  SimulationAssumptions,
} from '@/types/simulation'

export function useSimulation() {
  const queryClient = useQueryClient()

  const simulationProgress = ref<SimulationProgress>('idle')
  const currentResults = ref<SimulationResult | null>(null)

  async function computeSimulationLocally(pricingModel: PricingModelConfig): Promise<SimulationResult> {
    simulationProgress.value = 'fetching'

    const data = await api.fetchAnalyzerData()

    simulationProgress.value = 'calculating'

    const now = new Date()
    const months: MonthlyProjection[] = []

    const customers = data?.customers ?? []
    const subscriptions = data?.subscriptions ?? []
    const costs = data?.costs ?? []
    const usage = data?.usage ?? []

    const totalMrr = subscriptions.reduce((sum: number, s: { amount?: number; mrr?: number }) => {
      return sum + (s.mrr ?? s.amount ?? 0)
    }, 0)

    const totalCostRaw = costs.reduce((sum: number, c: { cost?: number; amount?: number }) => {
      return sum + (c.cost ?? c.amount ?? 0)
    }, 0)

    const customerCount = customers.length || subscriptions.length || 1
    const growthRate = pricingModel.growthRate ?? 0.05

    const totalRevenue = totalMrr * 6
    const totalCost = totalCostRaw || totalRevenue * 0.6
    const totalMargin = totalRevenue - totalCost
    const avgMarginPercent = totalRevenue > 0 ? Math.round((totalMargin / totalRevenue) * 100) : 0

    for (let i = 0; i < 6; i++) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
      const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`
      const label = monthDate.toLocaleString('default', { month: 'short', year: '2-digit' })
      const growth = Math.pow(1 + growthRate, i)
      const rev = totalMrr * growth
      const cost = (totalCost / 6) * growth
      const margin = rev - cost

      months.push({
        month: monthKey,
        monthLabel: label,
        revenue: Math.round(rev),
        cost: Math.round(cost),
        margin: Math.round(margin),
        marginPercent: rev > 0 ? Math.round((margin / rev) * 100) : 0,
        customers: Math.round(customerCount * growth),
        usage: usage.length > 0 ? Math.round((usage.length / 6) * growth) : 0,
        projectedGrowth: Math.round(growthRate * 100),
      })
    }

    const customerBreakdown: CustomerMargin[] = customers.slice(0, 20).map((c: { id?: string; customer_id?: string; email?: string; name?: string }) => {
      const sub = subscriptions.find((s: { customer_id?: string }) => s.customer_id === (c.id ?? c.customer_id))
      const rev = (sub as { mrr?: number; amount?: number } | undefined)?.mrr ?? (sub as { mrr?: number; amount?: number } | undefined)?.amount ?? totalMrr / customerCount
      const cost = totalCost / customerCount
      const margin = rev - cost
      return {
        customerId: String(c.id ?? c.customer_id ?? ''),
        customerName: (c as { name?: string }).name,
        customerEmail: c.email,
        revenue: Math.round(rev),
        cost: Math.round(cost),
        margin: Math.round(margin),
        marginPercent: rev > 0 ? Math.round((margin / rev) * 100) : 0,
        profitable: margin > 0,
      }
    })

    const modelBreakdown: ModelCost[] = []
    const totalTokens = usage.reduce((sum: number, u: { total_tokens?: number; tokens?: number }) => sum + (u.total_tokens ?? u.tokens ?? 0), 0)
    if (totalTokens > 0) {
      modelBreakdown.push({
        model: 'gpt-4',
        tokens: totalTokens,
        cost: totalCost,
        percentOfTotal: 100,
      })
    }

    const breakEven = customerCount > 0 ? totalCost / customerCount : 0
    const currentImplied = customerCount > 0 ? totalRevenue / customerCount / 6 : 0

    const recommendations: PricingRecommendation = {
      breakEvenPrice: Math.round(breakEven / 6),
      currentImpliedPrice: Math.round(currentImplied),
      recommendedPriceFor20Percent: Math.round(currentImplied * 1.25),
      recommendedPriceFor30Percent: Math.round(currentImplied * 1.43),
      recommendedPriceFor40Percent: Math.round(currentImplied * 1.67),
      recommendedPriceFor50Percent: Math.round(currentImplied * 2),
    }

    const assumptions: SimulationAssumptions = {
      growthRate,
      dataSources: [],
      dateRange: {
        start: months[0]?.month ?? '',
        end: months[months.length - 1]?.month ?? '',
      },
      simulatedAt: now.toISOString(),
    }

    const summary: SimulationSummary = {
      totalRevenue: Math.round(totalRevenue),
      totalCost: Math.round(totalCost),
      totalMargin: Math.round(totalMargin),
      avgMarginPercent,
      customerCount,
      profitableCustomers: customerBreakdown.filter(c => c.profitable).length,
      unprofitableCustomers: customerBreakdown.filter(c => !c.profitable).length,
      totalTokens,
      pricingModel: pricingModel.type,
      billingPeriod: pricingModel.billingPeriod,
    }

    simulationProgress.value = 'idle'

    return {
      summary,
      monthlyData: months,
      customerBreakdown,
      modelBreakdown,
      recommendations,
      assumptions,
    }
  }

  const runSimulationMutation = useMutation({
    mutationFn: async (request: SimulationRequest): Promise<SimulationResult> => {
      return computeSimulationLocally(request.pricingModel)
    },
    onSuccess: (results) => {
      currentResults.value = results
      queryClient.invalidateQueries({ queryKey: ['scenarios'] })
    },
    onError: () => {
      simulationProgress.value = 'idle'
    },
  })

  const runSimulationPreviewMutation = useMutation({
    mutationFn: async (config: { pricingModel: PricingModelConfig }): Promise<SimulationResult> => {
      return computeSimulationLocally(config.pricingModel)
    },
    onSuccess: (results) => {
      currentResults.value = results
    },
    onError: () => {
      simulationProgress.value = 'idle'
    },
  })

  async function rerunSimulation(_scenarioId: string): Promise<SimulationResult> {
    return computeSimulationLocally({
      type: 'flat_rate',
      billingPeriod: 'monthly',
      growthRate: 0.05,
    })
  }

  function clearResults() {
    currentResults.value = null
    simulationProgress.value = 'idle'
  }

  const progressMessage = computed(() => {
    switch (simulationProgress.value) {
      case 'fetching':
        return 'Fetching your data...'
      case 'calculating':
        return 'Running simulation engine...'
      case 'saving':
        return 'Saving results...'
      default:
        return ''
    }
  })

  return {
    simulationProgress,
    currentResults,
    progressMessage,
    isRunning: computed(
      () =>
        runSimulationMutation.isPending.value ||
        runSimulationPreviewMutation.isPending.value
    ),
    error: computed(
      () => runSimulationMutation.error.value || runSimulationPreviewMutation.error.value
    ),
    runSimulation: runSimulationMutation.mutate,
    runSimulationAsync: runSimulationMutation.mutateAsync,
    runPreview: runSimulationPreviewMutation.mutate,
    runPreviewAsync: runSimulationPreviewMutation.mutateAsync,
    rerunSimulation,
    clearResults,
  }
}
