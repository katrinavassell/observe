<script setup lang="ts">
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
  type TooltipItem,
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
)

export interface RevenueFlowData {
  newMRR: number
  expansionMRR: number
  contractionMRR: number
  churnedMRR: number
  netMRR: number
}

const props = defineProps<{
  data: RevenueFlowData
}>()

function formatCurrency(amount: number): string {
  if (Math.abs(amount) >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`
  }
  return `$${amount.toFixed(0)}`
}

const chartData = computed(() => {
  return {
    labels: ['New', 'Expansion', 'Contraction', 'Churned', 'Net'],
    datasets: [
      {
        data: [
          props.data.newMRR,
          props.data.expansionMRR,
          -props.data.contractionMRR,
          -props.data.churnedMRR,
          props.data.netMRR,
        ],
        backgroundColor: [
          'rgba(34, 197, 94, 0.85)',   // Green - New
          'rgba(59, 130, 246, 0.85)',  // Blue - Expansion
          'rgba(249, 115, 22, 0.85)',  // Orange - Contraction
          'rgba(239, 68, 68, 0.85)',   // Red - Churned
          props.data.netMRR >= 0
            ? 'rgba(99, 102, 241, 0.85)'  // Indigo - Net Positive
            : 'rgba(239, 68, 68, 0.85)',   // Red - Net Negative
        ],
        borderColor: [
          'rgb(34, 197, 94)',
          'rgb(59, 130, 246)',
          'rgb(249, 115, 22)',
          'rgb(239, 68, 68)',
          props.data.netMRR >= 0 ? 'rgb(99, 102, 241)' : 'rgb(239, 68, 68)',
        ],
        borderWidth: 1,
        borderRadius: 6,
      },
    ],
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      callbacks: {
        label: (item: TooltipItem<'bar'>) => {
          const value = item.raw as number
          const label = value >= 0 ? '+' : ''
          return `${label}${formatCurrency(value)}`
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
      grid: {
        color: 'rgba(0, 0, 0, 0.05)',
      },
      ticks: {
        callback: (value: number | string) => {
          const num = typeof value === 'string' ? parseFloat(value) : value
          return formatCurrency(num)
        },
      },
    },
  },
}
</script>

<template>
  <div class="h-[220px] w-full">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>
