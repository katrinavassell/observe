<script setup lang="ts">
/**
 * PlanPerformanceView - Plan health cards with key metrics
 *
 * Displays health score (0-100), customer counts, churn risk,
 * and upsell readiness for each pricing plan
 */

import { computed } from 'vue'
import { Card, CardContent, CardHeader, CardTitle, Badge, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui'
import { Users, TrendingDown, TrendingUp, AlertTriangle, DollarSign, Info } from 'lucide-vue-next'

// =============================================================================
// TYPES
// =============================================================================

export interface PlanHealth {
  planName: string
  planId: string
  customerCount: number
  customerNames: string[]
  totalMRR: number
  avgMRR: number
  avgUsage: string
  healthScore: number
  churnRiskCount: number
  churnRiskCustomers: string[]
  upsellReadyCount: number
  upsellReadyCustomers: string[]
  negativeMarginCount: number
  negativeMarginCustomers: string[]
}

// =============================================================================
// PROPS
// =============================================================================

const props = defineProps<{
  plans: PlanHealth[]
}>()

// =============================================================================
// COMPUTED
// =============================================================================

// Sort plans by MRR descending
const sortedPlans = computed(() => {
  return [...props.plans].sort((a, b) => b.totalMRR - a.totalMRR)
})

// Summary stats
const summary = computed(() => {
  const totalMRR = props.plans.reduce((sum, p) => sum + p.totalMRR, 0)
  const totalCustomers = props.plans.reduce((sum, p) => sum + p.customerCount, 0)
  const totalChurnRisk = props.plans.reduce((sum, p) => sum + p.churnRiskCount, 0)
  const totalUpsellReady = props.plans.reduce((sum, p) => sum + p.upsellReadyCount, 0)
  const avgHealth = props.plans.length > 0
    ? Math.round(props.plans.reduce((sum, p) => sum + p.healthScore, 0) / props.plans.length)
    : 0

  return { totalMRR, totalCustomers, totalChurnRisk, totalUpsellReady, avgHealth }
})

// =============================================================================
// HELPERS
// =============================================================================

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function getHealthColor(score: number): string {
  if (score >= 80) return 'text-green-600'
  if (score >= 60) return 'text-yellow-600'
  return 'text-red-600'
}

function getHealthBg(score: number): string {
  if (score >= 80) return 'bg-green-500/10 border-green-500/20'
  if (score >= 60) return 'bg-yellow-500/10 border-yellow-500/20'
  return 'bg-red-500/10 border-red-500/20'
}

function getHealthLabel(score: number): string {
  if (score >= 80) return 'Healthy'
  if (score >= 60) return 'Moderate'
  return 'At Risk'
}
</script>

<template>
  <Card>
    <CardHeader class="pb-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <CardTitle class="text-base font-semibold">Plan Performance</CardTitle>
          <Tooltip>
            <TooltipTrigger>
              <Info class="h-3.5 w-3.5 text-muted-foreground/60" />
            </TooltipTrigger>
            <TooltipContent>
              Health scores (0-100) based on churn risk, margin health, and usage patterns
            </TooltipContent>
          </Tooltip>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <Badge variant="outline" class="font-mono">
            {{ summary.totalCustomers }} customers
          </Badge>
          <Badge
            :class="getHealthBg(summary.avgHealth)"
            class="border"
          >
            <span :class="getHealthColor(summary.avgHealth)">
              Avg {{ summary.avgHealth }}
            </span>
          </Badge>
        </div>
      </div>
    </CardHeader>

    <CardContent class="space-y-3">
      <!-- Summary Row -->
      <div class="grid grid-cols-4 gap-2 text-center pb-3 border-b">
        <div>
          <p class="text-xs text-muted-foreground">Total MRR</p>
          <p class="text-lg font-semibold">{{ formatCurrency(summary.totalMRR) }}</p>
        </div>
        <div>
          <p class="text-xs text-muted-foreground">Customers</p>
          <p class="text-lg font-semibold">{{ summary.totalCustomers }}</p>
        </div>
        <div>
          <p class="text-xs text-muted-foreground">At Risk</p>
          <p class="text-lg font-semibold text-amber-600">{{ summary.totalChurnRisk }}</p>
        </div>
        <div>
          <p class="text-xs text-muted-foreground">Upsell Ready</p>
          <p class="text-lg font-semibold text-blue-600">{{ summary.totalUpsellReady }}</p>
        </div>
      </div>

      <!-- Plan Cards -->
      <div class="space-y-2">
        <div
          v-for="plan in sortedPlans"
          :key="plan.planId"
          class="p-3 rounded-lg border hover:shadow-sm transition-shadow"
          :class="getHealthBg(plan.healthScore)"
        >
          <div class="flex items-start justify-between mb-2">
            <div>
              <h4 class="font-medium">{{ plan.planName }}</h4>
              <p class="text-sm text-muted-foreground">
                {{ formatCurrency(plan.totalMRR) }} MRR
              </p>
            </div>
            <div class="text-right">
              <div
                class="text-2xl font-bold"
                :class="getHealthColor(plan.healthScore)"
              >
                {{ plan.healthScore }}
              </div>
              <Badge
                variant="outline"
                :class="getHealthColor(plan.healthScore)"
              >
                {{ getHealthLabel(plan.healthScore) }}
              </Badge>
            </div>
          </div>

          <!-- Metrics Row -->
          <div class="grid grid-cols-4 gap-2 pt-2 border-t border-border/50">
            <!-- Customers -->
            <div class="flex items-center gap-1.5">
              <Users class="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <p class="text-xs text-muted-foreground">Customers</p>
                <p class="text-sm font-medium">{{ plan.customerCount }}</p>
              </div>
            </div>

            <!-- Avg MRR -->
            <div class="flex items-center gap-1.5">
              <DollarSign class="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <p class="text-xs text-muted-foreground">Avg MRR</p>
                <p class="text-sm font-medium">{{ formatCurrency(plan.avgMRR) }}</p>
              </div>
            </div>

            <!-- Churn Risk -->
            <div class="flex items-center gap-1.5">
              <Tooltip v-if="plan.churnRiskCount > 0">
                <TooltipTrigger class="flex items-center gap-1.5">
                  <TrendingDown class="h-3.5 w-3.5 text-red-500" />
                  <div>
                    <p class="text-xs text-muted-foreground">At Risk</p>
                    <p class="text-sm font-medium text-red-600">{{ plan.churnRiskCount }}</p>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p class="font-medium mb-1">Churn Risk Customers:</p>
                  <ul class="text-xs space-y-0.5">
                    <li v-for="name in plan.churnRiskCustomers.slice(0, 5)" :key="name">
                      {{ name }}
                    </li>
                    <li v-if="plan.churnRiskCustomers.length > 5" class="text-muted-foreground">
                      +{{ plan.churnRiskCustomers.length - 5 }} more
                    </li>
                  </ul>
                </TooltipContent>
              </Tooltip>
              <div v-else class="flex items-center gap-1.5">
                <TrendingDown class="h-3.5 w-3.5 text-muted-foreground/50" />
                <div>
                  <p class="text-xs text-muted-foreground">At Risk</p>
                  <p class="text-sm font-medium text-muted-foreground">0</p>
                </div>
              </div>
            </div>

            <!-- Upsell Ready -->
            <div class="flex items-center gap-1.5">
              <Tooltip v-if="plan.upsellReadyCount > 0">
                <TooltipTrigger class="flex items-center gap-1.5">
                  <TrendingUp class="h-3.5 w-3.5 text-blue-500" />
                  <div>
                    <p class="text-xs text-muted-foreground">Upsell</p>
                    <p class="text-sm font-medium text-blue-600">{{ plan.upsellReadyCount }}</p>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p class="font-medium mb-1">Upsell Ready Customers:</p>
                  <ul class="text-xs space-y-0.5">
                    <li v-for="name in plan.upsellReadyCustomers.slice(0, 5)" :key="name">
                      {{ name }}
                    </li>
                    <li v-if="plan.upsellReadyCustomers.length > 5" class="text-muted-foreground">
                      +{{ plan.upsellReadyCustomers.length - 5 }} more
                    </li>
                  </ul>
                </TooltipContent>
              </Tooltip>
              <div v-else class="flex items-center gap-1.5">
                <TrendingUp class="h-3.5 w-3.5 text-muted-foreground/50" />
                <div>
                  <p class="text-xs text-muted-foreground">Upsell</p>
                  <p class="text-sm font-medium text-muted-foreground">0</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Negative Margin Warning -->
          <div
            v-if="plan.negativeMarginCount > 0"
            class="mt-2 pt-2 border-t border-border/50 flex items-center gap-2 text-amber-600"
          >
            <AlertTriangle class="h-3.5 w-3.5" />
            <Tooltip>
              <TooltipTrigger>
                <span class="text-xs">
                  {{ plan.negativeMarginCount }} customers with negative margin
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p class="font-medium mb-1">Negative Margin Customers:</p>
                <ul class="text-xs space-y-0.5">
                  <li v-for="name in plan.negativeMarginCustomers.slice(0, 5)" :key="name">
                    {{ name }}
                  </li>
                  <li v-if="plan.negativeMarginCustomers.length > 5" class="text-muted-foreground">
                    +{{ plan.negativeMarginCustomers.length - 5 }} more
                  </li>
                </ul>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-if="plans.length === 0"
        class="text-center py-8 text-muted-foreground"
      >
        <Users class="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No plan data available</p>
      </div>
    </CardContent>
  </Card>
</template>
