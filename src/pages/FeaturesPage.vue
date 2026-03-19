<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { getFeatures } from '@/lib/api'
import { Layers, ChevronRight, TrendingDown } from 'lucide-vue-next'
import MarginBadge from '@/components/shared/MarginBadge.vue'

const router = useRouter()

const { data: features, isLoading, isError } = useQuery({
  queryKey: ['features'],
  queryFn: getFeatures,
})

function formatCurrency(val: number) {
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`
  if (val >= 1) return `$${val.toFixed(2)}`
  return `$${val.toFixed(4)}`
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString()
}

function goToDetail(key: string) {
  router.push(`/features/${key}`)
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Features</h1>
      <p class="text-sm text-muted-foreground mt-1">Per-feature cost, revenue and margin economics</p>
    </div>

    <!-- Summary strip -->
    <div v-if="features && features.length > 0" class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs text-muted-foreground mb-1">Total Features</div>
        <div class="text-2xl font-semibold">{{ features.length }}</div>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs text-muted-foreground mb-1">Total Cost</div>
        <div class="text-2xl font-semibold">{{ formatCurrency(features.reduce((s, f) => s + f.total_cost, 0)) }}</div>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs text-muted-foreground mb-1">Total Revenue</div>
        <div class="text-2xl font-semibold">{{ formatCurrency(features.reduce((s, f) => s + f.total_revenue, 0)) }}</div>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs text-muted-foreground mb-1">Negative Margin</div>
        <div class="text-2xl font-semibold text-red-600">
          {{ features.filter(f => f.margin_pct !== null && f.margin_pct < 0).length }}
        </div>
      </div>
    </div>

    <!-- Negative margin alert -->
    <div
      v-if="features && features.some(f => f.margin_pct !== null && f.margin_pct < 0)"
      class="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm"
    >
      <TrendingDown class="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
      <div>
        <span class="font-medium text-red-700">Negative-margin features detected.</span>
        <span class="text-red-600"> These features cost more to serve than they earn. Click a row to investigate.</span>
      </div>
    </div>

    <!-- Table -->
    <div class="rounded-lg border bg-card overflow-hidden">
      <div v-if="isLoading" class="p-8 text-center text-muted-foreground text-sm">Loading features…</div>
      <div v-else-if="isError" class="p-8 text-center text-destructive text-sm">Failed to load features.</div>
      <div v-else-if="!features || features.length === 0" class="p-8 text-center text-muted-foreground text-sm">
        <Layers class="h-8 w-8 mx-auto mb-2 opacity-40" />
        No feature data yet. Load sample data to see feature economics.
      </div>
      <table v-else class="w-full text-sm">
        <thead class="bg-muted/50 text-muted-foreground">
          <tr>
            <th class="px-4 py-3 text-left font-medium">Feature</th>
            <th class="px-4 py-3 text-right font-medium">Events</th>
            <th class="px-4 py-3 text-right font-medium">Customers</th>
            <th class="px-4 py-3 text-right font-medium">Total Cost</th>
            <th class="px-4 py-3 text-right font-medium">Total Revenue</th>
            <th class="px-4 py-3 text-right font-medium">Margin</th>
            <th class="px-4 py-3 text-right font-medium">Last Event</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody class="divide-y">
          <tr
            v-for="f in features"
            :key="f.feature_key"
            class="hover:bg-muted/30 transition-colors cursor-pointer"
            @click="goToDetail(f.feature_key)"
          >
            <td class="px-4 py-3">
              <span class="font-mono text-xs bg-muted px-2 py-0.5 rounded">{{ f.feature_key }}</span>
            </td>
            <td class="px-4 py-3 text-right text-muted-foreground">{{ f.event_count.toLocaleString() }}</td>
            <td class="px-4 py-3 text-right text-muted-foreground">{{ f.customer_count }}</td>
            <td class="px-4 py-3 text-right font-mono text-xs">{{ formatCurrency(f.total_cost) }}</td>
            <td class="px-4 py-3 text-right font-mono text-xs">{{ formatCurrency(f.total_revenue) }}</td>
            <td class="px-4 py-3 text-right">
              <MarginBadge :margin="f.margin_pct" />
            </td>
            <td class="px-4 py-3 text-right text-muted-foreground text-xs">{{ formatDate(f.last_seen) }}</td>
            <td class="px-4 py-3 text-right">
              <ChevronRight class="h-4 w-4 text-muted-foreground ml-auto" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
