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

import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { TrendingUp, FlaskConical, Eye } from 'lucide-vue-next'
import { Card, CardContent, Button } from '@/components/ui'
import {
  RevenueSection,
  CostsSection,
  UsageSection,
  ComingSoonSection,
} from '@/components/data-sources'
import UsageLimitBanner from '@/components/shared/UsageLimitBanner.vue'
import { useDataMode } from '@/composables/useDataMode'
import { useDemoMode } from '@/composables/useDemoMode'
import { useTeam } from '@/composables/useTeam'
import { useEntitlement } from '@/composables/useEntitlement'
import {
  loadSampleData,
  clearRevenueData,
  clearCostData,
  clearUsageData,
} from '@/lib/api'

const { isViewer } = useTeam()

const csvUpload = useEntitlement('csv_upload')

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

const {
  dataMode,
  refetch: refetchDataMode,
  hasRevenue,
  hasCosts,
  hasUsage,
  switchToSampleData,
} = useDataMode()

const { isDemoMode, isLoadingDemo, enterDemoMode } = useDemoMode()



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


/** Component refs */
const revenueSectionRef = ref<InstanceType<typeof RevenueSection> | null>(null)


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
    await switchToSampleData()
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
    await loadSampleData()
    await refetchDataMode()
    revenueFiles.value = { customers: true, subscriptions: true, invoices: true }
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
    await loadSampleData()
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
    await loadSampleData()
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

    <!-- Viewer notice -->
    <div v-if="isViewer" class="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300">
      <Eye class="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <strong>Viewer access</strong> — You can see your team's data but cannot upload, modify, or clear data. Contact your team admin to make changes.
      </div>
    </div>

    <!-- Demo Mode Notice (when already in demo, admin only) -->
    <Card v-if="isDemoMode && !isViewer" class="border-amber-400/50 bg-amber-50 dark:bg-amber-950/20">
      <CardContent class="p-6">
        <div class="flex items-center gap-2 mb-2">
          <FlaskConical class="h-5 w-5 text-amber-600" />
          <h2 class="font-semibold text-amber-800 dark:text-amber-300">You're in demo mode</h2>
        </div>
        <p class="text-sm text-amber-700 dark:text-amber-400">
          You're exploring Tanso with realistic demo data. Data import and connection features are disabled in demo mode.
          Exit the demo from the banner above to connect your own data.
        </p>
      </CardContent>
    </Card>

    <!-- Try Demo Hero (only when not in demo mode and not viewer) -->
    <Card v-if="!isDemoMode && !isViewer" class="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
      <CardContent class="p-6">
        <div class="flex items-center gap-2 mb-3">
          <FlaskConical class="h-5 w-5 text-primary" />
          <h2 class="font-semibold">Try Demo Mode</h2>
        </div>
        <p class="text-sm text-muted-foreground mb-4">
          Explore the full dashboard with realistic pre-loaded SaaS data — no setup required:
        </p>
        <ul class="text-sm text-muted-foreground space-y-1 mb-5">
          <li>- 5 customers across Starter, Pro, and Enterprise plans</li>
          <li>- Revenue, AI costs, and feature usage data</li>
          <li>- Feature-level margin and model cost analytics</li>
        </ul>
        <div class="flex items-center gap-3">
          <Button @click="enterDemoMode" :disabled="isLoadingDemo">
            <FlaskConical class="h-4 w-4 mr-2" />
            {{ isLoadingDemo ? 'Loading Demo...' : 'Try Demo' }}
          </Button>
          <Button variant="outline" @click="handleTrySampleData" :disabled="isLoadingSample">
            <TrendingUp class="h-4 w-4 mr-2" />
            {{ isLoadingSample ? 'Loading...' : 'Load Sample Data Only' }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Divider (hidden in demo mode and for viewers) -->
    <div v-if="!isDemoMode && !isViewer" class="relative">
      <div class="absolute inset-0 flex items-center">
        <div class="w-full border-t"></div>
      </div>
      <div class="relative flex justify-center text-xs">
        <span class="bg-background px-3 text-muted-foreground">Or connect your own</span>
      </div>
    </div>

    <UsageLimitBanner
      v-if="!isDemoMode && !isViewer && csvUpload.hasLimit.value"
      feature-label="CSV Uploads"
      :allowed="csvUpload.allowed.value"
      :usage="csvUpload.usage.value"
      :limit="csvUpload.limit.value"
      :usage-percent="csvUpload.usagePercent.value"
      :bar-color="csvUpload.barColor.value"
      :has-limit="csvUpload.hasLimit.value"
    />

    <!-- Revenue Section (hidden in demo mode) -->
    <RevenueSection
      v-if="!isDemoMode"
      ref="revenueSectionRef"
      :is-loading-sample="isLoadingRevenue"
      :readonly="isViewer"
      @use-sample="handleUseSampleRevenue"
      @files-changed="handleRevenueFilesChanged"
      @all-files-cleared="handleRevenueFilesCleared"
    />

    <!-- Costs Section (hidden in demo mode) -->
    <CostsSection
      v-if="!isDemoMode"
      :file="costsFile"
      :is-loading-sample="isLoadingCosts"
      :readonly="isViewer"
      @file-uploaded="handleCostsFileUploaded"
      @file-cleared="handleCostsFileCleared"
      @use-sample="handleUseSampleCosts"
    />

    <!-- Usage Section (hidden in demo mode) -->
    <UsageSection
      v-if="!isDemoMode"
      :file="usageFile"
      :is-loading-sample="isLoadingUsage"
      :readonly="isViewer"
      @file-uploaded="handleUsageFileUploaded"
      @file-cleared="handleUsageFileCleared"
      @use-sample="handleUseSampleUsage"
    />

    <!-- Coming Soon Section (hidden in demo mode) -->
    <ComingSoonSection v-if="!isDemoMode" />
  </div>


</template>
