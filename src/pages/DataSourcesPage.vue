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
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { TrendingUp, FlaskConical, Eye, Key, Copy, Trash2, Plus } from 'lucide-vue-next'
import { Card, CardContent, Button } from '@/components/ui'
import {
  RevenueSection,
  CostsSection,
  UsageSection,
  ComingSoonSection,
} from '@/components/data-sources'
import StripeApiKeyModal from '@/components/integrations/StripeApiKeyModal.vue'
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
  createSdkKey,
  listSdkKeys,
  revokeSdkKey,
} from '@/lib/api'
import type { SdkKey } from '@/lib/api'

const router = useRouter()
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
  lastSyncAt,
  switchToSampleData,
} = useDataMode()

const { isDemoMode, isLoadingDemo, enterDemoMode } = useDemoMode()

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

const ingestUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/events/ingest` : '/api/events/ingest'

/** SDK API Key state */
const sdkKeys = ref<SdkKey[]>([])
const showKeyGenerator = ref(false)
const newKeyName = ref('')
const isGeneratingKey = ref(false)
const generatedKey = ref<string | null>(null)
const keyCopied = ref(false)

async function loadSdkKeys() {
  try {
    sdkKeys.value = await listSdkKeys()
  } catch {
    // silently fail - keys list is not critical
  }
}

async function handleGenerateKey() {
  isGeneratingKey.value = true
  try {
    const result = await createSdkKey(newKeyName.value || undefined)
    generatedKey.value = result.key
    newKeyName.value = ''
    await loadSdkKeys()
  } catch (error) {
    toast.error('Failed to generate API key', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  } finally {
    isGeneratingKey.value = false
  }
}

async function handleRevokeKey(id: number) {
  try {
    await revokeSdkKey(id)
    sdkKeys.value = sdkKeys.value.filter(k => k.id !== id)
    toast.success('API key revoked')
  } catch (error) {
    toast.error('Failed to revoke key', {
      description: error instanceof Error ? error.message : 'Please try again.',
    })
  }
}

function copyKeyToClipboard() {
  if (!generatedKey.value) return
  navigator.clipboard.writeText(generatedKey.value)
  keyCopied.value = true
  setTimeout(() => { keyCopied.value = false }, 2000)
}

function dismissGeneratedKey() {
  generatedKey.value = null
  showKeyGenerator.value = false
}

// =============================================================================
// LIFECYCLE - Check Stripe status and auto-sync
// =============================================================================

onMounted(async () => {
  try {
    const { getStripeStatus } = await import('@/lib/api')
    const status = await getStripeStatus()
    isStripeConnected.value = status.connected
    stripeAccountName.value = status.account_name || ''
  } catch {
    isStripeConnected.value = false
  }
  await loadSdkKeys()
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
      description: 'Redirecting to the analyzer...',
    })
    setTimeout(() => router.push('/'), 1500)
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
        await handleStripeSync()
      }
    }, SYNC_INTERVAL_MS)
  }
}

async function handleStripeSync(): Promise<void> {
  if (isSyncing.value) return

  isSyncing.value = true
  try {
    const { syncStripeData } = await import('@/lib/api')
    const result = await syncStripeData()

    if (result.success) {
      toast.success(`Synced ${result.synced.customers} customers, ${result.synced.subscriptions} subscriptions`)
      revenueFiles.value = { customers: true, subscriptions: true, invoices: false }
      await refetchDataMode()
    }
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
        Track AI costs per customer, feature, and model
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

    <!-- SDK Integration Section — PRIMARY integration, shown first -->
    <Card v-if="!isDemoMode" class="border-green-200/50">
      <CardContent class="p-6 space-y-5">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-green-100 text-green-700 text-xs font-bold">{}</div>
            <h2 class="font-semibold">SDK Integration</h2>
            <span class="ml-auto text-[10px] font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Observe-only</span>
          </div>
          <p class="text-sm text-muted-foreground">
            Add 3 lines of code to see exactly where your AI spend goes. No billing changes required.
          </p>
        </div>

        <!-- API Key Management -->
        <div v-if="!isViewer">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">API Keys</h3>
            <Button v-if="!showKeyGenerator && !generatedKey" variant="outline" size="sm" class="h-7 text-xs" @click="showKeyGenerator = true">
              <Plus class="h-3 w-3 mr-1" />
              Generate API Key
            </Button>
          </div>

          <!-- Key generator inline UI -->
          <div v-if="showKeyGenerator && !generatedKey" class="rounded-lg border bg-muted/30 p-4 mb-3 space-y-3">
            <div class="flex gap-2">
              <input
                v-model="newKeyName"
                type="text"
                placeholder="Key name (optional, e.g. 'production')"
                class="flex-1 h-8 rounded-md border bg-background px-3 text-sm"
                @keydown.enter="handleGenerateKey"
              />
              <Button size="sm" class="h-8" :disabled="isGeneratingKey" @click="handleGenerateKey">
                <Key class="h-3 w-3 mr-1" />
                {{ isGeneratingKey ? 'Generating...' : 'Generate' }}
              </Button>
              <Button variant="ghost" size="sm" class="h-8" @click="showKeyGenerator = false">Cancel</Button>
            </div>
          </div>

          <!-- Generated key display (show once) -->
          <div v-if="generatedKey" class="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4 mb-3 space-y-2">
            <div class="flex items-center gap-2 text-xs font-medium text-amber-800 dark:text-amber-300">
              <Key class="h-3 w-3" />
              Save this key — you won't see it again
            </div>
            <div class="flex items-center gap-2">
              <code class="flex-1 text-xs font-mono bg-background border rounded px-3 py-2 select-all break-all">{{ generatedKey }}</code>
              <Button variant="outline" size="sm" class="h-8 shrink-0" @click="copyKeyToClipboard">
                <Copy class="h-3 w-3 mr-1" />
                {{ keyCopied ? 'Copied!' : 'Copy' }}
              </Button>
            </div>
            <Button variant="ghost" size="sm" class="h-7 text-xs" @click="dismissGeneratedKey">Done</Button>
          </div>

          <!-- Existing keys list -->
          <div v-if="sdkKeys.length > 0" class="space-y-1.5 mb-3">
            <div v-for="key in sdkKeys" :key="key.id" class="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-xs">
              <div class="flex items-center gap-3">
                <code class="font-mono text-muted-foreground">{{ key.key_prefix }}...</code>
                <span v-if="key.name" class="text-foreground">{{ key.name }}</span>
                <span class="text-muted-foreground">{{ new Date(key.created_at).toLocaleDateString() }}</span>
              </div>
              <Button variant="ghost" size="sm" class="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" @click="handleRevokeKey(key.id)">
                <Trash2 class="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        <!-- Quick Start — PostHog-style minimal snippet -->
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick start</h3>
            <span class="text-[10px] text-muted-foreground">~ 2 minutes</span>
          </div>
          <div class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto">
            <pre class="whitespace-pre text-zinc-100"><span class="text-zinc-500">// Add after any AI API call. That's it.</span>
<span class="text-emerald-400">await</span> fetch(<span class="text-amber-300">'{{ ingestUrl }}'</span>, {
  method: <span class="text-amber-300">'POST'</span>,
  headers: { <span class="text-amber-300">'Content-Type'</span>: <span class="text-amber-300">'application/json'</span>,
             <span class="text-amber-300">'Authorization'</span>: <span class="text-amber-300">'Bearer {{ sdkKeys.length > 0 ? sdkKeys[0].key_prefix + "..." : "YOUR_API_KEY" }}'</span> },
  body: JSON.stringify({ events: [{
    <span class="text-sky-300">eventName</span>: <span class="text-amber-300">'chat_completion'</span>,
    <span class="text-sky-300">customerReferenceId</span>: userId,
    <span class="text-sky-300">featureKey</span>: <span class="text-amber-300">'ai_summarization'</span>,
    <span class="text-sky-300">costAmount</span>: <span class="text-purple-300">0.24</span>,
    <span class="text-sky-300">model</span>: <span class="text-amber-300">'gpt-4o'</span>,
  }]})
})</pre>
          </div>
          <p class="text-[11px] text-muted-foreground mt-2">
            3 required fields: <span class="font-mono">eventName</span>, <span class="font-mono">customerReferenceId</span>, <span class="font-mono">featureKey</span>. Everything else is optional — we auto-detect the provider from the model name and enrich revenue from Stripe.
          </p>
        </div>

        <!-- Full example with comments -->
        <details class="group">
          <summary class="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
            Show full example with all options ▾
          </summary>
          <div class="mt-2 rounded-md bg-muted/60 border p-4 font-mono text-xs leading-relaxed overflow-x-auto">
            <pre class="whitespace-pre"><span class="text-muted-foreground">// Full example — wrap your AI API call</span>
const response = await openai.chat.completions.create({ ... })

await fetch('{{ ingestUrl }}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer {{ sdkKeys.length > 0 ? sdkKeys[0].key_prefix + "..." : "YOUR_API_KEY" }}'
  },
  body: JSON.stringify({ events: [{
    eventName: 'chat_completion',
    customerReferenceId: 'cus_123',  <span class="text-muted-foreground">// your customer ID</span>
    featureKey: 'ai_summarization',  <span class="text-muted-foreground">// which feature used it</span>
    costAmount: 0.24,                <span class="text-muted-foreground">// cost in USD</span>
    model: 'gpt-4o',                 <span class="text-muted-foreground">// auto-detects provider</span>
    usageUnits: 1500,                <span class="text-muted-foreground">// tokens, requests, etc.</span>
    revenueAmount: 0.50,             <span class="text-muted-foreground">// or auto-enriched from Stripe</span>
    eventIdempotencyKey: 'evt_abc',  <span class="text-muted-foreground">// prevents duplicates on retry</span>
    meta: { session: 'sess_xyz' },   <span class="text-muted-foreground">// any extra context</span>
  }]})
})</pre>
          </div>
        </details>

        <!-- Step 2: What you get -->
        <div>
          <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">2. What you get</h3>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="rounded-lg border bg-card p-3">
              <div class="text-xs font-medium mb-1">Per-feature costs</div>
              <div class="text-[11px] text-muted-foreground">See which features (summarization, search, image gen) cost the most</div>
            </div>
            <div class="rounded-lg border bg-card p-3">
              <div class="text-xs font-medium mb-1">Per-model breakdown</div>
              <div class="text-[11px] text-muted-foreground">Compare GPT-4o vs Claude vs embeddings costs. Provider auto-detected</div>
            </div>
            <div class="rounded-lg border bg-card p-3">
              <div class="text-xs font-medium mb-1">Historical backfill</div>
              <div class="text-[11px] text-muted-foreground">SDK patterns auto-split old CSV/API data into per-feature estimates</div>
            </div>
          </div>
        </div>

        <!-- Required vs optional fields -->
        <div>
          <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Event fields</h3>
          <div class="text-xs space-y-1.5">
            <div class="flex gap-2"><span class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0">eventName</span><span class="text-red-500 text-[10px]">required</span><span class="text-muted-foreground">What happened ("chat_completion", "image_generated")</span></div>
            <div class="flex gap-2"><span class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0">customerReferenceId</span><span class="text-red-500 text-[10px]">required</span><span class="text-muted-foreground">Your customer identifier</span></div>
            <div class="flex gap-2"><span class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0">featureKey</span><span class="text-red-500 text-[10px]">required</span><span class="text-muted-foreground">Which product feature ("ai_summarization", "search")</span></div>
            <div class="flex gap-2"><span class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0">costAmount</span><span class="text-muted-foreground/60 text-[10px]">optional</span><span class="text-muted-foreground">Cost in USD</span></div>
            <div class="flex gap-2"><span class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0">model</span><span class="text-muted-foreground/60 text-[10px]">optional</span><span class="text-muted-foreground">Model name — provider auto-detected (claude-* → Anthropic, gpt-* → OpenAI)</span></div>
            <div class="flex gap-2"><span class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0">usageUnits</span><span class="text-muted-foreground/60 text-[10px]">optional</span><span class="text-muted-foreground">Tokens, requests, or any quantity</span></div>
            <div class="flex gap-2"><span class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0">revenueAmount</span><span class="text-muted-foreground/60 text-[10px]">optional</span><span class="text-muted-foreground">Revenue for this event — auto-enriched from Stripe if missing</span></div>
            <div class="flex gap-2"><span class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0">eventIdempotencyKey</span><span class="text-muted-foreground/60 text-[10px]">optional</span><span class="text-muted-foreground">Unique key for dedup on retry</span></div>
          </div>
        </div>

        <div class="text-[11px] text-muted-foreground border-t pt-3">
          Batch up to 1,000 events per request. All data tagged as <span class="font-mono bg-green-100 text-green-700 px-1 py-0.5 rounded">SDK</span> in the dashboard.
        </div>
      </CardContent>
    </Card>

    <!-- AI Provider Connections (hidden in demo mode) -->
    <CostsSection
      v-if="!isDemoMode"
      :file="costsFile"
      :is-loading-sample="isLoadingCosts"
      :readonly="isViewer"
      @file-uploaded="handleCostsFileUploaded"
      @file-cleared="handleCostsFileCleared"
      @use-sample="handleUseSampleCosts"
    />

    <!-- Revenue Section (hidden in demo mode) -->
    <RevenueSection
      v-if="!isDemoMode"
      ref="revenueSectionRef"
      :is-loading-sample="isLoadingRevenue"
      :is-stripe-connected="isStripeConnected"
      :stripe-account-name="stripeAccountName"
      :is-syncing="isSyncing"
      :readonly="isViewer"
      @use-sample="handleUseSampleRevenue"
      @connect-stripe="handleStripeConnect"
      @sync-stripe="handleStripeSync"
      @disconnect-stripe="handleStripeDisconnect"
      @files-changed="handleRevenueFilesChanged"
      @all-files-cleared="handleRevenueFilesCleared"
    />

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

  <!-- Stripe API Key Modal -->
  <StripeApiKeyModal
    :open="showStripeModal"
    @close="showStripeModal = false"
    @connected="handleStripeConnected"
  />
</template>
