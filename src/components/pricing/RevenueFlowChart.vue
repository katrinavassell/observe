<script setup lang="ts">
/**
 * RevenueFlowChart - Stacked bar chart showing MRR breakdown by month
 *
 * Displays New, Expansion, Contraction, and Churn MRR for each month
 */

import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
} from 'chart.js'
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui'
import { Info, Download } from 'lucide-vue-next'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, ChartTooltip, Legend)

// =============================================================================
// TYPES
// =============================================================================

export interface MonthlyMrrData {
  month: string
  monthLabel: string
  mrr: number
  newMRR: number
  expansionMRR: number
  contractionMRR: number
  churnedMRR: number
  netNewMRR: number
  customerCount: number
  costs?: number
  margin?: number
  formatted: {
    mrr: string
    newMRR: string
    expansionMRR: string
    contractionMRR: string
    churnedMRR: string
    netNewMRR: string
    margin?: string
  }
}

// =============================================================================
// PROPS
// =============================================================================

const props = defineProps<{
  data: MonthlyMrrData[]
  showTable?: boolean
}>()

// =============================================================================
// COMPUTED
// =============================================================================

const chartData = computed(() => {
  const labels = props.data.map(d => d.monthLabel)

  return {
    labels,
    datasets: [
      {
        label: 'New',
        data: props.data.map(d => d.newMRR),
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderColor: 'rgb(34, 197, 94)',
        borderWidth: 1,
        stack: 'positive',
      },
      {
        label: 'Expansion',
        data: props.data.map(d => d.expansionMRR),
        backgroundColor: 'rgba(59, 130, 246, 0.8)',
        borderColor: 'rgb(59, 130, 246)',
        borderWidth: 1,
        stack: 'positive',
      },
      {
        label: 'Contraction',
        data: props.data.map(d => -d.contractionMRR),
        backgroundColor: 'rgba(249, 115, 22, 0.8)',
        borderColor: 'rgb(249, 115, 22)',
        borderWidth: 1,
        stack: 'negative',
      },
      {
        label: 'Churn',
        data: props.data.map(d => -d.churnedMRR),
        backgroundColor: 'rgba(239, 68, 68, 0.8)',
        borderColor: 'rgb(239, 68, 68)',
        borderWidth: 1,
        stack: 'negative',
      },
    ],
  }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index' as const,
    intersect: false,
  },
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: {
        usePointStyle: true,
        padding: 20,
      },
    },
    tooltip: {
      callbacks: {
        label: (context: any) => {
          const value = Math.abs(context.raw as number)
          return `${context.dataset.label || ''}: $${value.toLocaleString()}`
        },
      },
    },
  },
  scales: {
    x: {
      grid: {
        display: false,
      },
    },
    y: {
      stacked: true,
      grid: {
        color: 'rgba(0, 0, 0, 0.05)',
      },
      ticks: {
        callback: (value: number | string) => {
          const numValue = typeof value === 'string' ? parseFloat(value) : value
          return numValue >= 0 ? `$${numValue.toLocaleString()}` : `-$${Math.abs(numValue).toLocaleString()}`
        },
      },
    },
  },
}))

// Summary stats
const summary = computed(() => {
  if (props.data.length === 0) {
    return {
      currentMrr: 0,
      mrrGrowth: 0,
      totalNew: 0,
      totalExpansion: 0,
      totalContraction: 0,
      totalChurn: 0,
      netGrowth: 0,
    }
  }

  const latest = props.data[props.data.length - 1]!
  const previous = props.data.length > 1 ? props.data[props.data.length - 2] : null

  const totalNew = props.data.reduce((sum, d) => sum + d.newMRR, 0)
  const totalExpansion = props.data.reduce((sum, d) => sum + d.expansionMRR, 0)
  const totalContraction = props.data.reduce((sum, d) => sum + d.contractionMRR, 0)
  const totalChurn = props.data.reduce((sum, d) => sum + d.churnedMRR, 0)

  const mrrGrowth = previous && previous.mrr > 0
    ? Math.round(((latest.mrr - previous.mrr) / previous.mrr) * 100)
    : 0

  return {
    currentMrr: latest.mrr,
    mrrGrowth,
    totalNew,
    totalExpansion,
    totalContraction,
    totalChurn,
    netGrowth: totalNew + totalExpansion - totalContraction - totalChurn,
  }
})

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}
</script>

<template>
  <Card>
    <CardHeader class="pb-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <CardTitle class="text-base font-semibold">Revenue Flow</CardTitle>
          <Tooltip>
            <TooltipTrigger>
              <Info class="h-3.5 w-3.5 text-muted-foreground/60" />
            </TooltipTrigger>
            <TooltipContent>
              MRR breakdown showing new, expansion, contraction, and churned revenue each month
            </TooltipContent>
          </Tooltip>
        </div>
        <div class="flex items-center gap-2">
          <Badge variant="outline" class="tabular-nums">
            {{ formatCurrency(summary.currentMrr) }} MRR
          </Badge>
          <Badge
            v-if="summary.mrrGrowth !== 0"
            :variant="summary.mrrGrowth > 0 ? 'success' : 'destructive'"
          >
            {{ summary.mrrGrowth > 0 ? '+' : '' }}{{ summary.mrrGrowth }}%
          </Badge>
        </div>
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- Summary Cards -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="text-center p-3 bg-green-500/10 rounded-lg border border-green-500/20">
          <p class="text-xs text-muted-foreground mb-0.5">New</p>
          <p class="text-lg font-semibold text-green-600">
            +{{ formatCurrency(summary.totalNew) }}
          </p>
        </div>
        <div class="text-center p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
          <p class="text-xs text-muted-foreground mb-0.5">Expansion</p>
          <p class="text-lg font-semibold text-blue-600">
            +{{ formatCurrency(summary.totalExpansion) }}
          </p>
        </div>
        <div class="text-center p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
          <p class="text-xs text-muted-foreground mb-0.5">Contraction</p>
          <p class="text-lg font-semibold text-orange-600">
            -{{ formatCurrency(summary.totalContraction) }}
          </p>
        </div>
        <div class="text-center p-3 bg-red-500/10 rounded-lg border border-red-500/20">
          <p class="text-xs text-muted-foreground mb-0.5">Churned</p>
          <p class="text-lg font-semibold text-red-600">
            -{{ formatCurrency(summary.totalChurn) }}
          </p>
        </div>
      </div>

      <!-- Chart -->
      <div class="h-[300px]">
        <Bar :data="chartData" :options="chartOptions" />
      </div>

      <!-- Data Table -->
      <div v-if="showTable" class="overflow-x-auto pt-4 border-t">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b text-muted-foreground">
              <th class="text-left py-2 font-medium">Month</th>
              <th class="text-right py-2 font-medium">MRR</th>
              <th class="text-right py-2 font-medium text-green-600">New</th>
              <th class="text-right py-2 font-medium text-blue-600">Expansion</th>
              <th class="text-right py-2 font-medium text-orange-600">Contraction</th>
              <th class="text-right py-2 font-medium text-red-600">Churn</th>
              <th class="text-right py-2 font-medium">Net</th>
              <th class="text-right py-2 font-medium">Customers</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="month in data"
              :key="month.month"
              class="border-b hover:bg-muted/50"
            >
              <td class="py-2 font-medium">{{ month.monthLabel }}</td>
              <td class="py-2 text-right tabular-nums">{{ month.formatted.mrr }}</td>
              <td class="py-2 text-right tabular-nums text-green-600">
                +{{ month.formatted.newMRR }}
              </td>
              <td class="py-2 text-right tabular-nums text-blue-600">
                +{{ month.formatted.expansionMRR }}
              </td>
              <td class="py-2 text-right tabular-nums text-orange-600">
                -{{ month.formatted.contractionMRR }}
              </td>
              <td class="py-2 text-right tabular-nums text-red-600">
                -{{ month.formatted.churnedMRR }}
              </td>
              <td
                class="py-2 text-right tabular-nums"
                :class="month.netNewMRR >= 0 ? 'text-green-600' : 'text-red-600'"
              >
                {{ month.netNewMRR >= 0 ? '+' : '' }}{{ month.formatted.netNewMRR }}
              </td>
              <td class="py-2 text-right">{{ month.customerCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Actions -->
      <div class="flex justify-end pt-2">
        <Button variant="ghost" size="sm">
          <Download class="h-4 w-4 mr-1.5" />
          Export Data
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
