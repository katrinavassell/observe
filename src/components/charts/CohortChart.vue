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
import type { CohortData } from '@/lib/pricing-analyzer'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
)

const props = defineProps<{
  data: CohortData[]
}>()

const chartData = computed(() => {
  // Reverse to show oldest first (left to right chronologically)
  const sortedData = [...props.data].reverse()

  const labels = sortedData.map(d => d.cohort)

  return {
    labels,
    datasets: [
      {
        label: 'Active',
        data: sortedData.map(d => d.activeCount),
        backgroundColor: 'rgba(34, 197, 94, 0.8)', // Green
        borderRadius: 4,
      },
      {
        label: 'Churned',
        data: sortedData.map(d => d.churnedCount),
        backgroundColor: 'rgba(239, 68, 68, 0.8)', // Red
        borderRadius: 4,
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
        afterBody: (items: TooltipItem<'bar'>[]) => {
          const firstItem = items[0]
          if (firstItem) {
            const index = firstItem.dataIndex
            const sortedData = [...props.data].reverse()
            const cohort = sortedData[index]
            if (cohort) {
              return [
                '',
                `Retention: ${cohort.retentionRate}%`,
                `Avg MRR: ${cohort.avgMRR}`,
                `Total MRR: ${cohort.totalMRR}`,
              ]
            }
          }
          return []
        },
      },
    },
  },
  scales: {
    x: {
      stacked: true,
      grid: {
        display: false,
      },
    },
    y: {
      stacked: true,
      beginAtZero: true,
      title: {
        display: true,
        text: 'Customers',
      },
    },
  },
}
</script>

<template>
  <div class="h-[250px] w-full">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>
