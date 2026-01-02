<script setup lang="ts">
/**
 * PlanComparisonView - Compare plans side-by-side with aggregated metrics
 */

import { computed } from 'vue'
import { Users, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-vue-next'
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui'
import { formatCurrency, formatPercent } from '@/lib/utils'
import type { CustomerInsight } from '@/api/client'

// =============================================================================
// PROPS
// =============================================================================

const props = defineProps<{
  customers: CustomerInsight[]
}>()

// =============================================================================
// COMPUTED - Plan Aggregations
// =============================================================================

interface PlanStats {
  planName: string
  customerCount: number
  totalMrr: number
  avgMrr: number
  avgMargin: number
  atRiskCount: number
  unprofitableCount: number
}

const planStats = computed<PlanStats[]>(() => {
  const planMap = new Map<string, CustomerInsight[]>()

  // Group customers by plan
  for (const customer of props.customers) {
    const existing = planMap.get(customer.planName) || []
    existing.push(customer)
    planMap.set(customer.planName, existing)
  }

  // Calculate stats for each plan
  const stats: PlanStats[] = []
  for (const [planName, customers] of planMap) {
    const totalMrr = customers.reduce((sum, c) => sum + c.mrr, 0)
    const avgMrr = totalMrr / customers.length
    const avgMargin = customers.reduce((sum, c) => sum + c.trueMargin, 0) / customers.length
    const atRiskCount = customers.filter(c => c.riskLevel === 'high').length
    const unprofitableCount = customers.filter(c => c.trueMargin <= 0).length

    stats.push({
      planName,
      customerCount: customers.length,
      totalMrr,
      avgMrr,
      avgMargin,
      atRiskCount,
      unprofitableCount,
    })
  }

  // Sort by total MRR descending
  return stats.sort((a, b) => b.totalMrr - a.totalMrr)
})

// Health indicator
function getPlanHealth(plan: PlanStats): 'good' | 'warning' | 'critical' {
  if (plan.avgMargin < 0 || plan.atRiskCount > plan.customerCount * 0.3) return 'critical'
  if (plan.avgMargin < 20 || plan.atRiskCount > plan.customerCount * 0.1) return 'warning'
  return 'good'
}

function getHealthColor(health: 'good' | 'warning' | 'critical'): string {
  const colors = {
    good: 'border-green-200 bg-green-50/50',
    warning: 'border-amber-200 bg-amber-50/50',
    critical: 'border-red-200 bg-red-50/50',
  }
  return colors[health]
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Plan Performance</CardTitle>
    </CardHeader>
    <CardContent class="space-y-3">
      <div v-if="planStats.length === 0" class="text-center py-4 text-muted-foreground">
        No plan data available
      </div>

      <div
        v-for="plan in planStats"
        :key="plan.planName"
        class="p-3 rounded-lg border"
        :class="getHealthColor(getPlanHealth(plan))"
      >
        <!-- Plan Header -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <Badge variant="outline" class="font-semibold">{{ plan.planName }}</Badge>
            <Badge v-if="getPlanHealth(plan) === 'critical'" variant="destructive" class="text-xs">
              <AlertTriangle class="h-3 w-3 mr-1" />
              Needs attention
            </Badge>
          </div>
          <div class="flex items-center gap-1 text-sm text-muted-foreground">
            <Users class="h-3 w-3" />
            {{ plan.customerCount }}
          </div>
        </div>

        <!-- Stats Grid -->
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p class="text-muted-foreground text-xs">Total MRR</p>
            <p class="font-semibold">{{ formatCurrency(plan.totalMrr) }}</p>
          </div>
          <div>
            <p class="text-muted-foreground text-xs">Avg MRR</p>
            <p class="font-semibold">{{ formatCurrency(plan.avgMrr) }}</p>
          </div>
          <div>
            <p class="text-muted-foreground text-xs">Avg Margin</p>
            <div class="flex items-center gap-1">
              <component
                :is="plan.avgMargin >= 0 ? TrendingUp : TrendingDown"
                class="h-3 w-3"
                :class="plan.avgMargin >= 0 ? 'text-green-500' : 'text-red-500'"
              />
              <p
                class="font-semibold"
                :class="plan.avgMargin >= 0 ? 'text-green-600' : 'text-red-600'"
              >
                {{ formatPercent(plan.avgMargin / 100) }}
              </p>
            </div>
          </div>
          <div>
            <p class="text-muted-foreground text-xs">At Risk</p>
            <p class="font-semibold" :class="plan.atRiskCount > 0 ? 'text-amber-600' : ''">
              {{ plan.atRiskCount }} customers
            </p>
          </div>
        </div>

        <!-- Unprofitable Warning -->
        <div v-if="plan.unprofitableCount > 0" class="mt-2 pt-2 border-t text-xs text-red-600 flex items-center gap-1">
          <AlertTriangle class="h-3 w-3" />
          {{ plan.unprofitableCount }} customers with negative margin
        </div>
      </div>
    </CardContent>
  </Card>
</template>
