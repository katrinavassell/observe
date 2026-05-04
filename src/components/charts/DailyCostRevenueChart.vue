<script setup lang="ts">
import { computed, ref } from "vue";
import { Button } from "@/components/ui";
import { Chart } from "vue-chartjs";
import {
  Chart as ChartJS,
  BarController,
  LineController,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type TooltipItem,
} from "chart.js";
import { formatCurrency as fmt } from "@/lib/format";

ChartJS.register(
  BarController,
  LineController,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

const props = defineProps<{
  data: Array<{
    day: string;
    cost: number;
    revenue: number;
    event_count: number;
  }>;
}>();

type Granularity = "daily" | "weekly" | "monthly";
const granularity = ref<Granularity>("daily");

const COST_COLOR = "rgb(239, 68, 68)";
const COST_FILL = "rgba(239, 68, 68, 0.08)";
const REVENUE_COLOR = "rgb(99, 102, 241)";
const REVENUE_FILL = "rgba(99, 102, 241, 0.7)";

interface BucketEntry {
  label: string;
  cost: number;
  revenue: number;
}

const bucketedData = computed<BucketEntry[]>(() => {
  if (granularity.value === "daily") {
    return props.data.map((d) => ({
      label: new Date(d.day).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      cost: d.cost,
      revenue: d.revenue,
    }));
  }

  const buckets = new Map<string, { cost: number; revenue: number }>();

  for (const d of props.data) {
    const date = new Date(d.day);
    let key: string;
    if (granularity.value === "weekly") {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      key = weekStart.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } else {
      key = date.toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });
    }
    const bucket = buckets.get(key) ?? { cost: 0, revenue: 0 };
    bucket.cost += d.cost;
    bucket.revenue += d.revenue;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries()).map(([label, vals]) => ({
    label,
    ...vals,
  }));
});

const chartData = computed(() => ({
  labels: bucketedData.value.map((d) => d.label),
  datasets: [
    {
      type: "bar" as const,
      label: "Revenue",
      data: bucketedData.value.map((d) => d.revenue),
      backgroundColor: REVENUE_FILL,
      borderColor: REVENUE_COLOR,
      borderWidth: 1,
      yAxisID: "y",
      order: 2,
    },
    {
      type: "line" as const,
      label: "Cost",
      data: bucketedData.value.map((d) => d.cost),
      borderColor: COST_COLOR,
      backgroundColor: COST_FILL,
      pointBackgroundColor: COST_COLOR,
      pointRadius: 2,
      borderWidth: 2,
      fill: true,
      tension: 0.3,
      yAxisID: "y1",
      order: 1,
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
        label: (ctx: TooltipItem<"bar" | "line">) => {
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
      type: "linear" as const,
      position: "left" as const,
      beginAtZero: true,
      ticks: {
        callback: (value: number | string) => {
          const n = typeof value === "string" ? parseFloat(value) : value;
          return fmt(n);
        },
      },
    },
    y1: {
      type: "linear" as const,
      position: "right" as const,
      beginAtZero: true,
      grid: { drawOnChartArea: false },
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
  <div>
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-base font-semibold">Cost vs Revenue</h3>
      <div class="flex gap-1">
        <Button
          v-for="opt in ['daily', 'weekly', 'monthly'] as const"
          :key="opt"
          size="sm"
          :variant="granularity === opt ? 'default' : 'outline'"
          @click="granularity = opt"
        >
          {{ opt.charAt(0).toUpperCase() + opt.slice(1) }}
        </Button>
      </div>
    </div>
    <div class="h-[250px] w-full">
      <Chart type="bar" :data="chartData" :options="chartOptions" />
    </div>
  </div>
</template>
