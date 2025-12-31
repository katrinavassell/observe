/**
 * Composable for handling Stripe CSV file uploads and reconciliation.
 *
 * This composable manages the entire Stripe data import flow:
 * 1. Parsing uploaded CSV files (customers, subscriptions, invoices)
 * 2. Auto-detecting file types based on CSV headers
 * 3. Reconciling data across files
 * 4. Uploading reconciled data to Supabase
 */

import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { supabase } from '@/lib/supabase'
import {
  parseCSVFile,
  detectStripeFileType,
  parseStripeCustomers,
  parseStripeSubscriptions,
  parseStripeInvoices,
  reconcileStripeData,
  convertToDatabaseFormat,
  uploadStripeData,
  formatCurrency,
  type StripeCustomer,
  type StripeSubscription,
  type StripeInvoice,
  type ReconciliationReport,
  type UnifiedSubscriptionData,
} from '@/lib/stripe-import'

/**
 * Represents a Stripe export file reference.
 * When `file` is present, the file hasn't been saved yet.
 * When only `name` is present, the data has been saved to the database.
 */
export interface StripeFile {
  name: string
  file?: File
}

// =============================================================================
// MODULE-LEVEL STATE (persists across navigation)
// =============================================================================

// File references
const stripeCustomersFile = ref<StripeFile | null>(null)
const stripeSubscriptionsFile = ref<StripeFile | null>(null)
const stripeInvoicesFile = ref<StripeFile | null>(null)
const stripeSampleLoaded = ref(false)

// Parsed data from CSV files
const parsedCustomers = ref<StripeCustomer[]>([])
const parsedSubscriptions = ref<StripeSubscription[]>([])
const parsedInvoices = ref<StripeInvoice[]>([])

// Reconciliation state
const reconciliationReport = ref<ReconciliationReport | null>(null)
const unifiedData = ref<UnifiedSubscriptionData[]>([])
const isReconciling = ref(false)
const showReconciliation = ref(false)

// Upload state
const isUploading = ref(false)
const uploadError = ref<string | null>(null)

// Drag state for dropzone
const isDragging = ref(false)

/**
 * Composable for managing Stripe CSV uploads and data reconciliation.
 *
 * @param options.onDataSaved - Callback when data is successfully saved to database
 * @returns State and methods for Stripe upload management
 *
 * @example
 * ```vue
 * const {
 *   stripeFileCount,
 *   canReconcile,
 *   processStripeFile,
 *   handleReconcile
 * } = useStripeUpload({ onDataSaved: refetchData })
 * ```
 */
export function useStripeUpload(options: {
  onDataSaved?: () => Promise<void>
} = {}) {
  const router = useRouter()

  /**
   * Count of Stripe files currently uploaded (0-3).
   * Used to determine dropzone visibility and upload progress.
   */
  const stripeFileCount = computed(() =>
    (stripeCustomersFile.value ? 1 : 0) +
    (stripeSubscriptionsFile.value ? 1 : 0) +
    (stripeInvoicesFile.value ? 1 : 0)
  )

  /**
   * Whether we have enough data to reconcile.
   * Requires at least subscriptions file to proceed.
   */
  const canReconcile = computed(() => parsedSubscriptions.value.length > 0)

  /**
   * Whether there are unsaved changes (parsed but not uploaded files).
   */
  const hasUnsavedChanges = computed(() =>
    parsedCustomers.value.length > 0 ||
    parsedSubscriptions.value.length > 0 ||
    parsedInvoices.value.length > 0
  )

  /**
   * Process a dropped or selected Stripe CSV file.
   * Auto-detects file type and parses accordingly.
   *
   * @param file - The CSV file to process
   */
  async function processStripeFile(file: File): Promise<void> {
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload CSV files')
      return
    }

    try {
      const { data, headers } = await parseCSVFile<Record<string, unknown>>(file)
      const fileType = detectStripeFileType(headers)

      // Reset reconciliation when new files are added
      reconciliationReport.value = null
      showReconciliation.value = false
      uploadError.value = null

      if (fileType === 'customers') {
        stripeCustomersFile.value = { name: file.name, file }
        parsedCustomers.value = parseStripeCustomers(data)
        toast.success('Customers file detected', {
          description: `${parsedCustomers.value.length} customers found`,
        })
      } else if (fileType === 'subscriptions') {
        stripeSubscriptionsFile.value = { name: file.name, file }
        parsedSubscriptions.value = parseStripeSubscriptions(data)
        toast.success('Subscriptions file detected', {
          description: `${parsedSubscriptions.value.length} subscriptions found`,
        })
      } else if (fileType === 'invoices') {
        stripeInvoicesFile.value = { name: file.name, file }
        parsedInvoices.value = parseStripeInvoices(data)
        toast.success('Invoices file detected', {
          description: `${parsedInvoices.value.length} invoices found`,
        })
      } else {
        toast.error('File type not recognized', {
          description: 'Please upload a Stripe export (customers, subscriptions, or invoices)',
        })
      }
    } catch (error) {
      toast.error('Failed to parse CSV', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Clear a specific Stripe file and its parsed data.
   *
   * @param type - Which file type to clear
   */
  function clearStripeFile(type: 'customers' | 'subscriptions' | 'invoices'): void {
    if (type === 'customers') {
      stripeCustomersFile.value = null
      parsedCustomers.value = []
    } else if (type === 'subscriptions') {
      stripeSubscriptionsFile.value = null
      parsedSubscriptions.value = []
    } else if (type === 'invoices') {
      stripeInvoicesFile.value = null
      parsedInvoices.value = []
    }
    stripeSampleLoaded.value = false

    // Reset reconciliation when files are removed
    reconciliationReport.value = null
    showReconciliation.value = false
    uploadError.value = null
  }

  /**
   * Reconcile parsed Stripe data across files.
   * Matches customers with subscriptions and calculates MRR.
   */
  async function handleReconcile(): Promise<void> {
    if (!canReconcile.value) return

    isReconciling.value = true
    uploadError.value = null

    try {
      const result = reconcileStripeData(
        parsedCustomers.value,
        parsedSubscriptions.value,
        parsedInvoices.value
      )
      reconciliationReport.value = result.report
      unifiedData.value = result.unified
      showReconciliation.value = true
    } catch (error) {
      toast.error('Failed to reconcile data', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      isReconciling.value = false
    }
  }

  /**
   * Upload reconciled data to Supabase and navigate to analysis.
   */
  async function handleUploadAndContinue(): Promise<void> {
    if (!reconciliationReport.value || unifiedData.value.length === 0) {
      toast.error('Please reconcile data first')
      return
    }

    isUploading.value = true
    uploadError.value = null

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error('Not authenticated')
      }

      const dbData = convertToDatabaseFormat(unifiedData.value, user.id)
      await uploadStripeData(dbData)

      if (options.onDataSaved) {
        await options.onDataSaved()
      }

      // Clear local parsed data
      parsedCustomers.value = []
      parsedSubscriptions.value = []
      parsedInvoices.value = []

      // Keep file refs but remove the File objects (data is saved)
      if (stripeCustomersFile.value) {
        stripeCustomersFile.value = { name: stripeCustomersFile.value.name }
      }
      if (stripeSubscriptionsFile.value) {
        stripeSubscriptionsFile.value = { name: stripeSubscriptionsFile.value.name }
      }
      if (stripeInvoicesFile.value) {
        stripeInvoicesFile.value = { name: stripeInvoicesFile.value.name }
      }

      toast.success('Data uploaded successfully!', {
        description: 'Redirecting to pricing analysis...',
      })

      router.push('/')
    } catch (error) {
      uploadError.value = error instanceof Error ? error.message : 'Upload failed'
      toast.error('Failed to upload data', {
        description: uploadError.value,
      })
    } finally {
      isUploading.value = false
    }
  }

  /**
   * Set file indicators for sample data (already saved to database).
   */
  function setSampleDataLoaded(): void {
    stripeSampleLoaded.value = true
    stripeCustomersFile.value = { name: 'customers.csv' }
    stripeSubscriptionsFile.value = { name: 'subscriptions.csv' }
    stripeInvoicesFile.value = { name: 'invoices.csv' }
    // Clear any parsed data since sample is in database
    parsedCustomers.value = []
    parsedSubscriptions.value = []
    parsedInvoices.value = []
    reconciliationReport.value = null
    showReconciliation.value = false
  }

  /**
   * Clear all Stripe data and reset state.
   */
  function clearAll(): void {
    stripeCustomersFile.value = null
    stripeSubscriptionsFile.value = null
    stripeInvoicesFile.value = null
    stripeSampleLoaded.value = false
    parsedCustomers.value = []
    parsedSubscriptions.value = []
    parsedInvoices.value = []
    reconciliationReport.value = null
    showReconciliation.value = false
    uploadError.value = null
  }

  return {
    // File state
    stripeCustomersFile,
    stripeSubscriptionsFile,
    stripeInvoicesFile,
    stripeSampleLoaded,
    stripeFileCount,

    // Parsed data
    parsedCustomers,
    parsedSubscriptions,
    parsedInvoices,

    // Reconciliation state
    reconciliationReport,
    unifiedData,
    isReconciling,
    showReconciliation,
    canReconcile,

    // Upload state
    isUploading,
    uploadError,
    hasUnsavedChanges,

    // Drag state
    isDragging,

    // Methods
    processStripeFile,
    clearStripeFile,
    handleReconcile,
    handleUploadAndContinue,
    setSampleDataLoaded,
    clearAll,

    // Re-export for template use
    formatCurrency,
  }
}
