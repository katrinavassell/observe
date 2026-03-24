<script setup lang="ts">
import { computed } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { getModels } from '@/lib/api'
import { Cpu, AlertCircle, Plug, FlaskConical } from 'lucide-vue-next'
import { useDemoMode } from '@/composables/useDemoMode'
import MarginBadge from '@/components/shared/MarginBadge.vue'
import { Skeleton, Button, Card, CardContent } from '@/components/ui'
import { formatCurrency } from '@/lib/format'

const router = useRouter()
const queryClient = useQueryClient()
const { enterDemoMode, isLoadingDemo } = useDemoMode()

const { data: models, isLoading, isError } = useQuery({
  queryKey: ['models'],
  queryFn: getModels,
})

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString()
}

const providerColors: Record<string, string> = {
  openai: 'bg-emerald-100 text-emerald-700',
  anthropic: 'bg-orange-100 text-orange-700',
  google: 'bg-blue-100 text-blue-700',
}

const providerBarColors: Record<string, string> = {
  openai: '#059669',
  anthropic: '#ea580c',
  google: '#2563eb',
}

function providerClass(provider: string | null) {
  if (!provider) return 'bg-gray-100 text-gray-600'
  return providerColors[provider.toLowerCase()] || 'bg-gray-100 text-gray-600'
}

function providerBarColor(provider: string | null) {
  if (!provider) return '#9ca3af'
  return providerBarColors[provider.toLowerCase()] || '#9ca3af'
}

const costByProvider = computed(() => {
  if (!models.value || models.value.length === 0) return []
  const map: Record<string, number> = {}
  for (const m of models.value) {
    const key = m.model_provider || 'unknown'
    map[key] = (map[key] || 0) + m.total_cost
  }
  const total = Object.values(map).reduce((s, v) => s + v, 0)
  if (total === 0) return []
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([provider, cost]) => ({
      provider,
      cost,
      pct: (cost / total) * 100,
      color: providerBarColor(provider === 'unknown' ? null : provider),
    }))
})

function goToModel(model: string) {
  router.push({ path: '/events', query: { model } })
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

    <!-- Cost by Provider Chart -->
    <div v-if="costByProvider.length > 0" class="rounded-lg border bg-card p-4">
      <div class="text-xs text-muted-foreground mb-2">Cost by Provider</div>
      <div class="flex h-5 w-full rounded-full overflow-hidden bg-muted">
        <div
          v-for="p in costByProvider"
          :key="p.provider"
          :style="{ width: `${p.pct}%`, backgroundColor: p.color }"
          class="h-full transition-all"
          :title="`${p.provider}: ${formatCurrency(p.cost)} (${p.pct.toFixed(1)}%)`"
        />
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        <div v-for="p in costByProvider" :key="p.provider" class="flex items-center gap-1.5 text-xs">
          <span class="inline-block w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: p.color }" />
          <span class="capitalize">{{ p.provider }}</span>
          <span class="text-muted-foreground">{{ formatCurrency(p.cost) }}</span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="space-y-4">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div v-for="i in 4" :key="i" class="rounded-lg border bg-card p-4">
          <Skeleton class="h-3 w-20 mb-2" />
          <Skeleton class="h-7 w-16" />
        </div>
      </div>
      <Card>
        <CardContent class="py-6 space-y-3">
          <Skeleton v-for="i in 5" :key="i" class="h-10 w-full" />
        </CardContent>
      </Card>
    </div>
    <!-- Error -->
    <div v-else-if="isError" class="flex flex-col items-center justify-center py-24 text-center">
      <AlertCircle class="h-10 w-10 text-muted-foreground mb-4" />
      <p class="text-muted-foreground mb-4">Failed to load model data.</p>
      <Button @click="queryClient.invalidateQueries({ queryKey: ['models'] })">Try Again</Button>
    </div>
    <!-- Empty -->
    <div v-else-if="!models || models.length === 0" class="flex flex-col items-center justify-center py-16 text-center">
      <Cpu class="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p class="text-muted-foreground mb-4">Models appear when you connect an AI provider (OpenAI, Anthropic) or send events via the SDK with a model field.</p>
      <div class="flex gap-3">
        <Button :disabled="isLoadingDemo" @click="enterDemoMode">
          <FlaskConical class="h-4 w-4 mr-2" />
          {{ isLoadingDemo ? 'Loading...' : 'Try Demo' }}
        </Button>
        <Button variant="outline" @click="router.push('/data-sources')">
          <Plug class="h-4 w-4 mr-2" />
          Import Data
        </Button>
      </div>
    </div>
    <!-- Table -->
    <div v-else class="rounded-lg border bg-card overflow-hidden">
      <div class="overflow-x-auto">
      <table class="w-full text-sm">
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
          <tr v-for="m in models" :key="m.model" class="hover:bg-muted/50 transition-colors cursor-pointer" @click="goToModel(m.model)">
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
            <td class="px-4 py-3 text-right tabular-nums text-xs">{{ formatCurrency(m.total_cost) }}</td>
            <td class="px-4 py-3 text-right tabular-nums text-xs">{{ formatCurrency(m.avg_cost_per_event) }}</td>
            <td class="px-4 py-3 text-right tabular-nums text-xs">{{ formatCurrency(m.total_revenue) }}</td>
            <td class="px-4 py-3 text-right">
              <MarginBadge :margin="m.margin_pct" />
            </td>
            <td class="px-4 py-3 text-right text-muted-foreground text-xs">{{ formatDate(m.last_seen) }}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  </div>
</template>
