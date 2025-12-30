<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  TrendingUp,
  AlertTriangle,
  Users,
  Package,
  RefreshCw,
  Info,
  BarChart3,
  Layers,
  Plug,
} from 'lucide-vue-next'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
// FileDropzone removed - uploads now handled via Data Sources page
import {
  parseCSV,
  analyzeData,
  type Customer,
  type Plan,
  type Subscription,
  type Invoice,
  type UsageRecord,
  type CostRecord,
  type AnalysisResult,
} from '@/lib/pricing-analyzer'
import { generateSampleData, getSampleDataSummary } from '@/lib/sample-data'

// =============================================================================
// STATE
// =============================================================================

const isAnalyzing = ref(false)
const analysisComplete = ref(false)
const uploadProgress = ref(0)
const error = ref<string | null>(null)
const analysisResult = ref<AnalysisResult | null>(null)
const dataSource = ref<'csv' | 'sample'>('csv')

// File states
const customersFile = ref<File | null>(null)
const plansFile = ref<File | null>(null)
const subscriptionsFile = ref<File | null>(null)
const invoicesFile = ref<File | null>(null)
const usageFile = ref<File | null>(null)
const costsFile = ref<File | null>(null)

// =============================================================================
// COMPUTED
// =============================================================================

const canAnalyze = computed(() => {
  return customersFile.value && plansFile.value && subscriptionsFile.value
})

const sampleSummary = getSampleDataSummary()

// =============================================================================
// METHODS
// =============================================================================

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

async function runAnalysis() {
  isAnalyzing.value = true
  uploadProgress.value = 0
  error.value = null

  const progressInterval = setInterval(() => {
    uploadProgress.value = Math.min(uploadProgress.value + 15, 90)
  }, 100)

  try {
    let customers: Customer[]
    let plans: Plan[]
    let subscriptions: Subscription[]
    let invoices: Invoice[] | undefined
    let usage: UsageRecord[] | undefined
    let costs: CostRecord[] | undefined

    // Parse required files
    const customersText = await readFileAsText(customersFile.value!)
    const plansText = await readFileAsText(plansFile.value!)
    const subscriptionsText = await readFileAsText(subscriptionsFile.value!)

    customers = parseCSV<Customer>(customersText)
    plans = parseCSV<Plan>(plansText)
    subscriptions = parseCSV<Subscription>(subscriptionsText)

    if (customers.length === 0) throw new Error('No customers found in CSV')
    if (plans.length === 0) throw new Error('No plans found in CSV')
    if (subscriptions.length === 0) throw new Error('No subscriptions found in CSV')

    // Parse optional files
    if (invoicesFile.value) {
      const invoicesText = await readFileAsText(invoicesFile.value)
      invoices = parseCSV<Invoice>(invoicesText)
    }
    if (usageFile.value) {
      const usageText = await readFileAsText(usageFile.value)
      usage = parseCSV<UsageRecord>(usageText)
    }
    if (costsFile.value) {
      const costsText = await readFileAsText(costsFile.value)
      costs = parseCSV<CostRecord>(costsText)
    }

    clearInterval(progressInterval)
    uploadProgress.value = 100

    // Run analysis
    analysisResult.value = analyzeData({
      customers,
      plans,
      subscriptions,
      invoices,
      usage,
      costs,
    })

    dataSource.value = 'csv'
    analysisComplete.value = true
  } catch (err: unknown) {
    clearInterval(progressInterval)
    error.value = err instanceof Error ? err.message : 'Analysis failed'
  } finally {
    isAnalyzing.value = false
  }
}

async function loadSampleData() {
  isAnalyzing.value = true
  uploadProgress.value = 0
  error.value = null

  const progressInterval = setInterval(() => {
    uploadProgress.value = Math.min(uploadProgress.value + 20, 90)
  }, 80)

  try {
    await new Promise(resolve => setTimeout(resolve, 500)) // Simulate processing

    const sampleData = generateSampleData()
    analysisResult.value = analyzeData(sampleData)

    clearInterval(progressInterval)
    uploadProgress.value = 100

    dataSource.value = 'sample'
    analysisComplete.value = true
  } catch (err: unknown) {
    clearInterval(progressInterval)
    error.value = err instanceof Error ? err.message : 'Failed to load sample data'
  } finally {
    isAnalyzing.value = false
  }
}

function resetAnalysis() {
  analysisComplete.value = false
  analysisResult.value = null
  error.value = null
  uploadProgress.value = 0
  customersFile.value = null
  plansFile.value = null
  subscriptionsFile.value = null
  invoicesFile.value = null
  usageFile.value = null
  costsFile.value = null
}
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
      <Alert v-if="error" variant="destructive">
        <AlertTriangle class="h-4 w-4" />
        <span class="font-medium">Error:</span> {{ error }}
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
            <router-link to="/data-sources">
              <Button size="lg">
                <Plug class="h-4 w-4 mr-2" />
                Connect Data
              </Button>
            </router-link>
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
            Source: {{ dataSource === 'sample' ? 'Sample Data' : 'CSV Upload' }}
          </Badge>
        </div>
        <Button variant="outline" @click="resetAnalysis">
          <RefreshCw class="h-4 w-4 mr-2" />
          New Analysis
        </Button>
      </div>

      <!-- Tabbed Results -->
      <Tabs default-value="saas" class="space-y-6">
        <TabsList class="flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="saas">SaaS Metrics</TabsTrigger>
          <TabsTrigger value="health">Plan Health</TabsTrigger>
          <!-- Hidden for P0 scope -->
          <!-- <TabsTrigger value="experiments">Price Experiments</TabsTrigger> -->
          <!-- <TabsTrigger value="bundling">Bundling</TabsTrigger> -->
          <TabsTrigger v-if="analysisResult.meta.hasUsageData" value="usage">
            Usage Anomalies
          </TabsTrigger>
          <TabsTrigger v-if="analysisResult.meta.hasCostData" value="margin">
            Negative Margin
          </TabsTrigger>
          <!-- <TabsTrigger value="cohorts">Cohorts</TabsTrigger> -->
        </TabsList>

        <!-- ========== SaaS Metrics Tab ========== -->
        <TabsContent value="saas" class="space-y-6">
          <!-- Hero Metrics -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card class="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
              <CardContent class="p-6">
                <div class="flex items-center gap-1.5 mb-2">
                  <p class="text-sm font-medium text-muted-foreground">Annual Recurring Revenue</p>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info class="h-3.5 w-3.5 text-muted-foreground/60" />
                    </TooltipTrigger>
                    <TooltipContent>MRR x 12</TooltipContent>
                  </Tooltip>
                </div>
                <p class="text-4xl font-bold tracking-tight">
                  {{ analysisResult.saasMetrics.formatted.arr }}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent class="p-6">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-1.5">
                    <p class="text-sm font-medium text-muted-foreground">Monthly Recurring Revenue</p>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info class="h-3.5 w-3.5 text-muted-foreground/60" />
                      </TooltipTrigger>
                      <TooltipContent>Sum of all active subscriptions</TooltipContent>
                    </Tooltip>
                  </div>
                  <Badge
                    v-if="analysisResult.saasMetrics.mrrGrowth !== 0"
                    :variant="analysisResult.saasMetrics.mrrGrowth > 0 ? 'success' : 'destructive'"
                  >
                    {{ analysisResult.saasMetrics.mrrGrowth > 0 ? '+' : '' }}{{ analysisResult.saasMetrics.mrrGrowth }}% MoM
                  </Badge>
                </div>
                <p class="text-4xl font-bold tracking-tight">
                  {{ analysisResult.saasMetrics.formatted.mrr }}
                </p>
              </CardContent>
            </Card>
          </div>

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
              <div class="grid grid-cols-5 gap-3">
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
                  <th class="text-left p-3 font-medium text-sm">Health</th>
                  <th class="text-left p-3 font-medium text-sm">Customers</th>
                  <th class="text-left p-3 font-medium text-sm">Total MRR</th>
                  <th class="text-left p-3 font-medium text-sm">Avg MRR</th>
                  <th class="text-left p-3 font-medium text-sm">Churn Risk</th>
                  <th class="text-left p-3 font-medium text-sm">Upsell Ready</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="plan in analysisResult.planHealth"
                  :key="plan.planId"
                  class="border-b border-border hover:bg-muted/50"
                >
                  <td class="p-3 font-medium">{{ plan.planName }}</td>
                  <td class="p-3">
                    <div class="flex items-center gap-2">
                      <Progress :value="plan.healthScore" class="w-16 h-2" />
                      <span
                        class="text-sm font-semibold"
                        :class="plan.healthScore >= 80 ? 'text-green-600' : plan.healthScore >= 60 ? 'text-yellow-600' : 'text-red-600'"
                      >
                        {{ plan.healthScore }}
                      </span>
                    </div>
                  </td>
                  <td class="p-3">{{ plan.customerCount }}</td>
                  <td class="p-3 font-mono">${{ plan.totalMRR.toFixed(0) }}</td>
                  <td class="p-3 font-mono">${{ plan.avgMRR.toFixed(0) }}</td>
                  <td class="p-3">
                    <Badge v-if="plan.churnRiskCount > 0" variant="destructive">
                      {{ plan.churnRiskCount }}
                    </Badge>
                    <span v-else class="text-muted-foreground">0</span>
                  </td>
                  <td class="p-3">
                    <Badge v-if="plan.upsellReadyCount > 0" variant="success">
                      {{ plan.upsellReadyCount }}
                    </Badge>
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
                  <td class="p-3 font-medium">{{ anomaly.customer }}</td>
                  <td class="p-3"><Badge variant="secondary">{{ anomaly.plan }}</Badge></td>
                  <td class="p-3">
                    <span :class="anomaly.type === 'warning' ? 'text-yellow-600 font-semibold' : ''">
                      {{ anomaly.usage }}
                    </span>
                  </td>
                  <td class="p-3 text-sm text-muted-foreground">{{ anomaly.description }}</td>
                  <td class="p-3">
                    <Badge :variant="anomaly.type === 'warning' ? 'destructive' : 'secondary'">
                      {{ anomaly.type === 'warning' ? 'Over Limit' : 'Under-utilized' }}
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
                  <td class="p-3 font-medium">{{ customer.customer }}</td>
                  <td class="p-3"><Badge variant="secondary">{{ customer.plan }}</Badge></td>
                  <td class="p-3 font-mono">{{ customer.mrr }}</td>
                  <td class="p-3 font-mono text-destructive font-semibold">{{ customer.costs }}</td>
                  <td class="p-3"><Badge variant="destructive">{{ customer.margin }}</Badge></td>
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
