<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import {
  getEventsByFeature,
  getEventsByModel,
  getEventsByCustomer,
} from '@/lib/api'
import { AlertCircle, AlertTriangle, Database, Plug, FlaskConical } from 'lucide-vue-next'
import { useDemoMode } from '@/composables/useDemoMode'
import {
  Card,
  Skeleton,
  Button,
} from '@/components/ui'
import { formatCurrency as fmt, formatPct as fmtPct } from '@/lib/format'

const router = useRouter()
const queryClient = useQueryClient()
const { enterDemoMode, isLoadingDemo } = useDemoMode()

type Tab = 'feature' | 'model' | 'customer'
const activeTab = ref<Tab>('feature')

const {
  data: featureData,
  isLoading: featuresLoading,
  isError: featuresError,
} = useQuery({
  queryKey: ['events-by-feature'],
  queryFn: getEventsByFeature,
})

const {
  data: modelData,
  isLoading: modelsLoading,
  isError: modelsError,
} = useQuery({
  queryKey: ['events-by-model'],
  queryFn: getEventsByModel,
})

const {
  data: customerData,
  isLoading: customersLoading,
  isError: customersError,
} = useQuery({
  queryKey: ['events-by-customer'],
  queryFn: getEventsByCustomer,
})

const isLoading = computed(() => featuresLoading.value || modelsLoading.value || customersLoading.value)
const isError = computed(() => featuresError.value || modelsError.value || customersError.value)
const hasData = computed(() => !isLoading.value && !isError.value && (featureData.value?.length || modelData.value?.length || customerData.value?.length))

// KPI computations
const totalCost = computed(() => {
  if (!featureData.value) return 0
  return featureData.value.reduce((s, f) => s + f.total_cost, 0)
})
const totalRevenue = computed(() => {
  if (!featureData.value) return 0
  return featureData.value.reduce((s, f) => s + f.total_revenue, 0)
})
const netMarginPct = computed(() => {
  if (totalRevenue.value === 0) return null
  return ((totalRevenue.value - totalCost.value) / totalRevenue.value) * 100
})

// Negative margin alert
const negativeMarginsInfo = computed(() => {
  if (!featureData.value) return null
  const negative = featureData.value.filter(f => f.margin_pct !== null && f.margin_pct < 0)
  if (negative.length === 0) return null
  const totalLoss = negative.reduce((s, f) => s + (f.total_cost - f.total_revenue), 0)
  return { count: negative.length, totalLoss }
})

// Feature view
const sortedFeatures = computed(() => {
  if (!featureData.value) return []
  return [...featureData.value].sort((a, b) => b.total_cost - a.total_cost)
})
const maxFeatureCost = computed(() => {
  if (!sortedFeatures.value.length) return 1
  return Math.max(...sortedFeatures.value.map(f => f.total_cost), 0.01)
})

// Model view
const sortedModels = computed(() => {
  if (!modelData.value) return []
  return [...modelData.value].filter(m => m.total_cost > 0).sort((a, b) => b.total_cost - a.total_cost)
})
const maxModelCost = computed(() => {
  if (!sortedModels.value.length) return 1
  return Math.max(...sortedModels.value.map(m => m.total_cost), 0.01)
})

// Customer view
const sortedCustomers = computed(() => {
  if (!customerData.value) return []
  return [...customerData.value].sort((a, b) => b.total_cost - a.total_cost)
})
const maxCustomerCost = computed(() => {
  if (!sortedCustomers.value.length) return 1
  return Math.max(...sortedCustomers.value.map(c => c.total_cost), 0.01)
})

function retry() {
  queryClient.invalidateQueries({ queryKey: ['events-by-feature'] })
  queryClient.invalidateQueries({ queryKey: ['events-by-model'] })
  queryClient.invalidateQueries({ queryKey: ['events-by-customer'] })
}
</script>

<template>
  <div class="space-y-6">
    <!-- Page header -->
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Analytics</h1>
      <p class="text-muted-foreground mt-1">Where your AI spend is going</p>
    </div>

    <!-- Error state -->
    <div v-if="isError && !isLoading" class="flex flex-col items-center justify-center py-24 text-center">
      <AlertCircle class="h-10 w-10 text-muted-foreground mb-4" />
      <p class="text-muted-foreground mb-4">Failed to load analytics data.</p>
      <Button @click="retry">Try Again</Button>
    </div>

    <!-- Loading state -->
    <div v-else-if="isLoading">
      <div class="grid grid-cols-3 gap-4 mb-6">
        <Card v-for="i in 3" :key="i" class="p-6">
          <Skeleton class="h-4 w-24 mb-2" />
          <Skeleton class="h-8 w-20" />
        </Card>
      </div>
      <Card class="p-6">
        <Skeleton class="h-8 w-48 mb-4" />
        <Skeleton v-for="i in 5" :key="i" class="h-10 w-full mb-2" />
      </Card>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!hasData"
      class="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto"
    >
      <Database class="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p class="text-sm font-medium mb-1">No analytics data yet</p>
      <p class="text-xs text-muted-foreground mb-4">
        Cost and margin breakdowns appear here once you have event data flowing in via the SDK, CSV upload, or provider integrations.
      </p>
      <div class="flex gap-3">
        <Button size="sm" :disabled="isLoadingDemo" @click="enterDemoMode">
          <FlaskConical class="h-3.5 w-3.5 mr-1.5" />
          {{ isLoadingDemo ? 'Loading...' : 'Try Demo' }}
        </Button>
        <Button variant="outline" size="sm" @click="router.push('/data-sources')">
          <Plug class="h-3.5 w-3.5 mr-1.5" />
          Data Sources
        </Button>
      </div>
    </div>

    <!-- Data loaded -->
    <template v-else>
      <!-- Negative margin alert -->
      <div
        v-if="negativeMarginsInfo"
        class="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3"
      >
        <AlertTriangle class="h-5 w-5 text-warning shrink-0" />
        <span class="text-sm font-medium text-warning-foreground">
          {{ negativeMarginsInfo.count }} feature{{ negativeMarginsInfo.count === 1 ? '' : 's' }}
          {{ negativeMarginsInfo.count === 1 ? 'has' : 'have' }} negative margin totaling
          {{ fmt(negativeMarginsInfo.totalLoss) }} in losses
        </span>
      </div>

      <!-- KPI cards -->
      <div class="grid grid-cols-3 gap-4">
        <Card class="p-6">
          <div class="text-sm font-medium text-muted-foreground">Total Cost</div>
          <div class="text-3xl font-semibold tabular-nums mt-1">{{ fmt(totalCost) }}</div>
        </Card>
        <Card class="p-6">
          <div class="text-sm font-medium text-muted-foreground">Total Revenue</div>
          <div class="text-3xl font-semibold tabular-nums mt-1">{{ fmt(totalRevenue) }}</div>
        </Card>
        <Card class="p-6">
          <div class="text-sm font-medium text-muted-foreground">Net Margin</div>
          <div
            class="text-3xl font-bold tabular-nums mt-1"
            :class="netMarginPct != null && netMarginPct >= 0 ? 'text-success' : 'text-destructive'"
          >
            {{ netMarginPct != null ? fmtPct(netMarginPct) : '—' }}
          </div>
        </Card>
      </div>

      <!-- Tab bar -->
      <div class="flex gap-1 border-b">
        <button
          v-for="tab in ([
            { key: 'feature', label: 'By Feature', count: sortedFeatures.length },
            { key: 'model', label: 'By Model', count: sortedModels.length },
            { key: 'customer', label: 'By Customer', count: sortedCustomers.length },
          ] as const)"
          :key="tab.key"
          class="px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px"
          :class="activeTab === tab.key
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <span class="ml-1.5 text-xs text-muted-foreground">({{ tab.count }})</span>
        </button>
      </div>

      <!-- Feature tab -->
      <div v-if="activeTab === 'feature'" class="space-y-1">
        <div v-if="!sortedFeatures.length" class="py-8 text-center text-sm text-muted-foreground">
          No feature data yet
        </div>
        <div
          v-for="f in sortedFeatures"
          :key="f.feature_key"
          class="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
        >
          <span class="w-36 text-sm font-medium truncate">{{ f.feature_key }}</span>
          <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full rounded-full"
              :class="f.margin_pct != null && f.margin_pct < 0 ? 'bg-destructive' : 'bg-foreground'"
              :style="{ width: `${(f.total_cost / maxFeatureCost) * 100}%` }"
            />
          </div>
          <span class="w-20 text-right text-sm tabular-nums">{{ fmt(f.total_cost) }}</span>
          <span class="w-20 text-right text-sm tabular-nums text-muted-foreground">{{ fmt(f.total_revenue) }}</span>
          <span
            class="w-16 text-right text-sm tabular-nums font-medium"
            :class="f.margin_pct != null && f.margin_pct < 0 ? 'text-destructive' : 'text-success'"
          >
            {{ f.margin_pct != null ? fmtPct(f.margin_pct) : '—' }}
          </span>
        </div>
      </div>

      <!-- Model tab -->
      <div v-if="activeTab === 'model'" class="space-y-1">
        <div v-if="!sortedModels.length" class="py-8 text-center text-sm text-muted-foreground">
          No model data yet
        </div>
        <div
          v-for="m in sortedModels"
          :key="m.model"
          class="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
          @click="router.push(`/events?model=${encodeURIComponent(m.model)}`)"
        >
          <div class="w-36 min-w-0">
            <div class="text-sm font-medium truncate">{{ m.model }}</div>
            <div v-if="m.model_provider" class="text-xs text-muted-foreground">{{ m.model_provider }}</div>
          </div>
          <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full bg-foreground rounded-full"
              :style="{ width: `${(m.total_cost / maxModelCost) * 100}%` }"
            />
          </div>
          <span class="w-20 text-right text-sm tabular-nums">{{ fmt(m.total_cost) }}</span>
          <span class="w-20 text-right text-sm tabular-nums text-muted-foreground">{{ fmt(m.total_revenue) }}</span>
          <span
            class="w-16 text-right text-sm tabular-nums font-medium"
            :class="m.margin_pct != null && m.margin_pct < 0 ? 'text-destructive' : 'text-success'"
          >
            {{ m.margin_pct != null ? fmtPct(m.margin_pct) : '—' }}
          </span>
        </div>
      </div>

      <!-- Customer tab -->
      <div v-if="activeTab === 'customer'" class="space-y-1">
        <div v-if="!sortedCustomers.length" class="py-8 text-center text-sm text-muted-foreground">
          No customer data yet
        </div>
        <div
          v-for="c in sortedCustomers"
          :key="c.customer_id"
          class="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
        >
          <div class="w-36 min-w-0">
            <div class="text-sm font-medium truncate">{{ c.customer_name || c.customer_id }}</div>
            <div v-if="c.customer_name" class="text-xs text-muted-foreground truncate">{{ c.customer_id }}</div>
          </div>
          <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full rounded-full"
              :class="c.margin_pct != null && c.margin_pct < 0 ? 'bg-destructive' : 'bg-foreground'"
              :style="{ width: `${(c.total_cost / maxCustomerCost) * 100}%` }"
            />
          </div>
          <span class="w-20 text-right text-sm tabular-nums">{{ fmt(c.total_cost) }}</span>
          <span class="w-20 text-right text-sm tabular-nums text-muted-foreground">{{ fmt(c.total_revenue) }}</span>
          <span
            class="w-16 text-right text-sm tabular-nums font-medium"
            :class="c.margin_pct != null && c.margin_pct < 0 ? 'text-destructive' : 'text-success'"
          >
            {{ c.margin_pct != null ? fmtPct(c.margin_pct) : '—' }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>
