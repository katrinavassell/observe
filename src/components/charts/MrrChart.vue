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
  showCosts?: boolean
}>()

const chartData = computed(() => {
  const labels = props.data.map(d => {
    const parts = d.month?.split('-') || []
    const year = parts[0] || '2024'
    const month = parts[1] || '01'
    const date = new Date(parseInt(year), parseInt(month) - 1)
    if (isNaN(date.getTime())) {
      return d.month || 'Unknown'
    }
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  })

  const datasets = [
    {
      label: 'MRR',
      data: props.data.map(d => d.mrr),
      borderColor: 'rgb(99, 102, 241)', // Indigo
      backgroundColor: 'rgba(99, 102, 241, 0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: 'rgb(99, 102, 241)',
    },
  ]

  if (props.showCosts) {
    datasets.push({
      label: 'Costs',
      data: props.data.map(d => d.costs),
      borderColor: 'rgb(239, 68, 68)', // Red
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: 'rgb(239, 68, 68)',
    })
  }

  return { labels, datasets }
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
      display: props.showCosts,
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
            return `$${(num / 1000).toFixed(0)}K`
          }
          return `$${num}`
        },
      },
    },
  },
}))
</script>

<template>
  <div class="h-[300px] w-full">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>
