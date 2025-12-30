<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  DollarSign,
  BarChart3,
  Target,
  ChevronRight,
  Info,
} from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@/components/ui'
import Skeleton from '@/components/ui/skeleton.vue'
import Progress from '@/components/ui/progress.vue'
import { getPricingIntelligence } from '@/api/client'
import { formatCurrency, formatPercent } from '@/lib/utils'

const router = useRouter()

const { data, isLoading, error } = useQuery({
  queryKey: ['pricing-intelligence'],
  queryFn: getPricingIntelligence,
})

const concentration = computed(() => data.value?.revenue_concentration)
const anomalies = computed(() => data.value?.pricing_anomalies ?? [])
const discounts = computed(() => data.value?.discount_analysis)
const benchmarks = computed(() => data.value?.segment_benchmarks ?? [])
const usageRevenue = computed(() => data.value?.usage_revenue)
const confidence = computed(() => data.value?.confidence_score ?? 0)

function getRiskBadgeVariant(risk: string) {
  switch (risk) {
    case 'high': return 'destructive'
    case 'medium': return 'warning'
    case 'low': return 'success'
    default: return 'secondary'
  }
}

function navigateToAccount(accountId: number) {
  router.push(`/accounts?id=${accountId}`)
}
</script>

<template>
  <div class="space-y-8">
    <!-- Header -->
    <div>
      <h1 class="text-3xl font-bold tracking-tight">Pricing Intelligence</h1>
      <p class="text-muted-foreground">
        Signals and insights from your actual customer data
      </p>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="space-y-6">
      <div class="grid gap-4 md:grid-cols-3">
        <Skeleton v-for="i in 3" :key="i" class="h-32" />
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <Skeleton class="h-64" />
        <Skeleton class="h-64" />
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex flex-col items-center justify-center rounded-lg border border-dashed py-16">
      <AlertTriangle class="h-10 w-10 text-destructive" />
      <h3 class="mt-4 text-sm font-medium">Failed to load pricing intelligence</h3>
      <p class="mt-1 text-sm text-muted-foreground">{{ (error as Error).message }}</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="!concentration || concentration.total_arr === 0" class="flex flex-col items-center justify-center rounded-lg border border-dashed py-16">
      <BarChart3 class="h-10 w-10 text-muted-foreground/40" />
      <h3 class="mt-4 text-sm font-medium">No pricing data available</h3>
      <p class="mt-1 text-sm text-muted-foreground">Upload account data with ARR to see pricing insights.</p>
      <Button class="mt-4" @click="router.push('/onboarding/upload')">
        Upload Data
      </Button>
    </div>

    <template v-else>
      <!-- Confidence Indicator -->
      <div class="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
        <Info class="h-4 w-4 text-muted-foreground" />
        <div class="flex-1">
          <span class="text-sm text-muted-foreground">
            Analysis confidence: <span class="font-medium text-foreground">{{ formatPercent(confidence) }}</span>
          </span>
        </div>
        <Progress :value="confidence * 100" class="h-1.5 w-24" />
      </div>

      <!-- Key Metrics Row -->
      <div class="grid gap-4 md:grid-cols-3">
        <!-- Revenue Concentration Card -->
        <Card :class="concentration.concentration_risk === 'high' ? 'border-destructive' : ''">
          <CardHeader class="flex flex-row items-center justify-between pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Revenue Concentration</CardTitle>
            <Target class="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-bold">{{ concentration.top_3_percentage.toFixed(0) }}%</span>
              <Badge :variant="getRiskBadgeVariant(concentration.concentration_risk)" class="text-[10px] uppercase">
                {{ concentration.concentration_risk }} risk
              </Badge>
            </div>
            <p class="text-xs text-muted-foreground mt-1">of ARR from top 3 accounts</p>
          </CardContent>
        </Card>

        <!-- Pricing Anomalies Card -->
        <Card :class="anomalies.length > 3 ? 'border-warning' : ''">
          <CardHeader class="flex flex-row items-center justify-between pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Pricing Anomalies</CardTitle>
            <AlertTriangle class="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-bold">{{ anomalies.length }}</span>
              <span class="text-sm text-muted-foreground">accounts</span>
            </div>
            <p class="text-xs text-muted-foreground mt-1">priced differently than peers</p>
          </CardContent>
        </Card>

        <!-- Discount Analysis Card -->
        <Card>
          <CardHeader class="flex flex-row items-center justify-between pb-2">
            <CardTitle class="text-sm font-medium text-muted-foreground">Discount Rate</CardTitle>
            <DollarSign class="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-bold">{{ discounts?.discount_rate.toFixed(0) ?? 0 }}%</span>
              <span class="text-sm text-muted-foreground">of subscriptions</span>
            </div>
            <p class="text-xs text-muted-foreground mt-1">
              {{ discounts?.subscriptions_with_discount ?? 0 }} of {{ discounts?.total_subscriptions ?? 0 }} have discounts
            </p>
          </CardContent>
        </Card>
      </div>

      <!-- Main Content Grid -->
      <div class="grid gap-6 lg:grid-cols-2">
        <!-- Revenue Concentration Detail -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base flex items-center gap-2">
              <Target class="h-4 w-4" />
              Revenue Concentration
            </CardTitle>
          </CardHeader>
          <CardContent class="space-y-4">
            <!-- Insight -->
            <div class="rounded-md bg-muted/50 p-3">
              <p class="text-sm">{{ concentration.insight_text }}</p>
            </div>

            <!-- Top Accounts Table -->
            <div class="space-y-2">
              <div
                v-for="account in concentration.top_accounts.slice(0, 5)"
                :key="account.id"
                class="flex items-center justify-between gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors"
                @click="navigateToAccount(account.id)"
              >
                <div class="flex items-center gap-3 min-w-0">
                  <span class="text-xs text-muted-foreground font-mono w-4">{{ account.rank }}</span>
                  <div class="min-w-0">
                    <div class="font-medium text-sm truncate">{{ account.name }}</div>
                    <div class="text-xs text-muted-foreground">{{ account.segment }}</div>
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <div class="font-medium text-sm font-mono">{{ formatCurrency(account.arr) }}</div>
                  <div class="text-xs text-muted-foreground">{{ account.percentage.toFixed(1) }}%</div>
                </div>
              </div>
            </div>

            <!-- Concentration Bar -->
            <div class="pt-4 border-t space-y-2">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>Top 3: {{ concentration.top_3_percentage.toFixed(0) }}%</span>
                <span>Top 10: {{ concentration.top_10_percentage.toFixed(0) }}%</span>
              </div>
              <div class="h-2 rounded-full bg-muted overflow-hidden flex">
                <div
                  class="bg-destructive transition-all"
                  :style="{ width: `${Math.min(concentration.top_3_percentage, 100)}%` }"
                />
                <div
                  class="bg-warning transition-all"
                  :style="{ width: `${Math.min(concentration.top_10_percentage - concentration.top_3_percentage, 100 - concentration.top_3_percentage)}%` }"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Pricing Anomalies -->
        <Card>
          <CardHeader>
            <CardTitle class="text-base flex items-center gap-2">
              <AlertTriangle class="h-4 w-4" />
              Pricing Anomalies
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div v-if="anomalies.length === 0" class="py-8 text-center text-muted-foreground">
              <p class="text-sm">No significant pricing anomalies detected.</p>
              <p class="text-xs mt-1">Pricing is consistent across similar accounts.</p>
            </div>

            <div v-else class="space-y-3">
              <div
                v-for="anomaly in anomalies.slice(0, 5)"
                :key="anomaly.account_id"
                class="rounded-md border p-3 space-y-2 hover:border-muted-foreground/50 cursor-pointer transition-colors"
                @click="navigateToAccount(anomaly.account_id)"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <Badge
                      :variant="anomaly.direction === 'underpriced' ? 'warning' : 'success'"
                      class="text-[10px] uppercase"
                    >
                      {{ anomaly.direction }}
                    </Badge>
                    <span class="font-medium text-sm">{{ anomaly.account_name }}</span>
                  </div>
                  <ChevronRight class="h-4 w-4 text-muted-foreground/40" />
                </div>

                <div class="flex items-center gap-4 text-xs">
                  <div>
                    <span class="text-muted-foreground">Pays: </span>
                    <span class="font-mono font-medium">{{ formatCurrency(anomaly.arr) }}</span>
                  </div>
                  <div>
                    <span class="text-muted-foreground">Avg: </span>
                    <span class="font-mono">{{ formatCurrency(anomaly.segment_avg_arr) }}</span>
                  </div>
                  <div :class="anomaly.direction === 'underpriced' ? 'text-warning' : 'text-success'">
                    {{ anomaly.deviation_percent > 0 ? '+' : '' }}{{ anomaly.deviation_percent.toFixed(0) }}%
                  </div>
                </div>

                <p class="text-xs text-muted-foreground">{{ anomaly.insight_text }}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Segment Benchmarks -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base flex items-center gap-2">
            <BarChart3 class="h-4 w-4" />
            Pricing by Segment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="benchmarks.length === 0" class="py-8 text-center text-muted-foreground">
            No segment data available. Add segment information to accounts for benchmarks.
          </div>

          <div v-else class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b">
                  <th class="text-left py-2 font-medium text-muted-foreground">Segment</th>
                  <th class="text-right py-2 font-medium text-muted-foreground">Accounts</th>
                  <th class="text-right py-2 font-medium text-muted-foreground">Total ARR</th>
                  <th class="text-right py-2 font-medium text-muted-foreground">Avg ARR</th>
                  <th class="text-right py-2 font-medium text-muted-foreground">Range</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="benchmark in benchmarks"
                  :key="benchmark.segment"
                  class="border-b last:border-0 hover:bg-muted/50"
                >
                  <td class="py-3">
                    <Badge variant="outline" class="font-normal">{{ benchmark.segment }}</Badge>
                  </td>
                  <td class="py-3 text-right font-mono">{{ benchmark.account_count }}</td>
                  <td class="py-3 text-right font-mono font-medium">{{ formatCurrency(benchmark.total_arr) }}</td>
                  <td class="py-3 text-right font-mono">{{ formatCurrency(benchmark.avg_arr) }}</td>
                  <td class="py-3 text-right text-muted-foreground text-xs">{{ benchmark.range }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <!-- Usage vs Revenue (if available) -->
      <Card v-if="usageRevenue">
        <CardHeader>
          <CardTitle class="text-base flex items-center gap-2">
            <TrendingUp class="h-4 w-4" />
            Usage vs Revenue
          </CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <!-- Insight -->
          <div class="rounded-md bg-muted/50 p-3">
            <p class="text-sm">{{ usageRevenue.insight_text }}</p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <!-- High Usage, Low Revenue -->
            <div class="space-y-2">
              <h4 class="text-sm font-medium flex items-center gap-2">
                <TrendingUp class="h-4 w-4 text-warning" />
                Upsell Opportunities
              </h4>
              <p class="text-xs text-muted-foreground">High usage relative to revenue</p>

              <div v-if="usageRevenue.high_usage_low_revenue.length === 0" class="text-sm text-muted-foreground py-4">
                No accounts identified
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="item in usageRevenue.high_usage_low_revenue"
                  :key="item.account_id"
                  class="flex items-center justify-between p-2 rounded-md border hover:bg-muted cursor-pointer"
                  @click="navigateToAccount(item.account_id)"
                >
                  <span class="text-sm font-medium truncate">{{ item.account_name }}</span>
                  <span class="text-xs font-mono text-warning">{{ formatCurrency(item.arr) }}</span>
                </div>
              </div>
            </div>

            <!-- Low Usage, High Revenue -->
            <div class="space-y-2">
              <h4 class="text-sm font-medium flex items-center gap-2">
                <TrendingDown class="h-4 w-4 text-destructive" />
                Churn Risks
              </h4>
              <p class="text-xs text-muted-foreground">Low usage relative to revenue</p>

              <div v-if="usageRevenue.low_usage_high_revenue.length === 0" class="text-sm text-muted-foreground py-4">
                No accounts identified
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="item in usageRevenue.low_usage_high_revenue"
                  :key="item.account_id"
                  class="flex items-center justify-between p-2 rounded-md border hover:bg-muted cursor-pointer"
                  @click="navigateToAccount(item.account_id)"
                >
                  <span class="text-sm font-medium truncate">{{ item.account_name }}</span>
                  <span class="text-xs font-mono text-destructive">{{ formatCurrency(item.arr) }}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Discount Analysis -->
      <Card v-if="discounts && discounts.high_discount_accounts.length > 0">
        <CardHeader>
          <CardTitle class="text-base flex items-center gap-2">
            <DollarSign class="h-4 w-4" />
            High Discount Accounts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div class="rounded-md bg-muted/50 p-3 mb-4">
            <p class="text-sm">{{ discounts.insight_text }}</p>
          </div>

          <div class="space-y-2">
            <div
              v-for="account in discounts.high_discount_accounts"
              :key="account.account_id"
              class="flex items-center justify-between p-3 rounded-md border hover:bg-muted cursor-pointer"
              @click="navigateToAccount(account.account_id)"
            >
              <div>
                <div class="font-medium text-sm">{{ account.account_name }}</div>
                <div class="text-xs text-muted-foreground">{{ account.plan }}</div>
              </div>
              <div class="text-right">
                <Badge variant="warning" class="text-xs">{{ account.discount_percent }}% off</Badge>
                <div class="text-xs text-muted-foreground mt-1">
                  -{{ formatCurrency(account.monthly_discount) }}/mo
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
