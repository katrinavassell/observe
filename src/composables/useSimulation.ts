// Simulation Composable
// Handles simulation execution and state management using TanStack Vue Query
// Adapted from margin-engine for metrics-onboarding

import { ref, computed } from 'vue'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type {
  SimulationRequest,
  SimulationResult,
  SimulationProgress,
  PricingModelConfig,
} from '@/types/simulation'

export function useSimulation() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  // Get user ID
  const getUserId = () => user.value?.id

  // Simulation state
  const simulationProgress = ref<SimulationProgress>('idle')
  const currentResults = ref<SimulationResult | null>(null)

  // Run simulation mutation
  const runSimulationMutation = useMutation({
    mutationFn: async (request: SimulationRequest): Promise<SimulationResult> => {
      const userId = getUserId()

      if (!userId) {
        throw new Error('User must be logged in to run simulations')
      }

      simulationProgress.value = 'fetching'

      // Call Edge Function
      const { data, error } = await supabase.functions.invoke('run-simulation', {
        body: {
          userId,
          pricingModel: request.pricingModel,
        },
      })

      if (error) {
        console.error('Edge function error:', error)
        const errorMessage = error.message || 'Simulation failed'
        throw new Error(errorMessage)
      }

      if (!data?.success) {
        const errorCode = data?.error?.code || 'UNKNOWN'
        const errorMsg = data?.error?.message || 'Simulation returned an error'
        console.error('Simulation error:', errorCode, errorMsg)
        throw new Error(`[${errorCode}] ${errorMsg}`)
      }

      simulationProgress.value = 'saving'

      // Save scenario to database
      const { error: saveError } = await supabase
        .from('pricing_scenarios')
        .insert({
          user_id: userId,
          name: request.scenarioName,
          description: request.scenarioDescription || null,
          is_baseline: request.isBaseline,
          pricing_model: request.pricingModel,
          results: data.results,
        })

      if (saveError) {
        console.error('Save error:', saveError)
        throw new Error(saveError.message || 'Failed to save scenario')
      }

      simulationProgress.value = 'idle'
      return data.results as SimulationResult
    },
    onSuccess: (results) => {
      currentResults.value = results
      // Invalidate scenarios query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['scenarios'] })
    },
    onError: (error) => {
      console.error('Simulation mutation error:', error)
      simulationProgress.value = 'idle'
    },
  })

  // Run simulation without saving (for preview)
  const runSimulationPreviewMutation = useMutation({
    mutationFn: async (config: {
      pricingModel: PricingModelConfig
    }): Promise<SimulationResult> => {
      const userId = getUserId()

      if (!userId) {
        throw new Error('User must be logged in to run simulations')
      }

      simulationProgress.value = 'fetching'

      const { data, error } = await supabase.functions.invoke('run-simulation', {
        body: {
          userId,
          pricingModel: config.pricingModel,
        },
      })

      if (error) {
        throw new Error(error.message || 'Simulation failed')
      }

      if (!data?.success) {
        throw new Error(data?.error?.message || 'Simulation returned an error')
      }

      simulationProgress.value = 'idle'
      return data.results as SimulationResult
    },
    onSuccess: (results) => {
      currentResults.value = results
    },
    onError: () => {
      simulationProgress.value = 'idle'
    },
  })

  // Re-run simulation for an existing scenario
  async function rerunSimulation(scenarioId: string): Promise<SimulationResult> {
    const userId = getUserId()

    if (!userId) {
      throw new Error('User must be logged in')
    }

    // Fetch existing scenario configuration
    const { data: scenario, error: fetchError } = await supabase
      .from('pricing_scenarios')
      .select('*')
      .eq('id', scenarioId)
      .single()

    if (fetchError || !scenario) {
      throw new Error('Scenario not found')
    }

    simulationProgress.value = 'fetching'

    // Run simulation with same config but fresh data
    const { data, error } = await supabase.functions.invoke('run-simulation', {
      body: {
        userId,
        pricingModel: scenario.pricing_model,
      },
    })

    if (error) {
      simulationProgress.value = 'idle'
      throw new Error(error.message || 'Re-run failed')
    }

    if (!data?.success) {
      simulationProgress.value = 'idle'
      throw new Error(data?.error?.message || 'Re-run returned an error')
    }

    simulationProgress.value = 'saving'

    // Update the scenario with new results
    const { error: updateError } = await supabase
      .from('pricing_scenarios')
      .update({
        results: data.results,
        updated_at: new Date().toISOString(),
      })
      .eq('id', scenarioId)

    if (updateError) {
      console.error('Update error:', updateError)
      // Don't throw - we still have results
    }

    simulationProgress.value = 'idle'
    currentResults.value = data.results as SimulationResult

    // Invalidate scenarios query
    queryClient.invalidateQueries({ queryKey: ['scenarios'] })

    return data.results as SimulationResult
  }

  // Clear current results
  function clearResults() {
    currentResults.value = null
    simulationProgress.value = 'idle'
  }

  // Progress message helper
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
    // State
    simulationProgress,
    currentResults,
    progressMessage,

    // Computed
    isRunning: computed(
      () =>
        runSimulationMutation.isPending.value ||
        runSimulationPreviewMutation.isPending.value
    ),
    error: computed(
      () => runSimulationMutation.error.value || runSimulationPreviewMutation.error.value
    ),

    // Actions
    runSimulation: runSimulationMutation.mutate,
    runSimulationAsync: runSimulationMutation.mutateAsync,
    runPreview: runSimulationPreviewMutation.mutate,
    runPreviewAsync: runSimulationPreviewMutation.mutateAsync,
    rerunSimulation,
    clearResults,
  }
}
