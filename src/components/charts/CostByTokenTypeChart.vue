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
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui";
import { formatCurrency as fmt } from "@/lib/format";
import type { CostByTokenTypePoint } from "@/lib/api";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
);

const props = defineProps<{
  series: CostByTokenTypePoint[];
}>();

const INPUT_COLOR = "rgb(59, 130, 246)"; // blue-500
const OUTPUT_COLOR = "rgb(249, 115, 22)"; // orange-500

const totalInput = computed(() =>
  props.series.reduce((s, p) => s + p.input_cost, 0),
);
const totalOutput = computed(() =>
  props.series.reduce((s, p) => s + p.output_cost, 0),
);
const grandTotal = computed(() => totalInput.value + totalOutput.value);

const inputPct = computed(() =>
  grandTotal.value > 0
    ? Math.round((totalInput.value / grandTotal.value) * 100)
    : 0,
);
const outputPct = computed(() =>
  grandTotal.value > 0
    ? Math.round((totalOutput.value / grandTotal.value) * 100)
    : 0,
);

const hasData = computed(() => props.series.length > 0 && grandTotal.value > 0);

const chartData = computed(() => ({
  labels: props.series.map((p) => {
    const d = new Date(p.date);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }),
  datasets: [
    {
      label: "Input",
      data: props.series.map((p) => p.input_cost),
      backgroundColor: INPUT_COLOR,
      borderColor: INPUT_COLOR,
      stack: "cost",
    },
    {
      label: "Output",
      data: props.series.map((p) => p.output_cost),
      backgroundColor: OUTPUT_COLOR,
      borderColor: OUTPUT_COLOR,
      stack: "cost",
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
      stacked: true,
      grid: { display: false },
    },
    y: {
      stacked: true,
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
  <Card>
    <CardHeader class="pb-2">
      <CardTitle class="text-base font-semibold">Cost by Token Type</CardTitle>
    </CardHeader>
    <CardContent>
      <template v-if="hasData">
        <!-- Summary stats -->
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div
              class="flex items-center gap-2 text-xs font-medium text-muted-foreground"
            >
              <span
                class="inline-block h-2 w-2 rounded-full"
                :style="{ backgroundColor: INPUT_COLOR }"
              />
              Input
            </div>
            <div class="text-xl font-semibold tabular-nums mt-1">
              {{ fmt(totalInput) }}
              <span class="text-sm font-normal text-muted-foreground"
                >({{ inputPct }}%)</span
              >
            </div>
          </div>
          <div>
            <div
              class="flex items-center gap-2 text-xs font-medium text-muted-foreground"
            >
              <span
                class="inline-block h-2 w-2 rounded-full"
                :style="{ backgroundColor: OUTPUT_COLOR }"
              />
              Output
            </div>
            <div class="text-xl font-semibold tabular-nums mt-1">
              {{ fmt(totalOutput) }}
              <span class="text-sm font-normal text-muted-foreground"
                >({{ outputPct }}%)</span
              >
            </div>
          </div>
        </div>

        <div class="h-[280px] w-full">
          <Bar :data="chartData" :options="chartOptions" />
        </div>
      </template>

      <div v-else class="py-10 text-center">
        <p class="text-sm font-medium">No data yet</p>
        <p class="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
          Input/output split is captured automatically on new events. Backfill
          existing events from the Data Sources page.
        </p>
      </div>
    </CardContent>
  </Card>
</template>
