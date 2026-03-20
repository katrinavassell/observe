<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { getCustomerDetail } from '@/lib/api'
import { ArrowLeft, ChevronRight } from 'lucide-vue-next'
import MarginBadge from '@/components/shared/MarginBadge.vue'
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

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const route = useRoute()
const router = useRouter()

const customerId = computed(() => route.params.id as string)

const { data: detail, isLoading, isError } = useQuery({
  queryKey: ['customer-detail', customerId],
  queryFn: () => getCustomerDetail(customerId.value),
  enabled: computed(() => !!customerId.value),
})

const featureCostChartData = computed(() => {
  if (!detail.value || detail.value.by_feature.length === 0) return null
  const top = detail.value.by_feature.slice(0, 8)
  return {
    labels: top.map(f => f.feature_key),
    datasets: [
      {
        label: 'Cost',
        data: top.map(f => f.total_cost),
        backgroundColor: 'rgba(239, 68, 68, 0.7)',
      },
      {
        label: 'Revenue',
        data: top.map(f => f.total_revenue),
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

function formatCurrency(val: number) {
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`
  if (val >= 1) return `$${val.toFixed(2)}`
  return `$${val.toFixed(4)}`
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function marginForEvent(cost: number | null, revenue: number | null): number | null {
  if (!revenue || !cost) return null
  return Math.round(((revenue - cost) / revenue) * 100)
}

function activeSub() {
  return detail.value?.subscriptions.find(s => s.is_active)
}

function mrr() {
  const sub = activeSub()
  if (!sub) return 0
  return sub.mrr_override ?? sub.price_amount ?? 0
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <button
        class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"
        @click="router.push('/customers')"
      >
        <ArrowLeft class="h-3.5 w-3.5" /> Back to Customers
      </button>

      <div v-if="isLoading" class="text-muted-foreground text-sm">Loading customer…</div>
      <div v-else-if="isError" class="text-destructive text-sm">Failed to load customer data.</div>

      <template v-else-if="detail">
        <div class="flex items-start justify-between">
          <div>
            <h1 class="text-2xl font-semibold tracking-tight">{{ detail.customer.name }}</h1>
            <div class="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span v-if="detail.customer.email">{{ detail.customer.email }}</span>
              <span v-if="detail.customer.segment" class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">
                {{ detail.customer.segment }}
              </span>
              <span class="font-mono text-xs">{{ detail.customer.customer_id }}</span>
            </div>
          </div>
          <MarginBadge :margin="detail.margin_pct" />
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <div class="rounded-lg border bg-card p-4">
            <div class="text-xs text-muted-foreground mb-1">MRR</div>
            <div class="text-2xl font-semibold">${{ mrr().toLocaleString() }}</div>
          </div>
          <div class="rounded-lg border bg-card p-4">
            <div class="text-xs text-muted-foreground mb-1">Feature Cost</div>
            <div class="text-2xl font-semibold">{{ formatCurrency(detail.total_cost) }}</div>
          </div>
          <div class="rounded-lg border bg-card p-4">
            <div class="text-xs text-muted-foreground mb-1">Feature Revenue</div>
            <div class="text-2xl font-semibold">{{ formatCurrency(detail.total_revenue) }}</div>
          </div>
          <div class="rounded-lg border bg-card p-4">
            <div class="text-xs text-muted-foreground mb-1">Events</div>
            <div class="text-2xl font-semibold">{{ detail.recent_events.length }}+</div>
          </div>
        </div>

        <!-- Plan info -->
        <div v-if="activeSub()" class="rounded-lg border bg-card p-4 flex items-center gap-4 text-sm">
          <div>
            <span class="text-muted-foreground">Plan: </span>
            <span class="font-medium">{{ activeSub()?.plan_name || activeSub()?.plan_id }}</span>
          </div>
          <div>
            <span class="text-muted-foreground">Billing: </span>
            <span class="font-medium">${{ activeSub()?.price_amount }}/mo</span>
          </div>
          <div class="ml-auto">
            <span class="inline-flex items-center rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">Active</span>
          </div>
        </div>

        <!-- Feature cost chart -->
        <div v-if="featureCostChartData" class="rounded-lg border bg-card p-4">
          <div class="text-sm font-medium mb-4">Cost vs Revenue by Feature</div>
          <div style="height: 220px;">
            <Bar :data="featureCostChartData" :options="chartOptions" />
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Feature Usage -->
          <div class="rounded-lg border bg-card overflow-hidden">
            <div class="px-4 py-3 border-b bg-muted/30 text-sm font-medium">Feature Usage</div>
            <div v-if="detail.by_feature.length === 0" class="px-4 py-6 text-center text-muted-foreground text-sm">
              No feature events for this customer yet
            </div>
            <table v-else class="w-full text-sm">
              <thead class="text-muted-foreground">
                <tr>
                  <th class="px-4 py-2.5 text-left font-medium">Feature</th>
                  <th class="px-4 py-2.5 text-right font-medium">Events</th>
                  <th class="px-4 py-2.5 text-right font-medium">Cost</th>
                  <th class="px-4 py-2.5 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr
                  v-for="f in detail.by_feature"
                  :key="f.feature_key"
                  class="hover:bg-muted/30 cursor-pointer"
                  @click="router.push(`/features/${f.feature_key}`)"
                >
                  <td class="px-4 py-2.5">
                    <div class="flex items-center gap-1">
                      <span class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{{ f.feature_key }}</span>
                      <ChevronRight class="h-3 w-3 text-muted-foreground" />
                    </div>
                  </td>
                  <td class="px-4 py-2.5 text-right text-muted-foreground">{{ f.event_count }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums text-xs">{{ formatCurrency(f.total_cost) }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums text-xs">{{ formatCurrency(f.total_revenue) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Recent Events -->
          <div class="rounded-lg border bg-card overflow-hidden">
            <div class="px-4 py-3 border-b bg-muted/30 text-sm font-medium">Recent Events</div>
            <div v-if="detail.recent_events.length === 0" class="px-4 py-6 text-center text-muted-foreground text-sm">
              No events recorded
            </div>
            <table v-else class="w-full text-sm">
              <thead class="text-muted-foreground">
                <tr>
                  <th class="px-4 py-2.5 text-left font-medium">Time</th>
                  <th class="px-4 py-2.5 text-left font-medium">Feature</th>
                  <th class="px-4 py-2.5 text-right font-medium">Cost</th>
                  <th class="px-4 py-2.5 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr v-for="ev in detail.recent_events" :key="ev.id" class="hover:bg-muted/30">
                  <td class="px-4 py-2 text-muted-foreground text-xs whitespace-nowrap">{{ formatDate(ev.timestamp) }}</td>
                  <td class="px-4 py-2">
                    <button
                      v-if="ev.feature_key"
                      class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded hover:bg-muted/80"
                      @click.stop="router.push(`/features/${ev.feature_key}`)"
                    >
                      {{ ev.feature_key }}
                    </button>
                    <span v-else class="text-muted-foreground text-xs">—</span>
                  </td>
                  <td class="px-4 py-2 text-right tabular-nums text-xs">{{ ev.cost_amount !== null ? `$${ev.cost_amount.toFixed(4)}` : '—' }}</td>
                  <td class="px-4 py-2 text-right">
                    <MarginBadge :margin="marginForEvent(ev.cost_amount, ev.revenue_amount)" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
