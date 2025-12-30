<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { TrendingUp, TrendingDown, Users, AlertTriangle, CheckCircle, Download, Minus, ChevronRight, CreditCard, Sparkles } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@/components/ui'
import Skeleton from '@/components/ui/skeleton.vue'
import Progress from '@/components/ui/progress.vue'
import GettingStartedCard from '@/components/onboarding/GettingStartedCard.vue'
import { getRevenueAnalytics, getMatches, getDataStatus, loadSampleData, type TrendData, type Discrepancy } from '@/api/client'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { useAppMode } from '@/composables/useAppMode'

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
const bySegment = computed(() => revenue.value?.metrics.breakdown.by_segment ?? {})
const byPlan = computed(() => revenue.value?.metrics.breakdown.by_plan ?? {})
const pendingCount = computed(() => matches.value?.pending_count ?? 0)

// Trends
const arrTrend = computed(() => revenue.value?.metrics.arr_trend)
const mrrTrend = computed(() => revenue.value?.metrics.mrr_trend)
const accountTrend = computed(() => revenue.value?.metrics.account_trend)

function formatTrendPercent(trend?: TrendData): string {
  if (!trend) return ''
  const sign = trend.change_percent >= 0 ? '+' : ''
  return `${sign}${trend.change_percent.toFixed(1)}%`
}

function getTrendIcon(trend?: TrendData) {
  if (!trend) return Minus
  if (trend.direction === 'up') return TrendingUp
  if (trend.direction === 'down') return TrendingDown
  return Minus
}

function getTrendColor(trend?: TrendData): string {
  if (!trend) return 'text-muted-foreground'
  if (trend.direction === 'up') return 'text-success'
  if (trend.direction === 'down') return 'text-destructive'
  return 'text-muted-foreground'
}

function navigateToMatches() {
  router.push('/matches')
}

function navigateToDiscrepancy(disc: Discrepancy) {
  // Navigate to accounts page with filter based on discrepancy type
  if (disc.entity_type === 'account' && disc.entity_id) {
    router.push(`/accounts?id=${disc.entity_id}`)
  } else {
    // Navigate to accounts page (could add more specific filters)
    router.push('/accounts')
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p class="text-muted-foreground">
          Board-ready SaaS metrics overview
        </p>
      </div>
      <Button variant="outline">
        <Download class="mr-2 h-4 w-4" />
        Export Report
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

      <!-- KPI Cards -->
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <!-- ARR / Volume Card (Primary) -->
        <Card class="bg-primary text-primary-foreground">
          <CardHeader class="flex flex-row items-center justify-between pb-2">
            <CardTitle class="text-sm font-medium text-primary-foreground/80">{{ labels.arr }}</CardTitle>
            <component :is="getTrendIcon(arrTrend)" class="h-4 w-4 text-primary-foreground/60" />
          </CardHeader>
          <CardContent>
            <div class="text-3xl font-bold">{{ formatCurrency(arr) }}</div>
            <div class="flex items-center gap-2">
              <p class="text-xs text-primary-foreground/60">
                Annual Recurring Revenue
              </p>
              <span
                v-if="arrTrend"
                class="inline-flex items-center gap-1 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-semibold"
              >
                <component :is="getTrendIcon(arrTrend)" class="h-3 w-3" />
                {{ formatTrendPercent(arrTrend) }} MoM
              </span>
            </div>
          </CardContent>
        </Card>

        <!-- MRR / Monthly Volume Card -->
        <Card>
          <CardHeader class="flex flex-row items-center justify-between pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">{{ labels.mrr }}</CardTitle>
            <component :is="getTrendIcon(mrrTrend)" :class="['h-4 w-4', mrrTrend ? getTrendColor(mrrTrend) : 'text-muted-foreground']" />
          </CardHeader>
          <CardContent>
            <div class="text-3xl font-bold">{{ formatCurrency(mrr) }}</div>
            <div class="flex items-center gap-2">
              <p class="text-xs text-muted-foreground">
                Monthly Recurring Revenue
              </p>
              <span
                v-if="mrrTrend"
                :class="[
                  'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  mrrTrend.direction === 'up' ? 'bg-success/10 text-success' : mrrTrend.direction === 'down' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
                ]"
              >
                <component :is="getTrendIcon(mrrTrend)" class="h-3 w-3" />
                {{ formatTrendPercent(mrrTrend) }}
              </span>
            </div>
          </CardContent>
        </Card>

        <!-- Accounts Card -->
        <Card>
          <CardHeader class="flex flex-row items-center justify-between pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">{{ labels.accounts }}</CardTitle>
            <Users class="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div class="text-3xl font-bold">{{ accountCount }}</div>
            <div class="flex items-center gap-2">
              <p class="text-xs text-muted-foreground">
                Total customers
              </p>
              <span
                v-if="accountTrend && accountTrend.change_amount > 0"
                class="inline-flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success"
              >
                +{{ accountTrend.change_amount.toFixed(0) }} new
              </span>
            </div>
          </CardContent>
        </Card>

        <!-- Data Quality Card -->
        <Card :class="confidenceScore < 0.8 ? 'border-warning' : ''">
          <CardHeader class="flex flex-row items-center justify-between pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Data Quality</CardTitle>
            <component
              :is="confidenceScore >= 0.8 ? CheckCircle : AlertTriangle"
              :class="[
                'h-4 w-4',
                confidenceScore >= 0.8 ? 'text-success' : 'text-warning'
              ]"
            />
          </CardHeader>
          <CardContent>
            <div class="text-3xl font-bold">{{ formatPercent(confidenceScore) }}</div>
            <p class="text-xs text-muted-foreground">Reconciliation score</p>
          </CardContent>
        </Card>
      </div>

      <!-- Charts Row -->
      <div class="grid gap-4 md:grid-cols-2">
        <!-- Revenue by Segment -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base">
              Revenue by Segment
            </CardTitle>
          </CardHeader>
          <CardContent class="space-y-4">
            <div
              v-for="(value, segment) in bySegment"
              :key="segment"
              class="space-y-2"
            >
              <div class="flex items-center justify-between text-sm">
                <span class="font-medium">{{ segment }}</span>
                <span class="text-muted-foreground">{{ formatCurrency(value) }}</span>
              </div>
              <Progress
                :value="value"
                :max="Math.max(...Object.values(bySegment))"
                class="h-2"
              />
            </div>
            <div v-if="Object.keys(bySegment).length === 0" class="py-8 text-center text-muted-foreground">
              No segment data available
            </div>
          </CardContent>
        </Card>

        <!-- ARR by Plan -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base">
              ARR by Plan Tier
            </CardTitle>
          </CardHeader>
          <CardContent class="space-y-4">
            <div
              v-for="(value, plan) in byPlan"
              :key="plan"
              class="space-y-2"
            >
              <div class="flex items-center justify-between text-sm">
                <span class="font-medium capitalize">{{ plan }}</span>
                <span class="text-muted-foreground">{{ formatCurrency(value) }}</span>
              </div>
              <Progress
                :value="value"
                :max="Math.max(...Object.values(byPlan))"
                class="h-2"
              />
            </div>
            <div v-if="Object.keys(byPlan).length === 0" class="py-8 text-center text-muted-foreground">
              No plan data available
            </div>
          </CardContent>
        </Card>
      </div>

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
