<script setup lang="ts">
/**
 * MarginAnalysisView - Cost vs revenue analysis with negative margin list
 *
 * Displays margin health, cost breakdown, and identifies customers
 * where costs exceed revenue
 */

import { computed } from 'vue'
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui'
import { AlertTriangle, TrendingUp, TrendingDown, DollarSign, Users, Info, ExternalLink } from 'lucide-vue-next'
import { Doughnut } from 'vue-chartjs'
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip as ChartTooltipPlugin,
  Legend,
} from 'chart.js'

ChartJS.register(ArcElement, ChartTooltipPlugin, Legend)

// =============================================================================
// TYPES
// =============================================================================

export interface NegativeMarginCustomer {
  customer: string
  customerId: string
  plan: string
  mrr: string
  costs: string
  margin: string
  reason: string
}

export interface MarginMetrics {
  totalRevenue: number
  totalCosts: number
  margin: number
  marginChange: number // Points change from previous period
  previousMargin: number
}

export interface CostBreakdown {
  name: string
  amount: number
  percentage: number
}

// =============================================================================
// PROPS
// =============================================================================

const props = defineProps<{
  metrics: MarginMetrics
  negativeMarginCustomers: NegativeMarginCustomer[]
  costBreakdown?: CostBreakdown[]
}>()

const emit = defineEmits<{
  'view-customer': [customerId: string]
}>()

// =============================================================================
// COMPUTED
// =============================================================================

const marginStatus = computed(() => {
  if (props.metrics.margin >= 70) return { label: 'Healthy', color: 'text-green-600', bg: 'bg-green-500/10' }
  if (props.metrics.margin >= 50) return { label: 'Moderate', color: 'text-yellow-600', bg: 'bg-yellow-500/10' }
  return { label: 'At Risk', color: 'text-red-600', bg: 'bg-red-500/10' }
})

const marginTrend = computed(() => {
  if (props.metrics.marginChange > 0) return { icon: TrendingUp, color: 'text-green-600' }
  if (props.metrics.marginChange < 0) return { icon: TrendingDown, color: 'text-red-600' }
  return { icon: TrendingUp, color: 'text-muted-foreground' }
})

// Cost breakdown chart data
const chartData = computed(() => {
  const breakdown = props.costBreakdown || [
    { name: 'OpenAI', amount: Math.round(props.metrics.totalCosts * 0.84), percentage: 84 },
    { name: 'Anthropic', amount: Math.round(props.metrics.totalCosts * 0.16), percentage: 16 },
  ]

  return {
    labels: breakdown.map(c => c.name),
    datasets: [{
      data: breakdown.map(c => c.amount),
      backgroundColor: [
        'rgba(34, 197, 94, 0.8)',   // Green
        'rgba(59, 130, 246, 0.8)',   // Blue
        'rgba(249, 115, 22, 0.8)',   // Orange
        'rgba(239, 68, 68, 0.8)',    // Red
        'rgba(168, 85, 247, 0.8)',   // Purple
      ],
      borderWidth: 0,
    }],
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: {
        usePointStyle: true,
        padding: 12,
      },
    },
    tooltip: {
      callbacks: {
        label: (context: any) => {
          return `${context.label || ''}: ${formatCurrency(context.raw as number)}`
        },
      },
    },
  },
}

// Negative margin total
const negativeMarginTotal = computed(() => {
  let total = 0
  props.negativeMarginCustomers.forEach(c => {
    // Parse MRR string (e.g., "$1.5K") back to number
    const mrrMatch = c.mrr.match(/\$([\d.]+)([KM])?/)
    if (mrrMatch) {
      let value = parseFloat(mrrMatch[1] || '0')
      if (mrrMatch[2] === 'K') value *= 1000
      if (mrrMatch[2] === 'M') value *= 1000000
      total += value
    }
  })
  return total
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

function getMarginColor(marginStr: string): string {
  const margin = parseInt(marginStr.replace('%', ''))
  if (margin >= 0) return 'text-green-600'
  if (margin >= -50) return 'text-amber-600'
  return 'text-red-600'
}

function getReasonBadge(reason: string): { variant: 'outline' | 'destructive'; label: string } {
  if (reason.includes('Extremely')) return { variant: 'destructive', label: 'Critical' }
  if (reason.includes('Heavy')) return { variant: 'outline', label: 'High Usage' }
  return { variant: 'outline', label: 'Over Cost' }
}
</script>

<template>
  <Card>
    <CardHeader class="pb-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <CardTitle class="text-base font-semibold">Margin Analysis</CardTitle>
          <Tooltip>
            <TooltipTrigger>
              <Info class="h-3.5 w-3.5 text-muted-foreground/60" />
            </TooltipTrigger>
            <TooltipContent>
              Revenue minus costs. Identifies customers where costs exceed revenue.
            </TooltipContent>
          </Tooltip>
        </div>
        <Badge
          :class="[marginStatus.bg, marginStatus.color]"
          class="border border-current/20"
        >
          {{ marginStatus.label }} ({{ metrics.margin }}%)
        </Badge>
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- Margin Overview -->
      <div class="grid grid-cols-3 gap-4">
        <div class="text-center p-3 rounded-lg bg-muted/50">
          <p class="text-xs text-muted-foreground mb-0.5">Revenue</p>
          <p class="text-lg font-semibold text-green-600">
            {{ formatCurrency(metrics.totalRevenue) }}
          </p>
        </div>
        <div class="text-center p-3 rounded-lg bg-muted/50">
          <p class="text-xs text-muted-foreground mb-0.5">Costs</p>
          <p class="text-lg font-semibold text-red-600">
            {{ formatCurrency(metrics.totalCosts) }}
          </p>
        </div>
        <div class="text-center p-3 rounded-lg" :class="marginStatus.bg">
          <p class="text-xs text-muted-foreground mb-0.5">Margin</p>
          <div class="flex items-center justify-center gap-1">
            <p class="text-lg font-semibold" :class="marginStatus.color">
              {{ metrics.margin }}%
            </p>
            <component
              :is="marginTrend.icon"
              class="h-4 w-4"
              :class="marginTrend.color"
            />
          </div>
          <p class="text-xs" :class="marginTrend.color">
            {{ metrics.marginChange > 0 ? '+' : '' }}{{ metrics.marginChange }} pts
          </p>
        </div>
      </div>

      <!-- Cost Breakdown Chart -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="p-3 rounded-lg border">
          <h4 class="text-sm font-medium mb-3">Cost Breakdown</h4>
          <div class="h-[160px]">
            <Doughnut :data="chartData" :options="chartOptions" />
          </div>
        </div>

        <!-- Margin Health Indicators -->
        <div class="p-3 rounded-lg border space-y-3">
          <h4 class="text-sm font-medium">Margin Health</h4>

          <div class="space-y-2">
            <!-- Gross Margin Bar -->
            <div>
              <div class="flex justify-between text-xs mb-1">
                <span class="text-muted-foreground">Gross Margin</span>
                <span class="font-medium" :class="marginStatus.color">{{ metrics.margin }}%</span>
              </div>
              <div class="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="metrics.margin >= 70 ? 'bg-green-500' : metrics.margin >= 50 ? 'bg-yellow-500' : 'bg-red-500'"
                  :style="{ width: `${Math.min(metrics.margin, 100)}%` }"
                />
              </div>
            </div>

            <!-- Cost Ratio -->
            <div>
              <div class="flex justify-between text-xs mb-1">
                <span class="text-muted-foreground">Cost Ratio</span>
                <span class="font-medium">{{ Math.round((metrics.totalCosts / metrics.totalRevenue) * 100) }}%</span>
              </div>
              <div class="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full bg-blue-500 rounded-full transition-all"
                  :style="{ width: `${Math.min((metrics.totalCosts / metrics.totalRevenue) * 100, 100)}%` }"
                />
              </div>
            </div>

            <!-- At-Risk Revenue -->
            <div v-if="negativeMarginCustomers.length > 0">
              <div class="flex justify-between text-xs mb-1">
                <span class="text-muted-foreground">At-Risk MRR</span>
                <span class="font-medium text-amber-600">{{ formatCurrency(negativeMarginTotal) }}</span>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ negativeMarginCustomers.length }} customers with negative margin
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Negative Margin Customers -->
      <div v-if="negativeMarginCustomers.length > 0" class="border-t pt-4">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <AlertTriangle class="h-4 w-4 text-amber-500" />
            <h4 class="text-sm font-medium">Negative Margin Customers</h4>
            <Badge variant="outline" class="text-amber-600">
              {{ negativeMarginCustomers.length }}
            </Badge>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b text-muted-foreground">
                <th class="text-left py-2 font-medium">Customer</th>
                <th class="text-left py-2 font-medium">Plan</th>
                <th class="text-right py-2 font-medium">MRR</th>
                <th class="text-right py-2 font-medium">Costs</th>
                <th class="text-right py-2 font-medium">Margin</th>
                <th class="text-left py-2 font-medium">Reason</th>
                <th class="text-right py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="customer in negativeMarginCustomers"
                :key="customer.customerId"
                class="border-b hover:bg-muted/50"
              >
                <td class="py-2">
                  <div class="flex items-center gap-2">
                    <Users class="h-3.5 w-3.5 text-muted-foreground" />
                    <span class="font-medium">{{ customer.customer }}</span>
                  </div>
                </td>
                <td class="py-2">
                  <Badge variant="outline">{{ customer.plan }}</Badge>
                </td>
                <td class="py-2 text-right font-mono text-green-600">
                  {{ customer.mrr }}
                </td>
                <td class="py-2 text-right font-mono text-red-600">
                  {{ customer.costs }}
                </td>
                <td class="py-2 text-right font-mono" :class="getMarginColor(customer.margin)">
                  {{ customer.margin }}
                </td>
                <td class="py-2">
                  <Badge :variant="getReasonBadge(customer.reason).variant">
                    {{ getReasonBadge(customer.reason).label }}
                  </Badge>
                </td>
                <td class="py-2 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    @click="emit('view-customer', customer.customerId)"
                  >
                    <ExternalLink class="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Action Suggestions -->
        <div class="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <h5 class="text-sm font-medium text-amber-700 mb-2">Recommended Actions</h5>
          <ul class="text-xs text-amber-600 space-y-1">
            <li>• Review usage patterns for customers with extremely high costs</li>
            <li>• Consider usage-based pricing tiers or overage charges</li>
            <li>• Discuss custom enterprise pricing for heavy users</li>
            <li>• Set up usage alerts to prevent cost overruns</li>
          </ul>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-else
        class="border-t pt-4 text-center text-muted-foreground"
      >
        <DollarSign class="h-8 w-8 mx-auto mb-2 opacity-50 text-green-500" />
        <p class="text-sm font-medium text-green-600">All customers are profitable</p>
        <p class="text-xs">No negative margin customers detected</p>
      </div>
    </CardContent>
  </Card>
</template>
