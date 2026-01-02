<script setup lang="ts">
import { ref, computed } from 'vue'
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

// Computed helpers for display
const marginStatus = computed(() => {
  const margin = props.results.summary.avgMarginPercent
  if (margin >= 30) return { color: 'text-green-600', bg: 'bg-green-50', label: 'Healthy', icon: CheckCircle }
  if (margin >= 10) return { color: 'text-yellow-600', bg: 'bg-yellow-50', label: 'Moderate', icon: AlertTriangle }
  return { color: 'text-red-600', bg: 'bg-red-50', label: 'At Risk', icon: AlertTriangle }
})

const formattedDate = computed(() => {
  if (!props.results.assumptions?.simulatedAt) return ''
  return new Date(props.results.assumptions.simulatedAt).toLocaleString()
})

// Download functions
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
}

function downloadJson(data: unknown, filename: string) {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  triggerDownload(blob, filename)
}

function downloadCsv(headers: string[], rows: (string | number)[][], filename: string) {
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      row
        .map((cell) =>
          typeof cell === 'string' && cell.includes(',') ? `"${cell}"` : cell
        )
        .join(',')
    ),
  ].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, filename)
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

  const exportData = {
    export_date: new Date().toISOString(),
    scenario_name: props.scenarioName,
    summary: props.results.summary,
    monthly_projections: props.results.monthlyData,
    customer_breakdown: props.results.customerBreakdown,
    model_breakdown: props.results.modelBreakdown,
    recommendations: props.results.recommendations,
    assumptions: props.results.assumptions,
  }

  downloadJson(exportData, filename)
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
    m.monthLabel,
    m.revenue,
    m.cost,
    m.margin,
    m.marginPercent,
    m.customers,
    m.usage,
    `${(m.projectedGrowth * 100).toFixed(1)}%`,
  ])

  downloadCsv(headers, rows, filename)
  toast.success('Results CSV downloaded')
}

function downloadConfiguration() {
  const date = new Date().toISOString().split('T')[0]
  const filename = `${sanitizeFilename(props.scenarioName)}_${date}_config.json`

  const configData = {
    scenario_name: props.scenarioName,
    pricing_model: props.results.summary.pricingModel,
    billing_period: props.results.summary.billingPeriod,
    assumptions: props.results.assumptions,
    recommendations: props.results.recommendations,
  }

  downloadJson(configData, filename)
  toast.success('Configuration downloaded')
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header with Actions -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <Button variant="ghost" size="sm" @click="emit('back')">
          <ChevronLeft class="h-4 w-4" />
        </Button>
        <div>
          <h2 class="text-lg font-semibold">{{ scenarioName }}</h2>
          <p class="text-sm text-muted-foreground">
            Simulated {{ formattedDate }}
          </p>
        </div>
      </div>
      <div class="flex gap-2">
        <Button variant="outline" @click="emit('rerun')" :disabled="isRerunning">
          <Loader2 v-if="isRerunning" class="h-4 w-4 mr-2 animate-spin" />
          <RefreshCw v-else class="h-4 w-4 mr-2" />
          Re-run with Latest Data
        </Button>
      </div>
    </div>

    <!-- High-Level Metric Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card class="bg-gradient-to-br from-green-50 to-green-100/50 border-green-200">
        <CardContent class="pt-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-green-800">Total Revenue</p>
              <p class="text-2xl font-bold text-green-900">
                ${{ results.summary.totalRevenue.toLocaleString() }}
              </p>
            </div>
            <DollarSign class="h-8 w-8 text-green-600" />
          </div>
        </CardContent>
      </Card>

      <Card class="bg-gradient-to-br from-red-50 to-red-100/50 border-red-200">
        <CardContent class="pt-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-red-800">Total Cost</p>
              <p class="text-2xl font-bold text-red-900">
                ${{ results.summary.totalCost.toLocaleString() }}
              </p>
            </div>
            <TrendingDown class="h-8 w-8 text-red-600" />
          </div>
        </CardContent>
      </Card>

      <Card class="bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200">
        <CardContent class="pt-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-blue-800">Total Margin</p>
              <p class="text-2xl font-bold text-blue-900">
                ${{ results.summary.totalMargin.toLocaleString() }}
              </p>
            </div>
            <TrendingUp class="h-8 w-8 text-blue-600" />
          </div>
        </CardContent>
      </Card>

      <Card :class="`bg-gradient-to-br border ${marginStatus.bg} ${marginStatus.bg.replace('bg-', 'border-').replace('-50', '-200')}`">
        <CardContent class="pt-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium" :class="marginStatus.color.replace('text-', 'text-').replace('-600', '-800')">
                Avg Margin %
              </p>
              <p class="text-2xl font-bold" :class="marginStatus.color">
                {{ results.summary.avgMarginPercent }}%
              </p>
              <Badge variant="outline" class="mt-1 text-xs" :class="marginStatus.color">
                {{ marginStatus.label }}
              </Badge>
            </div>
            <Percent class="h-8 w-8" :class="marginStatus.color" />
          </div>
        </CardContent>
      </Card>
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
        <TabsTrigger value="monthly">
          Monthly Projections
        </TabsTrigger>
        <TabsTrigger value="breakdown">
          Cost Breakdown
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" class="space-y-6">
        <!-- Recommendations + Assumptions -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Pricing Recommendations -->
          <Card v-if="results.recommendations">
            <CardHeader>
              <CardTitle class="text-base flex items-center gap-2">
                <TrendingUp class="h-4 w-4" />
                Pricing Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="flex justify-between items-center">
                <span class="text-sm text-muted-foreground">Current Implied Price</span>
                <span class="font-medium">${{ results.recommendations.currentImpliedPrice.toFixed(2) }}/M tokens</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-sm text-muted-foreground">Break-even Price</span>
                <span class="font-medium text-red-600">${{ results.recommendations.breakEvenPrice.toFixed(2) }}/M tokens</span>
              </div>
              <div class="border-t pt-3 mt-3">
                <p class="text-xs text-muted-foreground mb-2">Recommended prices for target margins:</p>
                <div class="grid grid-cols-2 gap-2">
                  <div class="flex justify-between items-center">
                    <span class="text-sm text-muted-foreground">20% Margin</span>
                    <span class="font-medium text-yellow-600">
                      ${{ results.recommendations.recommendedPriceFor20Percent.toFixed(2) }}
                    </span>
                  </div>
                  <div class="flex justify-between items-center">
                    <span class="text-sm text-muted-foreground">30% Margin</span>
                    <span class="font-medium text-green-600">
                      ${{ results.recommendations.recommendedPriceFor30Percent.toFixed(2) }}
                    </span>
                  </div>
                  <div class="flex justify-between items-center">
                    <span class="text-sm text-muted-foreground">40% Margin</span>
                    <span class="font-medium text-green-600">
                      ${{ results.recommendations.recommendedPriceFor40Percent.toFixed(2) }}
                    </span>
                  </div>
                  <div class="flex justify-between items-center">
                    <span class="text-sm text-muted-foreground">50% Margin</span>
                    <span class="font-medium text-green-700">
                      ${{ results.recommendations.recommendedPriceFor50Percent.toFixed(2) }}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- Assumptions -->
          <Card>
            <CardHeader>
              <CardTitle class="text-base flex items-center gap-2">
                <Settings class="h-4 w-4" />
                Simulation Assumptions
              </CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="flex justify-between">
                <span class="text-sm text-muted-foreground">Pricing Model</span>
                <span class="font-medium">{{ results.summary.pricingModel }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-sm text-muted-foreground">Billing Period</span>
                <span class="font-medium">{{ results.summary.billingPeriod }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-sm text-muted-foreground">Growth Rate</span>
                <span class="font-medium">{{ (results.assumptions.growthRate * 100).toFixed(1) }}% monthly</span>
              </div>
              <div class="flex justify-between">
                <span class="text-sm text-muted-foreground">Date Range</span>
                <span class="font-medium text-xs">
                  {{ results.assumptions.dateRange.start }} to {{ results.assumptions.dateRange.end }}
                </span>
              </div>
              <div class="pt-3 border-t">
                <p class="text-sm font-medium mb-2">Data Sources:</p>
                <div class="space-y-1">
                  <div
                    v-for="source in results.assumptions.dataSources"
                    :key="source.id"
                    class="text-sm text-muted-foreground flex items-center gap-2"
                  >
                    <span class="w-2 h-2 rounded-full bg-green-500"></span>
                    {{ source.name }}
                    <Badge variant="outline" class="text-xs">
                      {{ source.dataTypes.join(', ') }}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="monthly">
        <!-- Monthly Projection Table -->
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
        <!-- Model Cost Breakdown -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card v-if="results.modelBreakdown?.length">
            <CardHeader>
              <CardTitle class="text-base">Cost by Model</CardTitle>
            </CardHeader>
            <CardContent>
              <div class="space-y-4">
                <div
                  v-for="model in results.modelBreakdown"
                  :key="model.model"
                  class="space-y-2"
                >
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="font-medium text-sm">{{ model.model }}</p>
                      <p class="text-xs text-muted-foreground">
                        {{ (model.tokens / 1000000).toFixed(2) }}M tokens
                      </p>
                    </div>
                    <div class="text-right">
                      <p class="font-medium">${{ model.cost.toFixed(2) }}</p>
                      <p class="text-xs text-muted-foreground">
                        {{ model.percentOfTotal.toFixed(1) }}%
                      </p>
                    </div>
                  </div>
                  <div class="w-full bg-muted rounded-full h-2">
                    <div
                      class="bg-primary h-2 rounded-full transition-all"
                      :style="{ width: `${model.percentOfTotal}%` }"
                    />
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
                <!-- Show worst 5 first -->
                <template v-for="customer in results.customerBreakdown.slice(0, 5)" :key="customer.customerId">
                  <div
                    class="flex items-center justify-between p-2 rounded"
                    :class="customer.profitable ? 'bg-green-50' : 'bg-red-50'"
                  >
                    <div>
                      <p class="font-medium text-sm">
                        {{ customer.customerEmail || customer.customerId }}
                      </p>
                      <p class="text-xs text-muted-foreground">
                        Revenue: ${{ customer.revenue.toLocaleString() }}
                      </p>
                    </div>
                    <div class="text-right">
                      <p
                        class="font-medium"
                        :class="customer.profitable ? 'text-green-600' : 'text-red-600'"
                      >
                        {{ customer.marginPercent.toFixed(1) }}%
                      </p>
                      <p class="text-xs text-muted-foreground">
                        ${{ customer.margin.toLocaleString() }}
                      </p>
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

    <!-- Download Section -->
    <Card>
      <CardHeader>
        <CardTitle class="text-base flex items-center gap-2">
          <Download class="h-4 w-4" />
          Download Simulation Data
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Button
            variant="outline"
            class="h-auto py-4 flex flex-col items-center gap-2"
            @click="downloadFullExport"
          >
            <FileJson class="h-6 w-6 text-blue-600" />
            <div class="text-center">
              <p class="font-medium">Full Export</p>
              <p class="text-xs text-muted-foreground">All data as JSON</p>
            </div>
          </Button>

          <Button
            variant="outline"
            class="h-auto py-4 flex flex-col items-center gap-2"
            @click="downloadResults"
          >
            <FileSpreadsheet class="h-6 w-6 text-green-600" />
            <div class="text-center">
              <p class="font-medium">Results CSV</p>
              <p class="text-xs text-muted-foreground">Monthly projections</p>
            </div>
          </Button>

          <Button
            variant="outline"
            class="h-auto py-4 flex flex-col items-center gap-2"
            @click="downloadConfiguration"
          >
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
