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

import { ref, computed, watch } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { toast } from 'vue-sonner'
import { TrendingUp, Check, ArrowRight } from 'lucide-vue-next'
import { Card, CardContent, Button } from '@/components/ui'
import ConfirmDialog from '@/components/ui/confirm-dialog.vue'
import {
  RevenueSection,
  CostsSection,
  UsageSection,
  ComingSoonSection,
} from '@/components/data-sources'
import { useDataMode } from '@/composables/useDataMode'
import {
  loadSampleData as loadSampleDataToSupabase,
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

const router = useRouter()
const {
  dataMode,
  refetch: refetchDataMode,
  hasRevenue,
  hasCosts,
  hasUsage,
} = useDataMode()

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

/** Pending deletions (file removed but not yet saved) */
const pendingCostsDeletion = ref(false)
const pendingUsageDeletion = ref(false)
const pendingRevenueDeletion = ref(false)

/** Unsaved changes tracking */
const hasUnsavedChanges = ref(false)
const showDiscardDialog = ref(false)
const pendingNavigationPath = ref<string | null>(null)

/** Component refs */
const revenueSectionRef = ref<InstanceType<typeof RevenueSection> | null>(null)

// =============================================================================
// COMPUTED PROPERTIES
// =============================================================================

/** Whether any data has been uploaded (for showing progress bar) */
const hasAnyData = computed(() =>
  hasRevenue.value || hasCosts.value || hasUsage.value ||
  revenueFiles.value.subscriptions ||
  costsFile.value || usageFile.value
)

/** Progress tracking for the sticky bar */
const uploadProgress = computed(() => [
  { label: 'Revenue', done: hasRevenue.value && !pendingRevenueDeletion.value },
  { label: 'AI Costs', done: hasCosts.value && costsFile.value && !pendingCostsDeletion.value },
  { label: 'Usage', done: hasUsage.value && usageFile.value && !pendingUsageDeletion.value },
])

// =============================================================================
// SAMPLE DATA HANDLERS
// =============================================================================

/**
 * Load all sample data at once.
 * This is the primary CTA for trying the product.
 */
async function handleTrySampleData(): Promise<void> {
  isLoadingSample.value = true
  try {
    await loadSampleDataToSupabase()
    await refetchDataMode()

    // Reset all state
    hasUnsavedChanges.value = false
    pendingCostsDeletion.value = false
    pendingUsageDeletion.value = false
    pendingRevenueDeletion.value = false

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
    pendingRevenueDeletion.value = false
    hasUnsavedChanges.value = false

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
    pendingCostsDeletion.value = false
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
    pendingUsageDeletion.value = false
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
  hasUnsavedChanges.value = true
  pendingRevenueDeletion.value = false
}

function handleRevenueFilesCleared(): void {
  hasUnsavedChanges.value = true
  pendingRevenueDeletion.value = true
  revenueFiles.value = { customers: false, subscriptions: false, invoices: false }
}

function handleCostsFileUploaded(file: { name: string; isSample: boolean }): void {
  costsFile.value = file
  pendingCostsDeletion.value = false
  refetchDataMode()
}

function handleCostsFileCleared(): void {
  costsFile.value = null
  pendingCostsDeletion.value = true
  hasUnsavedChanges.value = true
}

function handleUsageFileUploaded(file: { name: string; isSample: boolean }): void {
  usageFile.value = file
  pendingUsageDeletion.value = false
  refetchDataMode()
}

function handleUsageFileCleared(): void {
  usageFile.value = null
  pendingUsageDeletion.value = true
  hasUnsavedChanges.value = true
}

function handleStripeConnect(): void {
  toast.info('Stripe integration coming soon')
}

// =============================================================================
// NAVIGATION HANDLERS
// =============================================================================

/**
 * Save changes and navigate to analysis.
 * Processes any pending deletions before navigating.
 */
async function handleContinue(): Promise<void> {
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

    // Reset state
    pendingCostsDeletion.value = false
    pendingUsageDeletion.value = false
    pendingRevenueDeletion.value = false
    hasUnsavedChanges.value = false

    router.push('/')
  } catch (error) {
    toast.error('Failed to save changes', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  }
}

// Navigation guard for unsaved changes
onBeforeRouteLeave((to, _from, next) => {
  if (hasUnsavedChanges.value && !pendingNavigationPath.value) {
    pendingNavigationPath.value = to.fullPath
    showDiscardDialog.value = true
    next(false)
  } else {
    next()
  }
})

function handleDiscardCancel(): void {
  showDiscardDialog.value = false
  pendingNavigationPath.value = null
}

function handleDiscardConfirm(): void {
  showDiscardDialog.value = false
  hasUnsavedChanges.value = false
  pendingCostsDeletion.value = false
  pendingUsageDeletion.value = false
  pendingRevenueDeletion.value = false

  if (pendingNavigationPath.value) {
    const path = pendingNavigationPath.value
    pendingNavigationPath.value = null
    router.push(path)
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
      @use-sample="handleUseSampleRevenue"
      @connect-stripe="handleStripeConnect"
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

  <!-- Sticky Progress Bar -->
  <div
    v-if="hasAnyData"
    class="fixed bottom-0 left-64 right-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-50"
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
    title="Discard changes to data sources?"
    description="Your uploaded files and connections will be lost."
    cancel-text="Cancel"
    confirm-text="Discard"
    :destructive="true"
    @cancel="handleDiscardCancel"
    @confirm="handleDiscardConfirm"
  />
</template>
