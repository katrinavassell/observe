<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  DollarSign,
  Cpu,
  BarChart3,
  Clock,
  TrendingUp,
  Upload,
  Download,
  Bell,
  ArrowRight,
  Info,
  CheckCircle,
  X,
  ChevronDown,
  Check,
  AlertTriangle,
  Loader2,
} from 'lucide-vue-next'
import { Card, CardContent, Button } from '@/components/ui'
import Alert from '@/components/ui/alert.vue'
import ConfirmDialog from '@/components/ui/confirm-dialog.vue'
import {
  loadSampleData as loadSampleDataToSupabase,
  loadSampleRevenue,
  loadSampleCosts,
  loadSampleUsage,
  uploadCostData,
  uploadUsageData,
  clearCostData,
  clearUsageData,
  clearRevenueData,
  type CostRecord,
  type UsageRecord,
} from '@/lib/supabase-data'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase'
import { useDataMode } from '@/composables/useDataMode'
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

const router = useRouter()
const {
  dataMode,
  refetch: refetchDataMode,
  hasRevenue,
  hasCosts,
  hasUsage,
} = useDataMode()

// File input refs
const stripeFileInput = ref<HTMLInputElement | null>(null)
const costsFileInput = ref<HTMLInputElement | null>(null)
const usageFileInput = ref<HTMLInputElement | null>(null)

// Track Stripe export files (customers, subscriptions, invoices)
interface StripeFile {
  name: string
  file?: File
}
const stripeCustomersFile = ref<StripeFile | null>(null)
const stripeSubscriptionsFile = ref<StripeFile | null>(null)
const stripeInvoicesFile = ref<StripeFile | null>(null)
const stripeSampleLoaded = ref(false)

// Parsed Stripe data
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

// Track loaded files/sample data per section (for costs and usage)
const costsFile = ref<{ name: string; isSample: boolean } | null>(null)
const usageFile = ref<{ name: string; isSample: boolean } | null>(null)

// Track pending deletions (file removed but not yet saved to database)
const pendingCostsDeletion = ref(false)
const pendingUsageDeletion = ref(false)
const pendingRevenueDeletion = ref(false)

// Drag states
const isDraggingStripe = ref(false)
const isDraggingCosts = ref(false)
const isDraggingUsage = ref(false)

// Show Stripe export instructions
const showStripeInstructions = ref(false)

// Sample data loading
const isLoadingSample = ref(false)

async function handleTrySampleData() {
  isLoadingSample.value = true
  try {
    await loadSampleDataToSupabase()
    await refetchDataMode()
    // Clear any locally parsed data (sample data replaces everything)
    parsedCustomers.value = []
    parsedSubscriptions.value = []
    parsedInvoices.value = []
    reconciliationReport.value = null
    showReconciliation.value = false
    hasUnsavedChanges.value = false
    // Reset all pending deletions since sample data replaces everything
    pendingCostsDeletion.value = false
    pendingUsageDeletion.value = false
    pendingRevenueDeletion.value = false
    // Mark all sections as having sample data (no File objects = saved data)
    stripeSampleLoaded.value = true
    stripeCustomersFile.value = { name: 'customers.csv' }
    stripeSubscriptionsFile.value = { name: 'subscriptions.csv' }
    stripeInvoicesFile.value = { name: 'invoices.csv' }
    costsFile.value = { name: 'sample-costs.csv', isSample: true }
    usageFile.value = { name: 'sample-usage.csv', isSample: true }
    toast.success('Sample data loaded!', {
      description: 'Go to Pricing to see the analysis.',
    })
  } catch (error) {
    toast.error('Failed to load sample data', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  } finally {
    isLoadingSample.value = false
  }
}

// CSV Upload handlers
function triggerFileInput(type: 'stripe' | 'costs' | 'usage') {
  const inputs = {
    stripe: stripeFileInput,
    costs: costsFileInput,
    usage: usageFileInput,
  }
  inputs[type].value?.click()
}

function handleStripeFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (files) {
    for (const file of files) {
      processStripeFile(file)
    }
  }
  // Reset input so same file can be selected again
  input.value = ''
}

function handleStripeDrop(event: DragEvent) {
  isDraggingStripe.value = false
  const files = event.dataTransfer?.files
  if (files) {
    for (const file of files) {
      processStripeFile(file)
    }
  }
}

async function processStripeFile(file: File) {
  if (!file.name.endsWith('.csv')) {
    toast.error('Please upload CSV files')
    return
  }

  try {
    // Parse CSV to detect file type by headers
    const { data, headers } = await parseCSVFile<Record<string, unknown>>(file)
    const fileType = detectStripeFileType(headers)

    // Reset reconciliation when new files are added
    reconciliationReport.value = null
    showReconciliation.value = false
    uploadError.value = null
    pendingRevenueDeletion.value = false  // Clear pending deletion since we have new data

    if (fileType === 'customers') {
      stripeCustomersFile.value = { name: file.name, file }
      parsedCustomers.value = parseStripeCustomers(data)
      hasUnsavedChanges.value = true
      toast.success('Customers file detected', {
        description: `${parsedCustomers.value.length} customers found`,
      })
    } else if (fileType === 'subscriptions') {
      stripeSubscriptionsFile.value = { name: file.name, file }
      parsedSubscriptions.value = parseStripeSubscriptions(data)
      hasUnsavedChanges.value = true
      toast.success('Subscriptions file detected', {
        description: `${parsedSubscriptions.value.length} subscriptions found`,
      })
    } else if (fileType === 'invoices') {
      stripeInvoicesFile.value = { name: file.name, file }
      parsedInvoices.value = parseStripeInvoices(data)
      hasUnsavedChanges.value = true
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

function clearStripeFile(type: 'customers' | 'subscriptions' | 'invoices') {
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

  // If ALL stripe files are now cleared, mark revenue for deletion
  if (!stripeCustomersFile.value && !stripeSubscriptionsFile.value && !stripeInvoicesFile.value) {
    pendingRevenueDeletion.value = true
  }

  // Reset reconciliation when files are removed
  reconciliationReport.value = null
  showReconciliation.value = false
  uploadError.value = null

  // Removing any file is a change - trigger unsaved warning
  hasUnsavedChanges.value = true
}

// Check if we can reconcile (need at least subscriptions)
const canReconcile = computed(() => parsedSubscriptions.value.length > 0)

// Reconcile Stripe data
async function handleReconcile() {
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

// Upload reconciled data to Supabase
async function handleUploadAndContinue() {
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
    await refetchDataMode()

    // Clear local parsed data so navigation guard doesn't trigger
    parsedCustomers.value = []
    parsedSubscriptions.value = []
    parsedInvoices.value = []
    // Keep file refs but remove the File objects (data is saved)
    if (stripeCustomersFile.value) stripeCustomersFile.value = { name: stripeCustomersFile.value.name }
    if (stripeSubscriptionsFile.value) stripeSubscriptionsFile.value = { name: stripeSubscriptionsFile.value.name }
    if (stripeInvoicesFile.value) stripeInvoicesFile.value = { name: stripeInvoicesFile.value.name }

    hasUnsavedChanges.value = false
    toast.success('Data uploaded successfully!', {
      description: 'Redirecting to pricing analysis...',
    })

    // Navigate to pricing page
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

function handleFileSelect(event: Event, type: 'costs' | 'usage') {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    processFile(file, type)
  }
}

function handleDrop(event: DragEvent, type: 'costs' | 'usage') {
  const dragRefs = { costs: isDraggingCosts, usage: isDraggingUsage }
  dragRefs[type].value = false

  const file = event.dataTransfer?.files[0]
  if (file) {
    processFile(file, type)
  }
}

// Upload state for costs/usage
const isUploadingCosts = ref(false)
const isUploadingUsage = ref(false)

async function processFile(file: File, type: 'costs' | 'usage') {
  if (!file.name.endsWith('.csv')) {
    toast.error('Please upload a CSV file')
    return
  }

  const loadingRefs = { costs: isUploadingCosts, usage: isUploadingUsage }
  const fileRefs = { costs: costsFile, usage: usageFile }

  loadingRefs[type].value = true

  try {
    // Parse CSV
    const parseResult = await new Promise<Papa.ParseResult<Record<string, unknown>>>((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: resolve,
        error: reject,
      })
    })

    const rows = parseResult.data

    if (type === 'costs') {
      // Parse costs: month, provider, cost
      const validRows = rows.filter(r => r.month && r.cost)
      const skippedCount = rows.length - validRows.length
      const records: CostRecord[] = validRows.map(r => ({
        month: String(r.month),
        provider: r.provider ? String(r.provider) : undefined,
        customer_id: r.customer_id ? String(r.customer_id) : undefined,
        cost: parseFloat(String(r.cost)) || 0,
      }))

      if (records.length === 0) {
        toast.error('No valid cost records found', {
          description: 'CSV must have columns: month, cost (and optionally provider)',
        })
        return
      }

      const result = await uploadCostData(records)
      await refetchDataMode()
      fileRefs[type].value = { name: file.name, isSample: false }
      pendingCostsDeletion.value = false  // Clear pending deletion since we have new data

      if (skippedCount > 0) {
        toast.warning(`${skippedCount} rows skipped`, {
          description: 'Some rows were missing required fields (month, cost)',
        })
      }
      toast.success('Costs uploaded!', {
        description: `${result.count} cost records saved`,
      })
    } else if (type === 'usage') {
      // Parse usage: month, customer_id, metric, value, limit
      const validRows = rows.filter(r => r.month && r.customer_id && r.metric && r.value)
      const skippedCount = rows.length - validRows.length
      const records: UsageRecord[] = validRows.map(r => ({
        month: String(r.month),
        customer_id: String(r.customer_id),
        metric: String(r.metric),
        value: parseFloat(String(r.value)) || 0,
        limit: r.limit ? parseFloat(String(r.limit)) : undefined,
      }))

      if (records.length === 0) {
        toast.error('No valid usage records found', {
          description: 'CSV must have columns: month, customer_id, metric, value',
        })
        return
      }

      const result = await uploadUsageData(records)
      await refetchDataMode()
      fileRefs[type].value = { name: file.name, isSample: false }
      pendingUsageDeletion.value = false  // Clear pending deletion since we have new data

      if (skippedCount > 0) {
        toast.warning(`${skippedCount} rows skipped`, {
          description: 'Some rows were missing required fields (month, customer_id, metric, value)',
        })
      }
      toast.success('Usage uploaded!', {
        description: `${result.count} usage records saved`,
      })
    }
  } catch (error) {
    toast.error(`Failed to upload ${type} data`, {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    loadingRefs[type].value = false
  }
}

function clearFile(type: 'costs' | 'usage') {
  const fileRefs = { costs: costsFile, usage: usageFile }
  const deletionRefs = { costs: pendingCostsDeletion, usage: pendingUsageDeletion }

  fileRefs[type].value = null
  deletionRefs[type].value = true  // Mark for deletion on save

  // Removing any file is a change - trigger unsaved warning
  hasUnsavedChanges.value = true
}

// Use sample data for a specific section
const isLoadingRevenue = ref(false)
const isLoadingCosts = ref(false)
const isLoadingUsage = ref(false)

async function handleUseSampleRevenue() {
  isLoadingRevenue.value = true
  try {
    await loadSampleRevenue()
    await refetchDataMode()
    // Clear any locally parsed data (sample data replaces revenue)
    parsedCustomers.value = []
    parsedSubscriptions.value = []
    parsedInvoices.value = []
    reconciliationReport.value = null
    showReconciliation.value = false
    hasUnsavedChanges.value = false
    pendingRevenueDeletion.value = false  // Clear pending deletion since we have new data
    // Mark Stripe files as loaded with sample data (no File objects = saved data)
    stripeSampleLoaded.value = true
    stripeCustomersFile.value = { name: 'customers.csv' }
    stripeSubscriptionsFile.value = { name: 'subscriptions.csv' }
    stripeInvoicesFile.value = { name: 'invoices.csv' }
    toast.success('Sample revenue data loaded!', {
      description: 'Go to Pricing to see the analysis.',
    })
  } catch (error) {
    toast.error('Failed to load sample revenue data', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  } finally {
    isLoadingRevenue.value = false
  }
}

async function handleUseSampleData(type: 'costs' | 'usage') {
  const loadingRefs = {
    costs: isLoadingCosts,
    usage: isLoadingUsage,
  }
  const loaders = {
    costs: loadSampleCosts,
    usage: loadSampleUsage,
  }
  const fileRefs = { costs: costsFile, usage: usageFile }
  const deletionRefs = { costs: pendingCostsDeletion, usage: pendingUsageDeletion }
  const fileNames = {
    costs: 'sample-costs.csv',
    usage: 'sample-usage.csv',
  }

  loadingRefs[type].value = true

  try {
    await loaders[type]()
    await refetchDataMode()
    // Update the dropzone to show sample data is loaded
    fileRefs[type].value = { name: fileNames[type], isSample: true }
    deletionRefs[type].value = false  // Clear pending deletion since we have new data
    toast.success(`Sample ${type} data loaded!`, {
      description: 'Go to Pricing to see the analysis.',
    })
  } catch (error) {
    toast.error(`Failed to load sample ${type} data`, {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  } finally {
    loadingRefs[type].value = false
  }
}

// Template downloads - creates CSV content and triggers download
function downloadTemplate(type: 'revenue' | 'costs' | 'usage') {
  const templates: Record<string, { filename: string; content: string }> = {
    revenue: {
      filename: 'revenue-template.csv',
      content: `customer_id,customer_name,email,plan,mrr,status,started_at
cust_001,Acme Corp,billing@acme.com,enterprise,1999,active,2024-01-15
cust_002,TechStart Inc,billing@techstart.com,pro,199,active,2024-02-01
cust_003,Small Biz LLC,billing@smallbiz.com,starter,49,active,2024-03-10`,
    },
    costs: {
      filename: 'costs-template.csv',
      content: `month,provider,cost
2024-12,openai,3200
2024-12,anthropic,3000
2024-11,openai,2800
2024-11,anthropic,2600`,
    },
    usage: {
      filename: 'usage-template.csv',
      content: `month,customer_id,metric,value,limit
2024-12,cust_001,api_calls,8500,10000
2024-12,cust_001,tokens,9500000,10000000
2024-12,cust_002,api_calls,1800,2000
2024-12,cust_002,tokens,1900000,2000000`,
    },
  }

  const template = templates[type]
  if (!template) return

  const blob = new Blob([template.content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = template.filename
  a.click()
  URL.revokeObjectURL(url)

  toast.success(`${type} template downloaded`, {
    description: 'Fill in your data and upload it back.',
  })
}

// Computed: has any data uploaded (check both local state and DB)
const hasAnyData = computed(() =>
  hasRevenue.value || hasCosts.value || hasUsage.value ||
  stripeCustomersFile.value || stripeSubscriptionsFile.value || stripeInvoicesFile.value ||
  costsFile.value || usageFile.value
)

// Computed: count of Stripe files uploaded
const stripeFileCount = computed(() =>
  (stripeCustomersFile.value ? 1 : 0) +
  (stripeSubscriptionsFile.value ? 1 : 0) +
  (stripeInvoicesFile.value ? 1 : 0)
)

const uploadProgress = computed(() => {
  // Check both database status AND local file state
  // If user removed a file locally, show as not done
  const hasRevenueFiles = stripeCustomersFile.value || stripeSubscriptionsFile.value || stripeInvoicesFile.value
  const items = [
    { label: 'Revenue', done: hasRevenue.value && hasRevenueFiles },
    { label: 'AI Costs', done: hasCosts.value && costsFile.value },
    { label: 'Usage', done: hasUsage.value && usageFile.value },
  ]
  return items
})

// Restore file display state when returning to page with existing data
watch(
  [hasRevenue, hasCosts, hasUsage, () => dataMode.value],
  ([hasRev, hasCst, hasUsg, mode]) => {
    if (mode === 'sample') {
      // Restore sample data file indicators
      if (hasRev) {
        stripeCustomersFile.value = { name: 'customers.csv' }
        stripeSubscriptionsFile.value = { name: 'subscriptions.csv' }
        stripeInvoicesFile.value = { name: 'invoices.csv' }
        stripeSampleLoaded.value = true
      }
      if (hasCst) {
        costsFile.value = { name: 'sample-costs.csv', isSample: true }
      }
      if (hasUsg) {
        usageFile.value = { name: 'sample-usage.csv', isSample: true }
      }
    } else if (mode === 'user') {
      // Restore user data file indicators
      if (hasRev) {
        stripeSubscriptionsFile.value = { name: 'Stripe data' }
        stripeSampleLoaded.value = false
      }
      if (hasCst && !costsFile.value) {
        costsFile.value = { name: 'costs.csv', isSample: false }
      }
      if (hasUsg && !usageFile.value) {
        usageFile.value = { name: 'usage.csv', isSample: false }
      }
    }
  },
  { immediate: true }
)

// Track which integrations user has requested
const requestedIntegrations = ref<Set<string>>(new Set())

// Request integration form
const showRequestForm = ref(false)
const requestFormData = ref({ name: '', email: '', integration: '' })
const isSubmittingRequest = ref(false)

async function handleNotifyMe(integration: string) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      toast.error('Please sign in first')
      return
    }

    await supabase.from('integration_requests').upsert({
      user_id: user.id,
      integration_name: integration,
      request_type: 'notify',
    }, { onConflict: 'user_id,integration_name' })

    requestedIntegrations.value.add(integration)
    toast.success('Got it!', {
      description: `We'll let you know when ${integration} is ready.`,
    })
  } catch (error) {
    toast.error('Failed to save request')
  }
}

function openRequestForm() {
  showRequestForm.value = true
}

async function submitRequestForm() {
  if (!requestFormData.value.integration.trim()) {
    toast.error('Please enter which integration you need')
    return
  }

  isSubmittingRequest.value = true
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      toast.error('Please sign in first')
      return
    }

    await supabase.from('integration_requests').insert({
      user_id: user.id,
      integration_name: requestFormData.value.integration.trim(),
      request_type: 'request',
    })

    requestedIntegrations.value.add('custom')
    showRequestForm.value = false
    requestFormData.value = { name: '', email: '', integration: '' }
    toast.success('Request submitted!', {
      description: 'We\'ll reach out to discuss your needs.',
    })
  } catch (error) {
    toast.error('Failed to save request')
  } finally {
    isSubmittingRequest.value = false
  }
}

// =============================================================================
// UNSAVED CHANGES TRACKING
// =============================================================================

// Simple dirty flag - set true when files dropped, false when saved
const hasUnsavedChanges = ref(false)

// Dialog state for navigation confirmation
const showDiscardDialog = ref(false)
const pendingNavigationPath = ref<string | null>(null)

// Navigation guard - intercept route changes when there are unsaved changes
onBeforeRouteLeave((to, _from, next) => {
  if (hasUnsavedChanges.value && !pendingNavigationPath.value) {
    pendingNavigationPath.value = to.fullPath
    showDiscardDialog.value = true
    next(false)
  } else {
    next()
  }
})

function handleDiscardCancel() {
  showDiscardDialog.value = false
  pendingNavigationPath.value = null
}

function handleDiscardConfirm() {
  showDiscardDialog.value = false
  // Clear the unsaved state
  parsedCustomers.value = []
  parsedSubscriptions.value = []
  parsedInvoices.value = []
  stripeCustomersFile.value = null
  stripeSubscriptionsFile.value = null
  stripeInvoicesFile.value = null
  reconciliationReport.value = null
  showReconciliation.value = false
  hasUnsavedChanges.value = false
  // Reset pending deletions (user chose to discard changes)
  pendingCostsDeletion.value = false
  pendingUsageDeletion.value = false
  pendingRevenueDeletion.value = false
  // Navigate to the pending destination
  if (pendingNavigationPath.value) {
    const path = pendingNavigationPath.value
    pendingNavigationPath.value = null
    router.push(path)
  }
}

async function handleSaveAndLeave() {
  showDiscardDialog.value = false
  try {
    // Process any pending deletions
    const deletionPromises: Promise<void>[] = []
    if (pendingCostsDeletion.value) deletionPromises.push(clearCostData())
    if (pendingUsageDeletion.value) deletionPromises.push(clearUsageData())
    if (pendingRevenueDeletion.value) deletionPromises.push(clearRevenueData())
    if (deletionPromises.length > 0) {
      await Promise.all(deletionPromises)
      await refetchDataMode()
    }

    // Reset state
    pendingCostsDeletion.value = false
    pendingUsageDeletion.value = false
    pendingRevenueDeletion.value = false
    hasUnsavedChanges.value = false

    // Navigate to pending destination
    if (pendingNavigationPath.value) {
      const path = pendingNavigationPath.value
      pendingNavigationPath.value = null
      router.push(path)
    }
  } catch (error) {
    toast.error('Failed to save changes', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  }
}

async function handleContinue() {
  // User clicked "Save and Analyze" - process any pending deletions
  try {
    const deletionPromises: Promise<void>[] = []

    if (pendingCostsDeletion.value) {
      deletionPromises.push(clearCostData())
    }
    if (pendingUsageDeletion.value) {
      deletionPromises.push(clearUsageData())
    }
    if (pendingRevenueDeletion.value) {
      deletionPromises.push(clearRevenueData())
    }

    if (deletionPromises.length > 0) {
      await Promise.all(deletionPromises)
      await refetchDataMode()
    }

    // Reset pending deletion flags
    pendingCostsDeletion.value = false
    pendingUsageDeletion.value = false
    pendingRevenueDeletion.value = false

    // Clear the flag so the navigation guard doesn't trigger
    hasUnsavedChanges.value = false
    router.push('/')
  } catch (error) {
    toast.error('Failed to save changes', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  }
}

</script>

<template>
  <div class="space-y-8 max-w-3xl pb-24">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-semibold">Data Sources</h1>
      <p class="text-muted-foreground">
        Connect your data to see pricing insights
      </p>
    </div>

    <!-- Sample Data Hero -->
    <Card class="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
      <CardContent class="p-6">
        <div class="flex items-center gap-2 mb-3">
          <TrendingUp class="h-5 w-5 text-primary" />
          <h2 class="font-semibold">See it in action first</h2>
        </div>
        <p class="text-sm text-muted-foreground mb-4">
          Load 6 months of realistic SaaS data:
        </p>
        <ul class="text-sm text-muted-foreground space-y-1 mb-5">
          <li>• 30 customers across 4 pricing tiers</li>
          <li>• Revenue, costs, and usage data</li>
          <li>• Real margin compression and churn risk scenarios</li>
        </ul>
        <Button @click="handleTrySampleData" :disabled="isLoadingSample">
          <TrendingUp class="h-4 w-4 mr-2" />
          {{ isLoadingSample ? 'Loading...' : 'Load Complete Demo Dataset' }}
        </Button>
      </CardContent>
    </Card>

    <!-- Divider -->
    <div class="relative">
      <div class="absolute inset-0 flex items-center">
        <div class="w-full border-t"></div>
      </div>
      <div class="relative flex justify-center text-xs uppercase">
        <span class="bg-background px-3 text-muted-foreground">or connect your own</span>
      </div>
    </div>

    <!-- REVENUE Section -->
    <section>
      <div class="flex items-center gap-2 mb-4">
        <DollarSign class="h-5 w-5 text-muted-foreground" />
        <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Revenue</h2>
      </div>

      <Card>
        <CardContent class="p-5 space-y-4">
          <!-- Stripe Connect -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="h-10 w-10 rounded-lg bg-[#635BFF]/10 flex items-center justify-center">
                <svg class="h-5 w-5" viewBox="0 0 24 24" fill="#635BFF">
                  <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
                </svg>
              </div>
              <div>
                <p class="font-medium">Stripe</p>
                <p class="text-xs text-muted-foreground">Pull customers, subscriptions, and invoices</p>
              </div>
            </div>
            <Button variant="outline" size="sm" disabled class="opacity-60">
              Coming Soon
            </Button>
          </div>

          <!-- Divider -->
          <div class="relative">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t"></div>
            </div>
            <div class="relative flex justify-center text-xs">
              <span class="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <!-- Hidden file input (multiple) -->
          <input
            ref="stripeFileInput"
            type="file"
            accept=".csv"
            multiple
            class="hidden"
            @change="handleStripeFileSelect"
          />

          <!-- Stripe CSV Dropzone - only show when < 3 files -->
          <div
            v-if="stripeFileCount < 3"
            :class="[
              'border-2 border-dashed rounded-lg p-5 transition-colors',
              isDraggingStripe
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25'
            ]"
            @dragover.prevent="isDraggingStripe = true"
            @dragleave.prevent="isDraggingStripe = false"
            @drop.prevent="handleStripeDrop"
          >
            <div
              class="text-center cursor-pointer"
              @click="triggerFileInput('stripe')"
            >
              <Upload class="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
              <p class="text-sm text-muted-foreground">
                Drop your Stripe exports here or <span class="text-primary font-medium">browse</span>
              </p>
              <p class="text-xs text-muted-foreground/60 mt-1">Drop all 3 files at once or one at a time</p>
            </div>
          </div>

          <!-- File slots - only show when at least 1 file uploaded -->
          <div v-if="stripeFileCount > 0" class="space-y-2 border rounded-lg p-4" :class="{ 'mt-4': stripeFileCount < 3 }">
            <!-- Customers slot -->
            <div class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-2">
                <CheckCircle v-if="stripeCustomersFile" class="h-4 w-4 text-green-500" />
                <div v-else class="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                <span :class="stripeCustomersFile ? 'text-foreground' : 'text-muted-foreground'">
                  {{ stripeCustomersFile?.name || 'customers.csv' }}
                </span>
              </div>
              <button
                v-if="stripeCustomersFile"
                type="button"
                class="p-0.5 rounded hover:bg-muted transition-colors"
                @click="clearStripeFile('customers')"
              >
                <X class="h-3 w-3 text-muted-foreground" />
              </button>
            </div>

            <!-- Subscriptions slot -->
            <div class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-2">
                <CheckCircle v-if="stripeSubscriptionsFile" class="h-4 w-4 text-green-500" />
                <div v-else class="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                <span :class="stripeSubscriptionsFile ? 'text-foreground' : 'text-muted-foreground'">
                  {{ stripeSubscriptionsFile?.name || 'subscriptions.csv' }}
                </span>
              </div>
              <button
                v-if="stripeSubscriptionsFile"
                type="button"
                class="p-0.5 rounded hover:bg-muted transition-colors"
                @click="clearStripeFile('subscriptions')"
              >
                <X class="h-3 w-3 text-muted-foreground" />
              </button>
            </div>

            <!-- Invoices slot (optional) -->
            <div class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-2">
                <CheckCircle v-if="stripeInvoicesFile" class="h-4 w-4 text-green-500" />
                <div v-else class="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                <span :class="stripeInvoicesFile ? 'text-foreground' : 'text-muted-foreground'">
                  {{ stripeInvoicesFile?.name || 'invoices.csv' }}
                  <span v-if="!stripeInvoicesFile" class="text-muted-foreground/50">(optional)</span>
                </span>
              </div>
              <button
                v-if="stripeInvoicesFile"
                type="button"
                class="p-0.5 rounded hover:bg-muted transition-colors"
                @click="clearStripeFile('invoices')"
              >
                <X class="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          </div>

          <!-- Reconcile button - only show when subscriptions are uploaded -->
          <div v-if="canReconcile && !showReconciliation" class="flex justify-center">
            <Button
              @click="handleReconcile"
              :disabled="isReconciling"
              class="w-full sm:w-auto"
            >
              <Loader2 v-if="isReconciling" class="h-4 w-4 mr-2 animate-spin" />
              {{ isReconciling ? 'Processing...' : 'Reconcile Data' }}
            </Button>
          </div>

          <!-- Reconciliation Report -->
          <div v-if="showReconciliation && reconciliationReport" class="border rounded-lg p-4 space-y-3 bg-muted/30">
            <div class="flex items-center gap-2">
              <CheckCircle class="h-5 w-5 text-green-500" />
              <h3 class="font-medium">Data Reconciliation</h3>
            </div>

            <div class="space-y-2 text-sm">
              <!-- Customers -->
              <div v-if="reconciliationReport.customersTotal > 0" class="flex items-center gap-2">
                <Check class="h-4 w-4 text-green-500" />
                <span>{{ reconciliationReport.customersTotal }} customers found</span>
              </div>

              <!-- Subscriptions matched -->
              <div class="flex items-center gap-2">
                <Check class="h-4 w-4 text-green-500" />
                <span>
                  {{ reconciliationReport.subscriptionsMatched }} subscriptions matched
                  <span v-if="reconciliationReport.customersTotal > 0" class="text-muted-foreground">
                    ({{ Math.round((reconciliationReport.subscriptionsMatched / reconciliationReport.subscriptionsTotal) * 100) }}%)
                  </span>
                </span>
              </div>

              <!-- Orphaned subscriptions warning -->
              <div v-if="reconciliationReport.subscriptionsOrphaned > 0" class="flex items-center gap-2 text-amber-600">
                <AlertTriangle class="h-4 w-4" />
                <span>{{ reconciliationReport.subscriptionsOrphaned }} subscriptions with no matching customer</span>
              </div>

              <!-- Active subscriptions -->
              <div class="flex items-center gap-2">
                <Check class="h-4 w-4 text-green-500" />
                <span>{{ reconciliationReport.activeSubscriptions }} active subscriptions</span>
              </div>

              <!-- Canceled subscriptions (churn data) -->
              <div v-if="reconciliationReport.canceledSubscriptions > 0" class="flex items-center gap-2">
                <Check class="h-4 w-4 text-green-500" />
                <span>{{ reconciliationReport.canceledSubscriptions }} canceled (churn data available)</span>
              </div>

              <!-- Total MRR -->
              <div class="pt-2 border-t mt-2">
                <div class="flex items-center justify-between">
                  <span class="font-medium">Calculated MRR:</span>
                  <span class="text-lg font-semibold text-green-600">
                    {{ formatCurrency(reconciliationReport.totalMrr) }}
                  </span>
                </div>
              </div>

              <!-- Warnings -->
              <div v-if="reconciliationReport.warnings.length > 0" class="pt-2 space-y-1">
                <div
                  v-for="warning in reconciliationReport.warnings"
                  :key="warning"
                  class="text-xs text-amber-600 flex items-center gap-1"
                >
                  <AlertTriangle class="h-3 w-3" />
                  {{ warning }}
                </div>
              </div>
            </div>

            <!-- Upload button -->
            <div class="pt-3 border-t">
              <Button
                @click="handleUploadAndContinue"
                :disabled="isUploading"
                class="w-full"
              >
                <Loader2 v-if="isUploading" class="h-4 w-4 mr-2 animate-spin" />
                {{ isUploading ? 'Uploading...' : 'Continue to Analysis' }}
                <ArrowRight v-if="!isUploading" class="h-4 w-4 ml-2" />
              </Button>
              <p v-if="uploadError" class="text-xs text-red-500 mt-2 text-center">
                {{ uploadError }}
              </p>
            </div>
          </div>

          <!-- Action links -->
          <div class="flex items-center justify-center gap-4">
            <button
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground transition-opacity"
              :class="{ 'opacity-50 cursor-not-allowed': isLoadingRevenue }"
              :disabled="isLoadingRevenue"
              @click="handleUseSampleRevenue"
            >
              {{ isLoadingRevenue ? 'Loading...' : 'Use sample revenue' }}
            </button>
            <span class="text-muted-foreground/30">|</span>
            <button
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              @click="showStripeInstructions = !showStripeInstructions"
            >
              <Info class="h-3 w-3" />
              How to export from Stripe
              <ChevronDown
                :class="[
                  'h-3 w-3 transition-transform',
                  showStripeInstructions ? 'rotate-180' : ''
                ]"
              />
            </button>
          </div>

          <!-- Stripe export instructions (collapsible) -->
          <div v-if="showStripeInstructions" class="bg-muted/50 rounded-lg p-4 text-sm space-y-3">
            <p class="font-medium">Export these CSVs from your Stripe Dashboard:</p>
            <div class="space-y-2">
              <div class="flex items-start gap-2">
                <span class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">1</span>
                <div>
                  <p class="font-medium">Customers</p>
                  <p class="text-muted-foreground text-xs">Customers → Export</p>
                </div>
              </div>
              <div class="flex items-start gap-2">
                <span class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">2</span>
                <div>
                  <p class="font-medium">Subscriptions</p>
                  <p class="text-muted-foreground text-xs">Billing → Subscriptions → Export</p>
                </div>
              </div>
              <div class="flex items-start gap-2">
                <span class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">3</span>
                <div>
                  <p class="font-medium">Invoices <span class="text-muted-foreground">(optional)</span></p>
                  <p class="text-muted-foreground text-xs">Billing → Invoices → Export</p>
                </div>
              </div>
            </div>
            <p class="text-xs text-muted-foreground">
              We auto-detect file types from the CSV headers. Just drop them all in!
            </p>
          </div>
        </CardContent>
      </Card>
    </section>

    <!-- AI COSTS Section -->
    <section>
      <div class="flex items-center gap-2 mb-4">
        <Cpu class="h-5 w-5 text-muted-foreground" />
        <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">AI Costs</h2>
      </div>

      <Card>
        <CardContent class="p-5 space-y-4">
          <!-- OpenAI -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="h-10 w-10 rounded-lg bg-black flex items-center justify-center">
                <svg class="h-5 w-5" viewBox="0 0 24 24" fill="white">
                  <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
                </svg>
              </div>
              <div>
                <p class="font-medium">OpenAI</p>
                <p class="text-xs text-muted-foreground">Pull monthly usage and token costs</p>
              </div>
            </div>
            <Button variant="outline" size="sm" disabled class="opacity-60">
              Coming Soon
            </Button>
          </div>

          <!-- Anthropic -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="h-10 w-10 rounded-lg bg-[#D4A574]/10 flex items-center justify-center">
                <span class="text-lg font-semibold text-[#D4A574]">A</span>
              </div>
              <div>
                <p class="font-medium">Anthropic</p>
                <p class="text-xs text-muted-foreground">Pull monthly usage and token costs</p>
              </div>
            </div>
            <Button variant="outline" size="sm" disabled class="opacity-60">
              Coming Soon
            </Button>
          </div>

          <!-- Divider -->
          <div class="relative">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t"></div>
            </div>
            <div class="relative flex justify-center text-xs">
              <span class="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <!-- Hidden file input -->
          <input
            ref="costsFileInput"
            type="file"
            accept=".csv"
            class="hidden"
            @change="(e) => handleFileSelect(e, 'costs')"
          />

          <!-- Drop zone - only show when no file -->
          <div
            v-if="!costsFile"
            :class="[
              'border-2 border-dashed rounded-lg p-5 transition-colors',
              isDraggingCosts
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25'
            ]"
            @dragover.prevent="isDraggingCosts = true"
            @dragleave.prevent="isDraggingCosts = false"
            @drop.prevent="(e) => handleDrop(e, 'costs')"
          >
            <div
              class="text-center cursor-pointer"
              @click="triggerFileInput('costs')"
            >
              <Upload class="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
              <p class="text-sm text-muted-foreground">
                Drop one CSV here or <span class="text-primary font-medium">browse</span>
              </p>
            </div>
          </div>

          <!-- File display - only show when file exists -->
          <div v-if="costsFile" class="border rounded-lg p-4">
            <div class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-2">
                <CheckCircle class="h-4 w-4 text-green-500" />
                <span>{{ costsFile.name }}</span>
              </div>
              <button
                type="button"
                class="p-0.5 rounded hover:bg-muted transition-colors"
                @click="clearFile('costs')"
              >
                <X class="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          <div class="flex items-center justify-center gap-4">
            <button
              type="button"
              class="text-xs text-primary hover:underline flex items-center gap-1"
              @click="downloadTemplate('costs')"
            >
              <Download class="h-3 w-3" />
              Download template
            </button>
            <span class="text-muted-foreground/30">|</span>
            <button
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground transition-opacity"
              :class="{ 'opacity-50 cursor-not-allowed': isLoadingCosts }"
              :disabled="isLoadingCosts"
              @click="handleUseSampleData('costs')"
            >
              {{ isLoadingCosts ? 'Loading...' : 'Use sample costs' }}
            </button>
          </div>
        </CardContent>
      </Card>
    </section>

    <!-- USAGE Section -->
    <section>
      <div class="flex items-center gap-2 mb-4">
        <BarChart3 class="h-5 w-5 text-muted-foreground" />
        <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Usage</h2>
      </div>

      <Card>
        <CardContent class="p-5 space-y-4">
          <!-- Hidden file input -->
          <input
            ref="usageFileInput"
            type="file"
            accept=".csv"
            class="hidden"
            @change="(e) => handleFileSelect(e, 'usage')"
          />

          <!-- Drop zone - only show when no file -->
          <div
            v-if="!usageFile"
            :class="[
              'border-2 border-dashed rounded-lg p-5 transition-colors',
              isDraggingUsage
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25'
            ]"
            @dragover.prevent="isDraggingUsage = true"
            @dragleave.prevent="isDraggingUsage = false"
            @drop.prevent="(e) => handleDrop(e, 'usage')"
          >
            <div
              class="text-center cursor-pointer"
              @click="triggerFileInput('usage')"
            >
              <Upload class="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
              <p class="text-sm text-muted-foreground">
                Drop one CSV here or <span class="text-primary font-medium">browse</span>
              </p>
            </div>
          </div>

          <!-- File display - only show when file exists -->
          <div v-if="usageFile" class="border rounded-lg p-4">
            <div class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-2">
                <CheckCircle class="h-4 w-4 text-green-500" />
                <span>{{ usageFile.name }}</span>
              </div>
              <button
                type="button"
                class="p-0.5 rounded hover:bg-muted transition-colors"
                @click="clearFile('usage')"
              >
                <X class="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          <div class="flex items-center justify-center gap-4">
            <button
              type="button"
              class="text-xs text-primary hover:underline flex items-center gap-1"
              @click="downloadTemplate('usage')"
            >
              <Download class="h-3 w-3" />
              Download template
            </button>
            <span class="text-muted-foreground/30">|</span>
            <button
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground transition-opacity"
              :class="{ 'opacity-50 cursor-not-allowed': isLoadingUsage }"
              :disabled="isLoadingUsage"
              @click="handleUseSampleData('usage')"
            >
              {{ isLoadingUsage ? 'Loading...' : 'Use sample usage' }}
            </button>
          </div>

          <!-- Stripe metered billing note -->
          <Alert variant="info" class="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <Info class="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <div class="ml-2">
              <p class="text-sm font-medium text-blue-800 dark:text-blue-200">Using Stripe metered billing?</p>
              <p class="text-xs text-blue-700 dark:text-blue-300 mt-1">
                If you connected Stripe above and use Billing Meters or Usage Records,
                we'll detect and pull usage automatically. No CSV needed.
              </p>
            </div>
          </Alert>
        </CardContent>
      </Card>
    </section>

    <!-- COMING SOON Section -->
    <section>
      <div class="flex items-center gap-2 mb-4">
        <Clock class="h-5 w-5 text-muted-foreground" />
        <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Coming Soon</h2>
      </div>

      <Card>
        <CardContent class="p-5 space-y-3">
          <!-- Salesforce -->
          <div class="flex items-center justify-between py-1">
            <div class="flex items-center gap-3">
              <div class="h-8 w-8 rounded bg-[#00A1E0]/10 flex items-center justify-center">
                <span class="text-xs font-bold text-[#00A1E0]">SF</span>
              </div>
              <span class="font-medium">Salesforce</span>
            </div>
            <Button
              v-if="!requestedIntegrations.has('Salesforce')"
              variant="ghost"
              size="sm"
              @click="handleNotifyMe('Salesforce')"
            >
              <Bell class="h-3.5 w-3.5 mr-1.5" />
              Notify me
            </Button>
            <span v-else class="text-xs text-green-600 flex items-center gap-1">
              <Check class="h-3.5 w-3.5" />
              On the list
            </span>
          </div>

          <!-- HubSpot -->
          <div class="flex items-center justify-between py-1">
            <div class="flex items-center gap-3">
              <div class="h-8 w-8 rounded bg-[#FF7A59]/10 flex items-center justify-center">
                <span class="text-xs font-bold text-[#FF7A59]">HS</span>
              </div>
              <span class="font-medium">HubSpot</span>
            </div>
            <Button
              v-if="!requestedIntegrations.has('HubSpot')"
              variant="ghost"
              size="sm"
              @click="handleNotifyMe('HubSpot')"
            >
              <Bell class="h-3.5 w-3.5 mr-1.5" />
              Notify me
            </Button>
            <span v-else class="text-xs text-green-600 flex items-center gap-1">
              <Check class="h-3.5 w-3.5" />
              On the list
            </span>
          </div>

          <!-- QuickBooks -->
          <div class="flex items-center justify-between py-1">
            <div class="flex items-center gap-3">
              <div class="h-8 w-8 rounded bg-[#2CA01C]/10 flex items-center justify-center">
                <span class="text-xs font-bold text-[#2CA01C]">QB</span>
              </div>
              <span class="font-medium">QuickBooks</span>
            </div>
            <Button
              v-if="!requestedIntegrations.has('QuickBooks')"
              variant="ghost"
              size="sm"
              @click="handleNotifyMe('QuickBooks')"
            >
              <Bell class="h-3.5 w-3.5 mr-1.5" />
              Notify me
            </Button>
            <span v-else class="text-xs text-green-600 flex items-center gap-1">
              <Check class="h-3.5 w-3.5" />
              On the list
            </span>
          </div>

          <!-- Request integration -->
          <div class="pt-3 border-t">
            <button
              v-if="!requestedIntegrations.has('custom')"
              class="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 group"
              @click="openRequestForm"
            >
              Need something else?
              <span class="text-primary font-medium group-hover:underline flex items-center gap-1">
                Request integration
                <ArrowRight class="h-3.5 w-3.5" />
              </span>
            </button>
            <span v-else class="text-sm text-green-600 flex items-center gap-1">
              <Check class="h-4 w-4" />
              Request submitted - we'll be in touch!
            </span>
          </div>

          <!-- Request Form (inline) -->
          <div v-if="showRequestForm" class="pt-3 border-t space-y-3">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium">What integration do you need?</p>
              <span class="text-xs text-muted-foreground">
                {{ requestFormData.integration.length }}/100
              </span>
            </div>
            <input
              v-model="requestFormData.integration"
              type="text"
              maxlength="100"
              placeholder="e.g., Xero, Chargebee, Recurly..."
              class="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              :class="{ 'border-destructive': requestFormData.integration.length > 0 && requestFormData.integration.trim().length < 2 }"
            />
            <p v-if="requestFormData.integration.length > 0 && requestFormData.integration.trim().length < 2" class="text-xs text-destructive">
              Please enter at least 2 characters
            </p>
            <div class="flex gap-2">
              <Button
                size="sm"
                :disabled="isSubmittingRequest || requestFormData.integration.trim().length < 2"
                @click="submitRequestForm"
              >
                {{ isSubmittingRequest ? 'Submitting...' : 'Submit Request' }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                @click="showRequestForm = false; requestFormData.integration = ''"
              >
                Cancel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  </div>

  <!-- Sticky Progress Bar -->
  <div
    v-if="hasAnyData"
    class="fixed bottom-0 ml-64 left-0 right-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50"
  >
    <div class="container max-w-3xl py-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-6">
          <div
            v-for="item in uploadProgress"
            :key="item.label"
            class="flex items-center gap-2 text-sm"
          >
            <div
              :class="[
                'h-5 w-5 rounded-full flex items-center justify-center',
                item.done
                  ? 'bg-green-500 text-white'
                  : 'border-2 border-muted-foreground/30'
              ]"
            >
              <Check v-if="item.done" class="h-3 w-3" />
            </div>
            <span :class="item.done ? 'text-foreground font-medium' : 'text-muted-foreground'">
              {{ item.label }}
            </span>
          </div>
        </div>
        <Button @click="handleContinue" :disabled="!hasAnyData">
          Save and Analyze
          <ArrowRight class="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  </div>

  <!-- Discard Changes Confirmation Dialog -->
  <ConfirmDialog
    :open="showDiscardDialog"
    title="You have unsaved changes"
    description="Would you like to save your changes before leaving?"
    cancel-text="Stay"
    confirm-text="Discard"
    :destructive="true"
    :show-secondary="true"
    secondary-text="Save & Leave"
    @cancel="handleDiscardCancel"
    @confirm="handleDiscardConfirm"
    @secondary="handleSaveAndLeave"
  />
</template>
