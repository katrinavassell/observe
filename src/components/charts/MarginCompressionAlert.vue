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
import { AlertTriangle, TrendingUp, TrendingDown, Scissors, Clock, Target } from 'lucide-vue-next'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Tooltip as UiTooltip,
  TooltipTrigger,
  TooltipContent,
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

// Severity levels based on growth gap
type SeverityLevel = 'warning' | 'critical' | 'severe'

const severityLevel = computed((): SeverityLevel => {
  const gap = growthGap.value
  if (gap >= 30) return 'severe'
  if (gap >= 20) return 'critical'
  return 'warning'
})

const severityConfig = computed(() => {
  switch (severityLevel.value) {
    case 'severe':
      return {
        label: 'Severe',
        bgClass: 'from-red-50 to-red-100 dark:from-red-950/40 dark:to-red-900/30',
        borderClass: 'border-red-500/60',
        textClass: 'text-red-900 dark:text-red-100',
        subtextClass: 'text-red-700 dark:text-red-300',
        iconBgClass: 'bg-red-100 dark:bg-red-900/50',
        iconClass: 'text-red-600 dark:text-red-400',
        badgeVariant: 'destructive' as const,
      }
    case 'critical':
      return {
        label: 'Critical',
        bgClass: 'from-orange-50 to-red-50 dark:from-orange-950/30 dark:to-red-950/30',
        borderClass: 'border-orange-500/50',
        textClass: 'text-orange-900 dark:text-orange-100',
        subtextClass: 'text-orange-700 dark:text-orange-300',
        iconBgClass: 'bg-orange-100 dark:bg-orange-900/50',
        iconClass: 'text-orange-600 dark:text-orange-400',
        badgeVariant: 'destructive' as const,
      }
    default:
      return {
        label: 'Warning',
        bgClass: 'from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30',
        borderClass: 'border-amber-500/50',
        textClass: 'text-amber-900 dark:text-amber-100',
        subtextClass: 'text-amber-700 dark:text-amber-300',
        iconBgClass: 'bg-amber-100 dark:bg-amber-900/50',
        iconClass: 'text-amber-600 dark:text-amber-400',
        badgeVariant: 'secondary' as const,
      }
  }
})

// Calculate trend acceleration (is the gap accelerating or decelerating?)
const trendAcceleration = computed(() => {
  if (chartMonths.value.length < 4) return null

  const months = chartMonths.value
  const midpoint = Math.floor(months.length / 2)

  // Calculate gaps for first half and second half
  const firstHalf = months.slice(0, midpoint)
  const secondHalf = months.slice(midpoint)

  const firstHalfAvgGap = firstHalf.reduce((sum, m) => sum + (m.costs / Math.max(m.mrr, 1)), 0) / firstHalf.length
  const secondHalfAvgGap = secondHalf.reduce((sum, m) => sum + (m.costs / Math.max(m.mrr, 1)), 0) / secondHalf.length

  const acceleration = ((secondHalfAvgGap - firstHalfAvgGap) / firstHalfAvgGap) * 100

  if (acceleration > 5) return { direction: 'accelerating', value: Math.round(acceleration) }
  if (acceleration < -5) return { direction: 'decelerating', value: Math.round(Math.abs(acceleration)) }
  return { direction: 'stable', value: 0 }
})

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

// Generate projection data for next 3 months
const projectionData = computed(() => {
  if (chartMonths.value.length < 2) return { labels: [], revenueProjection: [], costProjection: [] }

  const months = chartMonths.value
  const lastMonth = months[months.length - 1]
  if (!lastMonth) return { labels: [], revenueProjection: [], costProjection: [] }

  const monthlyRevenueGrowth = props.revenueGrowth / 100 / 6
  const monthlyCostGrowth = props.costGrowth / 100 / 6

  const projectionLabels: string[] = []
  const revenueProjection: (number | null)[] = [...months.map(() => null as number | null)]
  const costProjection: (number | null)[] = [...months.map(() => null as number | null)]

  // Set starting point at last actual data point
  revenueProjection[revenueProjection.length - 1] = lastMonth.mrr
  costProjection[costProjection.length - 1] = lastMonth.costs

  let projectedRevenue = lastMonth.mrr
  let projectedCost = lastMonth.costs

  // Project 3 months ahead
  for (let i = 1; i <= 3; i++) {
    projectedRevenue *= (1 + monthlyRevenueGrowth)
    projectedCost *= (1 + monthlyCostGrowth)

    const lastMonthParts = lastMonth.month?.split('-') || ['2024', '01']
    const year = parseInt(lastMonthParts[0] || '2024')
    const month = parseInt(lastMonthParts[1] || '01')
    const projectedDate = new Date(year, month - 1 + i, 1)
    projectionLabels.push(projectedDate.toLocaleDateString('en-US', { month: 'short' }))

    revenueProjection.push(Math.round(projectedRevenue))
    costProjection.push(Math.round(projectedCost))
  }

  return { labels: projectionLabels, revenueProjection, costProjection }
})

const chartData = computed(() => {
  const baseLabels = chartMonths.value.map(d => {
    const parts = d.month?.split('-') || []
    const year = parts[0] || '2024'
    const month = parts[1] || '01'
    const date = new Date(parseInt(year), parseInt(month) - 1)
    if (isNaN(date.getTime())) {
      return d.month || 'Unknown'
    }
    return date.toLocaleDateString('en-US', { month: 'short' })
  })

  const labels = [...baseLabels, ...projectionData.value.labels]

  // Pad actual data with nulls for projection period
  const revenueData = [...chartMonths.value.map(d => d.mrr), ...Array(3).fill(null)]
  const costData = [...chartMonths.value.map(d => d.costs), ...Array(3).fill(null)]

  return {
    labels,
    datasets: [
      {
        label: 'Revenue',
        data: revenueData,
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
        data: costData,
        borderColor: 'rgb(239, 68, 68)', // Red
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        fill: false,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: 'rgb(239, 68, 68)',
        borderWidth: 2,
      },
      {
        label: 'Revenue (Projected)',
        data: projectionData.value.revenueProjection,
        borderColor: 'rgba(59, 130, 246, 0.4)',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.3,
        borderDash: [5, 5],
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: 'rgba(59, 130, 246, 0.4)',
        borderWidth: 2,
      },
      {
        label: 'Costs (Projected)',
        data: projectionData.value.costProjection,
        borderColor: 'rgba(239, 68, 68, 0.4)',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.3,
        borderDash: [5, 5],
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: 'rgba(239, 68, 68, 0.4)',
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
    :class="`${severityConfig.borderClass} bg-gradient-to-br ${severityConfig.bgClass}`"
  >
    <CardHeader class="pb-2">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div class="flex items-center gap-2">
          <div :class="`p-1.5 rounded-lg ${severityConfig.iconBgClass}`">
            <AlertTriangle :class="`h-5 w-5 ${severityConfig.iconClass}`" />
          </div>
          <CardTitle :class="`text-lg font-semibold ${severityConfig.textClass}`">
            Margin Compression Alert
          </CardTitle>
          <Badge :variant="severityConfig.badgeVariant" class="text-[10px]">
            {{ severityConfig.label }}
          </Badge>
        </div>
        <div class="flex items-center gap-2">
          <!-- Trend Acceleration Badge -->
          <UiTooltip v-if="trendAcceleration && trendAcceleration.direction !== 'stable'">
            <TooltipTrigger>
              <Badge
                :variant="trendAcceleration.direction === 'accelerating' ? 'destructive' : 'success'"
                class="text-[10px]"
              >
                <TrendingUp v-if="trendAcceleration.direction === 'accelerating'" class="h-3 w-3 mr-1" />
                <TrendingDown v-else class="h-3 w-3 mr-1" />
                {{ trendAcceleration.direction === 'accelerating' ? 'Accelerating' : 'Slowing' }}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Gap is {{ trendAcceleration.direction }} by {{ trendAcceleration.value }}%</p>
            </TooltipContent>
          </UiTooltip>
          <Badge variant="destructive" class="text-sm font-semibold">
            +{{ growthGap }}pts gap
          </Badge>
        </div>
      </div>
      <p :class="`text-sm mt-1 ${severityConfig.subtextClass}`">
        Costs are growing {{ growthGap }} percentage points faster than revenue
        <span v-if="monthsToNegativeMargin !== null" class="font-medium">
          — at this rate, negative margin in {{ monthsToNegativeMargin }} months
        </span>
      </p>
    </CardHeader>
    <CardContent class="space-y-4">
      <!-- Dual Line Chart with Projections -->
      <div class="h-[220px] w-full relative">
        <Line :data="chartData" :options="chartOptions" />
        <!-- Scissors Icon Overlay -->
        <div
          class="absolute top-1/2 right-4 transform -translate-y-1/2 opacity-10"
          v-if="hasDivergence"
        >
          <Scissors :class="`h-16 w-16 rotate-90 ${severityConfig.iconClass}`" />
        </div>
        <!-- Projection Legend -->
        <div class="absolute top-2 right-2 flex items-center gap-2 text-[10px] text-muted-foreground bg-background/80 px-2 py-1 rounded">
          <div class="flex items-center gap-1">
            <div class="w-4 border-t-2 border-dashed border-muted-foreground/40"></div>
            <span>Projected</span>
          </div>
        </div>
      </div>

      <!-- Metric Cards -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
            <Scissors class="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            <p class="text-xs text-muted-foreground">Gap Widening</p>
          </div>
          <p class="text-xl font-bold text-amber-600 dark:text-amber-400">
            {{ growthGap }} pts
          </p>
        </div>

        <!-- Time to Negative -->
        <UiTooltip v-if="monthsToNegativeMargin !== null">
          <TooltipTrigger class="w-full">
            <div class="text-center p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
              <div class="flex items-center justify-center gap-1 mb-1">
                <Clock class="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                <p class="text-xs text-muted-foreground">Runway</p>
              </div>
              <p class="text-xl font-bold text-purple-600 dark:text-purple-400">
                {{ monthsToNegativeMargin }}mo
              </p>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>At current growth rates, costs will exceed revenue in {{ monthsToNegativeMargin }} months</p>
          </TooltipContent>
        </UiTooltip>
        <div v-else class="text-center p-3 bg-green-500/10 rounded-lg border border-green-500/20">
          <div class="flex items-center justify-center gap-1 mb-1">
            <Target class="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
            <p class="text-xs text-muted-foreground">Status</p>
          </div>
          <p class="text-sm font-bold text-green-600 dark:text-green-400">
            Sustainable
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
