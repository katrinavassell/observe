<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { getCohorts, discoverCohorts } from "@/lib/api";
import type {
  CohortLabel,
  CohortSummary,
  DiscoveredCluster,
} from "@/lib/api";
import {
  AlertCircle,
  Database,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Loader2,
} from "lucide-vue-next";
import { Card, Skeleton, Button } from "@/components/ui";
import { formatCurrency as fmt, formatPct as fmtPct } from "@/lib/format";
import { toast } from "vue-sonner";

const {
  data: cohortsData,
  isLoading,
  isError,
} = useQuery({
  queryKey: ["cohorts"],
  queryFn: getCohorts,
});

const customers = computed(() => cohortsData.value?.customers ?? []);
const summary = computed(
  () =>
    cohortsData.value?.summary ?? ({} as Record<CohortLabel, CohortSummary>),
);
const totals = computed(() => cohortsData.value?.totals ?? null);

// Cohort filter
const activeCohort = ref<CohortLabel | null>(null);

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

async function loadDiscovery() {
  discoveryLoading.value = true;
  try {
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

function selectCluster(cluster: DiscoveredCluster) {
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

function severityBorder(severity: string): string {
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
  return [...list].sort((a, b) => a.health_score - b.health_score);
});
</script>

<template>
  <div class="space-y-6">
    <!-- Page header -->
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Cohorts</h1>
      <p class="text-muted-foreground mt-1">Customer health and segmentation</p>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="space-y-4">
      <div class="grid grid-cols-4 gap-4">
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
    <Card v-else-if="!customers.length" class="p-12 text-center">
      <Database class="h-10 w-10 mx-auto text-muted-foreground mb-3" />
      <p class="text-muted-foreground">
        No customer data yet. Import data from the Data Sources page.
      </p>
    </Card>

    <!-- Main content -->
    <template v-else>
      <!-- KPI cards -->
      <div class="grid grid-cols-4 gap-4">
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

      <!-- Cohort filter chips -->
      <div class="flex flex-wrap gap-2">
        <button
          v-for="label in cohortLabels"
          :key="label"
          class="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
          :class="[
            activeCohort === label
              ? cohortMeta[label].color + ' ring-2 ring-offset-1 ring-current'
              : 'bg-muted text-muted-foreground hover:bg-muted/80',
          ]"
          @click="activeCohort = activeCohort === label ? null : label"
        >
          {{ cohortMeta[label].label }}
          <span v-if="summary[label]" class="ml-1 opacity-70"
            >({{ summary[label].count }})</span
          >
        </button>
      </div>

      <!-- AI discovery -->
      <Card class="p-4">
        <div class="flex items-center justify-between">
          <button
            v-if="discoveryLoaded"
            class="flex items-center gap-1.5 text-sm font-medium hover:text-foreground transition-colors"
            @click="discoveryExpanded = !discoveryExpanded"
          >
            <ChevronDown v-if="discoveryExpanded" class="h-4 w-4" />
            <ChevronRight v-else class="h-4 w-4" />
            AI Discovery
            <span class="text-xs text-muted-foreground font-normal ml-1">
              {{ discoveryClusters.length }} patterns found
            </span>
          </button>
          <h2 v-else class="text-sm font-medium">AI Discovery</h2>
          <div class="flex items-center gap-2">
            <span
              v-if="discoveryLoaded"
              class="text-[10px] text-muted-foreground"
            >
              1 AI credit used
            </span>
            <Button
              size="sm"
              variant="outline"
              :disabled="discoveryLoading"
              @click="loadDiscovery"
            >
              <Loader2
                v-if="discoveryLoading"
                class="h-3.5 w-3.5 mr-1.5 animate-spin"
              />
              <Sparkles v-else class="h-3.5 w-3.5 mr-1.5" />
              {{ discoveryLoaded ? "Run Again" : "Discover Hidden Patterns" }}
            </Button>
          </div>
        </div>
        <div
          v-if="
            discoveryExpanded && discoveryLoaded && discoveryClusters.length
          "
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3"
        >
          <Card
            v-for="cluster in discoveryClusters"
            :key="cluster.name"
            class="p-3 border-l-4 cursor-pointer transition-colors"
            :class="[
              severityBorder(cluster.severity),
              activeClusterName === cluster.name
                ? 'bg-accent'
                : 'hover:bg-accent/50',
            ]"
            @click="selectCluster(cluster)"
          >
            <p class="text-xs font-medium">{{ cluster.name }}</p>
            <p class="text-xs text-muted-foreground mt-1">
              {{ cluster.description }}
            </p>
            <p class="text-xs mt-2">
              <span class="font-medium">{{ cluster.customer_ids.length }}</span>
              customers
            </p>
            <p class="text-xs text-muted-foreground mt-1">
              {{ cluster.recommended_action }}
            </p>
          </Card>
        </div>
        <p
          v-else-if="
            discoveryExpanded && discoveryLoaded && !discoveryClusters.length
          "
          class="text-xs text-muted-foreground mt-3"
        >
          No hidden patterns discovered.
        </p>
      </Card>

      <!-- Customer table -->
      <Card class="overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b bg-muted/50">
                <th class="text-left p-3 font-medium w-6"></th>
                <th class="text-left p-3 font-medium">Customer</th>
                <th class="text-left p-3 font-medium">Health</th>
                <th class="text-right p-3 font-medium">Revenue</th>
                <th class="text-right p-3 font-medium">Cost</th>
                <th class="text-right p-3 font-medium">Margin</th>
                <th class="text-right p-3 font-medium">Active Days</th>
                <th class="text-left p-3 font-medium">MRR</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="c in filteredCustomers" :key="c.customer_id">
                <tr
                  class="border-b hover:bg-muted/30 transition-colors"
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
                  <td class="p-3">
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
                  <td class="p-3">
                    <div class="flex items-center gap-2">
                      <span
                        class="h-2 w-2 rounded-full"
                        :class="healthColor(c.health_score)"
                      />
                      <span>{{ c.health_score }}</span>
                    </div>
                  </td>
                  <td class="p-3 text-right">{{ fmt(c.total_revenue) }}</td>
                  <td class="p-3 text-right">{{ fmt(c.total_cost) }}</td>
                  <td class="p-3 text-right">{{ fmtPct(c.margin_pct) }}</td>
                  <td class="p-3 text-right">{{ c.active_days_30d }}</td>
                  <td class="p-3">
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
                </tr>
                <!-- Expanded model-swap row -->
                <tr
                  v-if="
                    expandedRows.has(c.customer_id) && c.model_swap_suggestion
                  "
                  class="bg-muted/20"
                >
                  <td></td>
                  <td colspan="7" class="p-3">
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
                <td colspan="8" class="p-6 text-center text-muted-foreground">
                  No customers match the current filters.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </template>
  </div>
</template>
