/**
 * Composable for Stripe data analysis with Claude AI
 *
 * Provides reactive state management for:
 * - Enhanced Stripe data sync
 * - Claude AI-powered analysis
 * - Local fallback analysis
 */

import { ref, computed } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import {
  syncStripeDataEnhanced,
  getStripeDataSummary,
  type EnhancedSyncResult,
  type ClaudeAnalysisResult,
} from '@/api/client'
import {
  analyzeWithClaude,
  performLocalAnalysis,
} from '@/lib/stripe-claude-analyzer'

// Module-level state for persistence across navigation
const syncedData = ref<EnhancedSyncResult | null>(null)
const analysisResult = ref<ClaudeAnalysisResult | null>(null)
const selectedFocusAreas = ref<string[]>([])

/**
 * Available focus areas for analysis
 */
export const FOCUS_AREAS = [
  { id: 'pricing', label: 'Pricing Optimization', description: 'Identify underpriced customers and pricing gaps' },
  { id: 'churn', label: 'Churn Prevention', description: 'Find at-risk customers and retention opportunities' },
  { id: 'expansion', label: 'Expansion Revenue', description: 'Discover upsell and cross-sell opportunities' },
  { id: 'usage', label: 'Usage Patterns', description: 'Analyze usage-to-revenue correlation' },
  { id: 'segments', label: 'Customer Segments', description: 'Segment analysis and benchmarking' },
  { id: 'discounts', label: 'Discount Analysis', description: 'Review discount effectiveness and abuse' },
] as const

export type FocusAreaId = typeof FOCUS_AREAS[number]['id']

/**
 * Composable for Stripe analysis functionality
 */
export function useStripeAnalysis() {
  const queryClient = useQueryClient()

  // Query for data summary (quick check of what's available)
  const {
    data: dataSummary,
    isLoading: isSummaryLoading,
    error: summaryError,
  } = useQuery({
    queryKey: ['stripe-data-summary'],
    queryFn: getStripeDataSummary,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  })

  // Mutation for full data sync
  const syncMutation = useMutation({
    mutationFn: syncStripeDataEnhanced,
    onSuccess: (data) => {
      syncedData.value = data
      queryClient.invalidateQueries({ queryKey: ['stripe-data-summary'] })
      toast.success('Stripe data synced!', {
        description: `Imported ${data.customers.length} customers, ${data.subscriptions.length} subscriptions`,
      })
    },
    onError: (error) => {
      toast.error('Sync failed', {
        description: error instanceof Error ? error.message : 'Failed to sync Stripe data',
      })
    },
  })

  // Mutation for Claude analysis
  const analysisMutation = useMutation({
    mutationFn: async (data: EnhancedSyncResult) => {
      return analyzeWithClaude(data, selectedFocusAreas.value)
    },
    onSuccess: (result) => {
      analysisResult.value = result
      if (result.success) {
        toast.success('Analysis complete!', {
          description: `Health score: ${result.summary.health_score}/100`,
        })
      } else {
        toast.warning('Analysis completed with issues', {
          description: 'Using local analysis fallback',
        })
      }
    },
    onError: (error) => {
      // Fallback to local analysis
      if (syncedData.value) {
        const localResult = performLocalAnalysis(syncedData.value)
        analysisResult.value = localResult
        toast.info('Using local analysis', {
          description: 'Claude API unavailable, using local analysis',
        })
      } else {
        toast.error('Analysis failed', {
          description: error instanceof Error ? error.message : 'Failed to analyze data',
        })
      }
    },
  })

  // Computed properties
  const hasSyncedData = computed(() => syncedData.value !== null)
  const hasAnalysis = computed(() => analysisResult.value !== null)

  const syncSummary = computed(() => {
    if (!syncedData.value) return null
    return syncedData.value.summary
  })

  const topInsights = computed(() => {
    if (!analysisResult.value) return []
    return analysisResult.value.summary.top_insights
  })

  const healthScore = computed(() => {
    if (!analysisResult.value) return null
    return analysisResult.value.summary.health_score
  })

  const pricingInsights = computed(() => {
    if (!analysisResult.value) return []
    return analysisResult.value.pricing_insights
  })

  const segmentAnalysis = computed(() => {
    if (!analysisResult.value) return []
    return analysisResult.value.segment_analysis
  })

  const usageAnalysis = computed(() => {
    if (!analysisResult.value) return []
    return analysisResult.value.usage_analysis
  })

  const recommendations = computed(() => {
    if (!analysisResult.value) return null
    return analysisResult.value.recommendations
  })

  // Actions
  async function syncData() {
    await syncMutation.mutateAsync()
  }

  async function runAnalysis() {
    if (!syncedData.value) {
      toast.error('No data to analyze', {
        description: 'Please sync your Stripe data first',
      })
      return
    }
    await analysisMutation.mutateAsync(syncedData.value)
  }

  async function syncAndAnalyze() {
    try {
      await syncMutation.mutateAsync()
      if (syncedData.value) {
        await analysisMutation.mutateAsync(syncedData.value)
      }
    } catch {
      // Errors handled by individual mutations
    }
  }

  function runLocalAnalysis() {
    if (!syncedData.value) {
      toast.error('No data to analyze', {
        description: 'Please sync your Stripe data first',
      })
      return
    }
    analysisResult.value = performLocalAnalysis(syncedData.value)
    toast.success('Local analysis complete!')
  }

  function setFocusAreas(areas: FocusAreaId[]) {
    selectedFocusAreas.value = areas
  }

  function toggleFocusArea(area: FocusAreaId) {
    const index = selectedFocusAreas.value.indexOf(area)
    if (index >= 0) {
      selectedFocusAreas.value.splice(index, 1)
    } else {
      selectedFocusAreas.value.push(area)
    }
  }

  function clearData() {
    syncedData.value = null
    analysisResult.value = null
    selectedFocusAreas.value = []
  }

  return {
    // State
    syncedData,
    analysisResult,
    dataSummary,
    selectedFocusAreas,

    // Loading states
    isSyncing: computed(() => syncMutation.isPending.value),
    isAnalyzing: computed(() => analysisMutation.isPending.value),
    isSummaryLoading,

    // Errors
    syncError: computed(() => syncMutation.error.value),
    analysisError: computed(() => analysisMutation.error.value),
    summaryError,

    // Computed
    hasSyncedData,
    hasAnalysis,
    syncSummary,
    topInsights,
    healthScore,
    pricingInsights,
    segmentAnalysis,
    usageAnalysis,
    recommendations,

    // Actions
    syncData,
    runAnalysis,
    syncAndAnalyze,
    runLocalAnalysis,
    setFocusAreas,
    toggleFocusArea,
    clearData,

    // Constants
    FOCUS_AREAS,
  }
}
