<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { getFeatures } from '@/lib/api'
import { Layers } from 'lucide-vue-next'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui'

const router = useRouter()

const { data: features, isLoading, isError } = useQuery({
  queryKey: ['features'],
  queryFn: getFeatures,
})

function formatCurrency(val: number) {
  if (val === 0) return '$0.00'
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`
  if (val >= 0.01) return `$${val.toFixed(2)}`
  const formatted = val.toFixed(4)
  const trimmed = formatted.replace(/0+$/, '')
  return `$${trimmed.endsWith('.') ? trimmed + '00' : trimmed}`
}

function marginBand(margin: number | null): 'negative' | 'low' | 'profitable' | 'high' | 'unknown' {
  if (margin === null) return 'unknown'
  if (margin < 0) return 'negative'
  if (margin < 30) return 'low'
  if (margin < 70) return 'profitable'
  return 'high'
}

const bandConfig = {
  high: { label: 'High Margin (70%+)' },
  profitable: { label: 'Profitable (30–70%)' },
  low: { label: 'Low Margin (0–30%)' },
  negative: { label: 'Negative Margin' },
  unknown: { label: 'No Data' },
}

const orderedBands = ['high', 'profitable', 'low', 'negative', 'unknown'] as const

const featuresByBand = computed(() => {
  if (!features.value) return {}
  const result: Record<string, typeof features.value> = {
    high: [], profitable: [], low: [], negative: [], unknown: [],
  }
  for (const f of features.value) {
    result[marginBand(f.margin_pct)].push(f)
  }
  for (const band of orderedBands) {
    result[band].sort((a, b) => b.total_revenue - a.total_revenue)
  }
  return result
})

const maxRevenue = computed(() => {
  if (!features.value || features.value.length === 0) return 1
  return Math.max(...features.value.map(f => f.total_revenue), 0.01)
})

function formatMargin(margin: number | null) {
  if (margin === null) return '—'
  return `${margin.toFixed(0)}%`
}

function marginColor(margin: number | null) {
  if (margin === null) return 'text-muted-foreground'
  if (margin < 0) return 'text-destructive'
  if (margin < 30) return 'text-warning'
  return 'text-success'
}

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
      <div class="rounded-lg border bg-card p-4 shadow-sm">
        <div class="text-xs text-muted-foreground mb-1">Total Features</div>
        <div class="text-2xl font-semibold tabular-nums">{{ features.length }}</div>
      </div>
      <div class="rounded-lg border bg-card p-4 shadow-sm">
        <div class="text-xs text-muted-foreground mb-1">Total Cost</div>
        <div class="text-2xl font-semibold tabular-nums">{{ formatCurrency(features.reduce((s, f) => s + f.total_cost, 0)) }}</div>
      </div>
      <div class="rounded-lg border bg-card p-4 shadow-sm">
        <div class="text-xs text-muted-foreground mb-1">Total Revenue</div>
        <div class="text-2xl font-semibold tabular-nums">{{ formatCurrency(features.reduce((s, f) => s + f.total_revenue, 0)) }}</div>
      </div>
      <div class="rounded-lg border bg-card p-4 shadow-sm">
        <div class="text-xs text-muted-foreground mb-1">Negative Margin</div>
        <div class="text-2xl font-semibold text-destructive tabular-nums">
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

    <!-- Feature List by Band -->
    <Card v-else>
      <CardHeader>
        <CardTitle class="text-base">Revenue by Feature</CardTitle>
      </CardHeader>
      <CardContent class="space-y-8 pb-6">
        <template v-for="band in orderedBands" :key="band">
          <div v-if="featuresByBand[band] && featuresByBand[band].length > 0">
            <h3 class="text-sm font-semibold text-muted-foreground mb-3 px-1">
              {{ bandConfig[band].label }}
            </h3>
            <div class="space-y-1">
              <div
                v-for="f in featuresByBand[band]"
                :key="f.feature_key"
                class="flex items-center gap-4 hover:bg-muted/50 transition-colors rounded-md px-2 py-2.5 cursor-pointer -mx-2"
                @click="goToDetail(f.feature_key)"
              >
                <div class="w-32 sm:w-48 font-medium text-sm truncate">{{ f.feature_key }}</div>
                
                <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden hidden sm:block">
                  <div
                    class="h-full bg-foreground rounded-full"
                    :style="{ width: `${(f.total_revenue / maxRevenue) * 100}%` }"
                  />
                </div>
                
                <div class="flex items-center gap-4 sm:gap-8 justify-end ml-auto">
                  <div class="text-right w-16 sm:w-20">
                    <div class="text-sm font-semibold tabular-nums">{{ formatCurrency(f.total_revenue) }}</div>
                    <div class="text-[10px] sm:text-xs text-muted-foreground">Revenue</div>
                  </div>
                  <div class="text-right w-16 sm:w-20">
                    <div class="text-sm font-semibold tabular-nums">{{ formatCurrency(f.total_cost) }}</div>
                    <div class="text-[10px] sm:text-xs text-muted-foreground">Cost</div>
                  </div>
                  <div class="text-right w-12 sm:w-16">
                    <div :class="['text-sm font-semibold tabular-nums', marginColor(f.margin_pct)]">
                      {{ formatMargin(f.margin_pct) }}
                    </div>
                    <div class="text-[10px] sm:text-xs text-muted-foreground">Margin</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </CardContent>
    </Card>
  </div>
</template>
