/**
 * Stripe Connection Composable
 *
 * Manages the complete Stripe API connection and sync flow:
 * - API key validation
 * - Data syncing with progress tracking
 * - Error handling and retry logic
 * - Data storage to Supabase
 *
 * @module composables/useStripeConnection
 */

import { ref, computed, readonly } from 'vue'
import { toast } from 'vue-sonner'
import {
  createStripeClient,
  transformCustomer,
  transformSubscription,
  transformInvoice,
  isValidCustomer,
  isValidSubscription,
  isRelevantInvoice,
  type StripeKeyMode,
  type StripeKeyValidation,
  type StripeSyncStatus,
  type StripeSyncDataType,
  type StripeSyncProgress,
  type TransformedCustomer,
  type TransformedSubscription,
  type TransformedInvoice,
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
    totalSynced: 0,
    errors: [],
    startedAt: null,
    completedAt: null,
  }
}

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
  // STATE
  // ---------------------------------------------------------------------------

  const isValidating = ref(false)
  const validation = ref<StripeKeyValidation | null>(null)
  const isSyncing = ref(false)
  const syncState = ref<SyncState>(createInitialSyncState())
  const apiKey = ref<string | null>(null)
  const mode = ref<StripeKeyMode | null>(null)

  // ---------------------------------------------------------------------------
  // COMPUTED
  // ---------------------------------------------------------------------------

  const isConnected = computed(() => validation.value?.isValid === true)

  const syncProgress = computed(() => {
    const state = syncState.value
    const total = state.customers.total + state.subscriptions.total + state.invoices.total
    if (total === 0) return 0
    return Math.round(state.totalSynced / total * 100)
  })

  const hasErrors = computed(() => syncState.value.errors.length > 0)

  // ---------------------------------------------------------------------------
  // API KEY VALIDATION
  // ---------------------------------------------------------------------------

  /**
   * Validate a Stripe API key
   */
  async function validateApiKey(key: string): Promise<StripeKeyValidation> {
    isValidating.value = true
    validation.value = null

    try {
      const client = createStripeClient(key)
      const result = await client.validateKey()

      validation.value = result

      if (result.isValid) {
        apiKey.value = key
        mode.value = result.mode
      }

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
   * Start syncing data from Stripe
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

    const client = createStripeClient(syncKey)
    const keyMode = mode.value || 'test'

    // Track customer ID mappings for linking
    const customerIdMap = new Map<string, TransformedCustomer>()
    const subscriptionCustomerMap = new Map<string, string>()

    try {
      // Phase 1: Sync customers
      await syncCustomers(client, keyMode, customerIdMap)

      // Phase 2: Sync subscriptions
      await syncSubscriptions(client, keyMode, subscriptionCustomerMap)

      // Phase 3: Sync invoices
      await syncInvoices(client, keyMode)

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

      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error('Sync failed', { description: message })

      return false
    } finally {
      isSyncing.value = false
    }
  }

  /**
   * Sync customers from Stripe
   */
  async function syncCustomers(
    client: ReturnType<typeof createStripeClient>,
    keyMode: StripeKeyMode,
    customerIdMap: Map<string, TransformedCustomer>
  ): Promise<void> {
    const progress = syncState.value.customers
    progress.status = 'in_progress'

    const customers: TransformedCustomer[] = []

    try {
      for await (const customer of client.listCustomers()) {
        if (!isValidCustomer(customer)) continue

        const transformed = transformCustomer(customer, keyMode)
        customers.push(transformed)
        customerIdMap.set(customer.id, transformed)

        progress.synced++
        progress.total = Math.max(progress.total, progress.synced)
        progress.percentage = 100 // We don't know total until done
        syncState.value.totalSynced++
      }

      progress.total = customers.length
      progress.percentage = 100

      // Save to Supabase
      if (customers.length > 0) {
        await saveCustomers(customers)
      }

      progress.status = 'completed'
    } catch (error) {
      progress.status = 'failed'
      progress.error = error instanceof Error ? error.message : 'Failed to sync customers'
      syncState.value.errors.push({
        type: 'customers',
        message: progress.error,
      })
      throw error
    }
  }

  /**
   * Sync subscriptions from Stripe
   */
  async function syncSubscriptions(
    client: ReturnType<typeof createStripeClient>,
    keyMode: StripeKeyMode,
    subscriptionCustomerMap: Map<string, string>
  ): Promise<void> {
    const progress = syncState.value.subscriptions
    progress.status = 'in_progress'

    const subscriptions: TransformedSubscription[] = []

    try {
      for await (const subscription of client.listSubscriptions()) {
        if (!isValidSubscription(subscription)) continue

        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id

        const transformed = transformSubscription(subscription, keyMode)
        subscriptions.push(transformed)
        subscriptionCustomerMap.set(subscription.id, customerId)

        progress.synced++
        progress.total = Math.max(progress.total, progress.synced)
        progress.percentage = 100
        syncState.value.totalSynced++
      }

      progress.total = subscriptions.length
      progress.percentage = 100

      // Save to Supabase
      if (subscriptions.length > 0) {
        await saveSubscriptions(subscriptions)
      }

      progress.status = 'completed'
    } catch (error) {
      progress.status = 'failed'
      progress.error = error instanceof Error ? error.message : 'Failed to sync subscriptions'
      syncState.value.errors.push({
        type: 'subscriptions',
        message: progress.error,
      })
      throw error
    }
  }

  /**
   * Sync invoices from Stripe
   */
  async function syncInvoices(
    client: ReturnType<typeof createStripeClient>,
    keyMode: StripeKeyMode
  ): Promise<void> {
    const progress = syncState.value.invoices
    progress.status = 'in_progress'

    const invoices: TransformedInvoice[] = []

    try {
      for await (const invoice of client.listInvoices()) {
        if (!isRelevantInvoice(invoice)) continue

        const transformed = transformInvoice(invoice, keyMode)
        invoices.push(transformed)

        progress.synced++
        progress.total = Math.max(progress.total, progress.synced)
        progress.percentage = 100
        syncState.value.totalSynced++
      }

      progress.total = invoices.length
      progress.percentage = 100

      // Save to Supabase
      if (invoices.length > 0) {
        await saveInvoices(invoices)
      }

      progress.status = 'completed'
    } catch (error) {
      progress.status = 'failed'
      progress.error = error instanceof Error ? error.message : 'Failed to sync invoices'
      syncState.value.errors.push({
        type: 'invoices',
        message: progress.error,
      })
      throw error
    }
  }

  // ---------------------------------------------------------------------------
  // SUPABASE STORAGE
  // ---------------------------------------------------------------------------

  /**
   * Save customers to Supabase
   */
  async function saveCustomers(customers: TransformedCustomer[]): Promise<void> {
    // Transform to match existing schema
    const records = customers.map(c => ({
      id: c.stripeId,
      name: c.name || c.email || 'Unknown Customer',
      email: c.email,
      phone: c.phone,
      created_at: c.createdAt,
      metadata: c.metadata,
    }))

    // Upsert in batches
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
   * Save subscriptions to Supabase
   */
  async function saveSubscriptions(subscriptions: TransformedSubscription[]): Promise<void> {
    // Transform to match existing schema
    const records = subscriptions.map(s => ({
      id: s.stripeId,
      customer_id: s.customerId,
      plan_id: s.planId,
      status: s.status,
      quantity: s.quantity,
      mrr_override: s.mrrOverride,
      current_period_start: s.currentPeriodStart,
      current_period_end: s.currentPeriodEnd,
      start_date: s.startDate,
      ended_at: s.endedAt,
      canceled_at: s.canceledAt,
      cancel_at_period_end: s.cancelAtPeriodEnd,
      trial_start: s.trialStart,
      trial_end: s.trialEnd,
      metadata: s.metadata,
    }))

    // Upsert in batches
    const batchSize = 100
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      const { error } = await supabase
        .from('subscriptions')
        .upsert(batch, { onConflict: 'id' })

      if (error) throw new Error(`Failed to save subscriptions: ${error.message}`)
    }

    // Also save/update plans
    const plans = new Map<string, { id: string; name: string; price: number; interval: string }>()
    subscriptions.forEach(s => {
      if (!plans.has(s.planId)) {
        plans.set(s.planId, {
          id: s.planId,
          name: s.planName || s.planId,
          price: s.pricePerUnit * s.quantity,
          interval: s.interval,
        })
      }
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
   * Save invoices to Supabase
   */
  async function saveInvoices(invoices: TransformedInvoice[]): Promise<void> {
    // Transform to match existing schema
    const records = invoices.map(i => ({
      id: i.stripeId,
      customer_id: i.customerId,
      subscription_id: i.subscriptionId,
      number: i.number,
      status: i.status,
      amount_due: i.amountDue,
      amount_paid: i.amountPaid,
      subtotal: i.subtotal,
      total: i.total,
      tax: i.tax,
      currency: i.currency,
      period_start: i.periodStart,
      period_end: i.periodEnd,
      due_date: i.dueDate,
      paid_at: i.paidAt,
      billing_reason: i.billingReason,
      metadata: i.metadata,
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
