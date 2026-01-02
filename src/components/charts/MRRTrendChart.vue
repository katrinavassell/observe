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
  monthlyMetrics: MonthlyMetrics[]
}>()

const chartData = computed(() => ({
  labels: props.monthlyMetrics.map(m => m.monthLabel),
  datasets: [
    {
      label: 'MRR',
      data: props.monthlyMetrics.map(m => m.mrr),
      borderColor: 'hsl(var(--primary))',
      backgroundColor: 'hsla(var(--primary), 0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 6,
    },
    {
      label: 'Costs',
      data: props.monthlyMetrics.map(m => m.costs),
      borderColor: 'hsl(var(--destructive))',
      backgroundColor: 'transparent',
      borderDash: [5, 5],
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 6,
    },
  ],
}))

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    intersect: false,
    mode: 'index' as const,
  },
  plugins: {
    legend: {
      position: 'top' as const,
      labels: {
        usePointStyle: true,
        padding: 20,
      },
    },
    tooltip: {
      callbacks: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label: function(context: any) {
          const value = context.parsed?.y ?? 0
          const formatted = value >= 1000
            ? `$${(value / 1000).toFixed(1)}K`
            : `$${value.toFixed(0)}`
          return `${context.dataset?.label || ''}: ${formatted}`
        },
      },
    },
  },
  scales: {
    y: {
      beginAtZero: false,
      ticks: {
        callback: function(value: number | string) {
          const num = Number(value)
          return num >= 1000 ? `$${(num / 1000).toFixed(0)}K` : `$${num}`
        },
      },
      grid: {
        color: 'hsla(var(--border), 0.5)',
      },
    },
    x: {
      grid: {
        display: false,
      },
    },
  },
}
</script>

<template>
  <div class="h-[300px] w-full">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>
