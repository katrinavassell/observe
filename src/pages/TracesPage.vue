<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { getTraces, getTrace, type TraceListItem, type TraceDetail, type EventDetail } from '@/lib/api'
import { Activity, ChevronLeft, Clock, DollarSign, Layers } from 'lucide-vue-next'
import { Card, Button, Skeleton, Badge } from '@/components/ui'

const router = useRouter()
const selectedTraceId = ref<string | null>(null)

const { data: tracesData, isLoading: tracesLoading } = useQuery({
  queryKey: ['traces'],
  queryFn: () => getTraces(),
  enabled: computed(() => !selectedTraceId.value),
})

const { data: traceDetail, isLoading: detailLoading } = useQuery({
  queryKey: ['trace', selectedTraceId],
  queryFn: () => getTrace(selectedTraceId.value!),
  enabled: computed(() => !!selectedTraceId.value),
})

function selectTrace(traceId: string) { selectedTraceId.value = traceId }
function backToList() { selectedTraceId.value = null }

function formatDate(ts: string) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}
function formatCost(val: number) {
  if (val === 0) return '$0'
  return `$${val.toFixed(4)}`
}
function formatDuration(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
function costTypeBadgeClass(type: string) {
  switch (type) {
    case 'llm': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    case 'embedding': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
    case 'vector_db': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
    case 'compute': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    case 'api': return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300'
    case 'database': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
    default: return 'bg-muted text-muted-foreground'
  }
}

const spanDepths = computed(() => {
  if (!traceDetail.value) return new Map<string, number>()
  const spans = traceDetail.value.spans
  const depthMap = new Map<string, number>()
  const spanIds = new Set(spans.map(s => s.span_id).filter(Boolean))
  for (const span of spans) {
    if (!span.span_id) continue
    let depth = 0
    let current = span
    while (current.parent_span_id && spanIds.has(current.parent_span_id)) {
      depth++
      current = spans.find(s => s.span_id === current.parent_span_id) || current
      if (current.span_id === span.span_id) break
    }
    depthMap.set(span.span_id, depth)
  }
  return depthMap
})

const maxDuration = computed(() => {
  if (!traceDetail.value) return 1
  return Math.max(...traceDetail.value.spans.map(s => s.duration_ms ?? 0), 1)
})
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <div v-if="selectedTraceId" class="flex items-center gap-2 mb-1">
          <Button variant="ghost" size="sm" class="h-7 px-2" @click="backToList">
            <ChevronLeft class="h-4 w-4" />
          </Button>
          <span class="text-sm text-muted-foreground">Back to traces</span>
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">
          {{ selectedTraceId ? 'Trace Detail' : 'Traces' }}
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
          {{ selectedTraceId ? `Trace ${selectedTraceId}` : 'Multi-step agent execution traces with cost breakdown' }}
        </p>
      </div>
      <div v-if="!selectedTraceId && tracesData?.traces.length" class="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full border">
        <Layers class="h-4 w-4" />
        <span class="font-medium text-foreground">{{ tracesData.traces.length }} traces</span>
      </div>
    </div>

    <!-- LIST VIEW -->
    <template v-if="!selectedTraceId">
      <div v-if="tracesLoading">
        <Card class="p-6">
          <Skeleton class="h-8 w-48 mb-4" />
          <Skeleton v-for="i in 5" :key="i" class="h-12 w-full mb-2" />
        </Card>
      </div>

      <div v-else-if="!tracesData?.traces.length" class="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
        <Activity class="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p class="text-sm font-medium mb-1">No traces yet</p>
        <p class="text-xs text-muted-foreground">
          Use <code class="bg-muted px-1 rounded">Observe.startTrace()</code> or pass <code class="bg-muted px-1 rounded">traceId</code> in SDK events to group multi-step agent flows.
        </p>
      </div>

      <div v-else class="rounded-md border bg-card overflow-hidden">
        <table class="w-full text-sm text-left">
          <thead class="border-b bg-muted/40 text-muted-foreground text-xs font-medium uppercase tracking-wider">
            <tr>
              <th class="px-4 py-3 font-medium">Time</th>
              <th class="px-4 py-3 font-medium">Root Event</th>
              <th class="px-4 py-3 font-medium">Trace ID</th>
              <th class="px-4 py-3 text-right font-medium">Spans</th>
              <th class="px-4 py-3 font-medium">Cost Types</th>
              <th class="px-4 py-3 text-right font-medium">Duration</th>
              <th class="px-4 py-3 text-right font-medium">Cost</th>
              <th class="px-4 py-3 text-right font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="t in tracesData.traces"
              :key="t.trace_id"
              class="border-b last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
              @click="selectTrace(t.trace_id)"
            >
              <td class="px-4 py-3 text-muted-foreground whitespace-nowrap">{{ formatDate(t.start_time) }}</td>
              <td class="px-4 py-3 font-medium">{{ t.root_event }}</td>
              <td class="px-4 py-3">
                <code class="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{{ t.trace_id.slice(0, 12) }}</code>
              </td>
              <td class="px-4 py-3 text-right tabular-nums">{{ t.span_count }}</td>
              <td class="px-4 py-3">
                <div class="flex gap-1 flex-wrap">
                  <span
                    v-for="ct in (t.cost_types || []).filter(Boolean)"
                    :key="ct"
                    class="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    :class="costTypeBadgeClass(ct)"
                  >{{ ct }}</span>
                </div>
              </td>
              <td class="px-4 py-3 text-right tabular-nums text-muted-foreground">{{ formatDuration(t.total_duration_ms) }}</td>
              <td class="px-4 py-3 text-right tabular-nums">{{ formatCost(t.total_cost) }}</td>
              <td class="px-4 py-3 text-right tabular-nums text-muted-foreground">{{ formatCost(t.total_revenue) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- DETAIL VIEW (Waterfall) -->
    <template v-else>
      <div v-if="detailLoading">
        <Card class="p-6">
          <Skeleton class="h-8 w-48 mb-4" />
          <Skeleton v-for="i in 8" :key="i" class="h-10 w-full mb-2" />
        </Card>
      </div>

      <template v-else-if="traceDetail">
        <!-- Summary cards -->
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card class="p-4">
            <div class="text-xs font-medium text-muted-foreground">Spans</div>
            <div class="text-2xl font-semibold tabular-nums mt-1">{{ traceDetail.spans.length }}</div>
          </Card>
          <Card class="p-4">
            <div class="text-xs font-medium text-muted-foreground">Total Cost</div>
            <div class="text-2xl font-semibold tabular-nums mt-1">{{ formatCost(traceDetail.spans.reduce((s, sp) => s + (sp.cost_amount || 0), 0)) }}</div>
          </Card>
          <Card class="p-4">
            <div class="text-xs font-medium text-muted-foreground">Total Revenue</div>
            <div class="text-2xl font-semibold tabular-nums mt-1">{{ formatCost(traceDetail.spans.reduce((s, sp) => s + (sp.revenue_amount || 0), 0)) }}</div>
          </Card>
          <Card class="p-4">
            <div class="text-xs font-medium text-muted-foreground">Duration</div>
            <div class="text-2xl font-semibold tabular-nums mt-1">{{ formatDuration(Math.max(...traceDetail.spans.map(s => s.duration_ms ?? 0))) }}</div>
          </Card>
        </div>

        <!-- Waterfall -->
        <Card class="overflow-hidden">
          <div class="border-b bg-muted/40 px-4 py-2.5 flex items-center gap-3 text-xs text-muted-foreground font-medium uppercase tracking-wider">
            <span class="w-[280px]">Span</span>
            <span class="w-20">Type</span>
            <span class="flex-1">Duration</span>
            <span class="w-20 text-right">Cost</span>
            <span class="w-16 text-right">Model</span>
          </div>
          <div
            v-for="span in traceDetail.spans"
            :key="span.id"
            class="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 hover:bg-muted/30 transition-colors text-sm"
          >
            <div class="w-[280px] flex items-center gap-1 min-w-0">
              <span
                v-for="_ in (spanDepths.get(span.span_id ?? '') ?? 0)"
                :key="_"
                class="w-4 border-l border-muted-foreground/20 h-6 shrink-0"
              />
              <span class="truncate font-medium">{{ span.event_name }}</span>
            </div>
            <div class="w-20">
              <span
                class="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                :class="costTypeBadgeClass(span.cost_type ?? 'generic')"
              >{{ span.cost_type ?? 'generic' }}</span>
            </div>
            <div class="flex-1 flex items-center gap-2">
              <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full bg-foreground/60 rounded-full"
                  :style="{ width: `${span.duration_ms ? (span.duration_ms / maxDuration) * 100 : 0}%` }"
                />
              </div>
              <span class="text-xs text-muted-foreground tabular-nums w-16 text-right shrink-0">{{ formatDuration(span.duration_ms ?? null) }}</span>
            </div>
            <span class="w-20 text-right tabular-nums">{{ formatCost(span.cost_amount || 0) }}</span>
            <span class="w-16 text-right text-xs text-muted-foreground truncate">{{ span.model || '—' }}</span>
          </div>
        </Card>
      </template>
    </template>
  </div>
</template>
