<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import {
  getEventsByFeature,
  getEventsByModel,
  getEventsByCustomer,
  listInsights,
  generateInsights,
  getUsageLimits,
} from '@/lib/api'
import type { AiInsight } from '@/lib/api'
import { AlertCircle, AlertTriangle, Database, Plug, FlaskConical, Sparkles, Zap } from 'lucide-vue-next'
import { useDemoMode } from '@/composables/useDemoMode'
import Sheet from '@/components/ui/sheet.vue'
import {
  Card,
  Skeleton,
  Button,
} from '@/components/ui'
import { formatCurrency as fmt, formatPct as fmtPct } from '@/lib/format'

const router = useRouter()
const queryClient = useQueryClient()
const { isDemoMode, enterDemoMode, exitDemoMode, isLoadingDemo } = useDemoMode()

type Tab = 'feature' | 'model' | 'customer'
const activeTab = ref<Tab>('feature')

// Insights drawer state
const insightsOpen = ref(false)
const isGenerating = ref(false)
const generateError = ref<string | null>(null)

const { data: insightsData, refetch: refetchInsights } = useQuery({
  queryKey: ['insights'],
  queryFn: listInsights,
  enabled: computed(() => insightsOpen.value),
})

const { data: usageLimits } = useQuery({
  queryKey: ['usage-limits'],
  queryFn: getUsageLimits,
  enabled: computed(() => insightsOpen.value),
})

const insightsAllowed = computed(() => usageLimits.value?.ai_insights?.allowed !== false)
const insightsUsage = computed(() => usageLimits.value?.ai_insights?.usage ?? null)

async function handleGenerate() {
  isGenerating.value = true
  generateError.value = null
  try {
    await generateInsights()
    await refetchInsights()
    // Refresh usage limits
    queryClient.invalidateQueries({ queryKey: ['usage-limits'] })
  } catch (e: any) {
    generateError.value = e?.message || 'Failed to generate insights'
  } finally {
    isGenerating.value = false
  }
}

function severityColor(severity: string) {
  switch (severity) {
    case 'critical': return 'border-destructive/30 bg-destructive/5 text-destructive'
    case 'warning': return 'border-warning/30 bg-warning/5 text-warning'
    case 'positive': return 'border-success/30 bg-success/5 text-success'
    default: return 'border-border bg-card text-foreground'
  }
}

function severityBadge(severity: string) {
  switch (severity) {
    case 'critical': return 'bg-destructive/10 text-destructive'
    case 'warning': return 'bg-warning/10 text-warning'
    case 'positive': return 'bg-success/10 text-success'
    default: return 'bg-muted text-muted-foreground'
  }
}

// Analytics data
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

const negativeMarginsInfo = computed(() => {
  if (!featureData.value) return null
  const negative = featureData.value.filter(f => f.margin_pct !== null && f.margin_pct < 0)
  if (negative.length === 0) return null
  const totalLoss = negative.reduce((s, f) => s + (f.total_cost - f.total_revenue), 0)
  return { count: negative.length, totalLoss }
})

const sortedFeatures = computed(() => {
  if (!featureData.value) return []
  return [...featureData.value].sort((a, b) => b.total_cost - a.total_cost)
})
const maxFeatureCost = computed(() => {
  if (!sortedFeatures.value.length) return 1
  return Math.max(...sortedFeatures.value.map(f => f.total_cost), 0.01)
})

const sortedModels = computed(() => {
  if (!modelData.value) return []
  return [...modelData.value].filter(m => m.total_cost > 0).sort((a, b) => b.total_cost - a.total_cost)
})
const maxModelCost = computed(() => {
  if (!sortedModels.value.length) return 1
  return Math.max(...sortedModels.value.map(m => m.total_cost), 0.01)
})

const sortedCustomers = computed(() => {
  if (!customerData.value) return []
  return [...customerData.value].sort((a, b) => b.total_cost - a.total_cost)
})
const maxCustomerCost = computed(() => {
  if (!sortedCustomers.value.length) return 1
  return Math.max(...sortedCustomers.value.map(c => c.total_cost), 0.01)
})

// Data quality for insights
const totalEvents = computed(() => {
  if (!featureData.value) return 0
  return featureData.value.reduce((s, f) => s + (f.event_count || 0), 0)
})
const dataConfidence = computed(() => {
  const n = totalEvents.value
  if (n === 0) return { label: 'No data', color: 'text-muted-foreground', pct: 0 }
  if (n < 10) return { label: 'Very low', color: 'text-destructive', pct: 15 }
  if (n < 50) return { label: 'Low', color: 'text-warning', pct: 35 }
  if (n < 200) return { label: 'Medium', color: 'text-warning', pct: 60 }
  if (n < 500) return { label: 'Good', color: 'text-success', pct: 80 }
  return { label: 'High', color: 'text-success', pct: 95 }
})

function retry() {
  queryClient.invalidateQueries({ queryKey: ['events-by-feature'] })
  queryClient.invalidateQueries({ queryKey: ['events-by-model'] })
  queryClient.invalidateQueries({ queryKey: ['events-by-customer'] })
}

const exampleInsights = [
  { title: 'lead_enrichment is underwater (-23% margin)', description: 'This feature costs $4.12 per run but you charge $3.20. Acme Corp alone ran 1,847 enrichments last month. Switching from gpt-4o to gpt-4o-mini for initial scoring would cut cost 70% with <2% accuracy loss.', severity: 'critical', insight_type: 'margin_alert' },
  { title: 'Enterprise accounts subsidizing SMBs', description: 'Your top 3 enterprise accounts (Stripe, Ramp, Brex) generate 72% of revenue but only 41% of AI costs. SMB accounts average -8% margin. Consider usage-based pricing for the email_personalization feature.', severity: 'warning', insight_type: 'pricing_opportunity' },
  { title: 'gpt-4o spend up 340% month-over-month', description: 'Email personalization switched from claude-3-haiku to gpt-4o on Mar 12. Cost per email went from $0.003 to $0.018. Output quality improved but margins dropped from 62% to 31%. Consider gpt-4o-mini as a middle ground.', severity: 'warning', insight_type: 'cost_optimization' },
  { title: 'meeting_prep has 89% margin potential', description: 'This feature runs one Claude call per meeting at $0.02 but users would pay $2+ per prep. Only 12% of accounts use it. Promoting this feature could add $18K ARR at 89% margin.', severity: 'positive', insight_type: 'pricing_opportunity' },
]
</script>

<template>
  <div class="space-y-6">
    <!-- Page header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p class="text-muted-foreground mt-1">Where your AI spend is going</p>
      </div>
      <div class="flex gap-2">
        <div class="relative group">
          <Button
            variant="outline"
            size="sm"
            @click="insightsOpen = true"
          >
            <Sparkles class="h-3.5 w-3.5 mr-1.5" />
            {{ isDemoMode ? 'Preview AI Insights' : 'AI Insights' }}
          </Button>
          <div
            v-if="!hasData"
            class="absolute right-0 top-full mt-1 z-10 hidden group-hover:block rounded-md bg-foreground text-background px-3 py-1.5 text-xs whitespace-nowrap shadow-lg"
          >
            Upload data to see insights
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          :disabled="isLoadingDemo"
          @click="isDemoMode ? exitDemoMode() : enterDemoMode()"
        >
          <FlaskConical class="h-3.5 w-3.5 mr-1.5" />
          {{ isLoadingDemo ? 'Loading...' : isDemoMode ? 'Exit Demo' : 'Demo Data' }}
        </Button>
      </div>
    </div>

    <!-- AI Insights Drawer -->
    <Sheet :open="insightsOpen" side="right" @update:open="insightsOpen = $event">
      <div class="w-[420px] p-6 space-y-5">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <Sparkles class="h-5 w-5 text-primary" />
            <h2 class="text-lg font-semibold">AI Insights</h2>
          </div>
          <p class="text-sm text-muted-foreground">
            AI analyzes your cost and revenue data to find margin issues, pricing opportunities, and model optimizations. Insights improve as you send more events.
          </p>
        </div>

        <!-- Usage -->
        <div v-if="insightsUsage" class="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">Insights generated</span>
            <span class="font-medium">{{ insightsUsage.used }} / {{ insightsUsage.limit }}</span>
          </div>
          <div class="h-2 rounded-full bg-muted overflow-hidden">
            <div
              class="h-full rounded-full transition-all"
              :class="insightsUsage.remaining === 0 ? 'bg-destructive' : insightsUsage.remaining <= 1 ? 'bg-warning' : 'bg-primary'"
              :style="{ width: `${Math.min(100, (insightsUsage.used / insightsUsage.limit) * 100)}%` }"
            />
          </div>
          <div class="text-xs text-muted-foreground">
            <template v-if="insightsUsage.remaining > 0">
              {{ insightsUsage.remaining }} insight{{ insightsUsage.remaining === 1 ? '' : 's' }} remaining this month
            </template>
            <div v-else class="flex items-center gap-2">
              <Zap class="h-3 w-3 text-primary" />
              <span>No insights remaining. <router-link to="/plans" class="text-primary hover:underline">Upgrade to Growth</router-link> for unlimited.</span>
            </div>
          </div>
        </div>

        <!-- DEMO MODE: hardcoded preview -->
        <template v-if="isDemoMode">
          <div class="rounded-lg bg-muted/50 border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Preview mode. Connect your data to generate real insights.
          </div>

          <div class="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Data confidence</span>
              <span class="font-medium text-success">High</span>
            </div>
            <div class="h-2 rounded-full bg-muted overflow-hidden">
              <div class="h-full rounded-full bg-primary" style="width: 92%" />
            </div>
            <p class="text-[11px] text-muted-foreground">2,847 events tracked. Strong dataset for reliable insights.</p>
          </div>

          <div class="space-y-3">
            <div
              v-for="(ex, i) in exampleInsights"
              :key="i"
              class="rounded-lg border p-3 space-y-1.5"
              :class="severityColor(ex.severity)"
            >
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                  :class="severityBadge(ex.severity)"
                >
                  {{ ex.severity }}
                </span>
              </div>
              <div class="text-sm font-medium">{{ ex.title }}</div>
              <div class="text-xs text-muted-foreground">{{ ex.description }}</div>
            </div>
          </div>
        </template>

        <!-- REAL MODE -->
        <template v-else>
          <!-- Generated insights (show first when they exist) -->
          <div v-if="insightsData && insightsData.length > 0" class="space-y-3">
            <div
              v-for="insight in insightsData"
              :key="insight.id"
              class="rounded-lg border p-3 space-y-1.5"
              :class="severityColor(insight.severity)"
            >
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                  :class="severityBadge(insight.severity)"
                >
                  {{ insight.severity }}
                </span>
                <span v-if="insight.feature_key" class="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">{{ insight.feature_key }}</span>
              </div>
              <div class="text-sm font-medium">{{ insight.title }}</div>
              <div class="text-xs text-muted-foreground">{{ insight.description }}</div>
            </div>
          </div>

          <!-- No insights yet: show what they'll get -->
          <div v-else-if="!isGenerating" class="space-y-3">
            <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">What you'll get</div>
            <div
              v-for="(ex, i) in exampleInsights"
              :key="i"
              class="rounded-lg border p-3 space-y-1.5"
              :class="severityColor(ex.severity)"
            >
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                  :class="severityBadge(ex.severity)"
                >
                  {{ ex.severity }}
                </span>
              </div>
              <div class="text-sm font-medium">{{ ex.title }}</div>
              <div class="text-xs text-muted-foreground">{{ ex.description }}</div>
            </div>
          </div>

          <!-- Loading state -->
          <div v-if="isGenerating" class="flex items-center gap-3 py-4">
            <div class="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <div>
              <div class="text-sm font-medium">Analyzing your data...</div>
              <div class="text-xs text-muted-foreground">This usually takes 5-10 seconds</div>
            </div>
          </div>

          <!-- Generate button + progress -->
          <div class="space-y-3 border-t pt-4">
            <div class="flex items-center justify-between text-xs text-muted-foreground">
              <span>{{ totalEvents }} events tracked</span>
              <span v-if="insightsUsage">{{ insightsUsage.remaining }} of {{ insightsUsage.limit }} generations left</span>
            </div>
            <Button
              class="w-full"
              :disabled="isGenerating || !insightsAllowed || totalEvents < 10"
              @click="handleGenerate"
            >
              <Sparkles class="h-4 w-4 mr-2" />
              {{ isGenerating ? 'Analyzing...' : totalEvents < 10 ? `Send ${10 - totalEvents} more events to unlock` : !insightsAllowed ? 'Upgrade for more insights' : 'Generate Insights' }}
            </Button>
            <div v-if="!insightsAllowed" class="text-center">
              <router-link to="/plans" class="text-xs text-primary hover:underline">Upgrade to Growth for unlimited</router-link>
            </div>
          </div>

          <div v-if="generateError" class="text-sm text-destructive">{{ generateError }}</div>
        </template>
      </div>
    </Sheet>

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
      <Button variant="outline" size="sm" @click="router.push('/data-sources')">
        <Plug class="h-3.5 w-3.5 mr-1.5" />
        Data Sources
      </Button>
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
