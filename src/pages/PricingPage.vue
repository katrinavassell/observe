<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Users,
  Package,
  Info,
  BarChart3,
  Plug,
  Search,
  ExternalLink,
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
import Progress from '@/components/ui/progress.vue'
import Alert from '@/components/ui/alert.vue'
import { analyzeData, type AnalysisResult } from '@/lib/pricing-analyzer'
import { getSampleDataSummary } from '@/lib/sample-data'
import { useDataMode } from '@/composables/useDataMode'
import {
  loadSampleData as loadSampleDataToSupabase,
  fetchAnalyzerData,
} from '@/lib/supabase-data'
import { toast } from 'vue-sonner'

// =============================================================================
// ROUTING
// =============================================================================

const route = useRoute()
const router = useRouter()

// =============================================================================
// STATE
// =============================================================================

const isAnalyzing = ref(false)
const analysisComplete = ref(false)
const uploadProgress = ref(0)
const error = ref<string | null>(null)
const analysisResult = ref<AnalysisResult | null>(null)
const dataSource = ref<'none' | 'sample' | 'user'>('none')

const { dataMode, hasData, refetch: refetchDataMode } = useDataMode()

// =============================================================================
// COMPUTED
// =============================================================================

const sampleSummary = getSampleDataSummary()

// =============================================================================
// METHODS
// =============================================================================

async function loadSampleData() {
  isAnalyzing.value = true
  uploadProgress.value = 0
  error.value = null

  const progressInterval = setInterval(() => {
    uploadProgress.value = Math.min(uploadProgress.value + 20, 90)
  }, 80)

  try {
    // Load sample data to Supabase
    await loadSampleDataToSupabase()

    // Fetch and analyze the data
    const data = await fetchAnalyzerData()
    if (data) {
      try {
        analysisResult.value = analyzeData(data)
      } catch (analyzeErr) {
        throw new Error('Failed to analyze data. The data format may be invalid.')
      }
    }

    clearInterval(progressInterval)
    uploadProgress.value = 100

    dataSource.value = 'sample'
    analysisComplete.value = true

    // Refresh data mode status
    await refetchDataMode()
  } catch (err: unknown) {
    clearInterval(progressInterval)
    error.value = err instanceof Error ? err.message : 'Failed to load sample data'
  } finally {
    isAnalyzing.value = false
  }
}

async function loadExistingData() {
  isAnalyzing.value = true
  error.value = null

  try {
    const data = await fetchAnalyzerData()
    if (data) {
      try {
        analysisResult.value = analyzeData(data)
      } catch (analyzeErr) {
        throw new Error('Failed to analyze data. The data format may be invalid.')
      }
      dataSource.value = dataMode.value as 'sample' | 'user'
      analysisComplete.value = true
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : 'Failed to load data'
  } finally {
    isAnalyzing.value = false
  }
}

function handleDesignPartnerClick() {
  toast.info('Design Partner Program', {
    description: 'We\'ll be in touch! Email us at kat@tansohq.com to get started.',
  })
}

// =============================================================================
// LIFECYCLE
// =============================================================================

onMounted(async () => {
  // If redirected with loadSample flag, load sample data
  if (route.query.loadSample === 'true') {
    router.replace({ query: {} })
    await loadSampleData()
    return
  }

  // If user already has data, load and analyze it
  if (hasData.value) {
    await loadExistingData()
  }
})
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-semibold">Pricing Model Analyzer</h1>
      <p class="text-sm text-muted-foreground">
        Analyze your pricing data from CSV exports to discover optimization opportunities
      </p>
    </div>

    <!-- ==================== EMPTY STATE ==================== -->
    <template v-if="!analysisComplete">
      <!-- Error Alert -->
      <Alert v-if="error" variant="destructive" class="max-w-2xl mx-auto">
        <AlertTriangle class="h-4 w-4 shrink-0" />
        <div class="flex-1">
          <p class="font-medium">Something went wrong</p>
          <p class="text-sm mt-1 opacity-90">{{ error }}</p>
          <div class="flex gap-2 mt-3">
            <Button size="sm" variant="outline" @click="error = null; loadSampleData()">
              Try Again
            </Button>
            <Button size="sm" variant="ghost" @click="error = null">
              Dismiss
            </Button>
          </div>
        </div>
      </Alert>

      <!-- Progress (for sample data loading) -->
      <div v-if="isAnalyzing" class="space-y-2">
        <div class="flex items-center justify-between text-sm">
          <span>Loading data...</span>
          <span class="text-muted-foreground">{{ uploadProgress }}%</span>
        </div>
        <Progress :value="uploadProgress" />
      </div>

      <!-- Empty State Card -->
      <Card v-else class="max-w-2xl mx-auto">
        <CardContent class="p-12 text-center space-y-6">
          <div class="mx-auto w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <BarChart3 class="h-8 w-8 text-muted-foreground" />
          </div>

          <div class="space-y-2">
            <h2 class="text-xl font-semibold">No data connected yet</h2>
            <p class="text-muted-foreground max-w-md mx-auto">
              Connect your revenue and cost data to see margin analysis, plan health, usage anomalies, and more.
            </p>
          </div>

          <div class="space-y-3 pt-2">
            <ul class="text-sm text-muted-foreground space-y-1.5">
              <li class="flex items-center gap-2 justify-center">
                <TrendingUp class="h-4 w-4 text-primary" />
                Margin analysis
              </li>
              <li class="flex items-center gap-2 justify-center">
                <Users class="h-4 w-4 text-primary" />
                Plan health scores
              </li>
              <li class="flex items-center gap-2 justify-center">
                <AlertTriangle class="h-4 w-4 text-primary" />
                Usage anomalies & churn risk
              </li>
              <li class="flex items-center gap-2 justify-center">
                <Package class="h-4 w-4 text-primary" />
                Negative margin customers
              </li>
            </ul>
          </div>

          <div class="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <Button size="lg" @click="router.push('/data-sources')">
              <Plug class="h-4 w-4 mr-2" />
              Connect Data
            </Button>
            <Button
              variant="outline"
              size="lg"
              :disabled="isAnalyzing"
              :loading="isAnalyzing"
              @click="loadSampleData"
            >
              <TrendingUp class="h-4 w-4 mr-2" />
              Try Sample Data
            </Button>
          </div>

          <p class="text-xs text-muted-foreground">
            {{ sampleSummary.description }}
          </p>
        </CardContent>
      </Card>
    </template>

    <!-- ==================== RESULTS STATE ==================== -->
    <template v-else-if="analysisResult">
      <!-- Results Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Badge variant="secondary">
            {{ analysisResult.meta.customerCount }} customers
          </Badge>
          <Badge variant="secondary">
            {{ analysisResult.meta.planCount }} plans
          </Badge>
          <Badge variant="outline">
            Source: {{ dataSource === 'sample' ? 'Sample Data' : 'Your Data' }}
          </Badge>
        </div>
      </div>

      <!-- Tabbed Results -->
      <Tabs default-value="saas" class="space-y-6">
        <TabsList class="flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="saas">SaaS Metrics</TabsTrigger>
          <TabsTrigger value="health">Plan Health</TabsTrigger>
          <Tooltip v-if="!analysisResult.meta.hasUsageData">
            <TooltipTrigger as-child>
              <span class="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium opacity-50 cursor-not-allowed">
                Usage Anomalies
              </span>
            </TooltipTrigger>
            <TooltipContent>Upload usage data to unlock this tab</TooltipContent>
          </Tooltip>
          <TabsTrigger v-else value="usage">Usage Anomalies</TabsTrigger>
          <Tooltip v-if="!analysisResult.meta.hasCostData">
            <TooltipTrigger as-child>
              <span class="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium opacity-50 cursor-not-allowed">
                Negative Margin
              </span>
            </TooltipTrigger>
            <TooltipContent>Upload AI costs data to unlock this tab</TooltipContent>
          </Tooltip>
          <TabsTrigger v-else value="margin">Negative Margin</TabsTrigger>
        </TabsList>

        <!-- ========== SaaS Metrics Tab ========== -->
        <TabsContent value="saas" class="space-y-6">
          <!-- Hero Metrics - 4 column grid per PRD -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <!-- ARR Card -->
            <Card class="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
              <CardContent class="p-5">
                <div class="flex items-center gap-1.5 mb-2">
                  <p class="text-sm font-medium text-muted-foreground">ARR</p>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info class="h-3.5 w-3.5 text-muted-foreground/60" />
                    </TooltipTrigger>
                    <TooltipContent>Annual Recurring Revenue (MRR x 12)</TooltipContent>
                  </Tooltip>
                </div>
                <p class="text-3xl font-bold tracking-tight">
                  {{ analysisResult.saasMetrics.formatted.arr }}
                </p>
              </CardContent>
            </Card>

            <!-- MRR Card -->
            <Card>
              <CardContent class="p-5">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-1.5">
                    <p class="text-sm font-medium text-muted-foreground">MRR</p>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info class="h-3.5 w-3.5 text-muted-foreground/60" />
                      </TooltipTrigger>
                      <TooltipContent>Monthly Recurring Revenue</TooltipContent>
                    </Tooltip>
                  </div>
                  <Badge
                    v-if="analysisResult.saasMetrics.mrrGrowth !== 0"
                    :variant="analysisResult.saasMetrics.mrrGrowth > 0 ? 'success' : 'destructive'"
                    class="text-[10px]"
                  >
                    {{ analysisResult.saasMetrics.mrrGrowth > 0 ? '▲' : '▼' }}{{ Math.abs(analysisResult.saasMetrics.mrrGrowth) }}%
                  </Badge>
                </div>
                <p class="text-3xl font-bold tracking-tight">
                  {{ analysisResult.saasMetrics.formatted.mrr }}
                </p>
              </CardContent>
            </Card>

            <!-- AI Costs Card -->
            <Card v-if="analysisResult.meta.hasCostData">
              <CardContent class="p-5">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-1.5">
                    <p class="text-sm font-medium text-muted-foreground">AI Costs</p>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info class="h-3.5 w-3.5 text-muted-foreground/60" />
                      </TooltipTrigger>
                      <TooltipContent>Total AI infrastructure costs (OpenAI, Anthropic, etc.)</TooltipContent>
                    </Tooltip>
                  </div>
                  <Badge
                    v-if="analysisResult.saasMetrics.costGrowth > 0"
                    variant="destructive"
                    class="text-[10px]"
                  >
                    ▲{{ analysisResult.saasMetrics.costGrowth }}%
                  </Badge>
                </div>
                <div class="flex items-center gap-2">
                  <p class="text-3xl font-bold tracking-tight">
                    {{ analysisResult.saasMetrics.formatted.totalCosts }}
                  </p>
                  <AlertTriangle v-if="analysisResult.saasMetrics.costGrowth > 10" class="h-5 w-5 text-amber-500" />
                </div>
              </CardContent>
            </Card>

            <!-- Margin Card -->
            <Card v-if="analysisResult.meta.hasCostData">
              <CardContent class="p-5">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-1.5">
                    <p class="text-sm font-medium text-muted-foreground">Margin</p>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info class="h-3.5 w-3.5 text-muted-foreground/60" />
                      </TooltipTrigger>
                      <TooltipContent>Gross margin: (Revenue - Costs) / Revenue</TooltipContent>
                    </Tooltip>
                  </div>
                  <Badge
                    v-if="analysisResult.saasMetrics.marginChange !== 0"
                    :variant="analysisResult.saasMetrics.marginChange > 0 ? 'success' : 'destructive'"
                    class="text-[10px]"
                  >
                    {{ analysisResult.saasMetrics.marginChange > 0 ? '+' : '' }}{{ analysisResult.saasMetrics.marginChange }}pts
                  </Badge>
                </div>
                <div class="flex items-center gap-2">
                  <p class="text-3xl font-bold tracking-tight">
                    {{ analysisResult.saasMetrics.formatted.margin }}
                  </p>
                  <TrendingDown v-if="analysisResult.saasMetrics.marginChange < 0" class="h-5 w-5 text-red-500" />
                  <TrendingUp v-else-if="analysisResult.saasMetrics.marginChange > 0" class="h-5 w-5 text-green-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          <!-- Margin Alert Banner -->
          <Alert
            v-if="analysisResult.meta.hasCostData && analysisResult.saasMetrics.marginChange < -10"
            variant="destructive"
            class="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20"
          >
            <AlertTriangle class="h-4 w-4 text-amber-600" />
            <div class="ml-2">
              <p class="font-semibold text-amber-800 dark:text-amber-200">Margin Alert</p>
              <p class="text-sm text-amber-700 dark:text-amber-300">
                Costs growing faster than revenue. Margins dropped {{ Math.abs(analysisResult.saasMetrics.marginChange) }} points
                ({{ analysisResult.saasMetrics.previousMargin }}% → {{ analysisResult.saasMetrics.margin }}%).
                At this rate, profitability is at risk.
              </p>
            </div>
          </Alert>

          <!-- Secondary Metrics -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent class="p-5">
                <div class="flex items-center gap-1.5 mb-1">
                  <p class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Customers</p>
                </div>
                <p class="text-2xl font-semibold">{{ analysisResult.saasMetrics.customerCount }}</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent class="p-5">
                <div class="flex items-center gap-1.5 mb-1">
                  <p class="text-xs font-medium text-muted-foreground uppercase tracking-wide">ARPU</p>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info class="h-3 w-3 text-muted-foreground/60" />
                    </TooltipTrigger>
                    <TooltipContent>Average Revenue Per User (MRR / Customers)</TooltipContent>
                  </Tooltip>
                </div>
                <p class="text-2xl font-semibold">{{ analysisResult.saasMetrics.formatted.arpu }}</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent class="p-5">
                <div class="flex items-center gap-1.5 mb-1">
                  <p class="text-xs font-medium text-muted-foreground uppercase tracking-wide">NRR</p>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info class="h-3 w-3 text-muted-foreground/60" />
                    </TooltipTrigger>
                    <TooltipContent>Net Revenue Retention. 100%+ means growing from existing customers.</TooltipContent>
                  </Tooltip>
                </div>
                <div class="flex items-center gap-2">
                  <p class="text-2xl font-semibold">{{ analysisResult.saasMetrics.nrr }}%</p>
                  <TrendingUp v-if="analysisResult.saasMetrics.nrr >= 100" class="h-4 w-4 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent class="p-5">
                <div class="flex items-center gap-1.5 mb-1">
                  <p class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Avg LTV</p>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info class="h-3 w-3 text-muted-foreground/60" />
                    </TooltipTrigger>
                    <TooltipContent>Estimated Lifetime Value (90% retention assumption)</TooltipContent>
                  </Tooltip>
                </div>
                <p class="text-2xl font-semibold">{{ analysisResult.saasMetrics.formatted.avgLTV }}</p>
              </CardContent>
            </Card>
          </div>

          <!-- MRR Movement -->
          <Card>
            <CardHeader class="pb-2">
              <div class="flex items-center gap-2">
                <CardTitle class="text-base font-semibold">MRR Movement</CardTitle>
                <Tooltip>
                  <TooltipTrigger>
                    <Info class="h-3.5 w-3.5 text-muted-foreground/60" />
                  </TooltipTrigger>
                  <TooltipContent>Based on subscription changes. New customers in last 30 days counted as "New".</TooltipContent>
                </Tooltip>
              </div>
            </CardHeader>
            <CardContent>
              <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div class="text-center p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                  <p class="text-xs text-muted-foreground mb-0.5">New</p>
                  <p class="text-lg font-semibold text-green-600 dark:text-green-400">
                    +{{ analysisResult.saasMetrics.formatted.newMRR }}
                  </p>
                </div>
                <div class="text-center p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                  <p class="text-xs text-muted-foreground mb-0.5">Expansion</p>
                  <p class="text-lg font-semibold text-blue-600 dark:text-blue-400">
                    +{{ analysisResult.saasMetrics.formatted.expansionMRR }}
                  </p>
                </div>
                <div class="text-center p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
                  <p class="text-xs text-muted-foreground mb-0.5">Contraction</p>
                  <p class="text-lg font-semibold text-orange-600 dark:text-orange-400">
                    -{{ analysisResult.saasMetrics.formatted.contractionMRR }}
                  </p>
                </div>
                <div class="text-center p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                  <p class="text-xs text-muted-foreground mb-0.5">Churned</p>
                  <p class="text-lg font-semibold text-red-600 dark:text-red-400">
                    -{{ analysisResult.saasMetrics.formatted.churnedMRR }}
                  </p>
                </div>
                <div
                  class="text-center p-3 rounded-lg border"
                  :class="analysisResult.saasMetrics.mrrMovement.netNew >= 0
                    ? 'bg-primary/10 border-primary/20'
                    : 'bg-destructive/10 border-destructive/20'"
                >
                  <p class="text-xs text-muted-foreground mb-0.5">Net New</p>
                  <p
                    class="text-lg font-semibold"
                    :class="analysisResult.saasMetrics.mrrMovement.netNew >= 0 ? 'text-primary' : 'text-destructive'"
                  >
                    ={{ analysisResult.saasMetrics.formatted.netNewMRR }}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- ========== Plan Health Tab ========== -->
        <TabsContent value="health" class="space-y-4">
          <div v-if="analysisResult.planHealth.length > 0" class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-border">
                  <th class="text-left p-3 font-medium text-sm">Plan</th>
                  <th class="text-left p-3 font-medium text-sm">
                    <div class="flex items-center gap-1">
                      Health
                      <Tooltip>
                        <TooltipTrigger>
                          <Info class="h-3 w-3 text-muted-foreground/60" />
                        </TooltipTrigger>
                        <TooltipContent>Composite score (0-100) based on growth, retention, and usage patterns</TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  <th class="text-left p-3 font-medium text-sm">Customers</th>
                  <th class="text-left p-3 font-medium text-sm">Total MRR</th>
                  <th class="text-left p-3 font-medium text-sm">Avg MRR</th>
                  <th class="text-left p-3 font-medium text-sm">
                    <div class="flex items-center gap-1">
                      Churn Risk
                      <Tooltip>
                        <TooltipTrigger>
                          <Info class="h-3 w-3 text-muted-foreground/60" />
                        </TooltipTrigger>
                        <TooltipContent>Customers with declining usage or payment issues</TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                  <th class="text-left p-3 font-medium text-sm">
                    <div class="flex items-center gap-1">
                      Upsell Ready
                      <Tooltip>
                        <TooltipTrigger>
                          <Info class="h-3 w-3 text-muted-foreground/60" />
                        </TooltipTrigger>
                        <TooltipContent>Customers using 80%+ of plan limits</TooltipContent>
                      </Tooltip>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="plan in analysisResult.planHealth"
                  :key="plan.planId"
                  class="border-b border-border hover:bg-muted/50"
                >
                  <td class="p-3 text-sm font-medium">{{ plan.planName }}</td>
                  <td class="p-3 text-sm">
                    <div class="flex items-center gap-2">
                      <Progress :value="plan.healthScore" class="w-16 h-2" />
                      <span
                        class="font-semibold"
                        :class="plan.healthScore >= 80 ? 'text-green-600' : plan.healthScore >= 60 ? 'text-yellow-600' : 'text-red-600'"
                      >
                        {{ plan.healthScore }}
                      </span>
                    </div>
                  </td>
                  <td class="p-3 text-sm">
                    <Tooltip v-if="plan.customerNames.length > 0">
                      <TooltipTrigger class="cursor-default underline decoration-dotted underline-offset-2">
                        {{ plan.customerCount }}
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p class="font-medium mb-1">{{ plan.customerCount }} customers</p>
                        <p class="text-muted-foreground">{{ plan.customerNames.slice(0, 5).join(', ') }}{{ plan.customerNames.length > 5 ? ` +${plan.customerNames.length - 5} more` : '' }}</p>
                      </TooltipContent>
                    </Tooltip>
                    <span v-else>{{ plan.customerCount }}</span>
                  </td>
                  <td class="p-3 text-sm font-mono">${{ plan.totalMRR.toFixed(0) }}</td>
                  <td class="p-3 text-sm font-mono">${{ plan.avgMRR.toFixed(0) }}</td>
                  <td class="p-3 text-sm">
                    <Tooltip v-if="plan.churnRiskCount > 0">
                      <TooltipTrigger>
                        <Badge variant="destructive" class="cursor-default">
                          {{ plan.churnRiskCount }}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p class="font-medium mb-1">{{ plan.churnRiskCount }} at risk</p>
                        <p class="text-muted-foreground">{{ plan.churnRiskCustomers.join(', ') }}</p>
                      </TooltipContent>
                    </Tooltip>
                    <span v-else class="text-muted-foreground">0</span>
                  </td>
                  <td class="p-3 text-sm">
                    <Tooltip v-if="plan.upsellReadyCount > 0">
                      <TooltipTrigger>
                        <Badge variant="success" class="cursor-default">
                          {{ plan.upsellReadyCount }}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p class="font-medium mb-1">{{ plan.upsellReadyCount }} ready for upsell</p>
                        <p class="text-muted-foreground">{{ plan.upsellReadyCustomers.join(', ') }}</p>
                      </TooltipContent>
                    </Tooltip>
                    <span v-else class="text-muted-foreground">0</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <Card v-else>
            <CardContent class="p-6 text-center text-muted-foreground">
              No plan health data available.
            </CardContent>
          </Card>
        </TabsContent>

        <!-- Hidden for P0 scope: Price Experiments Tab -->
        <!--
        <TabsContent value="experiments" class="space-y-4">
          ... content hidden ...
        </TabsContent>
        -->

        <!-- Hidden for P0 scope: Bundling Tab -->
        <!--
        <TabsContent value="bundling" class="space-y-4">
          ... content hidden ...
        </TabsContent>
        -->

        <!-- ========== Usage Anomalies Tab ========== -->
        <TabsContent v-if="analysisResult.meta.hasUsageData" value="usage" class="space-y-4">
          <div v-if="analysisResult.usageAnomalies.length > 0" class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-border">
                  <th class="text-left p-3 font-medium text-sm">Customer</th>
                  <th class="text-left p-3 font-medium text-sm">Plan</th>
                  <th class="text-left p-3 font-medium text-sm">Usage</th>
                  <th class="text-left p-3 font-medium text-sm">Description</th>
                  <th class="text-left p-3 font-medium text-sm">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="anomaly in analysisResult.usageAnomalies"
                  :key="anomaly.customerId"
                  class="border-b border-border hover:bg-muted/50"
                >
                  <td class="p-3 text-sm font-medium">{{ anomaly.customer }}</td>
                  <td class="p-3 text-sm"><Badge variant="secondary">{{ anomaly.plan }}</Badge></td>
                  <td class="p-3 text-sm font-mono">
                    <span :class="anomaly.type === 'warning' ? 'text-yellow-600' : ''">
                      {{ anomaly.usage }}
                    </span>
                  </td>
                  <td class="p-3 text-sm text-muted-foreground">{{ anomaly.description }}</td>
                  <td class="p-3 text-sm">
                    <Badge
                      :variant="anomaly.status === 'churn_risk' ? 'destructive' : anomaly.status === 'upsell' ? 'success' : 'secondary'"
                    >
                      {{ anomaly.status === 'churn_risk' ? 'Churn Risk' : anomaly.status === 'upsell' ? 'Upsell Ready' : 'Anomaly' }}
                    </Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <Card v-else>
            <CardContent class="p-6 text-center text-muted-foreground">
              No usage anomalies detected.
            </CardContent>
          </Card>
        </TabsContent>

        <!-- ========== Negative Margin Tab ========== -->
        <TabsContent v-if="analysisResult.meta.hasCostData" value="margin" class="space-y-4">
          <Alert v-if="analysisResult.negativeMarginCustomers.length > 0" variant="destructive">
            <AlertTriangle class="h-4 w-4" />
            <span class="font-medium">{{ analysisResult.negativeMarginCustomers.length }} customers with negative margins detected</span>
            <p class="text-sm mt-1">These accounts are costing more to serve than revenue generated</p>
          </Alert>

          <div v-if="analysisResult.negativeMarginCustomers.length > 0" class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-border">
                  <th class="text-left p-3 font-medium text-sm">Customer</th>
                  <th class="text-left p-3 font-medium text-sm">Plan</th>
                  <th class="text-left p-3 font-medium text-sm">MRR</th>
                  <th class="text-left p-3 font-medium text-sm">Costs</th>
                  <th class="text-left p-3 font-medium text-sm">Margin</th>
                  <th class="text-left p-3 font-medium text-sm">Reason</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="customer in analysisResult.negativeMarginCustomers"
                  :key="customer.customerId"
                  class="border-b border-border hover:bg-muted/50"
                >
                  <td class="p-3 text-sm font-medium">{{ customer.customer }}</td>
                  <td class="p-3 text-sm"><Badge variant="secondary">{{ customer.plan }}</Badge></td>
                  <td class="p-3 text-sm font-mono">{{ customer.mrr }}</td>
                  <td class="p-3 text-sm font-mono text-destructive">{{ customer.costs }}</td>
                  <td class="p-3 text-sm"><Badge variant="destructive">{{ customer.margin }}</Badge></td>
                  <td class="p-3 text-sm text-muted-foreground">{{ customer.reason }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <Card v-else>
            <CardContent class="p-6 text-center text-muted-foreground">
              No negative margin customers detected.
            </CardContent>
          </Card>

          <!-- Gap Callout - Design Partner CTA -->
          <Card class="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent class="p-6">
              <div class="flex items-start gap-3">
                <div class="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg">
                  <Search class="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div class="flex-1">
                  <h3 class="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                    These margins are estimates
                  </h3>
                  <p class="text-sm text-blue-800 dark:text-blue-200 mb-3">
                    Costs are allocated proportionally by revenue. You don't actually know:
                  </p>
                  <ul class="text-sm text-blue-700 dark:text-blue-300 space-y-1 mb-4 list-disc list-inside">
                    <li>True cost-to-serve for each customer</li>
                    <li>Which features are driving the cost</li>
                    <li>Whether to raise prices, add limits, or cut features</li>
                  </ul>
                  <p class="text-sm text-blue-800 dark:text-blue-200 mb-4">
                    This requires tracking usage at the feature level. <strong>That's what Tanso does.</strong>
                  </p>
                  <div class="flex flex-wrap gap-3">
                    <Button size="sm" @click="handleDesignPartnerClick">
                      Become a Design Partner
                    </Button>
                    <a
                      href="https://tansohq.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3"
                    >
                      <ExternalLink class="h-3.5 w-3.5 mr-1.5" />
                      Learn More
                    </a>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- Hidden for P0 scope: Cohorts Tab -->
        <!--
        <TabsContent value="cohorts" class="space-y-4">
          ... content hidden ...
        </TabsContent>
        -->
      </Tabs>
    </template>
  </div>
</template>
