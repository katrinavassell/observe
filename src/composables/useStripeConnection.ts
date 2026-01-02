/**
 * Stripe Connection Composable
 *
 * Manages the complete Stripe API connection and sync flow via Edge Functions:
 * - API key validation (via stripe-connect edge function)
 * - Data syncing with progress tracking (via stripe-sync-enhanced edge function)
 * - Error handling and retry logic
 * - Data storage to Supabase
 *
 * @module composables/useStripeConnection
 */

import { ref, computed, readonly } from 'vue'
import { toast } from 'vue-sonner'
import {
  type StripeKeyMode,
  type StripeKeyValidation,
  type StripeSyncStatus,
  type StripeSyncDataType,
  type StripeSyncProgress,
} from '@/lib/stripe-api'
import { supabase } from '@/lib/supabase'

// =============================================================================
// TYPES
// =============================================================================

export interface SyncState {
  /** Overall sync status */
  status: StripeSyncStatus
  /** Progress for each data type */
  customers: StripeSyncProgress
  subscriptions: StripeSyncProgress
  invoices: StripeSyncProgress
  usage: StripeSyncProgress
  /** Total records synced */
  totalSynced: number
  /** Any errors that occurred */
  errors: { type: StripeSyncDataType; message: string }[]
  /** When sync started */
  startedAt: Date | null
  /** When sync completed */
  completedAt: Date | null
}

export interface StripeConnectionState {
  /** Whether we're validating the API key */
  isValidating: boolean
  /** API key validation result */
  validation: StripeKeyValidation | null
  /** Whether we're syncing data */
  isSyncing: boolean
  /** Current sync state */
  syncState: SyncState
}

// =============================================================================
// INITIAL STATE
// =============================================================================

function createInitialProgress(type: StripeSyncDataType): StripeSyncProgress {
  return {
    type,
    status: 'pending',
    total: 0,
    synced: 0,
    percentage: 0,
  }
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

// =============================================================================
// SHARED STATE (singleton - shared across all components)
// =============================================================================

const isValidating = ref(false)
const validation = ref<StripeKeyValidation | null>(null)
const isSyncing = ref(false)
const syncState = ref<SyncState>(createInitialSyncState())
const apiKey = ref<string | null>(null)
const mode = ref<StripeKeyMode | null>(null)

// =============================================================================
// COMPOSABLE
// =============================================================================

/**
 * Composable for managing Stripe API connections and data sync
 *
 * @example
 * ```ts
 * const {
 *   validateApiKey,
 *   startSync,
 *   syncState,
 *   isConnected,
 * } = useStripeConnection()
 *
 * const result = await validateApiKey('sk_test_...')
 * if (result.isValid) {
 *   await startSync('sk_test_...')
 * }
 * ```
 */
export function useStripeConnection() {
  // ---------------------------------------------------------------------------
  // COMPUTED
  // ---------------------------------------------------------------------------

  const isConnected = computed(() => validation.value?.isValid === true)

  const syncProgress = computed(() => {
    const state = syncState.value
    const total = state.customers.total + state.subscriptions.total + state.invoices.total + state.usage.total
    if (total === 0) return 0
    return Math.round(state.totalSynced / total * 100)
  })

  const hasErrors = computed(() => syncState.value.errors.length > 0)

  // ---------------------------------------------------------------------------
  // API KEY VALIDATION
  // ---------------------------------------------------------------------------

  /**
   * Validate a Stripe API key via edge function
   */
  async function validateApiKey(key: string): Promise<StripeKeyValidation> {
    isValidating.value = true
    validation.value = null

    try {
      // Detect key mode locally first
      const keyMode = key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : 'test'

      if (!key.startsWith('sk_') && !key.startsWith('rk_')) {
        const errorResult: StripeKeyValidation = {
          isValid: false,
          mode: null,
          error: 'Invalid API key format. Key must start with sk_test_ or sk_live_',
        }
        validation.value = errorResult
        return errorResult
      }

      // Call the stripe-connect edge function to validate and store the key
      const { data, error } = await supabase.functions.invoke('stripe-connect', {
        body: { api_key: key },
      })

      if (error) {
        const errorResult: StripeKeyValidation = {
          isValid: false,
          mode: keyMode,
          error: error.message || 'Failed to connect to Stripe',
        }
        validation.value = errorResult
        return errorResult
      }

      if (!data?.success) {
        const errorResult: StripeKeyValidation = {
          isValid: false,
          mode: keyMode,
          error: data?.message || 'Failed to validate API key',
        }
        validation.value = errorResult
        return errorResult
      }

      // Success - key is validated and stored in database
      const result: StripeKeyValidation = {
        isValid: true,
        mode: keyMode,
        accountId: data.account_id,
        accountName: data.account_name,
      }

      validation.value = result
      apiKey.value = key
      mode.value = keyMode

      return result
    } catch (error) {
      const errorResult: StripeKeyValidation = {
        isValid: false,
        mode: null,
        error: error instanceof Error ? error.message : 'Failed to validate API key',
      }
      validation.value = errorResult
      return errorResult
    } finally {
      isValidating.value = false
    }
  }

  /**
   * Disconnect from Stripe (clear stored key)
   */
  function disconnect(): void {
    apiKey.value = null
    mode.value = null
    validation.value = null
    syncState.value = createInitialSyncState()
  }

  // ---------------------------------------------------------------------------
  // DATA SYNC
  // ---------------------------------------------------------------------------

  /**
   * Start syncing data from Stripe via edge function
   */
  async function startSync(key?: string): Promise<boolean> {
    const syncKey = key || apiKey.value
    if (!syncKey) {
      toast.error('No API key provided')
      return false
    }

    // Validate key if not already validated
    if (!validation.value?.isValid) {
      const result = await validateApiKey(syncKey)
      if (!result.isValid) {
        toast.error('Invalid API key', { description: result.error })
        return false
      }
    }

    isSyncing.value = true
    syncState.value = createInitialSyncState()
    syncState.value.status = 'in_progress'
    syncState.value.startedAt = new Date()

    try {
      // Update progress to show we're starting
      syncState.value.customers.status = 'in_progress'

      // Call the stripe-sync-enhanced edge function
      const { data, error } = await supabase.functions.invoke('stripe-sync-enhanced', {
        body: {},
      })

      if (error) {
        throw new Error(error.message || 'Failed to sync Stripe data')
      }

      if (!data?.success) {
        throw new Error(data?.message || 'Sync failed')
      }

      // Update progress with returned counts
      const customers = data.customers || []
      const subscriptions = data.subscriptions || []
      const invoices = data.invoices || []
      const usage = data.usage || []

      // Update customer progress
      syncState.value.customers.total = customers.length
      syncState.value.customers.synced = customers.length
      syncState.value.customers.percentage = 100
      syncState.value.customers.status = 'completed'

      // Update subscription progress
      syncState.value.subscriptions.total = subscriptions.length
      syncState.value.subscriptions.synced = subscriptions.length
      syncState.value.subscriptions.percentage = 100
      syncState.value.subscriptions.status = 'completed'

      // Update invoice progress
      syncState.value.invoices.total = invoices.length
      syncState.value.invoices.synced = invoices.length
      syncState.value.invoices.percentage = 100
      syncState.value.invoices.status = 'completed'

      // Update usage progress
      syncState.value.usage.total = usage.length
      syncState.value.usage.synced = usage.length
      syncState.value.usage.percentage = 100
      syncState.value.usage.status = 'completed'

      // Calculate total synced
      syncState.value.totalSynced = customers.length + subscriptions.length + invoices.length + usage.length

      // Save data to database
      if (customers.length > 0) {
        await saveCustomersFromEdge(customers)
      }
      if (subscriptions.length > 0) {
        await saveSubscriptionsFromEdge(subscriptions, data.products || [])
      }
      if (invoices.length > 0) {
        await saveInvoicesFromEdge(invoices)
      }
      if (usage.length > 0) {
        await saveUsageFromEdge(usage)
      }

      // Mark complete
      syncState.value.status = 'completed'
      syncState.value.completedAt = new Date()

      toast.success('Stripe data synced successfully!', {
        description: `${syncState.value.totalSynced} records imported`,
      })

      return true
    } catch (error) {
      syncState.value.status = 'failed'
      syncState.value.completedAt = new Date()

      // Mark all in-progress items as failed
      if (syncState.value.customers.status === 'in_progress') {
        syncState.value.customers.status = 'failed'
        syncState.value.customers.error = error instanceof Error ? error.message : 'Sync failed'
      }

      const message = error instanceof Error ? error.message : 'Unknown error'
      syncState.value.errors.push({ type: 'customers', message })
      toast.error('Sync failed', { description: message })

      return false
    } finally {
      isSyncing.value = false
    }
  }

  // ---------------------------------------------------------------------------
  // SUPABASE STORAGE (for edge function response data)
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type EdgeCustomer = any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type EdgeSubscription = any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type EdgeInvoice = any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type EdgeUsage = any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type EdgeProduct = any

  /**
   * Save customers from edge function response
   */
  async function saveCustomersFromEdge(customers: EdgeCustomer[]): Promise<void> {
    const records = customers.map((c: EdgeCustomer) => ({
      id: c.id,
      name: c.name || c.email || 'Unknown Customer',
      email: c.email,
      phone: c.phone || null,
      created_at: c.created_at || new Date(c.created * 1000).toISOString(),
      metadata: c.metadata || {},
    }))

    const batchSize = 100
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      const { error } = await supabase
        .from('customers')
        .upsert(batch, { onConflict: 'id' })

      if (error) throw new Error(`Failed to save customers: ${error.message}`)
    }
  }

  /**
   * Save subscriptions from edge function response
   */
  async function saveSubscriptionsFromEdge(subscriptions: EdgeSubscription[], products: EdgeProduct[]): Promise<void> {
    // Build product name lookup
    const productNames = new Map<string, string>()
    products.forEach((p: EdgeProduct) => {
      productNames.set(p.id, p.name)
    })

    const records = subscriptions.map((s: EdgeSubscription) => ({
      id: s.id,
      customer_id: s.customer_id,
      plan_id: s.price_id || s.items?.[0]?.price_id || '',
      status: s.status,
      quantity: s.quantity || 1,
      mrr_override: s.mrr_override || null,
      current_period_start: s.current_period_start ? new Date(s.current_period_start * 1000).toISOString() : null,
      current_period_end: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
      start_date: s.start_date ? new Date(s.start_date * 1000).toISOString() : s.created_at,
      ended_at: s.ended_at ? new Date(s.ended_at * 1000).toISOString() : null,
      canceled_at: s.canceled_at ? new Date(s.canceled_at * 1000).toISOString() : null,
      cancel_at_period_end: s.cancel_at_period_end || false,
      trial_start: s.trial_start ? new Date(s.trial_start * 1000).toISOString() : null,
      trial_end: s.trial_end ? new Date(s.trial_end * 1000).toISOString() : null,
      metadata: s.metadata || {},
    }))

    const batchSize = 100
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      const { error } = await supabase
        .from('subscriptions')
        .upsert(batch, { onConflict: 'id' })

      if (error) throw new Error(`Failed to save subscriptions: ${error.message}`)
    }

    // Save plans from subscription items
    const plans = new Map<string, { id: string; name: string; price: number; interval: string }>()
    subscriptions.forEach((s: EdgeSubscription) => {
      const items = s.items || []
      items.forEach((item: { price_id: string; product_id: string; unit_amount: number; interval: string }) => {
        if (!plans.has(item.price_id)) {
          plans.set(item.price_id, {
            id: item.price_id,
            name: productNames.get(item.product_id) || item.price_id,
            price: item.unit_amount || 0,
            interval: item.interval || 'month',
          })
        }
      })
    })

    const planRecords = Array.from(plans.values()).map(p => ({
      id: p.id,
      name: p.name,
      amount: p.price,
      interval: p.interval,
    }))

    if (planRecords.length > 0) {
      const { error } = await supabase
        .from('plans')
        .upsert(planRecords, { onConflict: 'id' })

      if (error) throw new Error(`Failed to save plans: ${error.message}`)
    }
  }

  /**
   * Save invoices from edge function response
   */
  async function saveInvoicesFromEdge(invoices: EdgeInvoice[]): Promise<void> {
    const records = invoices.map((i: EdgeInvoice) => ({
      id: i.id,
      customer_id: i.customer_id,
      subscription_id: i.subscription_id || null,
      number: i.number || null,
      status: i.status,
      amount_due: i.amount_due || 0,
      amount_paid: i.amount_paid || 0,
      subtotal: i.subtotal || 0,
      total: i.total || 0,
      tax: i.tax || null,
      currency: i.currency || 'usd',
      period_start: i.period_start ? new Date(i.period_start * 1000).toISOString() : null,
      period_end: i.period_end ? new Date(i.period_end * 1000).toISOString() : null,
      due_date: i.due_date ? new Date(i.due_date * 1000).toISOString() : null,
      paid_at: i.paid_at ? new Date(i.paid_at * 1000).toISOString() : null,
      billing_reason: i.billing_reason || null,
      metadata: i.metadata || {},
    }))

    // Upsert in batches
    const batchSize = 100
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      const { error } = await supabase
        .from('invoices')
        .upsert(batch, { onConflict: 'id' })

      if (error) throw new Error(`Failed to save invoices: ${error.message}`)
    }
  }

  /**
   * Save usage records from edge function response
   */
  async function saveUsageFromEdge(usageRecords: EdgeUsage[]): Promise<void> {
    const records = usageRecords.map((u: EdgeUsage) => ({
      customer_id: u.customer_id,
      metric_key: u.subscription_item_id ? `usage_${u.subscription_item_id}` : 'usage',
      metric_value: u.total_usage || 0,
      period_start: u.period_start ? new Date(u.period_start * 1000).toISOString() : new Date().toISOString(),
      period_end: u.period_end ? new Date(u.period_end * 1000).toISOString() : new Date().toISOString(),
    }))

    const batchSize = 100
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      const { error } = await supabase
        .from('usage_records')
        .insert(batch)

      if (error) throw new Error(`Failed to save usage records: ${error.message}`)
    }
  }

  // ---------------------------------------------------------------------------
  // CANCEL SYNC
  // ---------------------------------------------------------------------------

  /**
   * Cancel an in-progress sync
   */
  function cancelSync(): void {
    if (syncState.value.status === 'in_progress') {
      syncState.value.status = 'cancelled'
      isSyncing.value = false
      toast.info('Sync cancelled')
    }
  }

  /**
   * Reset sync state for a new sync
   */
  function resetSync(): void {
    syncState.value = createInitialSyncState()
  }

  // ---------------------------------------------------------------------------
  // RETURN
  // ---------------------------------------------------------------------------

  return {
    // State (readonly to prevent external mutation)
    isValidating: readonly(isValidating),
    validation: readonly(validation),
    isSyncing: readonly(isSyncing),
    syncState: readonly(syncState),
    mode: readonly(mode),

    // Computed
    isConnected,
    syncProgress,
    hasErrors,

    // Actions
    validateApiKey,
    disconnect,
    startSync,
    cancelSync,
    resetSync,
  }
}
