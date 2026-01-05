<script setup lang="ts">
/**
 * DataSourcesPage - Main data sources configuration page.
 *
 * Orchestrates the data import flow:
 * - Sample data loading (all sections at once)
 * - Individual section management (revenue, costs, usage)
 * - Progress tracking and navigation
 * - Unsaved changes confirmation
 */

import { ref, watch, onMounted, onUnmounted } from 'vue'
import { toast } from 'vue-sonner'
import { TrendingUp } from 'lucide-vue-next'
import { getStripeStatus, disconnectStripe } from '@/api/client'
import { Card, CardContent, Button } from '@/components/ui'
import {
  RevenueSection,
  CostsSection,
  UsageSection,
  ComingSoonSection,
} from '@/components/data-sources'
import StripeApiKeyModal from '@/components/integrations/StripeApiKeyModal.vue'
import { useDataMode } from '@/composables/useDataMode'
import {
  loadSampleRevenue,
  loadSampleCosts,
  loadSampleUsage,
  clearCostData,
  clearUsageData,
  clearRevenueData,
} from '@/lib/supabase-data'

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

const {
  dataMode,
  refetch: refetchDataMode,
  hasRevenue,
  hasCosts,
  hasUsage,
  lastSyncAt,
  switchToSampleData,
} = useDataMode()

// Sync cadence constants (best practices for billing data)
const SYNC_STALE_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour - sync if older
const SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours - background sync interval
let syncIntervalId: ReturnType<typeof setInterval> | null = null

/** Check if data is stale and needs refresh */
function isDataStale(): boolean {
  if (!lastSyncAt.value) return true
  const lastSync = new Date(lastSyncAt.value).getTime()
  const now = Date.now()
  return (now - lastSync) > SYNC_STALE_THRESHOLD_MS
}

/** Track file state for each section */
const revenueFiles = ref<{ customers: boolean; subscriptions: boolean; invoices: boolean }>({
  customers: false,
  subscriptions: false,
  invoices: false,
})
const costsFile = ref<{ name: string; isSample: boolean } | null>(null)
const usageFile = ref<{ name: string; isSample: boolean } | null>(null)

/** Loading states for sample data */
const isLoadingSample = ref(false)
const isLoadingRevenue = ref(false)
const isLoadingCosts = ref(false)
const isLoadingUsage = ref(false)

/** Stripe API Key Modal */
const showStripeModal = ref(false)
const isStripeConnected = ref(false)
const stripeAccountName = ref('')
const isSyncing = ref(false)

/** Component refs */
const revenueSectionRef = ref<InstanceType<typeof RevenueSection> | null>(null)

// =============================================================================
// LIFECYCLE - Check Stripe status and auto-sync
// =============================================================================

onMounted(async () => {
  try {
    const status = await getStripeStatus()
    if (status.connected) {
      isStripeConnected.value = true
      stripeAccountName.value = status.account_name || ''

      // Auto-sync if data is stale (older than 1 hour)
      if (isDataStale()) {
        toast.info('Refreshing Stripe data...')
        await handleStripeSync()
      }

      // Set up background sync (every 4 hours)
      syncIntervalId = setInterval(async () => {
        if (isStripeConnected.value && !isSyncing.value) {
          console.log('[Stripe] Background sync triggered')
          await handleStripeSync()
        }
      }, SYNC_INTERVAL_MS)
    }
  } catch {
    // Silently fail - user just hasn't connected Stripe yet
  }
})

onUnmounted(() => {
  // Clean up sync interval
  if (syncIntervalId) {
    clearInterval(syncIntervalId)
    syncIntervalId = null
  }
})

// =============================================================================
// SAMPLE DATA HANDLERS
// =============================================================================

/**
 * Load all sample data at once.
 * This is the primary CTA for trying the product.
 */
async function handleTrySampleData(): Promise<void> {
  console.log('[Sample Data] Button clicked, starting load...')
  isLoadingSample.value = true
  try {
    console.log('[Sample Data] Calling switchToSampleData...')
    await switchToSampleData()
    console.log('[Sample Data] switchToSampleData completed, refetching...')
    await refetchDataMode()

    // Update file indicators
    revenueFiles.value = { customers: true, subscriptions: true, invoices: true }
    costsFile.value = { name: 'sample-costs.csv', isSample: true }
    usageFile.value = { name: 'sample-usage.csv', isSample: true }

    // Update the RevenueSection component to show sample files
    revenueSectionRef.value?.setSampleDataLoaded()

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

/**
 * Load sample revenue data only.
 */
async function handleUseSampleRevenue(): Promise<void> {
  isLoadingRevenue.value = true
  try {
    await loadSampleRevenue()
    await refetchDataMode()
    revenueFiles.value = { customers: true, subscriptions: true, invoices: true }

    // Update the RevenueSection component to show sample files
    revenueSectionRef.value?.setSampleDataLoaded()

    toast.success('Sample revenue data loaded!')
  } catch (error) {
    toast.error('Failed to load sample revenue data', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  } finally {
    isLoadingRevenue.value = false
  }
}

/**
 * Load sample cost data only.
 */
async function handleUseSampleCosts(): Promise<void> {
  isLoadingCosts.value = true
  try {
    await loadSampleCosts()
    await refetchDataMode()
    costsFile.value = { name: 'sample-costs.csv', isSample: true }
    toast.success('Sample costs data loaded!')
  } catch (error) {
    toast.error('Failed to load sample costs data', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  } finally {
    isLoadingCosts.value = false
  }
}

/**
 * Load sample usage data only.
 */
async function handleUseSampleUsage(): Promise<void> {
  isLoadingUsage.value = true
  try {
    await loadSampleUsage()
    await refetchDataMode()
    usageFile.value = { name: 'sample-usage.csv', isSample: true }
    toast.success('Sample usage data loaded!')
  } catch (error) {
    toast.error('Failed to load sample usage data', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  } finally {
    isLoadingUsage.value = false
  }
}

// =============================================================================
// FILE CHANGE HANDLERS
// =============================================================================

function handleRevenueFilesChanged(): void {
  // Revenue files updated - data is auto-saved by the component
}

async function handleRevenueFilesCleared(): Promise<void> {
  revenueFiles.value = { customers: false, subscriptions: false, invoices: false }
  try {
    await clearRevenueData()
    await refetchDataMode()
    toast.success('Revenue data cleared')
  } catch (error) {
    toast.error('Failed to clear revenue data', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  }
}

async function handleCostsFileUploaded(file: { name: string; isSample: boolean }): Promise<void> {
  costsFile.value = file
  await refetchDataMode()
}

async function handleCostsFileCleared(): Promise<void> {
  costsFile.value = null
  try {
    await clearCostData()
    await refetchDataMode()
    toast.success('Cost data cleared')
  } catch (error) {
    toast.error('Failed to clear cost data', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  }
}

async function handleUsageFileUploaded(file: { name: string; isSample: boolean }): Promise<void> {
  usageFile.value = file
  await refetchDataMode()
}

async function handleUsageFileCleared(): Promise<void> {
  usageFile.value = null
  try {
    await clearUsageData()
    await refetchDataMode()
    toast.success('Usage data cleared')
  } catch (error) {
    toast.error('Failed to clear usage data', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  }
}

function handleStripeConnect(): void {
  showStripeModal.value = true
}

async function handleStripeConnected(accountName: string): Promise<void> {
  isStripeConnected.value = true
  stripeAccountName.value = accountName
  toast.success(`Connected to ${accountName}. Syncing data...`)

  // Auto-sync immediately after connecting
  await handleStripeSync()

  // Set up background sync if not already running
  if (!syncIntervalId) {
    syncIntervalId = setInterval(async () => {
      if (isStripeConnected.value && !isSyncing.value) {
        console.log('[Stripe] Background sync triggered')
        await handleStripeSync()
      }
    }, SYNC_INTERVAL_MS)
  }
}

async function handleStripeSync(): Promise<void> {
  if (isSyncing.value) return // Prevent duplicate syncs

  isSyncing.value = true
  try {
    const { syncStripeDataEnhanced } = await import('@/api/client')
    const { saveStripeData } = await import('@/lib/supabase-data')
    const result = await syncStripeDataEnhanced()

    // Save to Supabase
    await saveStripeData(result)

    toast.success(`Synced ${result.summary.total_customers} customers, ${result.summary.active_subscriptions} subscriptions`)
    await refetchDataMode()
  } catch (error) {
    toast.error('Sync failed', {
      description: error instanceof Error ? error.message : 'Please try again',
    })
  } finally {
    isSyncing.value = false
  }
}

async function handleStripeDisconnect(): Promise<void> {
  try {
    // Call backend to disconnect and clear synced data
    await disconnectStripe(true)

    // Clear local state
    isStripeConnected.value = false
    stripeAccountName.value = ''

    // Clear file indicators
    revenueFiles.value = { customers: false, subscriptions: false, invoices: false }

    // Stop background sync
    if (syncIntervalId) {
      clearInterval(syncIntervalId)
      syncIntervalId = null
    }

    // Refresh data mode
    await refetchDataMode()

    toast.success('Stripe disconnected and data cleared')
  } catch (error) {
    toast.error('Failed to disconnect Stripe', {
      description: error instanceof Error ? error.message : 'Please try again',
    })
  }
}

// =============================================================================
// DATA RESTORATION
// =============================================================================

// Restore file display state when returning to page with existing data
watch(
  [hasRevenue, hasCosts, hasUsage, () => dataMode.value],
  ([hasRev, hasCst, hasUsg, mode]) => {
    if (mode === 'sample') {
      if (hasRev) {
        revenueFiles.value = { customers: true, subscriptions: true, invoices: true }
        // Update RevenueSection UI to show sample files
        revenueSectionRef.value?.setSampleDataLoaded()
      }
      if (hasCst && !costsFile.value) {
        costsFile.value = { name: 'sample-costs.csv', isSample: true }
      }
      if (hasUsg && !usageFile.value) {
        usageFile.value = { name: 'sample-usage.csv', isSample: true }
      }
    } else if (mode === 'user') {
      if (hasRev) {
        revenueFiles.value = { customers: false, subscriptions: true, invoices: false }
        // Update RevenueSection UI to show user files
        revenueSectionRef.value?.setSampleDataLoaded()
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
          <li>- 30 customers across 4 pricing tiers</li>
          <li>- Revenue, costs, and usage data</li>
          <li>- Real margin compression and churn risk scenarios</li>
        </ul>
        <Button @click="handleTrySampleData" :disabled="isLoadingSample">
          <TrendingUp class="h-4 w-4 mr-2" />
          {{ isLoadingSample ? 'Loading...' : 'Try Sample Data' }}
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

    <!-- Revenue Section -->
    <RevenueSection
      ref="revenueSectionRef"
      :is-loading-sample="isLoadingRevenue"
      :is-stripe-connected="isStripeConnected"
      :stripe-account-name="stripeAccountName"
      :is-syncing="isSyncing"
      @use-sample="handleUseSampleRevenue"
      @connect-stripe="handleStripeConnect"
      @sync-stripe="handleStripeSync"
      @disconnect-stripe="handleStripeDisconnect"
      @files-changed="handleRevenueFilesChanged"
      @all-files-cleared="handleRevenueFilesCleared"
    />

    <!-- Costs Section -->
    <CostsSection
      :file="costsFile"
      :is-loading-sample="isLoadingCosts"
      @file-uploaded="handleCostsFileUploaded"
      @file-cleared="handleCostsFileCleared"
      @use-sample="handleUseSampleCosts"
    />

    <!-- Usage Section -->
    <UsageSection
      :file="usageFile"
      :is-loading-sample="isLoadingUsage"
      @file-uploaded="handleUsageFileUploaded"
      @file-cleared="handleUsageFileCleared"
      @use-sample="handleUseSampleUsage"
    />

    <!-- Coming Soon Section -->
    <ComingSoonSection />
  </div>

  <!-- Stripe API Key Modal -->
  <StripeApiKeyModal
    :open="showStripeModal"
    @close="showStripeModal = false"
    @connected="handleStripeConnected"
  />
</template>
