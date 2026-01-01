import { ref, computed, onMounted } from 'vue'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
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

// Track if auth listener is already set up (prevents multiple registrations)
let authListenerInitialized = false

export function useDataMode() {
  const dataMode = computed<DataMode>(() => dataStatus.value?.data_mode ?? 'none')
  const hasData = computed(() => dataStatus.value?.has_data ?? false)
  const customerCount = computed(() => dataStatus.value?.customer_count ?? 0)
  const isSampleMode = computed(() => dataMode.value === 'sample')

  // Section-level tracking
  const hasRevenue = computed(() => dataStatus.value?.has_revenue ?? false)
  const hasCosts = computed(() => dataStatus.value?.has_costs ?? false)
  const hasUsage = computed(() => dataStatus.value?.has_usage ?? false)
  const revenueCustomerCount = computed(() => dataStatus.value?.revenue_customer_count ?? 0)
  const costsRecordCount = computed(() => dataStatus.value?.costs_record_count ?? 0)
  const usageRecordCount = computed(() => dataStatus.value?.usage_record_count ?? 0)
  const lastSyncAt = computed(() => dataStatus.value?.last_sync_at ?? null)

  async function refetch() {
    isLoading.value = true
    try {
      dataStatus.value = await getDataStatus()
    } catch (error) {
      logger.error('Failed to fetch data status', error)
      dataStatus.value = {
        data_mode: 'none',
        has_data: false,
        customer_count: 0,
        has_revenue: false,
        has_costs: false,
        has_usage: false,
        revenue_customer_count: 0,
        costs_record_count: 0,
        usage_record_count: 0,
        last_sync_at: null,
      }
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

  // Listen for auth changes (only register once to prevent memory leak)
  if (!authListenerInitialized) {
    authListenerInitialized = true
    supabase.auth.onAuthStateChange(() => {
      refetch()
    })
  }

  return {
    // State
    dataMode,
    hasData,
    customerCount,
    isSampleMode,
    isLoading,
    status: dataStatus,

    // Section-level state
    hasRevenue,
    hasCosts,
    hasUsage,
    revenueCustomerCount,
    costsRecordCount,
    usageRecordCount,
    lastSyncAt,

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
