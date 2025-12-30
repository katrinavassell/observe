import { ref, computed, onMounted } from 'vue'
import { supabase } from '@/lib/supabase'
import {
  getDataStatus,
  loadSampleData as loadSampleDataApi,
  clearUserData,
  type DataMode,
  type DataStatus,
} from '@/lib/supabase-data'

const dataStatus = ref<DataStatus | null>(null)
const isLoading = ref(true)
const isLoadingSample = ref(false)
const isClearingSample = ref(false)

export function useDataMode() {
  const dataMode = computed<DataMode>(() => dataStatus.value?.data_mode ?? 'none')
  const hasData = computed(() => dataStatus.value?.has_data ?? false)
  const customerCount = computed(() => dataStatus.value?.customer_count ?? 0)
  const isSampleMode = computed(() => dataMode.value === 'sample')

  async function refetch() {
    isLoading.value = true
    try {
      dataStatus.value = await getDataStatus()
    } catch (error) {
      console.error('Failed to fetch data status:', error)
      dataStatus.value = { data_mode: 'none', has_data: false, customer_count: 0 }
    } finally {
      isLoading.value = false
    }
  }

  async function switchToSampleData() {
    isLoadingSample.value = true
    try {
      await loadSampleDataApi()
      await refetch()
    } finally {
      isLoadingSample.value = false
    }
  }

  async function clearSample() {
    isClearingSample.value = true
    try {
      await clearUserData()
      await refetch()
    } finally {
      isClearingSample.value = false
    }
  }

  // Initialize on first use
  onMounted(() => {
    if (dataStatus.value === null) {
      refetch()
    }
  })

  // Listen for auth changes
  supabase.auth.onAuthStateChange(() => {
    refetch()
  })

  return {
    // State
    dataMode,
    hasData,
    customerCount,
    isSampleMode,
    isLoading,
    status: dataStatus,

    // Actions
    switchToSampleData,
    clearSample,
    refetch,

    // Loading states
    isLoadingSample: computed(() => isLoadingSample.value),
    isClearingSample: computed(() => isClearingSample.value),
  }
}

export type { DataMode, DataStatus }
