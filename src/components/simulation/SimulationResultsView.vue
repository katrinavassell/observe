<script setup lang="ts">
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Percent,
  RefreshCw,
  Download,
  FileJson,
  FileSpreadsheet,
  ChevronLeft,
  BarChart3,
  Settings,
  Loader2,
  Users,
  AlertTriangle,
  CheckCircle,
} from 'lucide-vue-next'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui'
import type { SimulationResult } from '@/types/simulation'
import { getMarginStatus } from '@/lib/simulationFormatters'
import SimulationMetricCard from './SimulationMetricCard.vue'
import SimulationRecommendations from './SimulationRecommendations.vue'
import SimulationAssumptions from './SimulationAssumptions.vue'

const props = defineProps<{
  results: SimulationResult
  scenarioName: string
  isRerunning?: boolean
}>()

const emit = defineEmits<{
  rerun: []
  back: []
  close: []
}>()

const activeTab = ref<'overview' | 'monthly' | 'breakdown'>('overview')

const marginStatus = getMarginStatus(props.results.summary.avgMarginPercent)

// Download helpers

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function downloadFullExport() {
  const date = new Date().toISOString().split('T')[0]
  const filename = `${sanitizeFilename(props.scenarioName)}_${date}_full_export.json`
  const blob = new Blob([JSON.stringify({
    export_date: new Date().toISOString(),
    scenario_name: props.scenarioName,
    ...props.results,
  }, null, 2)], { type: 'application/json' })
  triggerDownload(blob, filename)
  toast.success('Full export downloaded')
}

function downloadResults() {
  if (!props.results.monthlyData?.length) {
    toast.error('No results data available')
    return
  }
  const date = new Date().toISOString().split('T')[0]
  const filename = `${sanitizeFilename(props.scenarioName)}_${date}_results.csv`
  const headers = ['Month', 'Revenue', 'Cost', 'Margin', 'Margin %', 'Customers', 'Usage', 'Growth']
  const rows = props.results.monthlyData.map((m) => [
    m.monthLabel, m.revenue, m.cost, m.margin, m.marginPercent, m.customers, m.usage, `${m.projectedGrowth}%`,
  ])
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename)
  toast.success('Results CSV downloaded')
}

function downloadConfiguration() {
  const date = new Date().toISOString().split('T')[0]
  const filename = `${sanitizeFilename(props.scenarioName)}_${date}_config.json`
  const blob = new Blob([JSON.stringify({
    scenario_name: props.scenarioName,
    pricing_model: props.results.summary.pricingModel,
    billing_period: props.results.summary.billingPeriod,
    assumptions: props.results.assumptions,
    recommendations: props.results.recommendations,
  }, null, 2)], { type: 'application/json' })
  triggerDownload(blob, filename)
  toast.success('Configuration downloaded')
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <Button variant="ghost" size="sm" @click="emit('back')">
          <ChevronLeft class="h-4 w-4" />
        </Button>
        <div>
          <h2 class="text-lg font-semibold">{{ scenarioName }}</h2>
          <p v-if="results.assumptions?.simulatedAt" class="text-sm text-muted-foreground">
            Simulated {{ new Date(results.assumptions.simulatedAt).toLocaleString() }}
          </p>
        </div>
      </div>
      <Button variant="outline" @click="emit('rerun')" :disabled="isRerunning">
        <Loader2 v-if="isRerunning" class="h-4 w-4 mr-2 animate-spin" />
        <RefreshCw v-else class="h-4 w-4 mr-2" />
        Re-run with Latest Data
      </Button>
    </div>

    <!-- Metric Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <SimulationMetricCard
        label="Total Revenue"
        :value="'$' + results.summary.totalRevenue.toLocaleString()"
        :icon="DollarSign"
        gradient="green"
      />
      <SimulationMetricCard
        label="Total Cost"
        :value="'$' + results.summary.totalCost.toLocaleString()"
        :icon="TrendingDown"
        gradient="red"
      />
      <SimulationMetricCard
        label="Total Margin"
        :value="'$' + results.summary.totalMargin.toLocaleString()"
        :icon="TrendingUp"
        gradient="blue"
      />
      <SimulationMetricCard
        label="Avg Margin %"
        :value="results.summary.avgMarginPercent + '%'"
        :icon="Percent"
        :gradient="marginStatus.label === 'Healthy' ? 'green' : marginStatus.label === 'Moderate' ? 'yellow' : 'red'"
        :badge="{ label: marginStatus.label, class: marginStatus.color }"
      />
    </div>

    <!-- Customer Health Summary -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-muted-foreground">Total Customers</p>
              <p class="text-xl font-bold">{{ results.summary.customerCount }}</p>
            </div>
            <Users class="h-6 w-6 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-muted-foreground">Profitable</p>
              <p class="text-xl font-bold text-green-600">{{ results.summary.profitableCustomers }}</p>
            </div>
            <CheckCircle class="h-6 w-6 text-green-600" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-muted-foreground">At Risk</p>
              <p class="text-xl font-bold text-red-600">{{ results.summary.unprofitableCustomers }}</p>
            </div>
            <AlertTriangle class="h-6 w-6 text-red-600" />
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Tabbed Content -->
    <Tabs v-model="activeTab" class="w-full">
      <TabsList class="grid grid-cols-3 mb-6">
        <TabsTrigger value="overview" class="flex items-center gap-2">
          <BarChart3 class="h-4 w-4" />
          Overview
        </TabsTrigger>
        <TabsTrigger value="monthly">Monthly Projections</TabsTrigger>
        <TabsTrigger value="breakdown">Cost Breakdown</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" class="space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SimulationRecommendations v-if="results.recommendations" :recommendations="results.recommendations" />
          <SimulationAssumptions :assumptions="results.assumptions" :summary="results.summary" />
        </div>
      </TabsContent>

      <TabsContent value="monthly">
        <Card>
          <CardHeader>
            <CardTitle class="text-base">12-Month Projection</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b">
                    <th class="text-left p-2 font-medium">Month</th>
                    <th class="text-right p-2 font-medium">Revenue</th>
                    <th class="text-right p-2 font-medium">Cost</th>
                    <th class="text-right p-2 font-medium">Margin</th>
                    <th class="text-right p-2 font-medium">Margin %</th>
                    <th class="text-right p-2 font-medium">Customers</th>
                    <th class="text-right p-2 font-medium">Usage</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="month in results.monthlyData"
                    :key="month.month"
                    class="border-b hover:bg-muted/50"
                  >
                    <td class="p-2 font-medium">{{ month.monthLabel }}</td>
                    <td class="p-2 text-right">${{ month.revenue.toLocaleString() }}</td>
                    <td class="p-2 text-right">${{ month.cost.toLocaleString() }}</td>
                    <td class="p-2 text-right" :class="month.margin >= 0 ? 'text-green-600' : 'text-red-600'">
                      ${{ month.margin.toLocaleString() }}
                    </td>
                    <td class="p-2 text-right" :class="month.marginPercent >= 0 ? 'text-green-600' : 'text-red-600'">
                      {{ month.marginPercent.toFixed(1) }}%
                    </td>
                    <td class="p-2 text-right">{{ month.customers.toLocaleString() }}</td>
                    <td class="p-2 text-right text-muted-foreground">
                      {{ (month.usage / 1000000).toFixed(2) }}M
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="breakdown" class="space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card v-if="results.modelBreakdown?.length">
            <CardHeader>
              <CardTitle class="text-base">Cost by Model</CardTitle>
            </CardHeader>
            <CardContent>
              <div class="space-y-4">
                <div v-for="model in results.modelBreakdown" :key="model.model" class="space-y-2">
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="font-medium text-sm">{{ model.model }}</p>
                      <p class="text-xs text-muted-foreground">{{ (model.tokens / 1000000).toFixed(2) }}M tokens</p>
                    </div>
                    <div class="text-right">
                      <p class="font-medium">${{ model.cost.toFixed(2) }}</p>
                      <p class="text-xs text-muted-foreground">{{ model.percentOfTotal.toFixed(1) }}%</p>
                    </div>
                  </div>
                  <div class="w-full bg-muted rounded-full h-2">
                    <div class="bg-primary h-2 rounded-full transition-all" :style="{ width: `${model.percentOfTotal}%` }" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card v-if="results.customerBreakdown?.length">
            <CardHeader>
              <CardTitle class="text-base">Customer Margins (Top/Bottom 5)</CardTitle>
            </CardHeader>
            <CardContent>
              <div class="space-y-3">
                <template v-for="customer in results.customerBreakdown.slice(0, 5)" :key="customer.customerId">
                  <div class="flex items-center justify-between p-2 rounded" :class="customer.profitable ? 'bg-green-50' : 'bg-red-50'">
                    <div>
                      <p class="font-medium text-sm">{{ customer.customerEmail || customer.customerId }}</p>
                      <p class="text-xs text-muted-foreground">Revenue: ${{ customer.revenue.toLocaleString() }}</p>
                    </div>
                    <div class="text-right">
                      <p class="font-medium" :class="customer.profitable ? 'text-green-600' : 'text-red-600'">
                        {{ customer.marginPercent.toFixed(1) }}%
                      </p>
                      <p class="text-xs text-muted-foreground">${{ customer.margin.toLocaleString() }}</p>
                    </div>
                  </div>
                </template>
                <div v-if="results.customerBreakdown.length > 5" class="text-center py-2">
                  <p class="text-xs text-muted-foreground">
                    ... and {{ results.customerBreakdown.length - 5 }} more customers
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>

    <!-- Downloads -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <Download class="h-4 w-4" />
          Download Simulation Data
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Button variant="outline" class="h-auto py-4 flex flex-col items-center gap-2" @click="downloadFullExport">
            <FileJson class="h-6 w-6 text-blue-600" />
            <div class="text-center">
              <p class="font-medium">Full Export</p>
              <p class="text-xs text-muted-foreground">All data as JSON</p>
            </div>
          </Button>
          <Button variant="outline" class="h-auto py-4 flex flex-col items-center gap-2" @click="downloadResults">
            <FileSpreadsheet class="h-6 w-6 text-green-600" />
            <div class="text-center">
              <p class="font-medium">Results CSV</p>
              <p class="text-xs text-muted-foreground">Monthly projections</p>
            </div>
          </Button>
          <Button variant="outline" class="h-auto py-4 flex flex-col items-center gap-2" @click="downloadConfiguration">
            <Settings class="h-6 w-6 text-purple-600" />
            <div class="text-center">
              <p class="font-medium">Configuration</p>
              <p class="text-xs text-muted-foreground">Settings as JSON</p>
            </div>
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
