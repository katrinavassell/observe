<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { getTraces, getTrace, type EventDetail } from "@/lib/api";
import { useAuth } from "@/composables/useAuth";
import { GUEST_TRACES, getGuestTraceDetail } from "@/lib/guest-preview";
import { Activity, ChevronLeft, Layers, Plug } from "lucide-vue-next";
import { Card, Button, Skeleton } from "@/components/ui";

const _router = useRouter();
const { isLoggedIn } = useAuth();
const selectedTraceId = ref<string | null>(null);

const {
  data: realTracesData,
  isLoading: tracesLoading,
  isError: tracesError,
} = useQuery({
  queryKey: ["traces"],
  queryFn: () => getTraces(),
  enabled: computed(() => isLoggedIn.value && !selectedTraceId.value),
});

// Guests see hardcoded preview data; logged-in users see real data.
// Sample data is client-side only — the server cannot serve or store it.
const tracesData = computed(() =>
  isLoggedIn.value ? realTracesData.value : { traces: GUEST_TRACES },
);

const {
  data: realTraceDetail,
  isLoading: detailLoading,
  isError: detailError,
} = useQuery({
  queryKey: ["trace", selectedTraceId],
  queryFn: () => getTrace(selectedTraceId.value!),
  enabled: computed(() => isLoggedIn.value && !!selectedTraceId.value),
});

const traceDetail = computed(() => {
  if (!selectedTraceId.value) return undefined;
  if (isLoggedIn.value) return realTraceDetail.value;
  return getGuestTraceDetail(selectedTraceId.value) ?? undefined;
});

function selectTrace(traceId: string) {
  selectedTraceId.value = traceId;
  window.posthog?.capture("trace_expanded", { trace_id: traceId });
}
function backToList() {
  selectedTraceId.value = null;
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
function formatCost(val: number) {
  if (val === 0) return "$0";
  return `$${val.toFixed(4)}`;
}
function formatDuration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
function spanTokens(span: EventDetail): string {
  if (span.input_tokens != null || span.output_tokens != null) {
    return `${((span.input_tokens ?? 0) + (span.output_tokens ?? 0)).toLocaleString()}`;
  }
  if (span.usage_units) return span.usage_units.toLocaleString();
  return "—";
}

function spanTokensTooltip(span: EventDetail): string {
  if (span.input_tokens != null || span.output_tokens != null) {
    const inp = (span.input_tokens ?? 0).toLocaleString();
    const out = (span.output_tokens ?? 0).toLocaleString();
    return `${inp} in / ${out} out`;
  }
  if (span.usage_units) {
    return `${span.usage_units.toLocaleString()} units (token split unavailable)`;
  }
  return "No usage recorded";
}

function costTypeBadgeClass(type: string) {
  switch (type) {
    case "llm":
      return "bg-blue-600 text-white";
    case "embedding":
      return "bg-purple-600 text-white";
    case "vector_db":
      return "bg-amber-600 text-white";
    case "compute":
      return "bg-green-600 text-white";
    case "api":
      return "bg-cyan-600 text-white";
    case "database":
      return "bg-orange-600 text-white";
    default:
      return "bg-slate-500 text-white";
  }
}

const spanDepths = computed(() => {
  if (!traceDetail.value) return new Map<string, number>();
  const spans = traceDetail.value.spans;
  const depthMap = new Map<string, number>();
  const spanIds = new Set(spans.map((s) => s.span_id).filter(Boolean));
  for (const span of spans) {
    if (!span.span_id) continue;
    let depth = 0;
    let current = span;
    while (current.parent_span_id && spanIds.has(current.parent_span_id)) {
      depth++;
      current =
        spans.find((s) => s.span_id === current.parent_span_id) || current;
      if (current.span_id === span.span_id) break;
    }
    depthMap.set(span.span_id, depth);
  }
  return depthMap;
});

const maxDuration = computed(() => {
  if (!traceDetail.value) return 1;
  return Math.max(...traceDetail.value.spans.map((s) => s.duration_ms ?? 0), 1);
});
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <div v-if="selectedTraceId" class="flex items-center gap-2 mb-1">
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2"
            @click="backToList"
          >
            <ChevronLeft class="h-4 w-4" />
          </Button>
          <span class="text-sm text-muted-foreground">Back to traces</span>
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">
          {{ selectedTraceId ? "Trace Detail" : "Traces" }}
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
          {{
            selectedTraceId
              ? `Trace ${selectedTraceId}`
              : "Multi-step agent execution traces with cost breakdown"
          }}
        </p>
      </div>
      <div
        v-if="!selectedTraceId && tracesData?.traces.length"
        class="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full border"
      >
        <Layers class="h-4 w-4" />
        <span class="font-medium text-foreground"
          >{{ tracesData.traces.length }} traces</span
        >
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

      <div
        v-else-if="tracesError"
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

      <div
        v-else-if="!tracesData?.traces.length"
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

      <div
        v-else
        class="rounded-md border bg-card overflow-hidden overflow-x-auto"
      >
        <table class="w-full text-sm text-left min-w-[700px]">
          <thead
            class="border-b bg-muted/40 text-muted-foreground text-xs font-medium uppercase tracking-wider"
          >
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
              <td class="px-4 py-3 text-muted-foreground whitespace-nowrap">
                {{ formatDate(t.start_time) }}
              </td>
              <td class="px-4 py-3 font-medium">{{ t.root_event }}</td>
              <td class="px-4 py-3">
                <code
                  class="text-xs bg-muted px-1.5 py-0.5 rounded font-mono"
                  >{{ t.trace_id.slice(0, 12) }}</code
                >
              </td>
              <td class="px-4 py-3 text-right tabular-nums">
                {{ t.span_count }}
              </td>
              <td class="px-4 py-3">
                <div class="flex gap-1 flex-wrap">
                  <span
                    v-for="ct in (t.cost_types || []).filter(Boolean)"
                    :key="ct"
                    class="text-xs font-medium px-2 py-0.5 rounded-full"
                    :class="costTypeBadgeClass(ct)"
                    >{{ ct }}</span
                  >
                </div>
              </td>
              <td
                class="px-4 py-3 text-right tabular-nums text-muted-foreground"
              >
                {{ formatDuration(t.total_duration_ms) }}
              </td>
              <td class="px-4 py-3 text-right tabular-nums">
                {{ formatCost(t.total_cost) }}
              </td>
              <td
                class="px-4 py-3 text-right tabular-nums text-muted-foreground"
              >
                {{ formatCost(t.total_revenue) }}
              </td>
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

      <div
        v-else-if="detailError || !traceDetail"
        class="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto"
      >
        <Activity class="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p class="text-sm font-medium mb-1">Trace not found</p>
        <p class="text-xs text-muted-foreground mb-4">
          This trace may have been deleted or is no longer available.
        </p>
        <Button size="sm" variant="outline" @click="backToList">
          <ChevronLeft class="h-3.5 w-3.5 mr-1.5" />
          Back to traces
        </Button>
      </div>

      <template v-else>
        <!-- Summary cards -->
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card class="p-4">
            <div class="text-xs font-medium text-muted-foreground">Spans</div>
            <div class="text-2xl font-semibold tabular-nums mt-1">
              {{ traceDetail.spans.length }}
            </div>
          </Card>
          <Card class="p-4">
            <div class="text-xs font-medium text-muted-foreground">
              Total Cost
            </div>
            <div class="text-2xl font-semibold tabular-nums mt-1">
              {{
                formatCost(
                  traceDetail.spans.reduce(
                    (s, sp) => s + parseFloat(String(sp.cost_amount || 0)),
                    0,
                  ),
                )
              }}
            </div>
          </Card>
          <Card class="p-4">
            <div class="text-xs font-medium text-muted-foreground">
              Total Revenue
            </div>
            <div class="text-2xl font-semibold tabular-nums mt-1">
              {{
                formatCost(
                  traceDetail.spans.reduce(
                    (s, sp) => s + parseFloat(String(sp.revenue_amount || 0)),
                    0,
                  ),
                )
              }}
            </div>
          </Card>
          <Card class="p-4">
            <div class="text-xs font-medium text-muted-foreground">
              Duration
            </div>
            <div class="text-2xl font-semibold tabular-nums mt-1">
              {{
                formatDuration(
                  traceDetail.spans.length
                    ? Math.max(
                        ...traceDetail.spans.map((s) => s.duration_ms ?? 0),
                      )
                    : null,
                )
              }}
            </div>
          </Card>
        </div>

        <!-- Waterfall -->
        <Card class="overflow-hidden overflow-x-auto">
          <div
            class="border-b bg-muted/40 px-4 py-2.5 flex items-center gap-3 text-xs text-muted-foreground font-medium uppercase tracking-wider min-w-[700px]"
          >
            <span class="w-[280px]">Span</span>
            <span class="w-20">Type</span>
            <span class="flex-1">Duration</span>
            <span class="w-20 text-right">Cost</span>
            <span class="w-20 text-right">Tokens</span>
            <span class="w-16 text-right">Model</span>
          </div>
          <div
            v-for="span in traceDetail.spans"
            :key="span.id"
            class="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 hover:bg-muted/30 transition-colors text-sm"
          >
            <div class="w-[280px] flex items-center gap-1 min-w-0">
              <span
                v-for="_ in spanDepths.get(span.span_id ?? '') ?? 0"
                :key="_"
                class="w-4 border-l border-muted-foreground/20 h-6 shrink-0"
              />
              <span class="truncate font-medium">{{ span.event_name }}</span>
            </div>
            <div class="w-24">
              <span
                class="text-xs font-medium px-2 py-0.5 rounded-full"
                :class="costTypeBadgeClass(span.cost_type ?? 'generic')"
                >{{ span.cost_type ?? "generic" }}</span
              >
            </div>
            <div class="flex-1 flex items-center gap-2">
              <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full bg-foreground/60 rounded-full"
                  :style="{
                    width: `${span.duration_ms ? (span.duration_ms / maxDuration) * 100 : 0}%`,
                  }"
                />
              </div>
              <span
                class="text-xs text-muted-foreground tabular-nums w-16 text-right shrink-0"
                >{{ formatDuration(span.duration_ms ?? null) }}</span
              >
            </div>
            <span class="w-20 text-right tabular-nums">{{
              formatCost(parseFloat(String(span.cost_amount || 0)))
            }}</span>
            <span
              class="w-20 text-right tabular-nums text-xs text-muted-foreground"
              :title="spanTokensTooltip(span)"
              >{{ spanTokens(span) }}</span
            >
            <span class="w-32 text-right text-xs text-muted-foreground">{{
              span.model || "—"
            }}</span>
          </div>
        </Card>
      </template>
    </template>
  </div>
</template>
