<script setup lang="ts">
/**
 * DashboardPage - Board-ready SaaS metrics overview
 *
 * Layout:
 * - Header with title, badges, and refresh
 * - Date range selector
 * - Key metrics row (4 cards)
 * - Tabs: Overview | MRR Breakdown | Alerts | Actions
 */

import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Download,
  BarChart3,
  Sparkles,
  CreditCard,
  Clock,
  ArrowDownRight,
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
} from '@/components/ui'
import Skeleton from '@/components/ui/skeleton.vue'
import {
  MetricCard,
  AlertCard,
  MrrMonthlyBreakdown,
  QuickActions,
} from '@/components/dashboard'
import type { Alert, MrrMonthData, QuickAction } from '@/components/dashboard'
import { analyzeData, type AnalysisResult } from '@/lib/pricing-analyzer'
import { fetchAnalyzerData, loadSampleData as loadSampleDataToSupabase } from '@/lib/supabase-data'
import { useDataMode } from '@/composables/useDataMode'
import { toast } from 'vue-sonner'

// =============================================================================
// ROUTING & STATE
// =============================================================================

const router = useRouter()

const isLoading = ref(false)
const isSampleLoading = ref(false)
const analysisResult = ref<AnalysisResult | null>(null)
const activeTab = ref('overview')
const dateRange = ref('30d')

const { dataMode, hasData, lastSyncAt, refetch: refetchDataMode } = useDataMode()

// =============================================================================
// COMPUTED - Metrics
// =============================================================================

const mrr = computed(() => analysisResult.value?.saasMetrics.mrr ?? 0)
const customerCount = computed(() => analysisResult.value?.saasMetrics.customerCount ?? 0)
const margin = computed(() => analysisResult.value?.saasMetrics.margin ?? 0)
const marginChange = computed(() => analysisResult.value?.saasMetrics.marginChange ?? 0)
const mrrGrowth = computed(() => analysisResult.value?.saasMetrics.mrrGrowth ?? 0)
const arpu = computed(() => analysisResult.value?.saasMetrics.arpu ?? 0)
const nrr = computed(() => analysisResult.value?.saasMetrics.nrr ?? 0)
const churnRate = computed(() => {
  const churnMrr = analysisResult.value?.saasMetrics.mrrMovement.churned ?? 0
  return mrr.value > 0 ? (churnMrr / mrr.value) * 100 : 0
})

// Last sync formatted
const lastSyncFormatted = computed(() => {
  if (!lastSyncAt.value) return null
  const syncDate = new Date(lastSyncAt.value)
  const now = new Date()
  const diffMs = now.getTime() - syncDate.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return syncDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
})

// =============================================================================
// COMPUTED - MRR Monthly Data
// =============================================================================

const mrrMonthlyData = computed<MrrMonthData[]>(() => {
  if (!analysisResult.value?.monthlyMetrics) return []

  return analysisResult.value.monthlyMetrics.map((m, index) => ({
    month: m.monthLabel,
    monthShort: m.monthLabel.substring(0, 3),
    new: m.newMRR,
    expansion: m.expansionMRR,
    contraction: m.contractionMRR,
    churn: m.churnedMRR,
    netNew: m.netNewMRR,
    total: m.mrr,
    previousTotal: index > 0 ? analysisResult.value!.monthlyMetrics[index - 1]?.mrr : undefined,
  }))
})

// =============================================================================
// COMPUTED - Alerts
// =============================================================================

const alerts = computed<Alert[]>(() => {
  const alertList: Alert[] = []

  // Margin compression alert
  if (margin.value < 30 && mrr.value > 0) {
    alertList.push({
      id: 'margin-compression',
      title: 'Margin Compression',
      description: `Gross margin at ${margin.value.toFixed(1)}%, below healthy threshold of 30%`,
      severity: 'critical',
      icon: AlertTriangle,
      actions: [
        { label: 'Run Simulation', action: () => router.push('/pricing') },
        { label: 'View Costs', action: () => router.push('/pricing?tab=margins') },
      ],
    })
  }

  // High churn alert
  if (churnRate.value > 5) {
    alertList.push({
      id: 'high-churn',
      title: 'High Churn Rate',
      description: `${churnRate.value.toFixed(1)}% monthly churn detected`,
      severity: 'warning',
      icon: TrendingDown,
      actions: [
        { label: 'Review At-Risk', action: () => router.push('/pricing?tab=plans') },
        { label: 'Analyze Cohorts', action: () => router.push('/pricing?tab=revenue') },
      ],
    })
  }

  // Low NRR alert
  if (nrr.value < 100 && nrr.value > 0) {
    alertList.push({
      id: 'low-nrr',
      title: 'Negative Net Retention',
      description: `NRR at ${nrr.value}%, existing customers shrinking`,
      severity: 'warning',
      icon: ArrowDownRight,
      actions: [
        { label: 'View Expansion', action: () => router.push('/pricing?tab=revenue') },
      ],
    })
  }

  // Negative margin customers
  const negMarginCount = analysisResult.value?.negativeMarginCustomers.length ?? 0
  if (negMarginCount > 0) {
    alertList.push({
      id: 'negative-margins',
      title: `${negMarginCount} Customers with Negative Margin`,
      description: 'Some customers are costing more than they generate in revenue',
      severity: 'warning',
      icon: AlertTriangle,
      actions: [
        { label: 'View Details', action: () => router.push('/pricing?tab=margins') },
      ],
    })
  }

  return alertList
})

// =============================================================================
// COMPUTED - Quick Actions
// =============================================================================

const quickActions = computed<QuickAction[]>(() => [
  {
    label: 'Run Pricing Simulation',
    description: 'Test price changes before implementing',
    icon: BarChart3,
    action: () => router.push('/pricing'),
    variant: 'default',
  },
  {
    label: 'Refresh Data',
    description: 'Reload from connected sources',
    icon: RefreshCw,
    action: () => loadData(),
    variant: 'secondary',
  },
  {
    label: 'Export Report',
    description: 'Download PDF or CSV report',
    icon: Download,
    action: () => toast.info('Export coming soon'),
    variant: 'outline',
  },
])

// =============================================================================
// METHODS
// =============================================================================

async function loadData() {
  isLoading.value = true

  try {
    const data = await fetchAnalyzerData()
    if (data) {
      analysisResult.value = analyzeData(data)
    }
  } catch (err) {
    console.error('Failed to load data:', err)
    toast.error('Failed to load data')
  } finally {
    isLoading.value = false
  }
}

async function handleLoadSampleData() {
  isSampleLoading.value = true

  try {
    await loadSampleDataToSupabase()
    await refetchDataMode()
    await loadData()
    toast.success('Sample data loaded')
  } catch (err) {
    console.error('Failed to load sample data:', err)
    toast.error('Failed to load sample data')
  } finally {
    isSampleLoading.value = false
  }
}

// =============================================================================
// LIFECYCLE
// =============================================================================

onMounted(() => {
  if (hasData.value) {
    loadData()
  }
})

watch(hasData, (newValue) => {
  if (newValue) {
    loadData()
  }
})
</script>

<template>
  <div class="min-h-screen bg-background">
    <!-- Header -->
    <div class="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
      <div class="container mx-auto px-4 py-4">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold">Dashboard</h1>
            <p class="text-sm text-muted-foreground">Board-ready SaaS metrics overview</p>
          </div>
          <div class="flex items-center gap-3">
            <Badge v-if="dataMode === 'sample'" variant="outline">
              Sample Data
            </Badge>
            <Badge v-if="lastSyncFormatted" variant="secondary">
              <Clock class="h-3 w-3 mr-1" />
              {{ lastSyncFormatted }}
            </Badge>
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
    </div>

    <!-- Main Content -->
    <div class="container mx-auto px-4 py-6 space-y-6">
      <!-- Welcome State (No Data) -->
      <div v-if="!hasData && !isLoading" class="py-12">
        <Card class="max-w-2xl mx-auto border-dashed">
          <CardContent class="p-12 text-center space-y-6">
            <div class="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles class="h-8 w-8 text-primary" />
            </div>
            <div class="space-y-2">
              <h2 class="text-xl font-semibold">Welcome to Tanso</h2>
              <p class="text-muted-foreground max-w-md mx-auto">
                Get board-ready SaaS metrics in minutes. Connect your billing system
                or try our sample data.
              </p>
            </div>
            <div class="flex flex-col sm:flex-row gap-3 justify-center pt-4">
              <Button size="lg" @click="router.push('/data-sources')">
                <CreditCard class="mr-2 h-5 w-5" />
                Connect Your Data
              </Button>
              <Button
                variant="outline"
                size="lg"
                :disabled="isSampleLoading"
                @click="handleLoadSampleData"
              >
                <Sparkles class="mr-2 h-5 w-5" />
                {{ isSampleLoading ? 'Loading...' : 'Try Sample Data' }}
              </Button>
            </div>
            <p class="text-xs text-muted-foreground max-w-sm mx-auto">
              Sample data includes 30 customers across 4 plans with 6 months of history
            </p>
          </CardContent>
        </Card>
      </div>

      <!-- Loading State -->
      <div v-else-if="isLoading && !analysisResult" class="space-y-6">
        <div class="grid gap-4 grid-cols-2 md:grid-cols-4">
          <Card v-for="i in 4" :key="i">
            <CardContent class="p-6">
              <Skeleton class="h-4 w-24 mb-2" />
              <Skeleton class="h-8 w-32" />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardContent class="p-6">
            <Skeleton class="h-64 w-full" />
          </CardContent>
        </Card>
      </div>

      <!-- Dashboard Content -->
      <template v-else-if="analysisResult">
        <!-- Date Range Selector -->
        <div class="flex items-center justify-between">
          <Tabs v-model="dateRange" class="w-auto">
            <TabsList>
              <TabsTrigger value="7d">7D</TabsTrigger>
              <TabsTrigger value="30d">30D</TabsTrigger>
              <TabsTrigger value="90d">90D</TabsTrigger>
              <TabsTrigger value="ytd">YTD</TabsTrigger>
            </TabsList>
          </Tabs>
          <p class="text-sm text-muted-foreground">
            {{ mrrMonthlyData.length }} months of data
          </p>
        </div>

        <!-- Key Metrics Row -->
        <div class="grid gap-4 grid-cols-2 md:grid-cols-4">
          <MetricCard
            title="MRR"
            :value="mrr"
            :trend="mrrGrowth"
            format="currency"
            subtitle="Monthly Recurring"
            highlight
          />
          <MetricCard
            title="Margin"
            :value="margin"
            :trend="marginChange"
            format="percent"
            subtitle="Gross Margin"
          />
          <MetricCard
            title="Customers"
            :value="customerCount"
            format="number"
            subtitle="Active accounts"
          />
          <MetricCard
            title="ARPU"
            :value="arpu"
            format="currency"
            subtitle="Avg Revenue/User"
          />
        </div>

        <!-- Main Tabs -->
        <Tabs v-model="activeTab" class="space-y-6">
          <TabsList class="bg-muted p-1 rounded-lg">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="mrr">MRR Breakdown</TabsTrigger>
            <TabsTrigger value="alerts">
              Alerts
              <Badge
                v-if="alerts.length > 0"
                variant="destructive"
                class="ml-1.5 h-5 w-5 p-0 flex items-center justify-center"
              >
                {{ alerts.length }}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="actions">Quick Actions</TabsTrigger>
          </TabsList>

          <!-- Overview Tab -->
          <TabsContent value="overview" class="space-y-6">
            <!-- MRR Summary (compact) -->
            <MrrMonthlyBreakdown
              :data="mrrMonthlyData.slice(-3)"
              compact
            />

            <!-- Alerts Summary -->
            <div v-if="alerts.length > 0" class="space-y-4">
              <div class="flex items-center justify-between">
                <h3 class="text-lg font-semibold">Priority Alerts</h3>
                <Badge variant="destructive">{{ alerts.length }}</Badge>
              </div>
              <div class="grid gap-4 md:grid-cols-2">
                <AlertCard
                  v-for="alert in alerts.slice(0, 2)"
                  :key="alert.id"
                  :alert="alert"
                />
              </div>
              <Button
                v-if="alerts.length > 2"
                variant="ghost"
                class="w-full"
                @click="activeTab = 'alerts'"
              >
                View All {{ alerts.length }} Alerts
              </Button>
            </div>

            <!-- All Clear -->
            <Card v-else class="bg-green-50 dark:bg-green-950/20 border-green-200">
              <CardContent class="p-6 text-center">
                <CheckCircle class="h-12 w-12 text-green-500 mx-auto mb-4" />
                <h3 class="text-lg font-semibold text-green-800 dark:text-green-200">All Clear</h3>
                <p class="text-green-700 dark:text-green-300">No alerts at this time. Keep it up!</p>
              </CardContent>
            </Card>

            <!-- Quick Actions Preview -->
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <div class="grid gap-4 md:grid-cols-3">
                  <Card
                    v-for="action in quickActions"
                    :key="action.label"
                    class="hover:shadow-md transition-shadow cursor-pointer"
                    @click="action.action"
                  >
                    <CardContent class="p-6 text-center">
                      <component :is="action.icon" class="h-8 w-8 mx-auto mb-3 text-primary" />
                      <p class="font-semibold mb-1">{{ action.label }}</p>
                      <p class="text-sm text-muted-foreground">{{ action.description }}</p>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <!-- MRR Breakdown Tab -->
          <TabsContent value="mrr" class="space-y-6">
            <MrrMonthlyBreakdown
              :data="mrrMonthlyData"
              show-growth
            />
          </TabsContent>

          <!-- Alerts Tab -->
          <TabsContent value="alerts" class="space-y-4">
            <div v-if="alerts.length === 0" class="text-center py-12">
              <CheckCircle class="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h3 class="text-lg font-semibold mb-2">All Clear!</h3>
              <p class="text-muted-foreground">No alerts at this time.</p>
            </div>

            <div v-else class="space-y-4">
              <AlertCard
                v-for="alert in alerts"
                :key="alert.id"
                :alert="alert"
              />
            </div>
          </TabsContent>

          <!-- Quick Actions Tab -->
          <TabsContent value="actions" class="space-y-6">
            <QuickActions :actions="quickActions" />
          </TabsContent>
        </Tabs>
      </template>
    </div>
  </div>
</template>
