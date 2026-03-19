<script setup lang="ts">
/**
 * SimulatorPage - Dedicated pricing simulation page
 */

import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { RefreshCw, Loader2, FlaskConical } from 'lucide-vue-next'
import { Card, CardContent, Badge, Button } from '@/components/ui'
import { PricingSimulatorPanel } from '@/components/pricing'
import type { PlanPrice } from '@/components/pricing'
import { analyzeData, type AnalysisResult } from '@/lib/pricing-analyzer'
import * as api from '@/lib/api'
import { useDataMode } from '@/composables/useDataMode'
import { useDemoMode } from '@/composables/useDemoMode'
import { toast } from 'vue-sonner'

const router = useRouter()
const isLoading = ref(false)
const analysisResult = ref<AnalysisResult | null>(null)
const { dataMode, hasData } = useDataMode()
const { enterDemoMode, isLoadingDemo } = useDemoMode()

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

const summaryBadges = computed(() => {
  if (!analysisResult.value) return []

  const metrics = analysisResult.value.saasMetrics
  return [
    { label: 'MRR', value: metrics.formatted.mrr, variant: 'outline' as const },
    {
      label: 'Margin',
      value: `${metrics.margin}%`,
      variant: (metrics.margin >= 50 ? 'outline' : 'destructive') as 'outline' | 'destructive',
    },
    { label: 'Customers', value: metrics.customerCount.toString(), variant: 'outline' as const },
  ]
})

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

function handleSimulationComplete(results: unknown) {
  console.log('Simulation complete:', results)
  toast.success('Simulation completed')
}

onMounted(() => {
  loadData()
})

watch(dataMode, () => {
  if (hasData.value) {
    loadData()
  }
})
</script>

<template>
  <div class="min-h-screen bg-background">
    <header class="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
      <div class="container mx-auto px-4 py-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <h1 class="text-lg font-semibold">Pricing Simulator</h1>
          </div>

          <div class="flex items-center gap-3">
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

    <main class="container mx-auto px-4 py-6 space-y-6">
      <div v-if="isLoading && !analysisResult" class="flex items-center justify-center py-20">
        <div class="text-center">
          <Loader2 class="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p class="text-muted-foreground">Loading pricing data...</p>
        </div>
      </div>

      <template v-else-if="analysisResult">
        <PricingSimulatorPanel
          :plans="planPrices"
          @simulation-complete="handleSimulationComplete"
        />
      </template>

      <template v-else>
        <Card>
          <CardContent class="py-12 text-center">
            <p class="text-lg font-medium mb-2">No Data Available</p>
            <p class="text-sm text-muted-foreground mb-6">
              Try the demo to explore pricing simulation with realistic data, or import your own.
            </p>
            <div class="flex items-center justify-center gap-3">
              <Button @click="enterDemoMode" :disabled="isLoadingDemo">
                <FlaskConical class="h-4 w-4 mr-2" />
                {{ isLoadingDemo ? 'Loading Demo...' : 'Try Demo' }}
              </Button>
              <Button variant="outline" @click="router.push('/data-sources')">
                Import Data
              </Button>
            </div>
          </CardContent>
        </Card>
      </template>
    </main>
  </div>
</template>
