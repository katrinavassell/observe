<script setup lang="ts">
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type TooltipItem,
} from 'chart.js'
import { AlertTriangle, TrendingUp, TrendingDown, Scissors } from 'lucide-vue-next'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
} from '@/components/ui'
import type { MonthlyMetrics } from '@/lib/pricing-analyzer'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

const props = defineProps<{
  data: MonthlyMetrics[]
  revenueGrowth: number
  costGrowth: number
}>()

// Calculate the growth gap (difference between cost growth and revenue growth)
const growthGap = computed(() => {
  return props.costGrowth - props.revenueGrowth
})

// Determine if there's a concerning divergence (costs growing faster than revenue)
const hasDivergence = computed(() => {
  return props.costGrowth > props.revenueGrowth && growthGap.value > 10
})

// Get last 6 months of data
const chartMonths = computed(() => {
  return props.data.slice(-6)
})

const chartData = computed(() => {
  const labels = chartMonths.value.map(d => {
    const parts = d.month?.split('-') || []
    const year = parts[0] || '2024'
    const month = parts[1] || '01'
    const date = new Date(parseInt(year), parseInt(month) - 1)
    if (isNaN(date.getTime())) {
      return d.month || 'Unknown'
    }
    return date.toLocaleDateString('en-US', { month: 'short' })
  })

  return {
    labels,
    datasets: [
      {
        label: 'Revenue',
        data: chartMonths.value.map(d => d.mrr),
        borderColor: 'rgb(59, 130, 246)', // Blue
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: false,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: 'rgb(59, 130, 246)',
        borderWidth: 2,
      },
      {
        label: 'Costs',
        data: chartMonths.value.map(d => d.costs),
        borderColor: 'rgb(239, 68, 68)', // Red
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        fill: false,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: 'rgb(239, 68, 68)',
        borderWidth: 2,
      },
    ],
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index' as const,
    intersect: false,
  },
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      labels: {
        usePointStyle: true,
        padding: 20,
      },
    },
    tooltip: {
      callbacks: {
        label: (context: TooltipItem<'line'>) => {
          const value = context.parsed.y ?? 0
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
      beginAtZero: true,
      ticks: {
        callback: (value: number | string) => {
          const num = typeof value === 'string' ? parseFloat(value) : value
          if (num >= 1000) {
            return `$${(num / 1000).toFixed(1)}K`
          }
          return `$${num}`
        },
      },
    },
  },
}

// Calculate months until negative margin at current growth rates
const monthsToNegativeMargin = computed(() => {
  if (chartMonths.value.length < 2) return null

  const latestData = chartMonths.value[chartMonths.value.length - 1]
  if (!latestData || latestData.mrr <= latestData.costs) return 0

  // If costs aren't growing faster than revenue, no convergence
  if (props.costGrowth <= props.revenueGrowth) return null

  // Simple linear projection based on monthly growth rates
  const monthlyRevenueGrowth = props.revenueGrowth / 100 / 6 // Convert to monthly decimal
  const monthlyCostGrowth = props.costGrowth / 100 / 6

  let revenue = latestData.mrr
  let costs = latestData.costs
  let months = 0

  while (revenue > costs && months < 24) {
    revenue *= (1 + monthlyRevenueGrowth)
    costs *= (1 + monthlyCostGrowth)
    months++
  }

  return months < 24 ? months : null
})
</script>

<template>
  <Card
    v-if="hasDivergence"
    class="border-amber-500/50 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30"
  >
    <CardHeader class="pb-2">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="p-1.5 bg-amber-100 dark:bg-amber-900/50 rounded-lg">
            <AlertTriangle class="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <CardTitle class="text-lg font-semibold text-amber-900 dark:text-amber-100">
            Margin Compression Alert
          </CardTitle>
        </div>
        <Badge variant="destructive" class="text-sm font-semibold">
          +{{ growthGap }}pts gap
        </Badge>
      </div>
      <p class="text-sm text-amber-700 dark:text-amber-300 mt-1">
        Costs are growing {{ growthGap }} percentage points faster than revenue
        <span v-if="monthsToNegativeMargin !== null" class="font-medium">
          — at this rate, negative margin in {{ monthsToNegativeMargin }} months
        </span>
      </p>
    </CardHeader>
    <CardContent class="space-y-4">
      <!-- Dual Line Chart -->
      <div class="h-[200px] w-full relative">
        <Line :data="chartData" :options="chartOptions" />
        <!-- Scissors Icon Overlay -->
        <div
          class="absolute top-1/2 right-4 transform -translate-y-1/2 opacity-10"
          v-if="hasDivergence"
        >
          <Scissors class="h-16 w-16 text-amber-600 rotate-90" />
        </div>
      </div>

      <!-- Metric Cards -->
      <div class="grid grid-cols-3 gap-3">
        <!-- Revenue Growth -->
        <div class="text-center p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
          <div class="flex items-center justify-center gap-1 mb-1">
            <TrendingUp class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <p class="text-xs text-muted-foreground">Revenue Growth</p>
          </div>
          <p class="text-xl font-bold text-blue-600 dark:text-blue-400">
            +{{ revenueGrowth }}%
          </p>
        </div>

        <!-- Cost Growth -->
        <div class="text-center p-3 bg-red-500/10 rounded-lg border border-red-500/20">
          <div class="flex items-center justify-center gap-1 mb-1">
            <TrendingUp class="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            <p class="text-xs text-muted-foreground">Cost Growth</p>
          </div>
          <p class="text-xl font-bold text-red-600 dark:text-red-400">
            +{{ costGrowth }}%
          </p>
        </div>

        <!-- Gap Widening -->
        <div class="text-center p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
          <div class="flex items-center justify-center gap-1 mb-1">
            <TrendingDown class="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            <p class="text-xs text-muted-foreground">Gap Widening</p>
          </div>
          <p class="text-xl font-bold text-amber-600 dark:text-amber-400">
            {{ growthGap }} pts
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
