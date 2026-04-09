<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  getCohorts,
  discoverCohorts,
  getCustomers,
  createCustomCohort,
} from "@/lib/api";
import type {
  CohortLabel,
  CohortSummary,
  DiscoveredCluster,
  CohortRule,
} from "@/lib/api";
import {
  AlertCircle,
  Database,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  Settings2,
  RotateCcw,
  ArrowRight,
  Plug,
  Plus,
  X,
} from "lucide-vue-next";
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "radix-vue";
import { Card, Skeleton, Button } from "@/components/ui";
import { formatCurrency as fmt, formatPct as fmtPct } from "@/lib/format";
import { toast } from "vue-sonner";
import { useAuth } from "@/composables/useAuth";

const queryClient = useQueryClient();
const { isLoggedIn } = useAuth();

// ── Create cohort dialog ────────────────────────────────────────────────────

const createDialogOpen = ref(false);
const newCohortName = ref("");
const newCohortDescription = ref("");
const newCohortColor = ref("#6366f1");
const selectedCustomerIds = ref<Set<string>>(new Set());
const creating = ref(false);
const customerSearch = ref("");
const cohortType = ref<"static" | "dynamic">("dynamic");
const rules = ref<CohortRule[]>([
  { field: "margin_pct", operator: "lt", value: 0 },
]);

const RULE_FIELDS = [
  { value: "margin_pct", label: "Margin %" },
  { value: "total_cost", label: "Total Cost" },
  { value: "total_revenue", label: "Total Revenue" },
  { value: "health_score", label: "Health Score" },
  { value: "active_days_30d", label: "Active Days (30d)" },
];

const RULE_OPERATORS = [
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
];

function addRule() {
  rules.value.push({ field: "margin_pct", operator: "lt", value: 0 });
}

function removeRule(index: number) {
  rules.value.splice(index, 1);
}

const COHORT_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
];

const { data: allCustomers } = useQuery({
  queryKey: ["customers"],
  queryFn: getCustomers,
  enabled: isLoggedIn,
});

const filteredCustomerList = computed(() => {
  const list = allCustomers.value ?? [];
  if (!customerSearch.value.trim()) return list;
  const q = customerSearch.value.toLowerCase();
  return list.filter(
    (c) =>
      c.name?.toLowerCase().includes(q) ||
      c.customer_id.toLowerCase().includes(q),
  );
});

function toggleCustomer(id: string) {
  const next = new Set(selectedCustomerIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedCustomerIds.value = next;
}

function openCreateDialog() {
  newCohortName.value = "";
  newCohortDescription.value = "";
  newCohortColor.value = "#6366f1";
  selectedCustomerIds.value = new Set();
  customerSearch.value = "";
  cohortType.value = "dynamic";
  rules.value = [{ field: "margin_pct", operator: "lt", value: 0 }];
  createDialogOpen.value = true;
}

async function handleCreate() {
  if (!newCohortName.value.trim()) {
    toast.error("Cohort name is required");
    return;
  }
  if (cohortType.value === "dynamic" && rules.value.length === 0) {
    toast.error("Add at least one rule");
    return;
  }
  creating.value = true;
  try {
    await createCustomCohort({
      name: newCohortName.value.trim(),
      description: newCohortDescription.value.trim() || undefined,
      color: newCohortColor.value,
      cohort_type: cohortType.value,
      ...(cohortType.value === "dynamic"
        ? { rules: rules.value }
        : { customer_ids: [...selectedCustomerIds.value] }),
    });
    queryClient.invalidateQueries({ queryKey: ["cohorts"] });
    createDialogOpen.value = false;
    toast.success(`Cohort "${newCohortName.value.trim()}" created`);
  } catch (err: any) {
    toast.error(err.message || "Failed to create cohort");
  } finally {
    creating.value = false;
  }
}

const SAMPLE_DISCOVERY: {
  clusters: DiscoveredCluster[];
  source: "deterministic";
} = {
  source: "deterministic",
  clusters: [
    {
      name: "High-cost GPT-4o users",
      description:
        "3 customers spending 68% of total GPT-4o cost. Output tokens are 4x longer than average — consider routing summarization to a cheaper model.",
      customer_ids: ["acme-saas", "circleops", "neondata"],
      severity: "warning",
      recommended_action:
        "Route summarization calls to GPT-4o mini to cut cost by ~60%",
    },
    {
      name: "Embedding-heavy with low revenue",
      description:
        "2 customers generating high embedding volume but minimal revenue. Cost-to-serve exceeds what they pay.",
      customer_ids: ["tidewater-ai", "blazeml"],
      severity: "critical",
      recommended_action:
        "Add embedding usage limits or move to a tiered pricing model",
    },
    {
      name: "Healthy margin champions",
      description:
        "CircleOps and Acme SaaS maintain 65%+ margin consistently. Their usage patterns are the benchmark for profitable customers.",
      customer_ids: ["circleops", "acme-saas"],
      severity: "positive",
      recommended_action:
        "Use these customers as the template for your ideal pricing tier",
    },
  ],
};

// ── Column configuration ─────────────────────────────────────────────────────

interface TableColumn {
  id: string;
  label: string;
  visible: boolean;
  align: "left" | "right";
}

const DEFAULT_COLUMNS: TableColumn[] = [
  { id: "customer", label: "Customer", visible: true, align: "left" },
  { id: "health", label: "Health", visible: true, align: "left" },
  { id: "revenue", label: "Revenue", visible: true, align: "right" },
  { id: "cost", label: "Cost", visible: true, align: "right" },
  { id: "margin", label: "Margin", visible: true, align: "right" },
  { id: "active_days", label: "Active Days", visible: true, align: "right" },
  { id: "mrr", label: "MRR", visible: true, align: "left" },
];

const STORAGE_KEY = "observe:cohorts-columns";

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

function toggleColumn(id: string) {
  const col = columns.value.find((c) => c.id === id);
  if (col) {
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

// Exclude filter — hide customers whose name/ID contains any of these strings
const EXCLUDE_STORAGE_KEY = "observe:cohorts-exclude";

function loadExcludePatterns(): string[] {
  const saved = window.localStorage.getItem(EXCLUDE_STORAGE_KEY);
  if (!saved) return [];
  try {
    return JSON.parse(saved);
  } catch {
    return [];
  }
}

const excludePatterns = ref<string[]>(loadExcludePatterns());
const excludeInput = ref("");
const showExcludeEditor = ref(false);

function addExcludePattern() {
  const pattern = excludeInput.value.trim().toLowerCase();
  if (!pattern || excludePatterns.value.includes(pattern)) return;
  excludePatterns.value.push(pattern);
  window.localStorage.setItem(
    EXCLUDE_STORAGE_KEY,
    JSON.stringify(excludePatterns.value),
  );
  excludeInput.value = "";
}

function removeExcludePattern(index: number) {
  excludePatterns.value.splice(index, 1);
  window.localStorage.setItem(
    EXCLUDE_STORAGE_KEY,
    JSON.stringify(excludePatterns.value),
  );
}

const {
  data: cohortsData,
  isLoading,
  isError,
} = useQuery({
  queryKey: ["cohorts"],
  queryFn: () => getCohorts(),
});

const customers = computed(() => cohortsData.value?.customers ?? []);
const summary = computed(
  () =>
    cohortsData.value?.summary ?? ({} as Record<CohortLabel, CohortSummary>),
);
const totals = computed(() => cohortsData.value?.totals ?? null);

// Cohort filter
const activeCohort = ref<CohortLabel | null>(null);

function toggleCohortFilter(label: CohortLabel) {
  const newValue = activeCohort.value === label ? null : label;
  activeCohort.value = newValue;
  window.posthog?.capture("cohort_filter_changed", { filter: newValue });
}

// Expanded rows (for model-swap details)
const expandedRows = ref<Set<string>>(new Set());

function toggleRow(id: string) {
  const next = new Set(expandedRows.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedRows.value = next;
}

// AI discovery
const discoveryClusters = ref<DiscoveredCluster[]>([]);
const discoverySource = ref<"ai" | "deterministic" | null>(null);
const discoveryLoading = ref(false);
const discoveryLoaded = ref(false);
const discoveryExpanded = ref(false);
const discoveryFilter = ref<string | null>(null);
const activeClusterName = ref<string | null>(null);

async function _loadDiscovery() {
  discoveryLoading.value = true;
  try {
    if (!isLoggedIn.value) {
      discoveryClusters.value = SAMPLE_DISCOVERY.clusters;
      discoverySource.value = SAMPLE_DISCOVERY.source;
      discoveryLoaded.value = true;
      discoveryExpanded.value = true;
      return;
    }
    const res = await discoverCohorts();
    discoveryClusters.value = res.clusters;
    discoverySource.value = res.source;
    discoveryLoaded.value = true;
    discoveryExpanded.value = true;
    window.posthog?.capture("ai_discovery_run");
  } catch (e: any) {
    toast.error(e?.message || "Failed to discover patterns");
  } finally {
    discoveryLoading.value = false;
  }
}

function _selectCluster(cluster: DiscoveredCluster) {
  if (activeClusterName.value === cluster.name) {
    activeClusterName.value = null;
    discoveryFilter.value = null;
  } else {
    activeClusterName.value = cluster.name;
    discoveryFilter.value = cluster.name;
  }
}

// Cohort meta
const cohortMeta: Record<CohortLabel, { label: string; color: string }> = {
  unprofitable: { label: "Unprofitable", color: "bg-red-100 text-red-700" },
  at_risk: { label: "At Risk", color: "bg-yellow-100 text-yellow-700" },
  rising_cost: { label: "Rising Cost", color: "bg-orange-100 text-orange-700" },
  inactive: { label: "Inactive", color: "bg-gray-100 text-gray-600" },
  champion: { label: "Champion", color: "bg-green-100 text-green-700" },
  healthy: { label: "Healthy", color: "bg-blue-100 text-blue-700" },
};

const mrrMeta: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "bg-blue-100 text-blue-700" },
  expansion: { label: "Expansion", color: "bg-green-100 text-green-700" },
  contraction: { label: "Contraction", color: "bg-yellow-100 text-yellow-700" },
  churned: { label: "Churned", color: "bg-red-100 text-red-700" },
  stable: { label: "Stable", color: "bg-gray-100 text-gray-600" },
};

const cohortLabels: CohortLabel[] = [
  "unprofitable",
  "at_risk",
  "rising_cost",
  "inactive",
  "champion",
  "healthy",
];

function healthColor(score: number): string {
  if (score < 30) return "bg-red-500";
  if (score < 60) return "bg-yellow-500";
  return "bg-green-500";
}

function _severityBorder(severity: string): string {
  switch (severity) {
    case "critical":
      return "border-red-400";
    case "warning":
      return "border-yellow-400";
    case "positive":
      return "border-green-400";
    default:
      return "border-blue-400";
  }
}

// Filtered customers
const discoveredCustomerIds = computed(() => {
  if (!discoveryFilter.value) return null;
  const cluster = discoveryClusters.value.find(
    (c) => c.name === discoveryFilter.value,
  );
  if (!cluster) return null;
  return new Set(cluster.customer_ids);
});

const filteredCustomers = computed(() => {
  let list = customers.value;
  if (activeCohort.value) {
    list = list.filter((c) => c.cohort === activeCohort.value);
  }
  if (discoveredCustomerIds.value) {
    list = list.filter((c) => discoveredCustomerIds.value!.has(c.customer_id));
  }
  if (excludePatterns.value.length > 0) {
    list = list.filter((c) => {
      const name = (c.customer_name || "").toLowerCase();
      const id = c.customer_id.toLowerCase();
      return !excludePatterns.value.some(
        (p) => name.includes(p) || id.includes(p),
      );
    });
  }
  return [...list].sort((a, b) => a.health_score - b.health_score);
});

const excludedCount = computed(() => {
  if (excludePatterns.value.length === 0) return 0;
  return customers.value.filter((c) => {
    const name = (c.customer_name || "").toLowerCase();
    const id = c.customer_id.toLowerCase();
    return excludePatterns.value.some(
      (p) => name.includes(p) || id.includes(p),
    );
  }).length;
});
</script>

<template>
  <div class="space-y-6">
    <!-- Page header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Cohorts</h1>
        <p class="text-sm text-muted-foreground mt-1">
          Customer health and segmentation
        </p>
      </div>
      <div class="flex items-center gap-3">
        <div class="relative">
          <button
            class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            @click="showExcludeEditor = !showExcludeEditor"
          >
            <Settings2 class="h-3.5 w-3.5" />
            Exclude
            <span
              v-if="excludePatterns.length"
              class="text-xs bg-muted rounded-full px-1.5"
            >
              {{ excludedCount }} hidden
            </span>
          </button>
          <div
            v-if="showExcludeEditor"
            class="absolute right-0 top-8 z-20 w-72 rounded-lg border bg-background shadow-lg p-3 space-y-2"
          >
            <p class="text-xs font-medium">
              Hide customers where name or ID contains:
            </p>
            <div class="flex gap-1.5">
              <Input
                v-model="excludeInput"
                placeholder="e.g. test, internal, demo"
                class="flex-1 text-xs"
                @keydown.enter="addExcludePattern"
              />
              <Button
                size="sm"
                variant="outline"
                class="h-9 px-2"
                @click="addExcludePattern"
              >
                <Plus class="h-3.5 w-3.5" />
              </Button>
            </div>
            <div v-if="excludePatterns.length" class="flex flex-wrap gap-1.5">
              <span
                v-for="(pattern, i) in excludePatterns"
                :key="pattern"
                class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                {{ pattern }}
                <button
                  class="hover:text-foreground"
                  @click="removeExcludePattern(i)"
                >
                  <X class="h-3 w-3" />
                </button>
              </span>
            </div>
            <p
              v-if="excludePatterns.length"
              class="text-[10px] text-muted-foreground"
            >
              Saved across sessions
            </p>
          </div>
        </div>
        <Button v-if="isLoggedIn" size="sm" @click="openCreateDialog">
          <Plus class="h-3.5 w-3.5 mr-1.5" />
          New Cohort
        </Button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="space-y-4">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Skeleton v-for="i in 4" :key="i" class="h-24 rounded-lg" />
      </div>
      <Skeleton class="h-64 rounded-lg" />
    </div>

    <!-- Error -->
    <Card v-else-if="isError" class="p-6">
      <div class="flex items-center gap-3 text-destructive">
        <AlertCircle class="h-5 w-5" />
        <span>Failed to load cohort data</span>
      </div>
    </Card>

    <!-- Empty state -->
    <div
      v-else-if="!customers.length"
      class="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto"
    >
      <Database class="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p class="text-sm font-medium mb-1">No customer data yet</p>
      <p class="text-xs text-muted-foreground mb-4">
        Import data from the Data Sources page to see customer cohorts.
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

    <!-- Main content -->
    <template v-else>
      <!-- KPI cards -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card class="p-4">
          <p class="text-xs text-muted-foreground uppercase tracking-wider">
            Customers
          </p>
          <p class="text-2xl font-semibold mt-1">
            {{ totals?.customers ?? 0 }}
          </p>
        </Card>
        <Card class="p-4">
          <p class="text-xs text-muted-foreground uppercase tracking-wider">
            Revenue
          </p>
          <p class="text-2xl font-semibold mt-1">
            {{ fmt(totals?.revenue ?? 0) }}
          </p>
        </Card>
        <Card class="p-4">
          <p class="text-xs text-muted-foreground uppercase tracking-wider">
            Cost
          </p>
          <p class="text-2xl font-semibold mt-1">
            {{ fmt(totals?.cost ?? 0) }}
          </p>
        </Card>
        <Card class="p-4">
          <p class="text-xs text-muted-foreground uppercase tracking-wider">
            Avg Health Score
          </p>
          <p class="text-2xl font-semibold mt-1">
            {{ totals?.avg_health_score?.toFixed(0) ?? "—" }}
          </p>
        </Card>
      </div>

      <!-- Cohort filter chips + column settings -->
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="label in cohortLabels"
          :key="label"
          class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
          :class="[
            activeCohort === label
              ? cohortMeta[label].color + ' ring-2 ring-offset-1 ring-current'
              : 'bg-muted text-muted-foreground hover:bg-muted/80',
          ]"
          @click="toggleCohortFilter(label)"
        >
          {{ cohortMeta[label].label }}
          <span v-if="summary[label]" class="ml-1 opacity-70"
            >({{ summary[label].count }})</span
          >
        </button>

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

      <!-- Click-away overlays -->
      <div
        v-if="showColumnSettings"
        class="fixed inset-0 z-40"
        @click="showColumnSettings = false"
      />
      <div
        v-if="showExcludeEditor"
        class="fixed inset-0 z-10"
        @click="showExcludeEditor = false"
      />

      <!-- Customer table -->
      <Card class="overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b bg-muted/50">
                <th class="text-left p-3 font-medium w-6"></th>
                <th
                  v-for="col in visibleColumns"
                  :key="col.id"
                  class="p-3 font-medium"
                  :class="col.align === 'right' ? 'text-right' : 'text-left'"
                >
                  {{ col.label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="c in filteredCustomers" :key="c.customer_id">
                <tr
                  class="group border-b hover:bg-muted/30 transition-colors"
                  :class="{ 'cursor-pointer': c.model_swap_suggestion }"
                  @click="
                    c.model_swap_suggestion
                      ? toggleRow(c.customer_id)
                      : undefined
                  "
                >
                  <td class="p-3">
                    <component
                      :is="
                        expandedRows.has(c.customer_id)
                          ? ChevronDown
                          : ChevronRight
                      "
                      v-if="c.model_swap_suggestion"
                      class="h-3.5 w-3.5 text-muted-foreground"
                    />
                  </td>

                  <template v-for="col in visibleColumns" :key="col.id">
                    <!-- Customer -->
                    <td v-if="col.id === 'customer'" class="p-3">
                      <div class="flex items-center gap-2">
                        <span class="font-medium">{{ c.customer_name }}</span>
                        <span
                          class="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium"
                          :class="cohortMeta[c.cohort].color"
                        >
                          {{ cohortMeta[c.cohort].label }}
                        </span>
                      </div>
                    </td>

                    <!-- Health -->
                    <td v-else-if="col.id === 'health'" class="p-3">
                      <div class="flex items-center gap-2">
                        <span
                          class="h-2 w-2 rounded-full"
                          :class="healthColor(c.health_score)"
                        />
                        <span>{{ c.health_score }}</span>
                      </div>
                    </td>

                    <!-- Revenue -->
                    <td v-else-if="col.id === 'revenue'" class="p-3 text-right">
                      {{ fmt(c.total_revenue) }}
                    </td>

                    <!-- Cost -->
                    <td v-else-if="col.id === 'cost'" class="p-3 text-right">
                      {{ fmt(c.total_cost) }}
                    </td>

                    <!-- Margin -->
                    <td v-else-if="col.id === 'margin'" class="p-3 text-right">
                      {{ fmtPct(c.margin_pct) }}
                    </td>

                    <!-- Active Days -->
                    <td
                      v-else-if="col.id === 'active_days'"
                      class="p-3 text-right"
                    >
                      {{ c.active_days_30d }}
                    </td>

                    <!-- MRR -->
                    <td v-else-if="col.id === 'mrr'" class="p-3">
                      <span
                        v-if="c.mrr_movement"
                        class="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium"
                        :class="
                          mrrMeta[c.mrr_movement]?.color ??
                          'bg-gray-100 text-gray-600'
                        "
                      >
                        {{ mrrMeta[c.mrr_movement]?.label ?? c.mrr_movement }}
                      </span>
                      <span v-else class="text-muted-foreground">—</span>
                    </td>
                  </template>
                </tr>
                <!-- Expanded model-swap row -->
                <tr
                  v-if="
                    expandedRows.has(c.customer_id) && c.model_swap_suggestion
                  "
                  class="bg-muted/20"
                >
                  <td></td>
                  <td :colspan="colCount - 1" class="p-3">
                    <div class="flex items-center gap-4 text-xs">
                      <span class="text-muted-foreground"
                        >Model swap suggestion:</span
                      >
                      <span>{{ c.top_model }}</span>
                      <ArrowRight class="h-3 w-3 text-muted-foreground" />
                      <span class="font-medium">{{
                        c.model_swap_suggestion.suggested_model
                      }}</span>
                      <span class="text-muted-foreground">
                        {{
                          fmt(c.model_swap_suggestion.current_cost_per_event)
                        }}/event
                      </span>
                      <ArrowRight class="h-3 w-3 text-muted-foreground" />
                      <span class="text-green-600">
                        {{
                          fmt(c.model_swap_suggestion.suggested_cost_per_event)
                        }}/event
                      </span>
                      <span class="text-green-600 font-medium">
                        ({{
                          c.model_swap_suggestion.potential_savings_pct.toFixed(
                            0,
                          )
                        }}% savings)
                      </span>
                    </div>
                  </td>
                </tr>
              </template>
              <tr v-if="!filteredCustomers.length">
                <td
                  :colspan="colCount"
                  class="p-6 text-center text-muted-foreground"
                >
                  No customers match the current filters.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </template>

    <!-- Create Cohort Dialog -->
    <DialogRoot
      :open="createDialogOpen"
      @update:open="createDialogOpen = $event"
    >
      <DialogPortal>
        <DialogOverlay
          class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogContent
          class="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg"
        >
          <div class="flex items-center justify-between mb-4">
            <DialogTitle class="text-lg font-semibold">New Cohort</DialogTitle>
            <DialogClose
              class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X class="h-4 w-4" />
            </DialogClose>
          </div>

          <div class="space-y-4">
            <!-- Name -->
            <div>
              <label class="text-sm font-medium mb-1.5 block">Name</label>
              <input
                v-model="newCohortName"
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="e.g. Enterprise EU"
              />
            </div>

            <!-- Description -->
            <div>
              <label class="text-sm font-medium mb-1.5 block"
                >Description
                <span class="text-muted-foreground font-normal"
                  >(optional)</span
                ></label
              >
              <input
                v-model="newCohortDescription"
                class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="High-value EU customers"
              />
            </div>

            <!-- Color -->
            <div>
              <label class="text-sm font-medium mb-1.5 block">Color</label>
              <div class="flex gap-2">
                <button
                  v-for="color in COHORT_COLORS"
                  :key="color"
                  class="h-6 w-6 rounded-full transition-all"
                  :class="
                    newCohortColor === color
                      ? 'ring-2 ring-offset-2 ring-primary'
                      : 'hover:scale-110'
                  "
                  :style="{ backgroundColor: color }"
                  @click="newCohortColor = color"
                />
              </div>
            </div>

            <!-- Type toggle -->
            <div>
              <label class="text-sm font-medium mb-1.5 block">Type</label>
              <div class="flex gap-1 p-0.5 bg-muted rounded-md">
                <button
                  class="flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors"
                  :class="
                    cohortType === 'dynamic'
                      ? 'bg-background shadow-sm'
                      : 'text-muted-foreground'
                  "
                  @click="cohortType = 'dynamic'"
                >
                  Rule-based
                </button>
                <button
                  class="flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors"
                  :class="
                    cohortType === 'static'
                      ? 'bg-background shadow-sm'
                      : 'text-muted-foreground'
                  "
                  @click="cohortType = 'static'"
                >
                  Manual
                </button>
              </div>
            </div>

            <!-- Rules (dynamic) -->
            <div v-if="cohortType === 'dynamic'">
              <label class="text-sm font-medium mb-1.5 block">Rules</label>
              <div class="space-y-2">
                <div
                  v-for="(rule, i) in rules"
                  :key="i"
                  class="flex items-center gap-1.5"
                >
                  <select
                    v-model="rule.field"
                    class="flex-1 rounded-md border bg-background px-2 pr-6 py-1.5 text-xs appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_6px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option
                      v-for="f in RULE_FIELDS"
                      :key="f.value"
                      :value="f.value"
                    >
                      {{ f.label }}
                    </option>
                  </select>
                  <select
                    v-model="rule.operator"
                    class="w-16 rounded-md border bg-background px-2 pr-5 py-1.5 text-xs appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px] bg-[right_4px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option
                      v-for="op in RULE_OPERATORS"
                      :key="op.value"
                      :value="op.value"
                    >
                      {{ op.label }}
                    </option>
                  </select>
                  <input
                    v-model.number="rule.value"
                    type="number"
                    class="w-20 rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    v-if="rules.length > 1"
                    class="p-1 text-muted-foreground hover:text-foreground"
                    @click="removeRule(i)"
                  >
                    <X class="h-3 w-3" />
                  </button>
                </div>
              </div>
              <button
                class="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
                @click="addRule"
              >
                <Plus class="h-3 w-3" /> Add rule
              </button>
              <p class="text-[11px] text-muted-foreground mt-1.5">
                Customers matching all rules are automatically included.
              </p>
            </div>

            <!-- Customers (static) -->
            <div v-if="cohortType === 'static'">
              <label class="text-sm font-medium mb-1.5 block">
                Customers
                <span class="text-muted-foreground font-normal">
                  ({{ selectedCustomerIds.size }} selected)
                </span>
              </label>
              <input
                v-model="customerSearch"
                class="w-full rounded-md border bg-background px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="Search customers..."
              />
              <div class="max-h-40 overflow-y-auto border rounded-md">
                <label
                  v-for="c in filteredCustomerList"
                  :key="c.customer_id"
                  class="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    :checked="selectedCustomerIds.has(c.customer_id)"
                    class="h-3.5 w-3.5 rounded border-input accent-primary"
                    @change="toggleCustomer(c.customer_id)"
                  />
                  <span>{{ c.name || c.customer_id }}</span>
                </label>
                <div
                  v-if="filteredCustomerList.length === 0"
                  class="px-3 py-3 text-xs text-muted-foreground text-center"
                >
                  No customers found
                </div>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex justify-end gap-2 mt-6">
            <Button
              variant="outline"
              size="sm"
              @click="createDialogOpen = false"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              :disabled="creating || !newCohortName.trim()"
              @click="handleCreate"
            >
              <Loader2
                v-if="creating"
                class="h-3.5 w-3.5 mr-1.5 animate-spin"
              />
              Create
            </Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>
