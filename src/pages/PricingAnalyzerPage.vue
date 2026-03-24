<script setup lang="ts">
/**
 * PricingAnalyzerPage - Deep pricing analysis and revenue flow
 *
 * Layout:
 * - Header with badges
 * - Tabs: Revenue Flow | Plans | Margins
 */

import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { RefreshCw, Loader2, FlaskConical, Calendar } from 'lucide-vue-next'
import {
  Card,
  CardContent,
  Badge,
  Button,
} from '@/components/ui'
import { RevenueFlowChart, MarginOverviewCard } from '@/components/pricing'
import { analyzeData, type AnalysisResult } from '@/lib/pricing-analyzer'
import * as api from '@/lib/api'
import { useDataMode } from '@/composables/useDataMode'
import { useDemoMode } from '@/composables/useDemoMode'
import { toast } from 'vue-sonner'

// =============================================================================
// ROUTING
// =============================================================================

const router = useRouter()

// =============================================================================
// STATE
// =============================================================================

const isLoading = ref(false)
const analysisResult = ref<AnalysisResult | null>(null)
const selectedMonth = ref<string | null>(null)
const { dataMode, hasData } = useDataMode()
const { enterDemoMode, isLoadingDemo } = useDemoMode()

// =============================================================================
// COMPUTED
// =============================================================================

// Available months for the month selector
const availableMonths = computed(() => {
  if (!analysisResult.value) return []
  return analysisResult.value.monthlyMetrics.map(m => ({
    value: m.month,
    label: m.monthLabel,
  }))
})

// Transform monthly metrics for charts (filtered by selected month)
const monthlyMrrData = computed(() => {
  if (!analysisResult.value) return []

  let metrics = analysisResult.value.monthlyMetrics
  if (selectedMonth.value) {
    const idx = metrics.findIndex(m => m.month === selectedMonth.value)
    if (idx >= 0) metrics = metrics.slice(0, idx + 1)
  }

  return metrics.map(m => ({
    month: m.month,
    monthLabel: m.monthLabel,
    mrr: m.mrr,
    newMRR: m.newMRR,
    expansionMRR: m.expansionMRR,
    contractionMRR: m.contractionMRR,
    churnedMRR: m.churnedMRR,
    netNewMRR: m.netNewMRR,
    customerCount: m.customerCount,
    costs: m.costs,
    margin: m.margin,
    formatted: m.formatted,
  }))
})

// Summary badges
const summaryBadges = computed(() => {
  if (!analysisResult.value) return []

  const metrics = analysisResult.value.saasMetrics
  return [
    {
      label: 'MRR',
      value: metrics.formatted.mrr,
      variant: 'outline' as const,
    },
    {
      label: 'Margin',
      value: `${metrics.margin}%`,
      variant: (metrics.margin >= 50 ? 'outline' : 'destructive') as 'outline' | 'destructive',
    },
    {
      label: 'Customers',
      value: metrics.customerCount.toString(),
      variant: 'outline' as const,
    },
  ]
})

// =============================================================================
// METHODS
// =============================================================================

async function loadData() {
  isLoading.value = true

  try {
    const data = await api.fetchAnalyzerData()
    if (data) {
      analysisResult.value = analyzeData(data)
    } else {
      analysisResult.value = null
    }
  } catch (err) {
    console.error('Failed to load data:', err)
    toast.error('Failed to load data')
  } finally {
    isLoading.value = false
  }
}

// =============================================================================
// LIFECYCLE
// =============================================================================

onMounted(() => {
  loadData()
})

// Reload when data mode changes
watch(dataMode, () => {
  if (hasData.value) {
    loadData()
  }
})
</script>

<template>
  <div class="min-h-screen bg-background">
    <!-- Header -->
    <header class="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
      <div class="container mx-auto px-4 py-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <h1 class="text-lg font-semibold">Pricing Analyzer</h1>
          </div>

          <div class="flex items-center gap-3">
            <!-- Summary Badges -->
            <div class="hidden sm:flex items-center gap-2">
              <Badge
                v-for="badge in summaryBadges"
                :key="badge.label"
                :variant="badge.variant"
                class="tabular-nums"
              >
                {{ badge.label }}: {{ badge.value }}
              </Badge>
            </div>

            <!-- Month Selector -->
            <div v-if="availableMonths.length > 0" class="flex items-center gap-1.5">
              <Calendar class="h-4 w-4 text-muted-foreground" />
              <select
                :value="selectedMonth || availableMonths[availableMonths.length - 1]?.value"
                class="h-8 rounded-md border bg-background px-2 text-sm"
                @change="selectedMonth = ($event.target as HTMLSelectElement).value || null"
              >
                <option
                  v-for="m in availableMonths"
                  :key="m.value"
                  :value="m.value"
                >
                  {{ m.label }}
                </option>
              </select>
            </div>

            <!-- Refresh -->
            <Button
              variant="outline"
              size="sm"
              :disabled="isLoading"
              @click="loadData"
            >
              <RefreshCw
                class="h-4 w-4"
                :class="{ 'animate-spin': isLoading }"
              />
            </Button>
          </div>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="container mx-auto px-4 py-6 space-y-6">
      <!-- Loading State -->
      <div v-if="isLoading && !analysisResult" class="flex items-center justify-center py-20">
        <div class="text-center">
          <Loader2 class="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p class="text-muted-foreground">Loading pricing data...</p>
        </div>
      </div>

      <!-- Content -->
      <template v-else-if="analysisResult">
        <RevenueFlowChart
          :data="monthlyMrrData"
          :show-table="true"
        />
        <MarginOverviewCard :data="monthlyMrrData" />
      </template>

      <!-- No Data State — minimize time to first insight -->
      <template v-else>
        <div class="space-y-4 max-w-2xl mx-auto">
          <div class="text-center mb-6">
            <h2 class="text-lg font-semibold mb-1">See where your AI spend goes</h2>
            <p class="text-sm text-muted-foreground">Pick the fastest path to your first insight</p>
          </div>

          <!-- Option 1: Demo (instant) -->
          <Card class="cursor-pointer hover:border-primary/50 transition-colors" @click="enterDemoMode">
            <CardContent class="py-4 flex items-center gap-4">
              <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 text-amber-700 shrink-0">
                <FlaskConical class="h-5 w-5" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">Try with demo data</div>
                <div class="text-xs text-muted-foreground">Explore the full dashboard instantly with realistic sample data</div>
              </div>
              <Badge variant="secondary" class="shrink-0 text-[10px]">~5 sec</Badge>
            </CardContent>
          </Card>

          <!-- Option 2: SDK (2 min) -->
          <Card class="cursor-pointer hover:border-primary/50 transition-colors" @click="router.push('/data-sources')">
            <CardContent class="py-4 flex items-center gap-4">
              <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 text-green-700 shrink-0 font-mono text-xs font-bold">{}</div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">Add the SDK to your backend</div>
                <div class="text-xs text-muted-foreground">3 lines of code → per-feature, per-model cost breakdown. No billing changes.</div>
              </div>
              <Badge variant="secondary" class="shrink-0 text-[10px]">~2 min</Badge>
            </CardContent>
          </Card>

          <!-- Option 3: Connect provider (5 min) -->
          <Card class="cursor-pointer hover:border-primary/50 transition-colors" @click="router.push('/data-sources')">
            <CardContent class="py-4 flex items-center gap-4">
              <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 text-blue-700 shrink-0 text-xs font-bold">API</div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">Connect OpenAI or Anthropic</div>
                <div class="text-xs text-muted-foreground">Paste your API key → automatic cost sync for the last 30 days</div>
              </div>
              <Badge variant="secondary" class="shrink-0 text-[10px]">~5 min</Badge>
            </CardContent>
          </Card>

          <!-- Option 4: CSV -->
          <Card class="cursor-pointer hover:border-primary/50 transition-colors" @click="router.push('/data-sources')">
            <CardContent class="py-4 flex items-center gap-4">
              <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 text-gray-700 shrink-0 text-xs font-bold">CSV</div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">Upload cost & revenue CSVs</div>
                <div class="text-xs text-muted-foreground">Bulk import historical data from any source</div>
              </div>
              <Badge variant="secondary" class="shrink-0 text-[10px]">~10 min</Badge>
            </CardContent>
          </Card>
        </div>
      </template>
    </main>
  </div>
</template>
