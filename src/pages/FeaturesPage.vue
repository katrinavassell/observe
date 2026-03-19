<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { getFeatures } from '@/lib/api'
import { Layers, TrendingDown, TrendingUp, Minus, ChevronRight } from 'lucide-vue-next'
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

function marginBand(margin: number | null): 'negative' | 'low' | 'profitable' | 'high' | 'unknown' {
  if (margin === null) return 'unknown'
  if (margin < 0) return 'negative'
  if (margin < 30) return 'low'
  if (margin < 70) return 'profitable'
  return 'high'
}

const bandConfig = {
  negative: { label: 'Negative', bg: 'bg-red-50 border-red-200', header: 'bg-red-100 text-red-700', icon: TrendingDown, iconClass: 'text-red-600' },
  low: { label: 'Low (0–30%)', bg: 'bg-yellow-50 border-yellow-200', header: 'bg-yellow-100 text-yellow-700', icon: Minus, iconClass: 'text-yellow-600' },
  profitable: { label: 'Profitable (30–70%)', bg: 'bg-green-50 border-green-200', header: 'bg-green-100 text-green-700', icon: TrendingUp, iconClass: 'text-green-600' },
  high: { label: 'High Margin (70%+)', bg: 'bg-emerald-50 border-emerald-200', header: 'bg-emerald-100 text-emerald-700', icon: TrendingUp, iconClass: 'text-emerald-600' },
  unknown: { label: 'No Data', bg: 'bg-muted/30 border-border', header: 'bg-muted text-muted-foreground', icon: Minus, iconClass: 'text-muted-foreground' },
}

const featuresByBand = computed(() => {
  if (!features.value) return {}
  const result: Record<string, typeof features.value> = {
    negative: [], low: [], profitable: [], high: [], unknown: [],
  }
  for (const f of features.value) {
    result[marginBand(f.margin_pct)].push(f)
  }
  return result
})

const orderedBands = ['negative', 'low', 'profitable', 'high', 'unknown'] as const

function goToDetail(key: string) {
  router.push(`/features/${key}`)
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Features</h1>
      <p class="text-sm text-muted-foreground mt-1">Per-feature cost, revenue, and margin economics</p>
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

    <!-- Loading / Error / Empty -->
    <div v-if="isLoading" class="p-8 text-center text-muted-foreground text-sm">Loading features…</div>
    <div v-else-if="isError" class="p-8 text-center text-destructive text-sm">Failed to load features.</div>
    <div v-else-if="!features || features.length === 0" class="p-12 text-center text-muted-foreground text-sm">
      <Layers class="h-10 w-10 mx-auto mb-3 opacity-30" />
      No feature data yet. Load sample data to see feature economics.
    </div>

    <!-- Card grid grouped by margin band -->
    <template v-else>
      <template v-for="band in orderedBands" :key="band">
        <div v-if="featuresByBand[band] && featuresByBand[band].length > 0">
          <!-- Band header -->
          <div class="flex items-center gap-2 mb-3">
            <component :is="bandConfig[band].icon" :class="['h-4 w-4', bandConfig[band].iconClass]" />
            <span class="text-sm font-medium text-foreground">{{ bandConfig[band].label }}</span>
            <span class="text-xs text-muted-foreground">({{ featuresByBand[band].length }})</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <div
              v-for="f in featuresByBand[band]"
              :key="f.feature_key"
              :class="['rounded-lg border p-4 cursor-pointer hover:shadow-sm transition-shadow', bandConfig[band].bg]"
              @click="goToDetail(f.feature_key)"
            >
              <!-- Card header -->
              <div class="flex items-start justify-between mb-3">
                <span class="font-mono text-sm font-semibold bg-white/60 px-2 py-0.5 rounded border border-black/5 truncate max-w-[180px]">
                  {{ f.feature_key }}
                </span>
                <MarginBadge :margin="f.margin_pct" />
              </div>

              <!-- Cost / Revenue row -->
              <div class="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <div class="text-[11px] text-muted-foreground">Cost</div>
                  <div class="text-base font-semibold">{{ formatCurrency(f.total_cost) }}</div>
                </div>
                <div>
                  <div class="text-[11px] text-muted-foreground">Revenue</div>
                  <div class="text-base font-semibold">{{ formatCurrency(f.total_revenue) }}</div>
                </div>
              </div>

              <!-- Footer stats -->
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>{{ f.event_count.toLocaleString() }} events · {{ f.customer_count }} customers</span>
                <ChevronRight class="h-3.5 w-3.5 shrink-0" />
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
