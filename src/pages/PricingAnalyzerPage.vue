<script setup lang="ts">
/**
 * PricingAnalyzerPage - 4-tab pricing analysis matching PRD spec.
 *
 * Tabs: SaaS Metrics | Plan Health | Usage Anomalies | Negative Margin
 */

import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  RefreshCw,
  Loader2,
  FlaskConical,
  Calendar,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Users,
  Activity,
  DollarSign,
  ArrowUp,
  ArrowDown,
  Minus,
} from 'lucide-vue-next'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui'
import { RevenueFlowChart, MarginOverviewCard } from '@/components/pricing'
import MarginCompressionAlert from '@/components/charts/MarginCompressionAlert.vue'
import GapCallout from '@/components/charts/GapCallout.vue'
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

// SaaS Metrics tab data
const saasMetrics = computed(() => analysisResult.value?.saasMetrics ?? null)
const costGrowth = computed(() => analysisResult.value?.costGrowthMetrics ?? null)

// Plan Health tab data
const planHealth = computed(() => analysisResult.value?.planHealth ?? [])

// Usage Anomalies tab data
const usageAnomalies = computed(() => analysisResult.value?.usageAnomalies ?? [])
const churnRisks = computed(() => usageAnomalies.value.filter(a => a.status === 'churn_risk'))
const upsellReady = computed(() => usageAnomalies.value.filter(a => a.status === 'upsell'))
const anomalies = computed(() => usageAnomalies.value.filter(a => a.status === 'anomaly'))

// Negative Margin tab data
const negativeMarginCustomers = computed(() => analysisResult.value?.negativeMarginCustomers ?? [])

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

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
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
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Pricing Analyzer</h1>
        <p class="text-sm text-muted-foreground mt-1">SaaS metrics, plan health, and margin analysis</p>
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
          aria-label="Refresh data"
          @click="loadData"
        >
          <RefreshCw
            class="h-4 w-4"
            :class="{ 'animate-spin': isLoading }"
          />
        </Button>
      </div>
    </div>

    <div class="space-y-6">
      <!-- Loading State -->
      <div v-if="isLoading && !analysisResult" class="flex items-center justify-center py-20">
        <div class="text-center">
          <Loader2 class="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p class="text-muted-foreground">Loading pricing data...</p>
        </div>
      </div>

      <!-- 4-Tab Content -->
      <template v-else-if="analysisResult">
        <Tabs default-value="saas-metrics" class="space-y-6">
          <TabsList class="grid w-full grid-cols-4">
            <TabsTrigger value="saas-metrics">SaaS Metrics</TabsTrigger>
            <TabsTrigger value="plan-health">Plan Health</TabsTrigger>
            <TabsTrigger value="usage-anomalies">
              Usage Anomalies
              <Badge v-if="usageAnomalies.length > 0" variant="secondary" class="ml-1.5 text-[10px]">
                {{ usageAnomalies.length }}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="negative-margin">
              Negative Margin
              <Badge v-if="negativeMarginCustomers.length > 0" variant="destructive" class="ml-1.5 text-[10px]">
                {{ negativeMarginCustomers.length }}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <!-- ============================================================= -->
          <!-- TAB 1: SaaS Metrics                                           -->
          <!-- ============================================================= -->
          <TabsContent value="saas-metrics" class="space-y-6">
            <!-- Top Metric Cards -->
            <div v-if="saasMetrics" class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card>
                <CardContent class="p-4">
                  <p class="text-xs text-muted-foreground uppercase tracking-wider">ARR</p>
                  <p class="text-2xl font-bold tabular-nums">{{ saasMetrics.formatted.arr }}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent class="p-4">
                  <p class="text-xs text-muted-foreground uppercase tracking-wider">MRR</p>
                  <p class="text-2xl font-bold tabular-nums">{{ saasMetrics.formatted.mrr }}</p>
                  <p class="text-xs text-muted-foreground">
                    <span :class="saasMetrics.mrrGrowth >= 0 ? 'text-success' : 'text-destructive'">
                      {{ saasMetrics.mrrGrowth >= 0 ? '+' : '' }}{{ saasMetrics.mrrGrowth.toFixed(1) }}% MoM
                    </span>
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent class="p-4">
                  <p class="text-xs text-muted-foreground uppercase tracking-wider">AI Costs</p>
                  <p class="text-2xl font-bold tabular-nums">{{ saasMetrics.formatted.totalCosts }}</p>
                  <p v-if="saasMetrics.costGrowth" class="text-xs">
                    <span class="text-destructive">+{{ saasMetrics.costGrowth.toFixed(0) }}% MoM</span>
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent class="p-4">
                  <p class="text-xs text-muted-foreground uppercase tracking-wider">Margin</p>
                  <p class="text-2xl font-bold tabular-nums" :class="saasMetrics.margin < 50 ? 'text-destructive' : ''">
                    {{ saasMetrics.margin }}%
                  </p>
                  <p v-if="saasMetrics.marginChange" class="text-xs">
                    <span :class="saasMetrics.marginChange < 0 ? 'text-destructive' : 'text-success'">
                      {{ saasMetrics.marginChange > 0 ? '+' : '' }}{{ saasMetrics.marginChange }}pts
                    </span>
                  </p>
                </CardContent>
              </Card>
            </div>

            <!-- Margin Compression Alert -->
            <MarginCompressionAlert
              v-if="costGrowth && saasMetrics"
              :data="monthlyMrrData"
              :revenue-growth="saasMetrics.mrrGrowth"
              :cost-growth="saasMetrics.costGrowth"
            />

            <!-- Secondary Metrics -->
            <div v-if="saasMetrics" class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card>
                <CardContent class="p-4">
                  <p class="text-xs text-muted-foreground uppercase tracking-wider">Customers</p>
                  <p class="text-xl font-bold">{{ saasMetrics.customerCount }}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent class="p-4">
                  <p class="text-xs text-muted-foreground uppercase tracking-wider">ARPU</p>
                  <p class="text-xl font-bold tabular-nums">{{ saasMetrics.formatted.arpu }}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent class="p-4">
                  <p class="text-xs text-muted-foreground uppercase tracking-wider">NRR</p>
                  <p class="text-xl font-bold tabular-nums">{{ saasMetrics.nrr }}%</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent class="p-4">
                  <p class="text-xs text-muted-foreground uppercase tracking-wider">Avg LTV</p>
                  <p class="text-xl font-bold tabular-nums">{{ saasMetrics.formatted.avgLTV }}</p>
                </CardContent>
              </Card>
            </div>

            <!-- MRR Movement -->
            <Card v-if="saasMetrics">
              <CardHeader class="pb-2">
                <CardTitle class="text-sm">MRR Movement</CardTitle>
              </CardHeader>
              <CardContent>
                <div class="grid grid-cols-5 gap-3 text-center">
                  <div class="p-3 rounded-lg border bg-card">
                    <p class="text-[11px] font-medium text-muted-foreground mb-1">New</p>
                    <p class="text-base font-semibold text-success tabular-nums">{{ saasMetrics.formatted.newMRR }}</p>
                  </div>
                  <div class="p-3 rounded-lg border bg-card">
                    <p class="text-[11px] font-medium text-muted-foreground mb-1">Expansion</p>
                    <p class="text-base font-semibold text-blue-600 dark:text-blue-400 tabular-nums">{{ saasMetrics.formatted.expansionMRR }}</p>
                  </div>
                  <div class="p-3 rounded-lg border bg-card">
                    <p class="text-[11px] font-medium text-muted-foreground mb-1">Contraction</p>
                    <p class="text-base font-semibold text-warning tabular-nums">{{ saasMetrics.formatted.contractionMRR }}</p>
                  </div>
                  <div class="p-3 rounded-lg border bg-card">
                    <p class="text-[11px] font-medium text-muted-foreground mb-1">Churned</p>
                    <p class="text-base font-semibold text-destructive tabular-nums">{{ saasMetrics.formatted.churnedMRR }}</p>
                  </div>
                  <div class="p-3 rounded-lg border bg-card">
                    <p class="text-[11px] font-medium text-muted-foreground mb-1">Net New</p>
                    <p class="text-base font-semibold tabular-nums">{{ saasMetrics.formatted.netNewMRR }}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <!-- Revenue Flow Chart -->
            <RevenueFlowChart :data="monthlyMrrData" :show-table="true" />
          </TabsContent>

          <!-- ============================================================= -->
          <!-- TAB 2: Plan Health                                            -->
          <!-- ============================================================= -->
          <TabsContent value="plan-health" class="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle class="text-sm">Plan Health Scores</CardTitle>
              </CardHeader>
              <CardContent>
                <div class="overflow-x-auto">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="border-b text-left">
                        <th class="pb-3 font-medium">Plan</th>
                        <th class="pb-3 font-medium text-center">Health</th>
                        <th class="pb-3 font-medium text-right">Customers</th>
                        <th class="pb-3 font-medium text-right">Total MRR</th>
                        <th class="pb-3 font-medium text-right">Avg MRR</th>
                        <th class="pb-3 font-medium text-center">Churn Risk</th>
                        <th class="pb-3 font-medium text-center">Upsell</th>
                        <th class="pb-3 font-medium text-center">Neg. Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="plan in planHealth" :key="plan.planId" class="border-b last:border-0">
                        <td class="py-3 font-medium">{{ plan.planName }}</td>
                        <td class="py-3 text-center">
                          <Badge
                            :variant="plan.healthScore >= 70 ? 'outline' : plan.healthScore >= 50 ? 'secondary' : 'destructive'"
                            class="tabular-nums"
                          >
                            {{ plan.healthScore }}
                          </Badge>
                        </td>
                        <td class="py-3 text-right tabular-nums">{{ plan.customerCount }}</td>
                        <td class="py-3 text-right tabular-nums">{{ formatCurrency(plan.totalMRR) }}</td>
                        <td class="py-3 text-right tabular-nums">{{ formatCurrency(plan.avgMRR) }}</td>
                        <td class="py-3 text-center">
                          <Tooltip v-if="plan.churnRiskCount > 0">
                            <TooltipTrigger>
                              <Badge variant="destructive" class="tabular-nums">{{ plan.churnRiskCount }}</Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{{ plan.churnRiskCustomers.join(', ') }}</p>
                            </TooltipContent>
                          </Tooltip>
                          <span v-else class="text-muted-foreground">0</span>
                        </td>
                        <td class="py-3 text-center">
                          <Tooltip v-if="plan.upsellReadyCount > 0">
                            <TooltipTrigger>
                              <Badge variant="secondary" class="tabular-nums">{{ plan.upsellReadyCount }}</Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{{ plan.upsellReadyCustomers.join(', ') }}</p>
                            </TooltipContent>
                          </Tooltip>
                          <span v-else class="text-muted-foreground">0</span>
                        </td>
                        <td class="py-3 text-center">
                          <Tooltip v-if="plan.negativeMarginCount > 0">
                            <TooltipTrigger>
                              <Badge variant="destructive" class="tabular-nums">{{ plan.negativeMarginCount }}</Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{{ plan.negativeMarginCustomers.join(', ') }}</p>
                            </TooltipContent>
                          </Tooltip>
                          <span v-else class="text-muted-foreground">0</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <!-- ============================================================= -->
          <!-- TAB 3: Usage Anomalies                                        -->
          <!-- ============================================================= -->
          <TabsContent value="usage-anomalies" class="space-y-6">
            <Card v-if="usageAnomalies.length === 0">
              <CardContent class="py-12 text-center">
                <Activity class="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                <p class="text-muted-foreground">No usage anomalies detected. Upload usage data to enable anomaly detection.</p>
              </CardContent>
            </Card>

            <template v-else>
              <Card>
                <CardHeader>
                  <CardTitle class="text-sm">Usage Anomalies</CardTitle>
                </CardHeader>
                <CardContent>
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead>
                        <tr class="border-b text-left">
                          <th class="pb-3 font-medium">Customer</th>
                          <th class="pb-3 font-medium">Plan</th>
                          <th class="pb-3 font-medium text-right">Usage</th>
                          <th class="pb-3 font-medium">Description</th>
                          <th class="pb-3 font-medium text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="anomaly in usageAnomalies" :key="anomaly.customerId" class="border-b last:border-0">
                          <td class="py-3 font-medium">{{ anomaly.customer }}</td>
                          <td class="py-3">{{ anomaly.plan }}</td>
                          <td class="py-3 text-right tabular-nums">{{ anomaly.usage }}</td>
                          <td class="py-3 text-muted-foreground">{{ anomaly.description }}</td>
                          <td class="py-3 text-center">
                            <Badge
                              :variant="anomaly.status === 'churn_risk' ? 'destructive' : anomaly.status === 'upsell' ? 'secondary' : 'outline'"
                            >
                              {{ anomaly.status === 'churn_risk' ? 'Churn Risk' : anomaly.status === 'upsell' ? 'Upsell' : 'Anomaly' }}
                            </Badge>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <!-- Summary -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card v-if="churnRisks.length > 0" class="border-destructive/30">
                  <CardContent class="p-4">
                    <div class="flex items-center gap-2 mb-1">
                      <TrendingDown class="h-4 w-4 text-destructive" />
                      <p class="text-xs text-muted-foreground uppercase">Churn Risk</p>
                    </div>
                    <p class="text-xl font-bold text-destructive">{{ churnRisks.length }} customers</p>
                    <p class="text-xs text-muted-foreground">Declining usage pattern</p>
                  </CardContent>
                </Card>
                <Card v-if="upsellReady.length > 0" class="border-blue-200 dark:border-blue-800">
                  <CardContent class="p-4">
                    <div class="flex items-center gap-2 mb-1">
                      <TrendingUp class="h-4 w-4 text-blue-600" />
                      <p class="text-xs text-muted-foreground uppercase">Upsell Ready</p>
                    </div>
                    <p class="text-xl font-bold text-blue-600">{{ upsellReady.length }} customers</p>
                    <p class="text-xs text-muted-foreground">At or over plan limits</p>
                  </CardContent>
                </Card>
                <Card v-if="anomalies.length > 0" class="border-warning/30">
                  <CardContent class="p-4">
                    <div class="flex items-center gap-2 mb-1">
                      <AlertTriangle class="h-4 w-4 text-warning" />
                      <p class="text-xs text-muted-foreground uppercase">Anomalies</p>
                    </div>
                    <p class="text-xl font-bold text-warning">{{ anomalies.length }} customers</p>
                    <p class="text-xs text-muted-foreground">Unusual usage spikes</p>
                  </CardContent>
                </Card>
              </div>
            </template>
          </TabsContent>

          <!-- ============================================================= -->
          <!-- TAB 4: Negative Margin                                        -->
          <!-- ============================================================= -->
          <TabsContent value="negative-margin" class="space-y-6">
            <Card v-if="negativeMarginCustomers.length === 0">
              <CardContent class="py-12 text-center">
                <DollarSign class="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                <p class="text-muted-foreground">No negative margin customers detected. Upload cost data to see margin analysis.</p>
              </CardContent>
            </Card>

            <template v-else>
              <!-- Alert Banner -->
              <Card class="border-destructive/30 bg-destructive/5">
                <CardContent class="p-4 flex items-center gap-3">
                  <AlertTriangle class="h-5 w-5 text-destructive shrink-0" />
                  <p class="text-sm text-foreground">
                    <strong>{{ negativeMarginCustomers.length }} customers</strong> are costing more than they pay
                  </p>
                </CardContent>
              </Card>

              <!-- Table -->
              <Card>
                <CardHeader>
                  <CardTitle class="text-sm">Negative Margin Customers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead>
                        <tr class="border-b text-left">
                          <th class="pb-3 font-medium">Customer</th>
                          <th class="pb-3 font-medium">Plan</th>
                          <th class="pb-3 font-medium text-right">MRR</th>
                          <th class="pb-3 font-medium text-right">Costs</th>
                          <th class="pb-3 font-medium text-right">Margin</th>
                          <th class="pb-3 font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="customer in negativeMarginCustomers" :key="customer.customerId" class="border-b last:border-0">
                          <td class="py-3 font-medium">{{ customer.customer }}</td>
                          <td class="py-3">{{ customer.plan }}</td>
                          <td class="py-3 text-right tabular-nums">{{ customer.mrr }}</td>
                          <td class="py-3 text-right tabular-nums">{{ customer.costs }}</td>
                          <td class="py-3 text-right">
                            <Badge variant="destructive" class="tabular-nums">{{ customer.margin }}</Badge>
                          </td>
                          <td class="py-3 text-muted-foreground">{{ customer.reason }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <!-- Gap Callout — the Tanso Core upsell -->
              <GapCallout
                :show-estimated-margins="true"
                :total-costs="saasMetrics?.totalCosts"
                :growth-gap="costGrowth ? (costGrowth.costGrowthRate - costGrowth.revenueGrowthRate) : undefined"
              />
            </template>
          </TabsContent>
        </Tabs>
      </template>

      <!-- No Data State — minimize time to first insight -->
      <template v-else>
        <div class="space-y-4 max-w-2xl mx-auto">
          <div class="text-center mb-6">
            <h2 class="text-lg font-semibold mb-1">See where your AI spend goes</h2>
            <p class="text-sm text-muted-foreground">Pick the fastest path to your first insight</p>
          </div>

          <Card class="cursor-pointer hover:border-primary/50 transition-colors" @click="enterDemoMode">
            <CardContent class="py-4 flex items-center gap-4">
              <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-warning/10 text-warning shrink-0">
                <FlaskConical class="h-5 w-5" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">Try with demo data</div>
                <div class="text-xs text-muted-foreground">Explore the full dashboard instantly with realistic sample data</div>
              </div>
              <Badge variant="secondary" class="shrink-0 text-[10px]">~5 sec</Badge>
            </CardContent>
          </Card>

          <Card class="cursor-pointer hover:border-primary/50 transition-colors" @click="router.push('/data-sources')">
            <CardContent class="py-4 flex items-center gap-4">
              <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-success/10 text-success shrink-0 font-mono text-xs font-bold">{}</div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">Add the SDK to your backend</div>
                <div class="text-xs text-muted-foreground">3 lines of code → per-feature, per-model cost breakdown. No billing changes.</div>
              </div>
              <Badge variant="secondary" class="shrink-0 text-[10px]">~2 min</Badge>
            </CardContent>
          </Card>

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
    </div>
  </div>
</template>
