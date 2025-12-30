import { computed } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import {
  getDataStatus,
  loadSampleData,
  clearSampleData,
  type DataMode,
  type DataStatus,
} from '@/api/client'

export function useDataMode() {
  const queryClient = useQueryClient()

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['data-status'],
    queryFn: getDataStatus,
    staleTime: 1000 * 60, // 1 minute
  })

  const dataMode = computed<DataMode>(() => status.value?.data_mode ?? 'none')
  const hasData = computed(() => status.value?.has_data ?? false)
  const accountCount = computed(() => status.value?.account_count ?? 0)
  const isSampleMode = computed(() => dataMode.value === 'sample')

  const loadSampleMutation = useMutation({
    mutationFn: loadSampleData,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['data-status'] })
      queryClient.invalidateQueries({ queryKey: ['revenue-analytics'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['matches'] })
    },
  })

  const clearSampleMutation = useMutation({
    mutationFn: clearSampleData,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['data-status'] })
      queryClient.invalidateQueries({ queryKey: ['revenue-analytics'] })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['matches'] })
    },
  })

  async function switchToSampleData() {
    await loadSampleMutation.mutateAsync()
  }

  async function clearSample() {
    await clearSampleMutation.mutateAsync()
  }

  return {
    // State
    dataMode,
    hasData,
    accountCount,
    isSampleMode,
    isLoading,
    status,

    // Actions
    switchToSampleData,
    clearSample,
    refetch,

    // Loading states
    isLoadingSample: loadSampleMutation.isPending,
    isClearingSample: clearSampleMutation.isPending,
  }
}

export type { DataMode, DataStatus }
