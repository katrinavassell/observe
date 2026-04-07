<script setup lang="ts">
/**
 * MarginOverviewCard - Revenue, Costs, and Margin per month
 *
 * Displays a combo chart with bars for Revenue/Costs and a line for Margin %,
 * plus a table breakdown below.
 */

import { computed } from 'vue'
import { Chart } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
} from 'chart.js'
import { Card, CardContent, CardHeader, CardTitle, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui'
import { Info } from 'lucide-vue-next'
import type { MonthlyMrrData } from './RevenueFlowChart.vue'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, ChartTooltip, Legend)

// =============================================================================
// PROPS
// =============================================================================

const props = defineProps<{
  data: MonthlyMrrData[]
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
        type: 'bar' as const,
        label: 'Revenue',
        data: props.data.map(d => d.mrr),
        backgroundColor: 'rgba(34, 197, 94, 0.7)',
        borderColor: 'rgb(34, 197, 94)',
        borderWidth: 1,
        order: 2,
        yAxisID: 'y',
      },
      {
        type: 'bar' as const,
        label: 'Costs',
        data: props.data.map(d => d.costs || 0),
        backgroundColor: 'rgba(239, 68, 68, 0.7)',
        borderColor: 'rgb(239, 68, 68)',
        borderWidth: 1,
        order: 2,
        yAxisID: 'y',
      },
      {
        type: 'line' as const,
        label: 'Margin %',
        data: props.data.map(d => d.margin || 0),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: 'rgb(59, 130, 246)',
        tension: 0.3,
        fill: false,
        order: 1,
        yAxisID: 'y1',
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
        label: (context: { dataset: { label: string }; raw: number }) => {
          if (context.dataset.label === 'Margin %') {
            return `${context.dataset.label}: ${context.raw}%`
          }
          return `${context.dataset.label}: $${context.raw.toLocaleString()}`
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
      type: 'linear' as const,
      position: 'left' as const,
      grid: {
        color: 'rgba(0, 0, 0, 0.05)',
      },
      ticks: {
        callback: (value: number | string) => {
          const numValue = typeof value === 'string' ? parseFloat(value) : value
          return `$${numValue.toLocaleString()}`
        },
      },
    },
    y1: {
      type: 'linear' as const,
      position: 'right' as const,
      min: 0,
      max: 100,
      grid: {
        drawOnChartArea: false,
      },
      ticks: {
        callback: (value: number | string) => `${value}%`,
      },
    },
  },
}))

// Latest margin for status badge
const latestMargin = computed(() => {
  if (props.data.length === 0) return 0
  return props.data[props.data.length - 1]?.margin || 0
})

const marginStatus = computed(() => {
  if (latestMargin.value >= 70) return { label: 'Healthy', color: 'text-green-600', bg: 'bg-green-500/10' }
  if (latestMargin.value >= 50) return { label: 'Moderate', color: 'text-yellow-600', bg: 'bg-yellow-500/10' }
  return { label: 'At Risk', color: 'text-red-600', bg: 'bg-red-500/10' }
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
</script>

<template>
  <Card>
    <CardHeader class="pb-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <CardTitle class="text-base font-semibold">Margin Overview</CardTitle>
          <Tooltip>
            <TooltipTrigger>
              <Info class="h-3.5 w-3.5 text-muted-foreground/60" />
            </TooltipTrigger>
            <TooltipContent>
              Monthly revenue vs costs with margin percentage
            </TooltipContent>
          </Tooltip>
        </div>
        <div
          class="px-2.5 py-0.5 rounded-full text-xs font-medium"
          :class="[marginStatus.bg, marginStatus.color]"
        >
          {{ marginStatus.label }} ({{ latestMargin }}%)
        </div>
      </div>
    </CardHeader>

    <CardContent class="space-y-4">
      <!-- Chart -->
      <div class="h-[280px]">
        <Chart type="bar" :data="chartData" :options="chartOptions" />
      </div>

      <!-- Table -->
      <div class="overflow-x-auto pt-4 border-t">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b text-muted-foreground">
              <th class="text-left py-2 font-medium">Month</th>
              <th class="text-right py-2 font-medium text-green-600">Revenue</th>
              <th class="text-right py-2 font-medium text-red-600">Costs</th>
              <th class="text-right py-2 font-medium text-blue-600">Margin</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="month in data"
              :key="month.month"
              class="border-b hover:bg-muted/50"
            >
              <td class="py-2 font-medium">{{ month.monthLabel }}</td>
              <td class="py-2 text-right tabular-nums text-green-600">
                {{ formatCurrency(month.mrr) }}
              </td>
              <td class="py-2 text-right tabular-nums text-red-600">
                {{ formatCurrency(month.costs || 0) }}
              </td>
              <td
                class="py-2 text-right tabular-nums"
                :class="(month.margin || 0) >= 50 ? 'text-blue-600' : 'text-red-600'"
              >
                {{ month.margin || 0 }}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </CardContent>
  </Card>
</template>
