<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { getTraces, getTrace, type EventDetail } from "@/lib/api";
import { useAuth } from "@/composables/useAuth";
import { GUEST_TRACES, getGuestTraceDetail } from "@/lib/guest-preview";
import { Activity, Plug, ChevronDown, ChevronRight } from "lucide-vue-next";
import { Card, CardContent, Button, Skeleton, Badge } from "@/components/ui";

const { isLoggedIn } = useAuth();

const {
  data: realTracesData,
  isLoading: tracesLoading,
  isError: tracesError,
} = useQuery({
  queryKey: ["traces"],
  queryFn: () => getTraces(),
  enabled: computed(() => isLoggedIn.value),
});

const tracesData = computed(() =>
  isLoggedIn.value ? realTracesData.value : { traces: GUEST_TRACES },
);

const expandedTraces = ref<Set<string>>(new Set());

function toggleTrace(traceId: string) {
  if (expandedTraces.value.has(traceId)) {
    expandedTraces.value.delete(traceId);
  } else {
    expandedTraces.value.add(traceId);
  }
  expandedTraces.value = new Set(expandedTraces.value);
}

const traceDetails = ref<Record<string, EventDetail[]>>({});
const loadingDetails = ref<Set<string>>(new Set());

async function loadDetail(traceId: string) {
  if (traceDetails.value[traceId]) return;
  loadingDetails.value.add(traceId);
  loadingDetails.value = new Set(loadingDetails.value);
  try {
    let detail;
    if (isLoggedIn.value) {
      detail = await getTrace(traceId);
    } else {
      detail = getGuestTraceDetail(traceId);
    }
    if (detail) {
      traceDetails.value = { ...traceDetails.value, [traceId]: detail.spans };
    }
  } finally {
    loadingDetails.value.delete(traceId);
    loadingDetails.value = new Set(loadingDetails.value);
  }
}

async function handleToggle(traceId: string) {
  if (!expandedTraces.value.has(traceId)) {
    await loadDetail(traceId);
  }
  toggleTrace(traceId);
}

function formatCost(val: number) {
  if (val === 0) return "$0";
  if (val >= 0.01) return `$${val.toFixed(2)}`;
  if (val > 0 && val < 0.0001) return "<$0.0001";
  return `$${val.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`;
}

function formatDuration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function spanTokens(span: EventDetail): number {
  if (span.input_tokens != null || span.output_tokens != null) {
    return (span.input_tokens ?? 0) + (span.output_tokens ?? 0);
  }
  return span.usage_units ?? 0;
}

function barColor(costType: string): string {
  switch (costType) {
    case "llm":
      return "bg-indigo-500";
    case "embedding":
      return "bg-violet-500";
    case "vector_db":
      return "bg-amber-500";
    case "compute":
      return "bg-emerald-500";
    case "api":
      return "bg-cyan-500";
    default:
      return "bg-slate-400";
  }
}

function costColor(cost: number): string {
  if (cost >= 0.1) return "text-destructive";
  if (cost >= 0.01) return "text-warning";
  return "text-muted-foreground";
}

function maxDurationForTrace(spans: EventDetail[]): number {
  return Math.max(...spans.map((s) => s.duration_ms ?? 0), 1);
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Traces</h1>
        <p class="text-muted-foreground">
          Multi-step agent runs with span-level cost attribution
        </p>
      </div>
      <span
        v-if="tracesData?.traces.length"
        class="text-sm text-muted-foreground"
      >
        Showing {{ tracesData.traces.length }} traces
      </span>
    </div>

    <div v-if="tracesLoading">
      <Card v-for="i in 3" :key="i" class="mb-4 p-5">
        <Skeleton class="h-6 w-48 mb-3" />
        <Skeleton class="h-4 w-full mb-2" />
        <Skeleton class="h-4 w-3/4" />
      </Card>
    </div>

    <div
      v-else-if="tracesError || !tracesData?.traces.length"
      class="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto"
    >
      <Activity class="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p class="text-sm font-medium mb-1">No traces yet</p>
      <p class="text-xs text-muted-foreground mb-4">
        Pass a
        <code class="bg-muted px-1 rounded text-[11px]">traceId</code> in SDK
        events to group multi-step agent flows with cost breakdown.
      </p>
      <Button
        size="sm"
        variant="outline"
        @click="$router.push('/data-sources')"
      >
        <Plug class="h-3.5 w-3.5 mr-1.5" />
        Data Sources
      </Button>
    </div>

    <div v-else class="space-y-4">
      <Card
        v-for="t in tracesData.traces"
        :key="t.trace_id"
        class="overflow-hidden"
      >
        <!-- Trace header -->
        <button
          class="w-full flex items-center justify-between p-5 text-left hover:bg-muted/30 transition-colors"
          @click="handleToggle(t.trace_id)"
        >
          <div class="flex items-center gap-3">
            <component
              :is="expandedTraces.has(t.trace_id) ? ChevronDown : ChevronRight"
              class="h-4 w-4 text-muted-foreground shrink-0"
            />
            <div>
              <div class="flex items-center gap-2">
                <span class="font-semibold text-sm">{{ t.root_event }}</span>
                <Badge variant="outline" class="text-[10px] font-mono">
                  {{ t.trace_id.slice(0, 12) }}
                </Badge>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-6 text-sm">
            <div class="text-right">
              <div class="text-xs text-muted-foreground">Duration</div>
              <div class="font-medium tabular-nums">
                {{ formatDuration(t.total_duration_ms) }}
              </div>
            </div>
            <div class="text-right">
              <div class="text-xs text-muted-foreground">Cost</div>
              <div class="font-medium tabular-nums">
                {{ formatCost(t.total_cost) }}
              </div>
            </div>
            <div class="text-right">
              <div class="text-xs text-muted-foreground">Spans</div>
              <div class="font-medium tabular-nums">{{ t.span_count }}</div>
            </div>
          </div>
        </button>

        <!-- Expanded waterfall -->
        <div v-if="expandedTraces.has(t.trace_id)" class="border-t">
          <div v-if="loadingDetails.has(t.trace_id)" class="p-5 space-y-2">
            <Skeleton v-for="i in 3" :key="i" class="h-8 w-full" />
          </div>

          <template v-else-if="traceDetails[t.trace_id]">
            <div class="divide-y">
              <div
                v-for="span in traceDetails[t.trace_id]"
                :key="span.id"
                class="flex items-center gap-4 px-5 py-3"
              >
                <!-- Span name + model -->
                <div class="w-[180px] shrink-0">
                  <div class="text-sm font-medium">{{ span.event_name }}</div>
                  <div class="text-xs text-muted-foreground font-mono">
                    {{ span.model || span.cost_type || "—" }}
                  </div>
                </div>

                <!-- Duration bar -->
                <div class="flex-1 flex items-center gap-2">
                  <div
                    class="flex-1 h-7 bg-muted/50 rounded-md relative overflow-hidden"
                  >
                    <div
                      class="absolute inset-y-0 left-0 rounded-md flex items-center justify-end px-2"
                      :class="barColor(span.cost_type ?? 'generic')"
                      :style="{
                        width: `${Math.max(
                          ((span.duration_ms ?? 0) /
                            maxDurationForTrace(traceDetails[t.trace_id])) *
                            100,
                          8,
                        )}%`,
                      }"
                    >
                      <span class="text-[11px] font-medium text-white">
                        {{ formatDuration(span.duration_ms ?? null) }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Tokens -->
                <div
                  class="w-[90px] text-right text-xs text-muted-foreground tabular-nums shrink-0"
                >
                  {{ spanTokens(span).toLocaleString() }} tokens
                </div>

                <!-- Cost -->
                <div
                  class="w-[80px] text-right font-mono text-sm tabular-nums shrink-0"
                  :class="costColor(parseFloat(String(span.cost_amount || 0)))"
                >
                  {{ formatCost(parseFloat(String(span.cost_amount || 0))) }}
                </div>
              </div>
            </div>

            <!-- Trace totals -->
            <div
              class="flex justify-end gap-6 px-5 py-3 border-t bg-muted/20 text-sm"
            >
              <div class="text-muted-foreground">
                Total tokens
                <span class="font-semibold text-foreground ml-1 tabular-nums">
                  {{
                    traceDetails[t.trace_id]
                      .reduce((s, sp) => s + spanTokens(sp), 0)
                      .toLocaleString()
                  }}
                </span>
              </div>
              <div class="text-muted-foreground">
                Total duration
                <span class="font-semibold text-foreground ml-1 tabular-nums">
                  {{
                    formatDuration(
                      Math.max(
                        ...traceDetails[t.trace_id].map(
                          (s) => s.duration_ms ?? 0,
                        ),
                      ),
                    )
                  }}
                </span>
              </div>
              <div class="text-muted-foreground">
                Total cost
                <span class="font-semibold text-foreground ml-1 tabular-nums">
                  {{
                    formatCost(
                      traceDetails[t.trace_id].reduce(
                        (s, sp) => s + parseFloat(String(sp.cost_amount || 0)),
                        0,
                      ),
                    )
                  }}
                </span>
              </div>
            </div>
          </template>
        </div>
      </Card>
    </div>
  </div>
</template>
