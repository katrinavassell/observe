<script setup lang="ts">
import { computed } from "vue";
import { Bar } from "vue-chartjs";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type TooltipItem,
} from "chart.js";
import { formatCurrency as fmt } from "@/lib/format";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
);

const props = defineProps<{
  data: Array<{
    day: string;
    cost: number;
    revenue: number;
    event_count: number;
  }>;
}>();

const COST_COLOR = "rgb(239, 68, 68)"; // red-500
const REVENUE_COLOR = "rgb(99, 102, 241)"; // indigo-500

const chartData = computed(() => ({
  labels: props.data.map((d) => {
    const date = new Date(d.day);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }),
  datasets: [
    {
      label: "Revenue",
      data: props.data.map((d) => d.revenue),
      backgroundColor: REVENUE_COLOR,
      borderColor: REVENUE_COLOR,
    },
    {
      label: "Cost",
      data: props.data.map((d) => d.cost),
      backgroundColor: COST_COLOR,
      borderColor: COST_COLOR,
    },
  ],
}));

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: "index" as const,
    intersect: false,
  },
  plugins: {
    legend: {
      display: true,
      position: "top" as const,
      labels: { usePointStyle: true, padding: 20 },
    },
    tooltip: {
      callbacks: {
        label: (ctx: TooltipItem<"bar">) => {
          const v = ctx.parsed.y ?? 0;
          return `${ctx.dataset.label || ""}: ${fmt(v)}`;
        },
      },
    },
  },
  scales: {
    x: {
      grid: { display: false },
    },
    y: {
      beginAtZero: true,
      ticks: {
        callback: (value: number | string) => {
          const n = typeof value === "string" ? parseFloat(value) : value;
          return fmt(n);
        },
      },
    },
  },
}));
</script>

<template>
  <div class="h-[250px] w-full">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>
