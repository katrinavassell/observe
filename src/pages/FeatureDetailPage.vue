<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { getFeatureDetail } from '@/lib/api'
import { formatCurrency } from '@/lib/format'
import { ArrowLeft, ChevronRight, AlertCircle } from 'lucide-vue-next'
import MarginBadge from '@/components/shared/MarginBadge.vue'
import { Bar, Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend)

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()

const featureKey = computed(() => route.params.key as string)

const { data: feature, isLoading, isError } = useQuery({
  queryKey: ['feature', featureKey],
  queryFn: () => getFeatureDetail(featureKey.value),
  enabled: computed(() => !!featureKey.value),
})

const chartData = computed(() => {
  if (!feature.value || feature.value.by_customer.length === 0) return null
  const top = feature.value.by_customer.slice(0, 8)
  return {
    labels: top.map(c => c.customer_name || c.customer_id),
    datasets: [
      {
        label: 'Cost',
        data: top.map(c => c.total_cost),
        backgroundColor: 'rgba(239, 68, 68, 0.7)',
      },
      {
        label: 'Revenue',
        data: top.map(c => c.total_revenue),
        backgroundColor: 'rgba(34, 197, 94, 0.7)',
      },
    ],
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y' as const,
  plugins: {
    legend: { position: 'top' as const },
    title: { display: false },
  },
  scales: {
    x: { beginAtZero: true },
  },
}

const timeseriesChartData = computed(() => {
  if (!feature.value || feature.value.timeseries.length === 0) return null
  const months = feature.value.timeseries
  return {
    labels: months.map(m => new Date(m.month).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })),
    datasets: [
      {
        label: 'Cost',
        data: months.map(m => m.total_cost),
        borderColor: 'rgba(239, 68, 68, 0.9)',
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
        tension: 0.3,
        fill: true,
      },
      {
        label: 'Revenue',
        data: months.map(m => m.total_revenue),
        borderColor: 'rgba(34, 197, 94, 0.9)',
        backgroundColor: 'rgba(34, 197, 94, 0.15)',
        tension: 0.3,
        fill: true,
      },
    ],
  }
})

const timeseriesOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'top' as const },
  },
  scales: {
    y: { beginAtZero: true },
  },
}


function formatDate(ts: string) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function marginForEvent(cost: number | null, revenue: number | null): number | null {
  if (!revenue || !cost) return null
  return Math.round(((revenue - cost) / revenue) * 100)
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <button
        class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"
        @click="router.push('/features')"
      >
        <ArrowLeft class="h-3.5 w-3.5" /> Back to Features
      </button>
      <div class="flex items-start justify-between">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <span class="font-mono text-xl bg-muted px-2 py-0.5 rounded">{{ featureKey }}</span>
          </h1>
          <p class="text-sm text-muted-foreground mt-1">Feature cost and revenue breakdown</p>
        </div>
        <MarginBadge v-if="feature" :margin="feature.margin_pct" />
      </div>
    </div>

    <div v-if="isLoading" class="p-8 text-center text-muted-foreground text-sm">Loading feature data…</div>
    <div v-else-if="isError" class="flex flex-col items-center justify-center py-16 text-center">
      <AlertCircle class="h-10 w-10 text-muted-foreground mb-4" />
      <p class="text-muted-foreground mb-4">Failed to load feature data.</p>
      <button
        class="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="queryClient.invalidateQueries({ queryKey: ['feature', featureKey] })"
      >Try Again</button>
    </div>

    <template v-else-if="feature">
      <!-- Stats -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-1">Events</div>
          <div class="text-2xl font-semibold">{{ feature.event_count.toLocaleString() }}</div>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-1">Total Cost</div>
          <div class="text-2xl font-semibold">{{ formatCurrency(feature.total_cost) }}</div>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-1">Total Revenue</div>
          <div class="text-2xl font-semibold">{{ formatCurrency(feature.total_revenue) }}</div>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div class="text-xs text-muted-foreground mb-1">Customers</div>
          <div class="text-2xl font-semibold">{{ feature.customer_count }}</div>
        </div>
      </div>

      <!-- Chart: Monthly Timeseries -->
      <div v-if="timeseriesChartData" class="rounded-lg border bg-card p-4">
        <div class="text-sm font-medium mb-4">Cost vs Revenue Over Time</div>
        <div style="height: 220px;">
          <Line :data="timeseriesChartData" :options="timeseriesOptions" />
        </div>
      </div>

      <!-- Chart: Cost vs Revenue by Customer -->
      <div v-if="chartData" class="rounded-lg border bg-card p-4">
        <div class="text-sm font-medium mb-4">Cost vs Revenue by Customer</div>
        <div style="height: 240px;">
          <Bar :data="chartData" :options="chartOptions" />
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- By Customer -->
        <div class="rounded-lg border bg-card overflow-hidden">
          <div class="px-4 py-3 border-b bg-muted/30 text-sm font-medium">By Customer</div>
          <table class="w-full text-sm">
            <thead class="text-muted-foreground">
              <tr>
                <th class="px-4 py-2.5 text-left font-medium">Customer</th>
                <th class="px-4 py-2.5 text-right font-medium">Events</th>
                <th class="px-4 py-2.5 text-right font-medium">Cost</th>
                <th class="px-4 py-2.5 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr
                v-for="c in feature.by_customer"
                :key="c.customer_id"
                class="hover:bg-muted/30 cursor-pointer"
                @click="router.push(`/customers/${c.customer_id}`)"
              >
                <td class="px-4 py-2.5 font-medium">
                  <div class="flex items-center gap-1">
                    {{ c.customer_name || c.customer_id }}
                    <ChevronRight class="h-3 w-3 text-muted-foreground" />
                  </div>
                </td>
                <td class="px-4 py-2.5 text-right text-muted-foreground">{{ c.event_count }}</td>
                <td class="px-4 py-2.5 text-right tabular-nums text-xs">{{ formatCurrency(c.total_cost) }}</td>
                <td class="px-4 py-2.5 text-right tabular-nums text-xs">{{ formatCurrency(c.total_revenue) }}</td>
              </tr>
              <tr v-if="feature.by_customer.length === 0">
                <td colspan="4" class="px-4 py-4 text-center text-muted-foreground">No customer data</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- By Model -->
        <div class="rounded-lg border bg-card overflow-hidden">
          <div class="px-4 py-3 border-b bg-muted/30 text-sm font-medium">By Model</div>
          <div v-if="feature.by_model.length === 0" class="px-4 py-6 text-center text-muted-foreground text-sm">
            No model attribution for this feature
          </div>
          <table v-else class="w-full text-sm">
            <thead class="text-muted-foreground">
              <tr>
                <th class="px-4 py-2.5 text-left font-medium">Model</th>
                <th class="px-4 py-2.5 text-right font-medium">Events</th>
                <th class="px-4 py-2.5 text-right font-medium">Cost</th>
                <th class="px-4 py-2.5 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr v-for="m in feature.by_model" :key="m.model">
                <td class="px-4 py-2.5">
                  <div class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded inline-block">{{ m.model }}</div>
                  <div v-if="m.model_provider" class="text-xs text-muted-foreground mt-0.5">{{ m.model_provider }}</div>
                </td>
                <td class="px-4 py-2.5 text-right text-muted-foreground">{{ m.event_count }}</td>
                <td class="px-4 py-2.5 text-right tabular-nums text-xs">{{ formatCurrency(m.total_cost) }}</td>
                <td class="px-4 py-2.5 text-right tabular-nums text-xs">{{ formatCurrency(m.total_revenue) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Recent Events -->
      <div class="rounded-lg border bg-card overflow-hidden">
        <div class="px-4 py-3 border-b bg-muted/30 text-sm font-medium">Recent Events</div>
        <table class="w-full text-sm">
          <thead class="text-muted-foreground bg-muted/20">
            <tr>
              <th class="px-4 py-2.5 text-left font-medium">Timestamp</th>
              <th class="px-4 py-2.5 text-left font-medium">Event</th>
              <th class="px-4 py-2.5 text-left font-medium">Customer</th>
              <th class="px-4 py-2.5 text-left font-medium">Model</th>
              <th class="px-4 py-2.5 text-right font-medium">Cost</th>
              <th class="px-4 py-2.5 text-right font-medium">Revenue</th>
              <th class="px-4 py-2.5 text-right font-medium">Margin</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr v-for="ev in feature.recent_events" :key="ev.id" class="hover:bg-muted/30">
              <td class="px-4 py-2 text-muted-foreground text-xs whitespace-nowrap">{{ formatDate(ev.timestamp) }}</td>
              <td class="px-4 py-2 text-xs">{{ ev.event_name }}</td>
              <td class="px-4 py-2">
                <button
                  v-if="ev.customer_id"
                  class="text-primary hover:underline text-xs"
                  @click="router.push(`/customers/${ev.customer_id}`)"
                >
                  {{ ev.customer_name || ev.customer_id }}
                </button>
                <span v-else class="text-muted-foreground text-xs">—</span>
              </td>
              <td class="px-4 py-2">
                <span v-if="ev.model" class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{{ ev.model }}</span>
                <span v-else class="text-muted-foreground text-xs">—</span>
              </td>
              <td class="px-4 py-2 text-right tabular-nums text-xs">{{ ev.cost_amount !== null ? `$${ev.cost_amount.toFixed(4)}` : '—' }}</td>
              <td class="px-4 py-2 text-right tabular-nums text-xs">{{ ev.revenue_amount !== null ? `$${ev.revenue_amount.toFixed(4)}` : '—' }}</td>
              <td class="px-4 py-2 text-right">
                <MarginBadge :margin="marginForEvent(ev.cost_amount, ev.revenue_amount)" />
              </td>
            </tr>
            <tr v-if="feature.recent_events.length === 0">
              <td colspan="7" class="px-4 py-4 text-center text-muted-foreground">No events recorded</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
