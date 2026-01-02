<script setup lang="ts">
/**
 * PricingAnalyzerPage - Deep pricing analysis, simulation, and revenue flow
 *
 * Layout:
 * - Header with back nav and badges
 * - Simulator panel (always visible)
 * - Tabs: Revenue Flow | Plans | Margins | Scenarios
 */

import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, RefreshCw, Loader2 } from 'lucide-vue-next'
import {
  Card,
  CardContent,
  Badge,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui'
import {
  PricingSimulatorPanel,
  RevenueFlowChart,
  PlanPerformanceView,
  MarginAnalysisView,
} from '@/components/pricing'
import type { PlanPrice } from '@/components/pricing'
import { analyzeData, type AnalysisResult } from '@/lib/pricing-analyzer'
import { fetchAnalyzerData } from '@/lib/supabase-data'
import { useDataMode } from '@/composables/useDataMode'
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
const activeTab = ref('revenue')
const { dataMode, hasData } = useDataMode()

// =============================================================================
// COMPUTED
// =============================================================================

// Transform plan health data for PricingSimulatorPanel
const planPrices = computed<PlanPrice[]>(() => {
  if (!analysisResult.value) return []

  return analysisResult.value.planHealth.map(plan => ({
    planId: plan.planId,
    planName: plan.planName,
    currentPrice: Math.round(plan.avgMRR),
    customerCount: plan.customerCount,
    totalMrr: plan.totalMRR,
  }))
})

// Transform monthly metrics for RevenueFlowChart
const monthlyMrrData = computed(() => {
  if (!analysisResult.value) return []

  return analysisResult.value.monthlyMetrics.map(m => ({
    month: m.month,
    monthLabel: m.monthLabel,
    mrr: m.mrr,
    newMRR: m.newMRR,
    expansionMRR: m.expansionMRR,
    contractionMRR: m.contractionMRR,
    churnedMRR: m.churnedMRR,
    netNewMRR: m.netNewMRR,
    customerCount: m.customerCount,
    margin: m.margin,
    formatted: m.formatted,
  }))
})

// Margin metrics for MarginAnalysisView
const marginMetrics = computed(() => {
  if (!analysisResult.value) return {
    totalRevenue: 0,
    totalCosts: 0,
    margin: 0,
    marginChange: 0,
    previousMargin: 0,
  }

  const metrics = analysisResult.value.saasMetrics
  return {
    totalRevenue: metrics.mrr,
    totalCosts: metrics.totalCosts,
    margin: metrics.margin,
    marginChange: metrics.marginChange,
    previousMargin: metrics.previousMargin,
  }
})

// Cost breakdown for margin analysis
const costBreakdown = computed(() => {
  if (!analysisResult.value) return []
  return analysisResult.value.costGrowthMetrics.providers
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
    const data = await fetchAnalyzerData()
    if (data) {
      analysisResult.value = analyzeData(data)
    } else {
      toast.error('No data available. Please import data first.')
      router.push('/data-sources')
    }
  } catch (err) {
    console.error('Failed to load data:', err)
    toast.error('Failed to load data')
  } finally {
    isLoading.value = false
  }
}

function handleSimulationComplete(results: unknown) {
  console.log('Simulation complete:', results)
  toast.success('Simulation completed')
}

function handleSaveScenario(name: string) {
  console.log('Saving scenario:', name)
  toast.success(`Scenario "${name}" saved`)
}

function handleViewCustomer(customerId: string) {
  router.push(`/customers?id=${customerId}`)
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
            <Button
              variant="ghost"
              size="sm"
              @click="router.push('/dashboard')"
            >
              <ArrowLeft class="h-4 w-4 mr-1" />
              Dashboard
            </Button>
            <div class="h-4 w-px bg-border" />
            <h1 class="text-lg font-semibold">Pricing Analyzer</h1>
          </div>

          <div class="flex items-center gap-3">
            <!-- Summary Badges -->
            <div class="hidden sm:flex items-center gap-2">
              <Badge
                v-for="badge in summaryBadges"
                :key="badge.label"
                :variant="badge.variant"
                class="font-mono"
              >
                {{ badge.label }}: {{ badge.value }}
              </Badge>
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
        <!-- Simulator Panel (Always Visible) -->
        <PricingSimulatorPanel
          :plans="planPrices"
          @simulation-complete="handleSimulationComplete"
          @save-scenario="handleSaveScenario"
        />

        <!-- Tabbed Content -->
        <Tabs v-model="activeTab" class="w-full">
          <TabsList class="grid w-full grid-cols-4 lg:w-auto lg:inline-flex">
            <TabsTrigger value="revenue">Revenue Flow</TabsTrigger>
            <TabsTrigger value="plans">Plans</TabsTrigger>
            <TabsTrigger value="margins">Margins</TabsTrigger>
            <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
          </TabsList>

          <!-- Revenue Flow Tab -->
          <TabsContent value="revenue" class="mt-4">
            <RevenueFlowChart
              :data="monthlyMrrData"
              :show-table="true"
            />
          </TabsContent>

          <!-- Plans Tab -->
          <TabsContent value="plans" class="mt-4">
            <PlanPerformanceView :plans="analysisResult.planHealth" />
          </TabsContent>

          <!-- Margins Tab -->
          <TabsContent value="margins" class="mt-4">
            <MarginAnalysisView
              :metrics="marginMetrics"
              :negative-margin-customers="analysisResult.negativeMarginCustomers"
              :cost-breakdown="costBreakdown"
              @view-customer="handleViewCustomer"
            />
          </TabsContent>

          <!-- Scenarios Tab -->
          <TabsContent value="scenarios" class="mt-4">
            <Card>
              <CardContent class="py-12 text-center text-muted-foreground">
                <p class="text-lg font-medium mb-2">Saved Scenarios</p>
                <p class="text-sm mb-4">
                  Save pricing simulations to compare and share with your team.
                </p>
                <Button variant="outline" disabled>
                  Coming Soon
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </template>

      <!-- No Data State -->
      <template v-else>
        <Card>
          <CardContent class="py-12 text-center">
            <p class="text-lg font-medium mb-2">No Data Available</p>
            <p class="text-sm text-muted-foreground mb-4">
              Import your data to start analyzing pricing.
            </p>
            <Button @click="router.push('/data-sources')">
              Import Data
            </Button>
          </CardContent>
        </Card>
      </template>
    </main>
  </div>
</template>
