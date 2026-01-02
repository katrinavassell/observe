<script setup lang="ts">
/**
 * CustomerProfitabilityChart - Shows profitability distribution across customers
 */

import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui'
import type { CustomerInsight } from '@/api/client'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

// =============================================================================
// PROPS
// =============================================================================

const props = defineProps<{
  customers: CustomerInsight[]
  riskDistribution: {
    high: number
    medium: number
    low: number
  }
}>()

// =============================================================================
// COMPUTED - Profitability Buckets
// =============================================================================

const profitabilityBuckets = computed(() => {
  const buckets = {
    'Negative (<0%)': 0,
    'Low (0-20%)': 0,
    'Medium (20-50%)': 0,
    'Good (50-70%)': 0,
    'Excellent (>70%)': 0,
  }

  for (const customer of props.customers) {
    const margin = customer.trueMargin
    if (margin < 0) buckets['Negative (<0%)']++
    else if (margin < 20) buckets['Low (0-20%)']++
    else if (margin < 50) buckets['Medium (20-50%)']++
    else if (margin < 70) buckets['Good (50-70%)']++
    else buckets['Excellent (>70%)']++
  }

  return buckets
})

const chartData = computed(() => ({
  labels: Object.keys(profitabilityBuckets.value),
  datasets: [
    {
      label: 'Customers',
      data: Object.values(profitabilityBuckets.value),
      backgroundColor: [
        'rgba(239, 68, 68, 0.8)',   // red for negative
        'rgba(251, 191, 36, 0.8)', // amber for low
        'rgba(59, 130, 246, 0.8)', // blue for medium
        'rgba(34, 197, 94, 0.8)',  // green for good
        'rgba(16, 185, 129, 0.8)', // emerald for excellent
      ],
      borderColor: [
        'rgb(239, 68, 68)',
        'rgb(251, 191, 36)',
        'rgb(59, 130, 246)',
        'rgb(34, 197, 94)',
        'rgb(16, 185, 129)',
      ],
      borderWidth: 1,
      borderRadius: 4,
    },
  ],
}))

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      callbacks: {
        label: (context: any) => {
          const value = context.parsed.y
          const total = props.customers.length
          const percent = total > 0 ? ((value / total) * 100).toFixed(1) : 0
          return `${value} customers (${percent}%)`
        },
      },
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      ticks: {
        stepSize: 1,
      },
    },
    x: {
      grid: {
        display: false,
      },
    },
  },
}

// Summary stats
const summaryStats = computed(() => {
  if (props.customers.length === 0) {
    return { profitable: 0, unprofitable: 0, avgMargin: 0 }
  }

  const profitable = props.customers.filter(c => c.trueMargin > 0).length
  const unprofitable = props.customers.length - profitable
  const avgMargin = props.customers.reduce((sum, c) => sum + c.trueMargin, 0) / props.customers.length

  return { profitable, unprofitable, avgMargin }
})
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Profitability Distribution</CardTitle>
      <CardDescription>
        Customer breakdown by margin percentage
      </CardDescription>
    </CardHeader>
    <CardContent>
      <!-- Summary Stats -->
      <div class="grid grid-cols-3 gap-4 mb-6">
        <div class="text-center p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
          <p class="text-2xl font-bold text-green-600">{{ summaryStats.profitable }}</p>
          <p class="text-xs text-muted-foreground">Profitable</p>
        </div>
        <div class="text-center p-3 bg-red-50 dark:bg-red-950/20 rounded-lg">
          <p class="text-2xl font-bold text-red-600">{{ summaryStats.unprofitable }}</p>
          <p class="text-xs text-muted-foreground">Unprofitable</p>
        </div>
        <div class="text-center p-3 bg-muted rounded-lg">
          <p class="text-2xl font-bold" :class="summaryStats.avgMargin >= 0 ? 'text-green-600' : 'text-red-600'">
            {{ summaryStats.avgMargin.toFixed(1) }}%
          </p>
          <p class="text-xs text-muted-foreground">Avg Margin</p>
        </div>
      </div>

      <!-- Chart -->
      <div class="h-[200px]">
        <Bar :data="chartData" :options="chartOptions" />
      </div>
    </CardContent>
  </Card>
</template>
