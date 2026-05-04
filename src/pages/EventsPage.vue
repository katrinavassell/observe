<script setup lang="ts">
import { ref, computed, reactive } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRouter, useRoute } from "vue-router";
import {
  getEvents,
  getEventsByCustomer,
  getEventsByModel,
  getFeatures,
  getEventDetail,
  type ObserveEvent,
  type EventDetail,
} from "@/lib/api";
import {
  Activity,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  X,
  Plug,
  Settings2,
  RotateCcw,
  Bot,
  User,
} from "lucide-vue-next";
import SourceBadge from "@/components/shared/SourceBadge.vue";
import {
  Select,
  Input,
  Button,
  Skeleton,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui";
import { useAuth } from "@/composables/useAuth";
import {
  GUEST_EVENTS,
  GUEST_EVENTS_BY_CUSTOMER,
  GUEST_EVENTS_BY_MODEL,
  getGuestEventDetail,
} from "@/lib/guest-preview";

const { isLoggedIn } = useAuth();
const router = useRouter();
const route = useRoute();

// Initialize filters from URL query params (e.g., navigating from ModelsPage with ?model=gpt-4o)
const selectedFeature = ref<string | undefined>(
  route.query.feature as string | undefined,
);
const selectedCustomer = ref<string | undefined>(
  route.query.customer as string | undefined,
);
const selectedModel = ref<string | undefined>(
  route.query.model as string | undefined,
);
const selectedSource = ref<string | undefined>(
  route.query.source as string | undefined,
);
const dateFrom = ref<string | undefined>();
const dateTo = ref<string | undefined>();
const currentPage = ref(0);
const PAGE_SIZE = 50;

// ── Column configuration ─────────────────────────────────────────────────────

interface TableColumn {
  id: string;
  label: string;
  visible: boolean;
  align: "left" | "right";
}

const DEFAULT_COLUMNS: TableColumn[] = [
  { id: "timestamp", label: "Timestamp", visible: true, align: "left" },
  { id: "event", label: "Event", visible: true, align: "left" },
  { id: "feature", label: "Feature", visible: true, align: "left" },
  { id: "customer", label: "Customer", visible: true, align: "left" },
  { id: "model", label: "Model", visible: true, align: "left" },
  { id: "source", label: "Source", visible: true, align: "left" },
  { id: "usage", label: "Usage", visible: true, align: "right" },
  { id: "cost", label: "Cost", visible: true, align: "right" },
  { id: "revenue", label: "Revenue", visible: false, align: "right" },
  { id: "margin", label: "Margin", visible: false, align: "right" },
  { id: "trace", label: "Trace", visible: true, align: "left" },
  { id: "duration", label: "Duration", visible: false, align: "right" },
  { id: "cost_type", label: "Cost Type", visible: false, align: "left" },
  { id: "properties", label: "Properties", visible: false, align: "left" },
];

const STORAGE_KEY = "observe:events-columns:v4";

function loadColumns(): TableColumn[] {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return DEFAULT_COLUMNS.map((c) => ({ ...c }));
  try {
    const { order, hidden } = JSON.parse(saved) as {
      order: string[];
      hidden: string[];
    };
    const byId = new Map(DEFAULT_COLUMNS.map((c) => [c.id, { ...c }]));
    const result: TableColumn[] = [];
    for (const id of order) {
      const col = byId.get(id);
      if (col) {
        col.visible = !hidden.includes(id);
        result.push(col);
        byId.delete(id);
      }
    }
    // Append any new columns not in saved order
    for (const col of byId.values()) {
      result.push(col);
    }
    return result;
  } catch {
    return DEFAULT_COLUMNS.map((c) => ({ ...c }));
  }
}

function saveColumns(cols: TableColumn[]) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      order: cols.map((c) => c.id),
      hidden: cols.filter((c) => !c.visible).map((c) => c.id),
    }),
  );
}

const columns = ref<TableColumn[]>(loadColumns());
const visibleColumns = computed(() => columns.value.filter((c) => c.visible));
const colCount = computed(() => visibleColumns.value.length + 1); // +1 for expand chevron
const showColumnSettings = ref(false);

// ── Column sorting ───────────────────────────────────────────────────────────

const SORT_FIELD_MAP: Record<string, string> = {
  timestamp: "timestamp",
  event: "event_name",
  feature: "feature_key",
  customer: "customer_id",
  model: "model",
  source: "source",
  usage: "usage_units",
  cost: "cost_amount",
  duration: "duration_ms",
};

const sortBy = ref<string | undefined>();
const sortDir = ref<"asc" | "desc">("desc");

function toggleSort(colId: string) {
  const field = SORT_FIELD_MAP[colId];
  if (!field) return;
  if (sortBy.value === field) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortBy.value = field;
    sortDir.value = colId === "timestamp" ? "desc" : "asc";
  }
  window.posthog?.capture("column_sort_changed", {
    sort_by: sortBy.value,
    sort_dir: sortDir.value,
  });
  resetPage();
}

function toggleColumn(id: string) {
  const col = columns.value.find((c) => c.id === id);
  if (col) {
    window.posthog?.capture("column_visibility_changed", {
      column: id,
      visible: !col.visible,
    });
    col.visible = !col.visible;
    saveColumns(columns.value);
  }
}

function moveColumn(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= columns.value.length) return;
  const arr = [...columns.value];
  [arr[index], arr[target]] = [arr[target], arr[index]];
  columns.value = arr;
  saveColumns(columns.value);
}

function resetColumns() {
  columns.value = DEFAULT_COLUMNS.map((c) => ({ ...c }));
  window.localStorage.removeItem(STORAGE_KEY);
}

// ── Expandable event detail ──────────────────────────────────────────────────

const expandedIds = reactive(new Set<number>());
const eventDetails = reactive<Record<number, EventDetail>>({});
const loadingDetails = reactive(new Set<number>());
const detailErrors = reactive<Record<number, string>>({});

async function toggleEvent(id: number) {
  if (expandedIds.has(id)) {
    expandedIds.delete(id);
    return;
  }
  expandedIds.add(id);
  window.posthog?.capture("event_expanded", { event_id: id });
  delete detailErrors[id];
  if (!eventDetails[id]) {
    if (!isLoggedIn.value) {
      const guest = getGuestEventDetail(id);
      if (guest) eventDetails[id] = guest;
      return;
    }
    loadingDetails.add(id);
    try {
      eventDetails[id] = await getEventDetail(id);
    } catch (err) {
      console.error(`Failed to load event detail id=${id}:`, err);
      detailErrors[id] = err instanceof Error ? err.message : "Unknown error";
    }
    loadingDetails.delete(id);
  }
}

function formatMessages(
  body: Record<string, unknown> | null | undefined,
): Array<{ role: string; content: string }> {
  if (!body) return [];
  const messages = body.messages as
    | Array<{ role: string; content: string }>
    | undefined;
  if (!Array.isArray(messages)) return [];
  return messages;
}

function getResponseContent(
  body: Record<string, unknown> | null | undefined,
): string | null {
  if (!body) return null;
  // OpenAI format
  const choices = body.choices as
    | Array<{ message?: { content?: string } }>
    | undefined;
  if (choices?.[0]?.message?.content) return choices[0].message.content;
  // Anthropic format
  const content = body.content as Array<{ text?: string }> | undefined;
  if (content?.[0]?.text) return content[0].text;
  return null;
}

function renderText(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// ── Filters & queries ────────────────────────────────────────────────────────

const SOURCES = [
  { value: "sdk", label: "SDK" },
  { value: "csv", label: "CSV Upload" },
  { value: "stripe", label: "Stripe Sync" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
];

const query = computed(() => ({
  limit: PAGE_SIZE,
  offset: currentPage.value * PAGE_SIZE,
  feature_key: selectedFeature.value || undefined,
  customer_id: selectedCustomer.value || undefined,
  model: selectedModel.value || undefined,
  source: selectedSource.value || undefined,
  date_from: dateFrom.value || undefined,
  date_to: dateTo.value || undefined,
  sort_by: sortBy.value || undefined,
  sort_dir: sortBy.value ? sortDir.value : undefined,
}));

const {
  data: realEventsData,
  isLoading,
  isError,
} = useQuery({
  queryKey: ["events", query],
  queryFn: () => getEvents(query.value),
  enabled: computed(() => isLoggedIn.value),
  placeholderData: { events: [], total: 0, limit: PAGE_SIZE, offset: 0 },
});
const eventsData = computed(() =>
  isLoggedIn.value
    ? realEventsData.value
    : {
        events: GUEST_EVENTS,
        total: GUEST_EVENTS.length,
        limit: 20,
        offset: 0,
      },
);

const { data: features } = useQuery({
  queryKey: ["features"],
  queryFn: getFeatures,
  enabled: computed(() => isLoggedIn.value),
});

const { data: realCustomerAgg } = useQuery({
  queryKey: ["events-by-customer"],
  queryFn: getEventsByCustomer,
  enabled: computed(() => isLoggedIn.value),
});
const customerAgg = computed(() =>
  isLoggedIn.value ? realCustomerAgg.value : GUEST_EVENTS_BY_CUSTOMER,
);

const { data: realModelAgg } = useQuery({
  queryKey: ["events-by-model"],
  queryFn: getEventsByModel,
  enabled: computed(() => isLoggedIn.value),
});
const modelAgg = computed(() =>
  isLoggedIn.value ? realModelAgg.value : GUEST_EVENTS_BY_MODEL,
);

const uniqueModels = computed(() =>
  (modelAgg.value || []).map((m) => m.model).sort(),
);

const ALL = "__all__";

const featureItems = computed(() => [
  { value: ALL, label: "All Features" },
  ...(features.value || []).map((f) => ({
    value: f.feature_key,
    label: f.feature_key,
  })),
]);

const customerItems = computed(() => [
  { value: ALL, label: "All Customers" },
  ...(customerAgg.value || []).map((c) => ({
    value: c.customer_id,
    label: c.customer_name || c.customer_id,
  })),
]);

const modelItems = computed(() => [
  { value: ALL, label: "All Models" },
  ...uniqueModels.value.map((m) => ({ value: m, label: m })),
]);

const sourceItems = computed(() => [
  { value: ALL, label: "All Sources" },
  ...SOURCES,
]);

function onSelectUpdate(setter: (v: string | undefined) => void) {
  return (val: string) => {
    setter(val === ALL ? undefined : val);
    window.posthog?.capture("events_filtered");
    resetPage();
  };
}

const onFeatureChange = onSelectUpdate((v) => (selectedFeature.value = v));
const onCustomerChange = onSelectUpdate((v) => (selectedCustomer.value = v));
const onModelChange = onSelectUpdate((v) => (selectedModel.value = v));
const onSourceChange = onSelectUpdate((v) => (selectedSource.value = v));

const hasFilters = computed(
  () =>
    selectedFeature.value ||
    selectedCustomer.value ||
    selectedModel.value ||
    selectedSource.value ||
    dateFrom.value ||
    dateTo.value,
);

function clearFilters() {
  selectedFeature.value = undefined;
  selectedCustomer.value = undefined;
  selectedModel.value = undefined;
  selectedSource.value = undefined;
  dateFrom.value = undefined;
  dateTo.value = undefined;
  currentPage.value = 0;
}

function resetPage() {
  currentPage.value = 0;
}

function formatCost(val: number | null) {
  if (val === null) return "—";
  if (val === 0) return "$0";
  if (val > 0 && val < 0.0001) return `<$0.0001`;
  return `$${val.toFixed(4)}`;
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

// ── Revenue / margin rendering helpers ─────────────────────────────────────
// Per-event revenue comes from PR #94's ingest enrichment. The revenue_source
// label tells us whether the number is exact (per_unit/tiered), estimated
// (allocated), or a hybrid. Margin is only shown per-event when the revenue
// is exact — for estimates we tag (est); for "none" we render em-dash.

type RevenueKind =
  | "per_unit"
  | "tiered"
  | "allocated"
  | "hybrid"
  | "explicit"
  | "feature_pricing"
  | "mrr_allocation"
  | "subscription"
  | "none"
  | null
  | undefined;

function revenueShortLabel(src: RevenueKind): string {
  switch (src) {
    case "per_unit":
      return "per unit";
    case "tiered":
      return "tiered";
    case "allocated":
    case "mrr_allocation":
      return "est";
    case "hybrid":
      return "hybrid";
    case "feature_pricing":
      return "feature";
    case "explicit":
    case "none":
    default:
      return "";
  }
}

function revenueLabelClass(src: RevenueKind): string {
  switch (src) {
    case "per_unit":
    case "tiered":
      return "text-green-600";
    case "allocated":
    case "mrr_allocation":
      return "text-muted-foreground";
    case "hybrid":
    case "feature_pricing":
      return "text-blue-600";
    default:
      return "text-muted-foreground";
  }
}

function revenueSourceTooltip(src: RevenueKind): string {
  switch (src) {
    case "per_unit":
      return "Metered Stripe price — unit_price × usage_units. Exact.";
    case "tiered":
      return "Graduated Stripe price — unit_price from the tier matching this customer's month-to-date usage. Exact.";
    case "subscription":
    case "allocated":
    case "mrr_allocation":
      return "Revenue from subscription — see customer page";
    case "hybrid":
      return "Flat + metered — metered portion exact per unit; flat base lives at customer level.";
    case "explicit":
      return "Sent directly on the event payload.";
    case "feature_pricing":
      return "Set on the feature definition (Data Sources → Features).";
    default:
      return "";
  }
}

const accountHasRevenue = computed(() =>
  (eventsData.value?.events ?? []).some(
    (e) => e.revenue_amount != null && e.revenue_amount > 0,
  ),
);

function marginForEvent(event: ObserveEvent): number | null {
  if (
    event.revenue_amount == null ||
    event.cost_amount == null ||
    event.revenue_amount <= 0
  )
    return null;
  return Math.round(
    ((event.revenue_amount - event.cost_amount) / event.revenue_amount) * 100,
  );
}

function marginColorClass(pct: number | null): string {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 50) return "text-green-600 font-medium";
  if (pct >= 20) return "text-yellow-600 font-medium";
  return "text-red-600 font-medium";
}

function isExactRevenue(src: RevenueKind): boolean {
  return src === "per_unit" || src === "tiered" || src === "explicit";
}

function isEstimateRevenue(src: RevenueKind): boolean {
  return (
    src === "allocated" ||
    src === "mrr_allocation" ||
    src === "hybrid" ||
    src === "feature_pricing"
  );
}

function costTooltip(event: ObserveEvent): string {
  if (event.input_cost != null || event.output_cost != null) {
    const inp = formatCost(event.input_cost);
    if (event.output_cost == null && event.output_tokens == null) {
      return `${inp} (input only)`;
    }
    const out = formatCost(event.output_cost);
    return `${inp} input / ${out} output`;
  }
  return "";
}

function usageTooltip(event: ObserveEvent): string {
  if (event.input_tokens != null || event.output_tokens != null) {
    const inp = (event.input_tokens ?? 0).toLocaleString();
    const out = (event.output_tokens ?? 0).toLocaleString();
    const base = `${inp} in / ${out} out`;
    return event.tokens_source === "estimated" ? `${base} (estimated)` : base;
  }
  if (event.usage_units != null && event.usage_units !== 0) {
    return `${event.usage_units.toLocaleString()} units (token split unavailable)`;
  }
  return "No usage recorded";
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Events</h1>
        <p class="text-sm text-muted-foreground mt-1">
          Per-event cost and usage from SDK, gateway, and CSV imports.
        </p>
      </div>
      <div
        class="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full border"
      >
        <Activity class="h-4 w-4" />
        <span v-if="eventsData" class="font-medium text-foreground"
          >{{ (eventsData.total || eventsData.events.length).toLocaleString() }}
          {{
            (eventsData.total || eventsData.events.length) === 1
              ? "event"
              : "events"
          }}</span
        >
      </div>
    </div>

    <!-- Usage banner removed — lives on Plans & Usage tab now -->

    <!-- Filters Inline Row -->
    <div class="flex flex-wrap items-center gap-3">
      <Select
        :model-value="selectedFeature || ALL"
        placeholder="Feature"
        :items="featureItems"
        @update:model-value="onFeatureChange"
        class="w-[160px]"
      />
      <Select
        :model-value="selectedCustomer || ALL"
        placeholder="Customer"
        :items="customerItems"
        @update:model-value="onCustomerChange"
        class="w-[180px]"
      />
      <Select
        :model-value="selectedModel || ALL"
        placeholder="Model"
        :items="modelItems"
        @update:model-value="onModelChange"
        class="w-[160px]"
      />
      <Select
        :model-value="selectedSource || ALL"
        placeholder="Source"
        :items="sourceItems"
        @update:model-value="onSourceChange"
        class="w-[160px]"
      />
      <div class="flex items-center gap-2">
        <Input
          v-model="dateFrom"
          type="date"
          class="h-9 w-[150px]"
          :class="{ 'text-muted-foreground': !dateFrom }"
          @update:model-value="resetPage"
        />
        <span class="text-muted-foreground text-sm">to</span>
        <Input
          v-model="dateTo"
          type="date"
          class="h-9 w-[150px]"
          :class="{ 'text-muted-foreground': !dateTo }"
          @update:model-value="resetPage"
        />
      </div>

      <Button
        v-if="hasFilters"
        variant="ghost"
        size="sm"
        class="h-9 px-3 text-muted-foreground hover:text-foreground"
        @click="clearFilters"
      >
        <X class="h-4 w-4 mr-1.5" />
        Clear
      </Button>

      <!-- Column settings -->
      <div class="relative ml-auto">
        <Button
          variant="outline"
          size="sm"
          class="h-9 px-2.5"
          @click="showColumnSettings = !showColumnSettings"
        >
          <Settings2 class="h-4 w-4" />
        </Button>

        <div
          v-if="showColumnSettings"
          class="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border bg-card shadow-lg"
        >
          <div
            class="flex items-center justify-between px-3 py-2 border-b text-xs font-medium text-muted-foreground"
          >
            <span>Columns</span>
            <button
              class="flex items-center gap-1 hover:text-foreground transition-colors"
              @click="resetColumns"
            >
              <RotateCcw class="h-3 w-3" />
              Reset
            </button>
          </div>
          <div class="max-h-80 overflow-y-auto py-1">
            <div
              v-for="(col, idx) in columns"
              :key="col.id"
              class="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 text-sm"
            >
              <input
                type="checkbox"
                :checked="col.visible"
                class="h-3.5 w-3.5 rounded border-input accent-primary"
                @change="toggleColumn(col.id)"
              />
              <span
                class="flex-1"
                :class="!col.visible && 'text-muted-foreground'"
                >{{ col.label }}</span
              >
              <div class="flex gap-0.5">
                <button
                  class="p-0.5 text-muted-foreground/50 hover:text-foreground disabled:opacity-20"
                  :disabled="idx === 0"
                  @click="moveColumn(idx, -1)"
                >
                  <ChevronUp class="h-3 w-3" />
                </button>
                <button
                  class="p-0.5 text-muted-foreground/50 hover:text-foreground disabled:opacity-20"
                  :disabled="idx === columns.length - 1"
                  @click="moveColumn(idx, 1)"
                >
                  <ChevronDown class="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Click-away overlay -->
    <div
      v-if="showColumnSettings"
      class="fixed inset-0 z-40"
      @click="showColumnSettings = false"
    />

    <!-- Table -->
    <div class="rounded-md border bg-card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm text-left">
          <thead
            class="border-b bg-muted/50 text-muted-foreground text-xs font-medium uppercase tracking-wider"
          >
            <tr>
              <th class="w-6"></th>
              <th
                v-for="col in visibleColumns"
                :key="col.id"
                class="px-4 py-3 font-medium"
                :class="[
                  col.align === 'right' && 'text-right',
                  SORT_FIELD_MAP[col.id] &&
                    'cursor-pointer select-none hover:text-foreground transition-colors',
                ]"
                @click="toggleSort(col.id)"
              >
                <span
                  class="inline-flex items-center gap-1"
                  :class="col.align === 'right' && 'justify-end'"
                >
                  {{ col.label }}
                  <ArrowUp
                    v-if="
                      sortBy === SORT_FIELD_MAP[col.id] && sortDir === 'asc'
                    "
                    class="h-3 w-3"
                  />
                  <ArrowDown
                    v-else-if="
                      sortBy === SORT_FIELD_MAP[col.id] && sortDir === 'desc'
                    "
                    class="h-3 w-3"
                  />
                  <ArrowUpDown
                    v-else-if="SORT_FIELD_MAP[col.id]"
                    class="h-3 w-3 opacity-30"
                  />
                </span>
              </th>
            </tr>
          </thead>

          <tbody v-if="isLoading" class="divide-y divide-border">
            <tr v-for="i in 10" :key="i">
              <td class="px-4 py-3"></td>
              <td v-for="col in visibleColumns" :key="col.id" class="px-4 py-3">
                <Skeleton
                  class="h-4 w-20"
                  :class="col.align === 'right' && 'ml-auto'"
                />
              </td>
            </tr>
          </tbody>

          <tbody v-else-if="isError" class="divide-y divide-border">
            <tr>
              <td
                :colspan="colCount"
                class="px-4 py-8 text-center text-destructive"
              >
                Failed to load events.
              </td>
            </tr>
          </tbody>

          <tbody
            v-else-if="!eventsData || eventsData.events.length === 0"
            class="divide-y divide-border"
          >
            <tr>
              <td :colspan="colCount" class="px-4 py-12 text-center">
                <template v-if="hasFilters">
                  <p class="text-muted-foreground mb-3">
                    No events match these filters.
                  </p>
                  <Button variant="outline" size="sm" @click="clearFilters"
                    >Clear Filters</Button
                  >
                </template>
                <template v-else>
                  <Activity
                    class="h-10 w-10 mx-auto text-muted-foreground/40 mb-3"
                  />
                  <p class="text-sm font-medium mb-1">No events yet</p>
                  <p
                    class="text-xs text-muted-foreground mb-4 max-w-sm mx-auto"
                  >
                    Send data via the SDK, connect an AI provider, or upload
                    CSVs to see your events here.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    @click="router.push('/data-sources')"
                  >
                    <Plug class="h-3.5 w-3.5 mr-1.5" />
                    Data Sources
                  </Button>
                </template>
              </td>
            </tr>
          </tbody>

          <tbody v-else class="divide-y divide-border">
            <template v-for="event in eventsData.events" :key="event.id">
              <tr
                class="hover:bg-muted/50 transition-colors cursor-pointer"
                :class="expandedIds.has(event.id) ? 'bg-muted/30' : ''"
                @click="toggleEvent(event.id)"
              >
                <td class="px-2 py-3 w-6">
                  <ChevronDown
                    v-if="expandedIds.has(event.id)"
                    class="h-3.5 w-3.5 text-muted-foreground"
                  />
                  <ChevronRight
                    v-else
                    class="h-3.5 w-3.5 text-muted-foreground"
                  />
                </td>

                <template v-for="col in visibleColumns" :key="col.id">
                  <!-- Timestamp -->
                  <td
                    v-if="col.id === 'timestamp'"
                    class="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs"
                  >
                    {{ formatDate(event.timestamp) }}
                  </td>

                  <!-- Event -->
                  <td
                    v-else-if="col.id === 'event'"
                    class="px-4 py-3 text-xs text-foreground"
                  >
                    {{ event.event_name }}
                  </td>

                  <!-- Feature -->
                  <td v-else-if="col.id === 'feature'" class="px-4 py-3">
                    <button
                      v-if="event.feature_key"
                      class="hover:underline"
                      @click.stop="
                        selectedFeature = event.feature_key;
                        resetPage();
                      "
                    >
                      <span
                        class="font-mono text-xs bg-muted px-1.5 py-0.5 rounded"
                      >
                        {{ event.feature_key }}
                      </span>
                    </button>
                    <span v-else class="text-muted-foreground text-sm">—</span>
                  </td>

                  <!-- Customer -->
                  <td v-else-if="col.id === 'customer'" class="px-4 py-3">
                    <button
                      v-if="
                        event.customer_name &&
                        event.customer_name !== event.customer_id
                      "
                      class="text-sm hover:underline text-left"
                      @click.stop="
                        selectedCustomer = event.customer_id;
                        resetPage();
                      "
                    >
                      {{ event.customer_name }}
                    </button>
                    <button
                      v-else-if="event.customer_id"
                      class="text-sm hover:underline text-left"
                      @click.stop="
                        selectedCustomer = event.customer_id;
                        resetPage();
                      "
                    >
                      {{ event.customer_id }}
                    </button>
                    <span v-else class="text-muted-foreground text-sm">—</span>
                  </td>

                  <!-- Model -->
                  <td v-else-if="col.id === 'model'" class="px-4 py-3">
                    <button
                      v-if="event.model"
                      class="hover:underline"
                      @click.stop="
                        selectedModel = event.model;
                        resetPage();
                      "
                    >
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <span
                            class="font-mono text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-md border truncate max-w-[120px] inline-block align-middle"
                          >
                            {{ event.model }}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{{ event.model }}</TooltipContent>
                      </Tooltip>
                    </button>
                    <span v-else class="text-muted-foreground text-sm">—</span>
                  </td>

                  <!-- Source -->
                  <td v-else-if="col.id === 'source'" class="px-4 py-3">
                    <SourceBadge
                      v-if="event.is_inferred"
                      source=""
                      :is-inferred="true"
                    />
                    <SourceBadge
                      v-else-if="event.source"
                      :source="event.source"
                    />
                    <span v-else class="text-muted-foreground text-sm">—</span>
                  </td>

                  <!-- Trace -->
                  <td v-else-if="col.id === 'trace'" class="px-4 py-3">
                    <code
                      v-if="event.trace_id"
                      class="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono cursor-pointer hover:bg-muted-foreground/20 transition-colors"
                      @click.stop="router.push('/traces')"
                      >{{ event.trace_id.slice(0, 8) }}</code
                    >
                  </td>

                  <!-- Usage -->
                  <td
                    v-else-if="col.id === 'usage'"
                    class="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums"
                    :title="usageTooltip(event)"
                  >
                    {{
                      event.usage_units != null && event.usage_units !== 0
                        ? event.usage_units.toLocaleString()
                        : "—"
                    }}
                  </td>

                  <!-- Cost -->
                  <td
                    v-else-if="col.id === 'cost'"
                    class="px-4 py-3 text-right text-xs text-foreground tabular-nums"
                    :title="costTooltip(event)"
                  >
                    {{ formatCost(event.cost_amount) }}
                  </td>

                  <!-- Revenue (per-event, with revenue_source label) -->
                  <td
                    v-else-if="col.id === 'revenue'"
                    class="px-4 py-3 text-right text-xs tabular-nums"
                    :title="revenueSourceTooltip(event.revenue_source)"
                  >
                    <template
                      v-if="
                        event.revenue_amount != null &&
                        event.revenue_amount > 0 &&
                        event.revenue_source &&
                        event.revenue_source !== 'none'
                      "
                    >
                      <span class="text-foreground">{{
                        formatCost(event.revenue_amount)
                      }}</span>
                      <span
                        v-if="revenueShortLabel(event.revenue_source)"
                        :class="[
                          'ml-1 text-[10px]',
                          revenueLabelClass(event.revenue_source),
                        ]"
                      >
                        ({{ revenueShortLabel(event.revenue_source) }})
                      </span>
                    </template>
                    <span v-else class="text-muted-foreground">—</span>
                  </td>

                  <!-- Margin (per-event) -->
                  <td
                    v-else-if="col.id === 'margin'"
                    class="px-4 py-3 text-right text-xs tabular-nums"
                  >
                    <template
                      v-if="
                        isExactRevenue(event.revenue_source) &&
                        marginForEvent(event) !== null
                      "
                    >
                      <span :class="marginColorClass(marginForEvent(event))">
                        {{ marginForEvent(event) }}%
                      </span>
                    </template>
                    <template
                      v-else-if="
                        isEstimateRevenue(event.revenue_source) &&
                        marginForEvent(event) !== null
                      "
                    >
                      <span class="text-muted-foreground">
                        {{ marginForEvent(event) }}% (est)
                      </span>
                    </template>
                    <span v-else class="text-muted-foreground">—</span>
                  </td>

                  <!-- Duration -->
                  <td
                    v-else-if="col.id === 'duration'"
                    class="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums"
                  >
                    {{
                      event.duration_ms != null ? `${event.duration_ms}ms` : "—"
                    }}
                  </td>

                  <!-- Cost Type -->
                  <td
                    v-else-if="col.id === 'cost_type'"
                    class="px-4 py-3 text-xs text-muted-foreground"
                  >
                    {{ event.cost_type || "—" }}
                  </td>

                  <!-- Properties -->
                  <td
                    v-else-if="col.id === 'properties'"
                    class="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate"
                  >
                    {{
                      event.properties
                        ? Object.entries(event.properties)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(", ")
                        : "—"
                    }}
                  </td>
                </template>
              </tr>

              <!-- Expanded detail panel -->
              <tr v-if="expandedIds.has(event.id)">
                <td :colspan="colCount" class="px-0 py-0 bg-muted/20 border-b">
                  <div
                    v-if="loadingDetails.has(event.id)"
                    class="p-6 text-center text-sm text-muted-foreground"
                  >
                    Loading...
                  </div>
                  <div
                    v-else-if="eventDetails[event.id]"
                    class="p-5 space-y-4 min-w-0 overflow-hidden"
                  >
                    <!-- Request messages -->
                    <div v-if="eventDetails[event.id].request_body">
                      <p
                        class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2"
                      >
                        Request
                      </p>
                      <div
                        v-if="
                          formatMessages(eventDetails[event.id].request_body)
                            .length > 0
                        "
                        class="space-y-2"
                      >
                        <div
                          v-for="(msg, idx) in formatMessages(
                            eventDetails[event.id].request_body,
                          )"
                          :key="idx"
                          class="flex gap-2"
                        >
                          <div class="shrink-0 mt-0.5">
                            <Bot
                              v-if="
                                msg.role === 'system' ||
                                msg.role === 'assistant'
                              "
                              class="h-4 w-4 text-muted-foreground"
                            />
                            <User v-else class="h-4 w-4 text-foreground" />
                          </div>
                          <div class="min-w-0">
                            <span
                              class="text-[10px] font-medium text-muted-foreground uppercase"
                              >{{ msg.role }}</span
                            >
                            <p
                              class="text-sm whitespace-pre-wrap break-words"
                              v-html="renderText(msg.content)"
                            />
                          </div>
                        </div>
                      </div>
                      <pre
                        v-else
                        class="text-xs bg-muted rounded-lg p-3 overflow-x-auto max-h-60"
                        >{{
                          JSON.stringify(
                            eventDetails[event.id].request_body,
                            null,
                            2,
                          )
                        }}</pre
                      >
                    </div>

                    <!-- Response content -->
                    <div v-if="eventDetails[event.id].response_body">
                      <p
                        class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2"
                      >
                        Response
                      </p>
                      <div
                        v-if="
                          getResponseContent(
                            eventDetails[event.id].response_body,
                          )
                        "
                        class="flex gap-2"
                      >
                        <Bot class="h-4 w-4 text-success shrink-0 mt-0.5" />
                        <p
                          class="text-sm whitespace-pre-wrap break-words"
                          v-html="
                            renderText(
                              getResponseContent(
                                eventDetails[event.id].response_body,
                              )!,
                            )
                          "
                        />
                      </div>
                      <pre
                        v-else
                        class="text-xs bg-muted rounded-lg p-3 overflow-x-auto max-h-60"
                        >{{
                          JSON.stringify(
                            eventDetails[event.id].response_body,
                            null,
                            2,
                          )
                        }}</pre
                      >
                    </div>

                    <!-- Request/response from properties (Path 1 direct-ingest fallback) -->
                    <div
                      v-if="
                        !eventDetails[event.id].request_body &&
                        eventDetails[event.id].properties?.prompt
                      "
                    >
                      <p
                        class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2"
                      >
                        Request
                      </p>
                      <div class="flex gap-2">
                        <User class="h-4 w-4 text-foreground shrink-0 mt-0.5" />
                        <p class="text-sm whitespace-pre-wrap break-words">
                          {{ eventDetails[event.id].properties!.prompt }}
                        </p>
                      </div>
                    </div>
                    <div
                      v-if="
                        !eventDetails[event.id].response_body &&
                        eventDetails[event.id].properties?.completion
                      "
                    >
                      <p
                        class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2"
                      >
                        Response
                      </p>
                      <div class="flex gap-2">
                        <Bot class="h-4 w-4 text-success shrink-0 mt-0.5" />
                        <p class="text-sm whitespace-pre-wrap break-words">
                          {{ eventDetails[event.id].properties!.completion }}
                        </p>
                      </div>
                    </div>

                    <!-- No bodies available -->
                    <div
                      v-if="
                        !eventDetails[event.id].request_body &&
                        !eventDetails[event.id].response_body &&
                        !eventDetails[event.id].properties?.prompt &&
                        !eventDetails[event.id].properties?.completion
                      "
                      class="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground space-y-1"
                    >
                      <p class="font-medium text-foreground">
                        No request/response body recorded
                      </p>
                      <p class="text-xs">
                        Add
                        <code class="font-mono">requestBody</code> and
                        <code class="font-mono">responseBody</code> to your
                        ingest call:
                      </p>
                      <pre
                        class="text-[11px] bg-muted rounded p-2 mt-1 overflow-x-auto"
                      ><code>// OpenAI
requestBody: { messages },
responseBody: { choices: [{ message: res.choices[0].message }] },

// Anthropic
requestBody: { messages },
responseBody: { content: res.content },</code></pre>
                    </div>

                    <!-- Metadata -->
                    <div
                      class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-t pt-3"
                    >
                      <span
                        v-if="
                          eventDetails[event.id].input_tokens != null ||
                          eventDetails[event.id].output_tokens != null
                        "
                      >
                        {{
                          (
                            eventDetails[event.id].input_tokens ?? 0
                          ).toLocaleString()
                        }}
                        in /
                        {{
                          (
                            eventDetails[event.id].output_tokens ?? 0
                          ).toLocaleString()
                        }}
                        out
                      </span>
                      <span v-else-if="eventDetails[event.id].usage_units"
                        >{{
                          eventDetails[event.id].usage_units.toLocaleString()
                        }}
                        tokens</span
                      >
                      <span
                        v-if="
                          eventDetails[event.id].input_cost != null ||
                          eventDetails[event.id].output_cost != null
                        "
                      >
                        ${{
                          (eventDetails[event.id].input_cost ?? 0).toFixed(4)
                        }}
                        <template
                          v-if="
                            eventDetails[event.id].output_cost == null &&
                            eventDetails[event.id].output_tokens == null
                          "
                          >(input only)</template
                        >
                        <template v-else>
                          input / ${{
                            (eventDetails[event.id].output_cost ?? 0).toFixed(4)
                          }}
                          output</template
                        >
                      </span>
                      <span v-else-if="eventDetails[event.id].cost_amount"
                        >${{
                          eventDetails[event.id].cost_amount.toFixed(4)
                        }}
                        cost</span
                      >
                      <span
                        v-if="
                          eventDetails[event.id].properties?.cache_hit ===
                          'true'
                        "
                        class="text-success"
                        >Cache HIT</span
                      >
                      <span v-if="eventDetails[event.id].source"
                        >Source: {{ eventDetails[event.id].source }}</span
                      >
                      <span v-if="eventDetails[event.id].feature_key"
                        >Feature: {{ eventDetails[event.id].feature_key }}</span
                      >
                      <Tooltip
                        v-if="
                          eventDetails[event.id].revenue_source &&
                          eventDetails[event.id].revenue_source !== 'none'
                        "
                      >
                        <TooltipTrigger as-child>
                          <span>
                            Revenue:
                            {{
                              revenueShortLabel(
                                eventDetails[event.id].revenue_source,
                              ) || eventDetails[event.id].revenue_source
                            }}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{{
                          revenueSourceTooltip(
                            eventDetails[event.id].revenue_source,
                          )
                        }}</TooltipContent>
                      </Tooltip>
                    </div>
                    <!-- Revenue onboarding hint -->
                    <div
                      v-if="
                        eventDetails[event.id].revenue_source === 'none' &&
                        !accountHasRevenue
                      "
                      class="text-xs text-muted-foreground border-t pt-2 mt-1"
                    >
                      Revenue not configured yet.
                      <router-link
                        to="/data-sources#stripe-section"
                        class="text-primary hover:underline"
                        @click.stop
                        >Connect Stripe</router-link
                      >
                      or send
                      <code class="font-mono text-[11px]">revenueAmount</code>
                      on events.
                    </div>
                  </div>
                  <div
                    v-else-if="event.id in detailErrors"
                    class="p-4 text-sm text-destructive space-y-1"
                  >
                    <p class="font-medium">Failed to load event detail</p>
                    <p class="text-xs text-muted-foreground">
                      {{ detailErrors[event.id] }}
                    </p>
                  </div>
                  <div v-else class="p-4 text-sm text-muted-foreground">
                    Sign in to view event details.
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Pagination -->
    <div
      v-if="eventsData && eventsData.total > PAGE_SIZE"
      class="flex items-center justify-between"
    >
      <span class="text-sm text-muted-foreground">
        Showing
        <span class="font-medium text-foreground">{{
          eventsData.offset + 1
        }}</span>
        to
        <span class="font-medium text-foreground">{{
          Math.min(eventsData.offset + PAGE_SIZE, eventsData.total)
        }}</span>
        of
        <span class="font-medium text-foreground">{{ eventsData.total }}</span>
        events
      </span>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          :disabled="currentPage === 0"
          @click="currentPage--"
        >
          <ChevronLeft class="h-4 w-4 mr-1" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="(currentPage + 1) * PAGE_SIZE >= eventsData.total"
          @click="currentPage++"
        >
          Next
          <ChevronRight class="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  </div>
</template>
