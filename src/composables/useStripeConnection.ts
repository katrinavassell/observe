import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import * as api from '@/lib/api'
import type {
  StripeSyncStatus,
  StripeSyncDataType,
  StripeSyncProgress,
} from '@/lib/stripe-api'

export interface SyncState {
  status: StripeSyncStatus
  customers: StripeSyncProgress
  subscriptions: StripeSyncProgress
  invoices: StripeSyncProgress
  usage: StripeSyncProgress
  totalSynced: number
  errors: { type: StripeSyncDataType; message: string }[]
  startedAt: Date | null
  completedAt: Date | null
}

function createInitialProgress(type: StripeSyncDataType): StripeSyncProgress {
  return { type, status: 'pending', total: 0, synced: 0, percentage: 0 }
}

function createInitialSyncState(): SyncState {
  return {
    status: 'pending',
    customers: createInitialProgress('customers'),
    subscriptions: createInitialProgress('subscriptions'),
    invoices: createInitialProgress('invoices'),
    usage: createInitialProgress('usage'),
    totalSynced: 0,
    errors: [],
    startedAt: null,
    completedAt: null,
  }
}

const isConnected = ref(false)
const accountName = ref('')
const isSyncing = ref(false)
const syncState = ref<SyncState>(createInitialSyncState())
const isCheckingStatus = ref(false)

export function useStripeConnection() {
  const syncProgress = computed(() => {
    const state = syncState.value
    const total = state.customers.total + state.subscriptions.total + state.invoices.total + state.usage.total
    if (total === 0) return 0
    return Math.round((state.totalSynced / total) * 100)
  })

  const hasErrors = computed(() => syncState.value.errors.length > 0)

  async function checkStatus() {
    isCheckingStatus.value = true
    try {
      const status = await api.getStripeStatus()
      isConnected.value = status.connected
      accountName.value = status.account_name || ''
      return status
    } catch {
      isConnected.value = false
      return { connected: false }
    } finally {
      isCheckingStatus.value = false
    }
  }

  async function startSync(): Promise<boolean> {
    isSyncing.value = true
    syncState.value = createInitialSyncState()
    syncState.value.status = 'in_progress'
    syncState.value.startedAt = new Date()

    syncState.value.customers.status = 'in_progress'
    syncState.value.subscriptions.status = 'in_progress'

    try {
      const result = await api.syncStripeData()

      if (!result.success) {
        throw new Error('Sync returned unsuccessful')
      }

      const { synced } = result

      syncState.value.customers.total = synced.customers
      syncState.value.customers.synced = synced.customers
      syncState.value.customers.percentage = 100
      syncState.value.customers.status = 'completed'

      syncState.value.subscriptions.total = synced.subscriptions
      syncState.value.subscriptions.synced = synced.subscriptions
      syncState.value.subscriptions.percentage = 100
      syncState.value.subscriptions.status = 'completed'

      syncState.value.invoices.status = 'completed'
      syncState.value.usage.status = 'completed'

      syncState.value.totalSynced = synced.customers + synced.subscriptions
      syncState.value.status = 'completed'
      syncState.value.completedAt = new Date()

      toast.success('Stripe data synced!', {
        description: `${synced.customers} customers, ${synced.subscriptions} subscriptions imported`,
      })

      return true
    } catch (error) {
      syncState.value.status = 'failed'
      syncState.value.completedAt = new Date()

      if (syncState.value.customers.status === 'in_progress') {
        syncState.value.customers.status = 'failed'
      }
      if (syncState.value.subscriptions.status === 'in_progress') {
        syncState.value.subscriptions.status = 'failed'
      }

      const message = error instanceof Error ? error.message : 'Sync failed'
      syncState.value.errors.push({ type: 'customers', message })
      toast.error('Sync failed', { description: message })

      return false
    } finally {
      isSyncing.value = false
    }
  }

  function disconnect() {
    isConnected.value = false
    accountName.value = ''
    syncState.value = createInitialSyncState()
  }

  function cancelSync() {
    // No-op: sync is server-side and cannot be cancelled mid-flight
  }

  function resetSync() {
    syncState.value = createInitialSyncState()
  }

  return {
    isConnected: computed(() => isConnected.value),
    accountName: computed(() => accountName.value),
    isSyncing: computed(() => isSyncing.value),
    isCheckingStatus: computed(() => isCheckingStatus.value),
    syncState,
    syncProgress,
    hasErrors,
    checkStatus,
    startSync,
    disconnect,
    cancelSync,
    resetSync,
    // Legacy compat aliases
    validateApiKey: async (_key: string) => ({ isValid: true, mode: 'test' as const }),
    validation: computed(() => isConnected.value ? { isValid: true, accountName: accountName.value, mode: 'test' as const } : null),
    isValidating: computed(() => isCheckingStatus.value),
  }
}
