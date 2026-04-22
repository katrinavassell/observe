<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { getModels, type ModelSummary } from "@/lib/api";
import {
  Cpu,
  AlertCircle,
  Plug,
  Settings2,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  DollarSign,
  Search,
  X,
} from "lucide-vue-next";
import { Skeleton, Button, Card, CardContent } from "@/components/ui";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/composables/useAuth";
import { GUEST_MODELS } from "@/lib/guest-preview";

const router = useRouter();
const queryClient = useQueryClient();
const { isLoggedIn } = useAuth();

// ── Column configuration ─────────────────────────────────────────────────────

interface TableColumn {
  id: string;
  label: string;
  visible: boolean;
  align: "left" | "right";
}

const DEFAULT_COLUMNS: TableColumn[] = [
  { id: "model", label: "Model", visible: true, align: "left" },
  { id: "provider", label: "Provider", visible: true, align: "left" },
  { id: "events", label: "Events", visible: true, align: "right" },
  { id: "customers", label: "Customers", visible: true, align: "right" },
  { id: "features", label: "Features", visible: true, align: "right" },
  { id: "usage", label: "Usage", visible: true, align: "right" },
  { id: "total_cost", label: "Model Cost", visible: true, align: "right" },
  { id: "avg_cost", label: "Avg Cost/Event", visible: true, align: "right" },
  { id: "last_seen", label: "Last Seen", visible: true, align: "right" },
];

const STORAGE_KEY = "observe:models-columns:v2";

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
const _colCount = computed(() => visibleColumns.value.length);
const showColumnSettings = ref(false);

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

const {
  data: realModels,
  isLoading,
  isError,
} = useQuery({
  queryKey: ["models"],
  queryFn: getModels,
  enabled: computed(() => isLoggedIn.value),
  placeholderData: [],
});
const models = computed(() =>
  isLoggedIn.value ? realModels.value : GUEST_MODELS,
);

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString();
}

const providerColors: Record<string, string> = {
  openai: "bg-emerald-100 text-emerald-700",
  anthropic: "bg-orange-100 text-orange-700",
  google: "bg-blue-100 text-blue-700",
};

const providerBarColors: Record<string, string> = {
  openai: "#059669",
  anthropic: "#ea580c",
  google: "#2563eb",
};

function providerClass(provider: string | null) {
  if (!provider) return "bg-gray-100 text-gray-600";
  return providerColors[provider.toLowerCase()] || "bg-gray-100 text-gray-600";
}

function providerBarColor(provider: string | null) {
  if (!provider) return "#9ca3af";
  return providerBarColors[provider.toLowerCase()] || "#9ca3af";
}

const costByProvider = computed(() => {
  if (!models.value || models.value.length === 0) return [];
  const map: Record<string, number> = {};
  for (const m of models.value) {
    const key = m.model_provider || "unknown";
    map[key] = (map[key] || 0) + m.total_cost;
  }
  const total = Object.values(map).reduce((s, v) => s + v, 0);
  if (total === 0) return [];
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([provider, cost]) => ({
      provider,
      cost,
      pct: (cost / total) * 100,
      color: providerBarColor(provider === "unknown" ? null : provider),
    }));
});

function goToModel(model: string) {
  router.push({ path: "/events", query: { model } });
}

function usageTooltip(m: ModelSummary): string {
  if (m.total_input_tokens != null || m.total_output_tokens != null) {
    const inp = (m.total_input_tokens ?? 0).toLocaleString();
    const out = (m.total_output_tokens ?? 0).toLocaleString();
    return `${inp} in / ${out} out`;
  }
  if (m.total_usage) {
    return `${m.total_usage.toLocaleString()} units (token split unavailable)`;
  }
  return "No usage recorded";
}

// ── Pricing table ───────────────────────────────────────────────────────────
const showPricingTable = ref(false);
const pricingSearch = ref("");
const pricingProviderFilter = ref("all");

const { data: pricingData } = useQuery({
  queryKey: ["model-pricing"],
  queryFn: async () => {
    const res = await fetch("/api/pricing/models");
    if (!res.ok) throw new Error("Failed to fetch pricing");
    return res.json() as Promise<{
      models: Array<{
        model: string;
        provider: string;
        input_cost_per_million: number;
        output_cost_per_million: number;
      }>;
    }>;
  },
  enabled: showPricingTable,
});

const pricingProviders = computed(() => {
  if (!pricingData.value) return [];
  return [...new Set(pricingData.value.models.map((m) => m.provider))].sort();
});

const filteredPricing = computed(() => {
  if (!pricingData.value) return [];
  return pricingData.value.models
    .filter((m) => {
      if (
        pricingProviderFilter.value !== "all" &&
        m.provider !== pricingProviderFilter.value
      )
        return false;
      if (
        pricingSearch.value &&
        !m.model.toLowerCase().includes(pricingSearch.value.toLowerCase())
      )
        return false;
      return true;
    })
    .sort((a, b) => a.model.localeCompare(b.model));
});
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Models</h1>
        <p class="text-sm text-muted-foreground mt-1">
          Cost and usage breakdown by AI model
        </p>
      </div>

      <div class="flex items-center gap-2">
        <!-- Pricing Table button -->
        <Button
          variant="outline"
          size="sm"
          class="h-9"
          @click="showPricingTable = true"
        >
          <DollarSign class="h-4 w-4 mr-1.5" />
          Pricing Table
        </Button>

        <!-- Column settings -->
        <div class="relative">
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
    </div>

    <!-- Click-away overlay -->
    <div
      v-if="showColumnSettings"
      class="fixed inset-0 z-40"
      @click="showColumnSettings = false"
    />

    <!-- Pricing Table Dialog -->
    <Teleport to="body">
      <div
        v-if="showPricingTable"
        class="fixed inset-0 z-50 flex items-start justify-end bg-background/80 backdrop-blur-sm"
        @click.self="showPricingTable = false"
      >
        <div
          class="w-full max-w-lg h-full border-l bg-card shadow-xl flex flex-col"
        >
          <div class="flex items-center justify-between px-4 py-3 border-b">
            <div class="flex items-center gap-2">
              <DollarSign class="h-4 w-4" />
              <h3 class="font-semibold text-sm">Model Pricing</h3>
            </div>
            <button
              class="p-1 rounded-md text-muted-foreground hover:text-foreground"
              @click="showPricingTable = false"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <p class="px-4 py-2 text-xs text-muted-foreground border-b">
            Per-token rates used for auto-cost calculation when you don't send
            costAmount. Updated regularly.
          </p>

          <!-- Filters -->
          <div class="px-4 py-2 border-b space-y-2">
            <div class="relative">
              <Search
                class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
              />
              <input
                v-model="pricingSearch"
                type="text"
                placeholder="Search models..."
                class="w-full h-8 rounded-md border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div class="flex gap-1 flex-wrap">
              <button
                class="px-2 py-1 rounded text-xs font-medium transition-colors"
                :class="
                  pricingProviderFilter === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                "
                @click="pricingProviderFilter = 'all'"
              >
                All
              </button>
              <button
                v-for="p in pricingProviders"
                :key="p"
                class="px-2 py-1 rounded text-xs font-medium transition-colors capitalize"
                :class="
                  pricingProviderFilter === p
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                "
                @click="pricingProviderFilter = p"
              >
                {{ p }}
              </button>
            </div>
          </div>

          <!-- Table -->
          <div class="flex-1 overflow-y-auto">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-card border-b">
                <tr>
                  <th
                    class="text-left font-medium text-muted-foreground px-4 py-2"
                  >
                    Model
                  </th>
                  <th
                    class="text-right font-medium text-muted-foreground px-4 py-2"
                  >
                    Input / 1M
                  </th>
                  <th
                    class="text-right font-medium text-muted-foreground px-4 py-2"
                  >
                    Output / 1M
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="m in filteredPricing"
                  :key="`${m.provider}-${m.model}`"
                  class="border-b last:border-0 hover:bg-muted/50"
                >
                  <td class="px-4 py-2 font-mono">{{ m.model }}</td>
                  <td class="px-4 py-2 text-right">
                    ${{ m.input_cost_per_million.toFixed(2) }}
                  </td>
                  <td class="px-4 py-2 text-right">
                    ${{ m.output_cost_per_million.toFixed(2) }}
                  </td>
                </tr>
                <tr v-if="filteredPricing.length === 0">
                  <td
                    colspan="3"
                    class="px-4 py-8 text-center text-muted-foreground"
                  >
                    No models found
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Summary -->
    <div
      v-if="models && models.length > 0"
      class="grid grid-cols-2 sm:grid-cols-4 gap-4"
    >
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs text-muted-foreground mb-1">Models Tracked</div>
        <div class="text-2xl font-semibold">{{ models.length }}</div>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs text-muted-foreground mb-1">Model Cost</div>
        <div class="text-2xl font-semibold">
          {{ formatCurrency(models.reduce((s, m) => s + m.total_cost, 0)) }}
        </div>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs text-muted-foreground mb-1">Total Events</div>
        <div class="text-2xl font-semibold">
          {{ models.reduce((s, m) => s + m.event_count, 0).toLocaleString() }}
        </div>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <div class="text-xs text-muted-foreground mb-1">Avg Cost/Event</div>
        <div class="text-2xl font-semibold">
          {{
            formatCurrency(
              models.reduce((s, m) => s + m.event_count, 0) > 0
                ? models.reduce((s, m) => s + m.total_cost, 0) /
                    models.reduce((s, m) => s + m.event_count, 0)
                : 0,
            )
          }}
        </div>
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
        <div
          v-for="p in costByProvider"
          :key="p.provider"
          class="flex items-center gap-1.5 text-xs"
        >
          <span
            class="inline-block w-2.5 h-2.5 rounded-full"
            :style="{ backgroundColor: p.color }"
          />
          <span class="capitalize">{{ p.provider }}</span>
          <span class="text-muted-foreground">{{
            formatCurrency(p.cost)
          }}</span>
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
    <div
      v-else-if="isError"
      class="flex flex-col items-center justify-center py-24 text-center"
    >
      <AlertCircle class="h-10 w-10 text-muted-foreground mb-4" />
      <p class="text-muted-foreground mb-4">Failed to load model data.</p>
      <Button @click="queryClient.invalidateQueries({ queryKey: ['models'] })"
        >Try Again</Button
      >
    </div>
    <!-- Empty -->
    <div
      v-else-if="!models || models.length === 0"
      class="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto"
    >
      <Cpu class="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p class="text-sm font-medium mb-1">No model data yet</p>
      <p class="text-xs text-muted-foreground mb-4">
        Connect an AI provider (OpenAI, Anthropic) or send events via the SDK
        with a model field.
      </p>
      <Button size="sm" variant="outline" @click="router.push('/data-sources')">
        <Plug class="h-3.5 w-3.5 mr-1.5" />
        Data Sources
      </Button>
    </div>
    <!-- Table -->
    <div v-else class="rounded-lg border bg-card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm table-auto">
          <thead
            class="bg-muted/50 text-muted-foreground text-xs font-medium uppercase tracking-wider"
          >
            <tr>
              <th
                v-for="col in visibleColumns"
                :key="col.id"
                class="px-4 py-3 font-medium"
                :class="col.align === 'right' && 'text-right'"
              >
                {{ col.label }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr
              v-for="m in models"
              :key="m.model"
              class="hover:bg-muted/50 transition-colors cursor-pointer"
              @click="goToModel(m.model)"
            >
              <template v-for="col in visibleColumns" :key="col.id">
                <!-- Model -->
                <td
                  v-if="col.id === 'model'"
                  class="px-4 py-3 whitespace-nowrap"
                >
                  <span
                    class="font-mono text-xs bg-muted px-2 py-0.5 rounded"
                    >{{ m.model }}</span
                  >
                </td>

                <!-- Provider -->
                <td v-else-if="col.id === 'provider'" class="px-4 py-3">
                  <span
                    v-if="m.model_provider"
                    :class="[
                      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                      providerClass(m.model_provider),
                    ]"
                  >
                    {{ m.model_provider }}
                  </span>
                  <span v-else class="text-muted-foreground">—</span>
                </td>

                <!-- Events -->
                <td
                  v-else-if="col.id === 'events'"
                  class="px-4 py-3 text-right text-muted-foreground"
                >
                  {{ m.event_count.toLocaleString() }}
                </td>

                <!-- Customers -->
                <td
                  v-else-if="col.id === 'customers'"
                  class="px-4 py-3 text-right text-muted-foreground"
                >
                  {{ m.customer_count }}
                </td>

                <!-- Features -->
                <td
                  v-else-if="col.id === 'features'"
                  class="px-4 py-3 text-right text-muted-foreground"
                >
                  {{ m.feature_count }}
                </td>

                <!-- Usage -->
                <td
                  v-else-if="col.id === 'usage'"
                  class="px-4 py-3 text-right text-muted-foreground text-xs tabular-nums"
                  :title="usageTooltip(m)"
                >
                  {{ m.total_usage ? m.total_usage.toLocaleString() : "—" }}
                </td>

                <!-- Total Cost -->
                <td
                  v-else-if="col.id === 'total_cost'"
                  class="px-4 py-3 text-right tabular-nums text-xs"
                >
                  {{ formatCurrency(m.total_cost) }}
                </td>

                <!-- Avg Cost/Event -->
                <td
                  v-else-if="col.id === 'avg_cost'"
                  class="px-4 py-3 text-right tabular-nums text-xs"
                >
                  {{ formatCurrency(m.avg_cost_per_event) }}
                </td>

                <!-- Last Seen -->
                <td
                  v-else-if="col.id === 'last_seen'"
                  class="px-4 py-3 text-right text-muted-foreground text-xs"
                >
                  {{ formatDate(m.last_seen) }}
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
