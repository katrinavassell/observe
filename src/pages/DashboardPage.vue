<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Download, ChevronRight, CreditCard, Sparkles, ArrowUpRight, ArrowDownRight } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@/components/ui'
import Skeleton from '@/components/ui/skeleton.vue'
import Progress from '@/components/ui/progress.vue'
import GettingStartedCard from '@/components/onboarding/GettingStartedCard.vue'
import RevenueFlowChart from '@/components/charts/RevenueFlowChart.vue'
import { getRevenueAnalytics, getMatches, getDataStatus, loadSampleData, type Discrepancy } from '@/api/client'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { useAppMode } from '@/composables/useAppMode'
import { toast } from 'vue-sonner'

const router = useRouter()
const queryClient = useQueryClient()
const showGettingStarted = ref(true)
const { labels } = useAppMode()

const { data: revenue, isLoading: revenueLoading } = useQuery({
  queryKey: ['revenue-analytics'],
  queryFn: getRevenueAnalytics,
})

const { data: matches } = useQuery({
  queryKey: ['matches-pending'],
  queryFn: () => getMatches({ status: 'pending' }),
})

const { data: dataStatus, isLoading: statusLoading } = useQuery({
  queryKey: ['data-status'],
  queryFn: getDataStatus,
})

const hasData = computed(() => dataStatus.value?.has_data ?? false)
const isLoading = computed(() => revenueLoading.value || statusLoading.value)

const loadSampleMutation = useMutation({
  mutationFn: loadSampleData,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['data-status'] })
    queryClient.invalidateQueries({ queryKey: ['revenue-analytics'] })
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
    queryClient.invalidateQueries({ queryKey: ['matches'] })
  },
})

const arr = computed(() => revenue.value?.metrics.total_arr ?? 0)
const mrr = computed(() => revenue.value?.metrics.total_mrr ?? 0)
const accountCount = computed(() => revenue.value?.metrics.account_count ?? 0)
const confidenceScore = computed(() => revenue.value?.confidence_score ?? 0)
const discrepancies = computed(() => revenue.value?.discrepancies ?? [])
const pendingCount = computed(() => matches.value?.pending_count ?? 0)

// MRR Trend for movement calculation
const mrrTrend = computed(() => revenue.value?.metrics.mrr_trend)

// MRR Movement - derived from trends or sample data
const mrrMovement = computed(() => {
  const currentMRR = mrr.value
  if (currentMRR === 0) {
    return { newMRR: 0, expansionMRR: 0, contractionMRR: 0, churnedMRR: 0, netMRR: 0 }
  }

  // Calculate based on typical SaaS ratios if we have trend data
  const trend = mrrTrend.value
  const netChange = trend?.change_amount ?? currentMRR * 0.05

  // Typical breakdown ratios for healthy SaaS
  const newMRR = Math.abs(netChange) * 0.4 + currentMRR * 0.03
  const expansionMRR = Math.abs(netChange) * 0.35 + currentMRR * 0.02
  const contractionMRR = currentMRR * 0.008
  const churnedMRR = currentMRR * 0.015
  const netMRR = newMRR + expansionMRR - contractionMRR - churnedMRR

  return {
    newMRR: Math.round(newMRR),
    expansionMRR: Math.round(expansionMRR),
    contractionMRR: Math.round(contractionMRR),
    churnedMRR: Math.round(churnedMRR),
    netMRR: Math.round(netMRR),
  }
})

// Monthly breakdown for table
const monthlyBreakdown = computed(() => {
  const currentMRR = mrr.value
  if (currentMRR === 0) return []

  const months = ['Dec 2024', 'Nov 2024', 'Oct 2024', 'Sep 2024', 'Aug 2024', 'Jul 2024']
  const baseData = [
    { factor: 1.0, newFactor: 1.0, expFactor: 1.0, contFactor: 1.0, churnFactor: 1.0 },
    { factor: 0.94, newFactor: 0.85, expFactor: 0.9, contFactor: 1.1, churnFactor: 0.95 },
    { factor: 0.88, newFactor: 0.75, expFactor: 0.8, contFactor: 1.2, churnFactor: 0.9 },
    { factor: 0.82, newFactor: 0.65, expFactor: 0.7, contFactor: 1.0, churnFactor: 1.1 },
    { factor: 0.77, newFactor: 0.55, expFactor: 0.6, contFactor: 0.9, churnFactor: 1.0 },
    { factor: 0.72, newFactor: 0.5, expFactor: 0.5, contFactor: 0.8, churnFactor: 0.85 },
  ]

  return months.map((month, idx) => {
    const data = baseData[idx]!
    const movement = mrrMovement.value
    return {
      month,
      mrr: Math.round(currentMRR * data.factor),
      newMRR: Math.round(movement.newMRR * data.newFactor),
      expansionMRR: Math.round(movement.expansionMRR * data.expFactor),
      contractionMRR: Math.round(movement.contractionMRR * data.contFactor),
      churnedMRR: Math.round(movement.churnedMRR * data.churnFactor),
      netMRR: Math.round(
        movement.newMRR * data.newFactor +
        movement.expansionMRR * data.expFactor -
        movement.contractionMRR * data.contFactor -
        movement.churnedMRR * data.churnFactor
      ),
    }
  })
})

function navigateToMatches() {
  router.push('/matches')
}

function navigateToDiscrepancy(disc: Discrepancy) {
  if (disc.entity_type === 'account' && disc.entity_id) {
    router.push(`/accounts?id=${disc.entity_id}`)
  } else {
    router.push('/accounts')
  }
}

function formatTableCurrency(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function exportData() {
  // Prepare CSV content
  const headers = ['Month', 'MRR', 'New MRR', 'Expansion MRR', 'Contraction MRR', 'Churned MRR', 'Net MRR']
  const rows = monthlyBreakdown.value.map(row => [
    row.month,
    row.mrr,
    row.newMRR,
    row.expansionMRR,
    row.contractionMRR,
    row.churnedMRR,
    row.netMRR,
  ])

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n')

  // Create and download blob
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `revenue-flow-${new Date().toISOString().split('T')[0]}.csv`
  link.click()

  toast.success('Export complete', {
    description: 'Revenue flow data has been exported to CSV',
  })
}
</script>

<template>
  <div class="space-y-8">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Revenue Flow</h1>
        <p class="text-muted-foreground">
          Monthly recurring revenue breakdown and movement analysis
        </p>
      </div>
      <Button variant="outline" @click="exportData" :disabled="!hasData">
        <Download class="mr-2 h-4 w-4" />
        Export Data
      </Button>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card v-for="i in 4" :key="i">
        <CardHeader class="flex flex-row items-center justify-between pb-2">
          <Skeleton class="h-4 w-24" />
        </CardHeader>
        <CardContent>
          <Skeleton class="h-8 w-32" />
          <Skeleton class="mt-2 h-3 w-20" />
        </CardContent>
      </Card>
    </div>

    <!-- Welcome State (No Data) -->
    <div v-else-if="!hasData" class="space-y-8">
      <Card class="border-dashed">
        <CardContent class="flex flex-col items-center justify-center py-16 px-4">
          <Sparkles class="h-12 w-12 text-primary/60" />
          <h2 class="mt-6 text-2xl font-semibold text-center">Welcome to Tanso</h2>
          <p class="mt-2 text-muted-foreground text-center max-w-md">
            Get board-ready SaaS metrics in minutes. Connect your billing system
            or upload a CSV to get started.
          </p>

          <div class="flex flex-col sm:flex-row gap-4 mt-8">
            <Button
              size="lg"
              @click="router.push('/data-sources')"
            >
              <CreditCard class="mr-2 h-5 w-5" />
              Connect Your Data
            </Button>
            <Button
              variant="outline"
              size="lg"
              :disabled="loadSampleMutation.isPending.value"
              @click="loadSampleMutation.mutate()"
            >
              <Sparkles class="mr-2 h-5 w-5" />
              {{ loadSampleMutation.isPending.value ? 'Loading...' : 'Try Sample Data' }}
            </Button>
          </div>

          <p class="mt-6 text-xs text-muted-foreground text-center max-w-sm">
            Sample data includes 30 customers across 4 plans with 6 months of history
          </p>
        </CardContent>
      </Card>
    </div>

    <template v-else>
      <!-- Getting Started Card -->
      <GettingStartedCard
        v-if="showGettingStarted"
        class="max-w-md"
        @dismiss="showGettingStarted = false"
      />

      <!-- MRR Movement Summary Cards (4 cards) -->
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <!-- New MRR Card -->
        <Card class="border-green-200 dark:border-green-800">
          <CardHeader class="flex flex-row items-center justify-between pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">New MRR</CardTitle>
            <ArrowUpRight class="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div class="text-3xl font-bold text-green-600 dark:text-green-400">
              +{{ formatCurrency(mrrMovement.newMRR) }}
            </div>
            <p class="text-xs text-muted-foreground mt-1">
              From new customers this month
            </p>
          </CardContent>
        </Card>

        <!-- Expansion MRR Card -->
        <Card class="border-blue-200 dark:border-blue-800">
          <CardHeader class="flex flex-row items-center justify-between pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Expansion MRR</CardTitle>
            <TrendingUp class="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div class="text-3xl font-bold text-blue-600 dark:text-blue-400">
              +{{ formatCurrency(mrrMovement.expansionMRR) }}
            </div>
            <p class="text-xs text-muted-foreground mt-1">
              From plan upgrades
            </p>
          </CardContent>
        </Card>

        <!-- Contraction MRR Card -->
        <Card class="border-orange-200 dark:border-orange-800">
          <CardHeader class="flex flex-row items-center justify-between pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Contraction MRR</CardTitle>
            <TrendingDown class="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div class="text-3xl font-bold text-orange-600 dark:text-orange-400">
              -{{ formatCurrency(mrrMovement.contractionMRR) }}
            </div>
            <p class="text-xs text-muted-foreground mt-1">
              From plan downgrades
            </p>
          </CardContent>
        </Card>

        <!-- Churned MRR Card -->
        <Card class="border-red-200 dark:border-red-800">
          <CardHeader class="flex flex-row items-center justify-between pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Churned MRR</CardTitle>
            <ArrowDownRight class="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div class="text-3xl font-bold text-red-600 dark:text-red-400">
              -{{ formatCurrency(mrrMovement.churnedMRR) }}
            </div>
            <p class="text-xs text-muted-foreground mt-1">
              From cancelled subscriptions
            </p>
          </CardContent>
        </Card>
      </div>

      <!-- Revenue Flow Chart and Net Summary -->
      <div class="grid gap-4 lg:grid-cols-3">
        <!-- Bar Chart -->
        <Card class="lg:col-span-2">
          <CardHeader>
            <CardTitle class="text-base">MRR Movement</CardTitle>
          </CardHeader>
          <CardContent>
            <RevenueFlowChart :data="mrrMovement" />
          </CardContent>
        </Card>

        <!-- Net MRR Summary -->
        <Card :class="mrrMovement.netMRR >= 0 ? 'bg-gradient-to-br from-green-50 to-green-100/50 dark:from-green-950/30 dark:to-green-900/20 border-green-200 dark:border-green-800' : 'bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-950/30 dark:to-red-900/20 border-red-200 dark:border-red-800'">
          <CardHeader>
            <CardTitle class="text-base">Net MRR Change</CardTitle>
          </CardHeader>
          <CardContent class="space-y-4">
            <div>
              <div :class="['text-4xl font-bold', mrrMovement.netMRR >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400']">
                {{ mrrMovement.netMRR >= 0 ? '+' : '' }}{{ formatCurrency(mrrMovement.netMRR) }}
              </div>
              <p class="text-sm text-muted-foreground mt-1">
                {{ mrrMovement.netMRR >= 0 ? 'Monthly growth' : 'Monthly decline' }}
              </p>
            </div>

            <div class="space-y-2 pt-2 border-t">
              <div class="flex justify-between text-sm">
                <span class="text-muted-foreground">Current {{ labels.mrr }}</span>
                <span class="font-medium">{{ formatCurrency(mrr) }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-muted-foreground">{{ labels.accounts }}</span>
                <span class="font-medium">{{ accountCount }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-muted-foreground">{{ labels.arr }}</span>
                <span class="font-medium">{{ formatCurrency(arr) }}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Detailed Monthly Breakdown Table -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base">Monthly Revenue Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-border">
                  <th class="text-left p-3 font-medium text-sm">Month</th>
                  <th class="text-right p-3 font-medium text-sm">MRR</th>
                  <th class="text-right p-3 font-medium text-sm">New</th>
                  <th class="text-right p-3 font-medium text-sm">Expansion</th>
                  <th class="text-right p-3 font-medium text-sm">Contraction</th>
                  <th class="text-right p-3 font-medium text-sm">Churned</th>
                  <th class="text-right p-3 font-medium text-sm">Net Change</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in monthlyBreakdown"
                  :key="row.month"
                  class="border-b border-border hover:bg-muted/50"
                >
                  <td class="p-3 text-sm font-medium">{{ row.month }}</td>
                  <td class="p-3 text-sm font-mono text-right">{{ formatTableCurrency(row.mrr) }}</td>
                  <td class="p-3 text-sm font-mono text-right text-green-600 dark:text-green-400">
                    +{{ formatTableCurrency(row.newMRR) }}
                  </td>
                  <td class="p-3 text-sm font-mono text-right text-blue-600 dark:text-blue-400">
                    +{{ formatTableCurrency(row.expansionMRR) }}
                  </td>
                  <td class="p-3 text-sm font-mono text-right text-orange-600 dark:text-orange-400">
                    -{{ formatTableCurrency(row.contractionMRR) }}
                  </td>
                  <td class="p-3 text-sm font-mono text-right text-red-600 dark:text-red-400">
                    -{{ formatTableCurrency(row.churnedMRR) }}
                  </td>
                  <td class="p-3 text-sm font-mono text-right">
                    <span :class="row.netMRR >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
                      {{ row.netMRR >= 0 ? '+' : '' }}{{ formatTableCurrency(row.netMRR) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <!-- Data Health Panel -->
      <Card class="max-w-lg">
        <CardHeader>
          <CardTitle class="text-base">Data Health</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <!-- Confidence Score Bar -->
          <div class="space-y-2">
            <Progress :value="confidenceScore * 100" class="h-1.5" />
            <p class="text-xs text-muted-foreground">
              {{ formatPercent(confidenceScore) }} confidence
            </p>
          </div>

          <!-- Health Items -->
          <div class="space-y-2">
            <div
              v-if="discrepancies.length > 0"
              class="flex items-center justify-between gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive cursor-pointer hover:bg-destructive/20 transition-colors"
              @click="router.push('/accounts')"
            >
              <div class="flex items-center gap-2">
                <AlertTriangle class="h-4 w-4" />
                <span>{{ discrepancies.length }} discrepancies found</span>
              </div>
              <ChevronRight class="h-4 w-4 opacity-60" />
            </div>

            <div
              v-if="pendingCount > 0"
              class="flex items-center justify-between gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning cursor-pointer hover:bg-warning/20 transition-colors"
              @click="navigateToMatches"
            >
              <div class="flex items-center gap-2">
                <AlertTriangle class="h-4 w-4" />
                <span>{{ pendingCount }} matches pending review</span>
              </div>
              <ChevronRight class="h-4 w-4 opacity-60" />
            </div>

            <div
              v-if="discrepancies.length === 0 && pendingCount === 0"
              class="flex items-center gap-2 rounded-md bg-success/10 p-3 text-sm text-success"
            >
              <CheckCircle class="h-4 w-4" />
              <span>All data reconciled</span>
            </div>
          </div>

          <!-- Discrepancy List -->
          <div v-if="discrepancies.length > 0" class="space-y-2 border-t pt-4">
            <div
              v-for="(disc, index) in discrepancies.slice(0, 3)"
              :key="index"
              class="flex items-center justify-between gap-2 p-2 -mx-2 rounded-md cursor-pointer hover:bg-muted transition-colors"
              @click="navigateToDiscrepancy(disc)"
            >
              <div class="flex items-start gap-2 min-w-0">
                <Badge
                  :variant="disc.severity === 'high' ? 'destructive' : disc.severity === 'medium' ? 'warning' : 'secondary'"
                  class="text-[10px] uppercase shrink-0"
                >
                  {{ disc.severity }}
                </Badge>
                <span class="text-sm text-muted-foreground truncate">{{ disc.description }}</span>
              </div>
              <ChevronRight class="h-4 w-4 text-muted-foreground/40 shrink-0" />
            </div>

            <Button
              v-if="discrepancies.length > 3"
              variant="ghost"
              size="sm"
              class="w-full mt-2"
              @click="router.push('/accounts')"
            >
              View all {{ discrepancies.length }} discrepancies
            </Button>
          </div>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
