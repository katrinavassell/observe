<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { getModels } from '@/lib/api'
import { Cpu } from 'lucide-vue-next'
import MarginBadge from '@/components/shared/MarginBadge.vue'

const { data: models, isLoading, isError } = useQuery({
  queryKey: ['models'],
  queryFn: getModels,
})

function formatCurrency(val: number) {
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`
  if (val >= 1) return `$${val.toFixed(2)}`
  return `$${val.toFixed(4)}`
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString()
}

const providerColors: Record<string, string> = {
  openai: 'bg-emerald-100 text-emerald-700',
  anthropic: 'bg-orange-100 text-orange-700',
  google: 'bg-blue-100 text-blue-700',
}

function providerClass(provider: string | null) {
  if (!provider) return 'bg-gray-100 text-gray-600'
  return providerColors[provider.toLowerCase()] || 'bg-gray-100 text-gray-600'
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Models</h1>
      <p class="text-sm text-muted-foreground mt-1">Cost and margin breakdown by AI model</p>
    </div>

    <!-- Summary -->
    <div v-if="models && models.length > 0" class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs text-muted-foreground mb-1">Models Tracked</div>
        <div class="text-2xl font-semibold">{{ models.length }}</div>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs text-muted-foreground mb-1">Total Cost</div>
        <div class="text-2xl font-semibold">{{ formatCurrency(models.reduce((s, m) => s + m.total_cost, 0)) }}</div>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs text-muted-foreground mb-1">Total Revenue</div>
        <div class="text-2xl font-semibold">{{ formatCurrency(models.reduce((s, m) => s + m.total_revenue, 0)) }}</div>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs text-muted-foreground mb-1">Total Events</div>
        <div class="text-2xl font-semibold">{{ models.reduce((s, m) => s + m.event_count, 0).toLocaleString() }}</div>
      </div>
    </div>

    <!-- Table -->
    <div class="rounded-lg border bg-card overflow-hidden">
      <div v-if="isLoading" class="p-8 text-center text-muted-foreground text-sm">Loading model data…</div>
      <div v-else-if="isError" class="p-8 text-center text-destructive text-sm">Failed to load model data.</div>
      <div v-else-if="!models || models.length === 0" class="p-8 text-center text-muted-foreground text-sm">
        <Cpu class="h-8 w-8 mx-auto mb-2 opacity-40" />
        No model data yet. Load sample data or connect an integration.
      </div>
      <table v-else class="w-full text-sm">
        <thead class="bg-muted/50 text-muted-foreground">
          <tr>
            <th class="px-4 py-3 text-left font-medium">Model</th>
            <th class="px-4 py-3 text-left font-medium">Provider</th>
            <th class="px-4 py-3 text-right font-medium">Events</th>
            <th class="px-4 py-3 text-right font-medium">Customers</th>
            <th class="px-4 py-3 text-right font-medium">Features</th>
            <th class="px-4 py-3 text-right font-medium">Total Cost</th>
            <th class="px-4 py-3 text-right font-medium">Avg Cost/Event</th>
            <th class="px-4 py-3 text-right font-medium">Total Revenue</th>
            <th class="px-4 py-3 text-right font-medium">Margin</th>
            <th class="px-4 py-3 text-right font-medium">Last Seen</th>
          </tr>
        </thead>
        <tbody class="divide-y">
          <tr v-for="m in models" :key="m.model" class="hover:bg-muted/30 transition-colors">
            <td class="px-4 py-3">
              <span class="font-mono text-xs bg-muted px-2 py-0.5 rounded">{{ m.model }}</span>
            </td>
            <td class="px-4 py-3">
              <span
                v-if="m.model_provider"
                :class="['inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', providerClass(m.model_provider)]"
              >
                {{ m.model_provider }}
              </span>
              <span v-else class="text-muted-foreground">—</span>
            </td>
            <td class="px-4 py-3 text-right text-muted-foreground">{{ m.event_count.toLocaleString() }}</td>
            <td class="px-4 py-3 text-right text-muted-foreground">{{ m.customer_count }}</td>
            <td class="px-4 py-3 text-right text-muted-foreground">{{ m.feature_count }}</td>
            <td class="px-4 py-3 text-right font-mono text-xs">{{ formatCurrency(m.total_cost) }}</td>
            <td class="px-4 py-3 text-right font-mono text-xs">{{ formatCurrency(m.avg_cost_per_event) }}</td>
            <td class="px-4 py-3 text-right font-mono text-xs">{{ formatCurrency(m.total_revenue) }}</td>
            <td class="px-4 py-3 text-right">
              <MarginBadge :margin="m.margin_pct" />
            </td>
            <td class="px-4 py-3 text-right text-muted-foreground text-xs">{{ formatDate(m.last_seen) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
