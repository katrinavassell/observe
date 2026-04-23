<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import {
  getEventsByFeature,
  getEventsByModel,
  getEventsByCustomer,
  getEventsByAgent,
  getMrrMovements,
  getUsageLimits,
  getSourceBreakdown,
} from "@/lib/api";
import type {} from "@/lib/api";
import { AlertCircle, Plug, Info } from "lucide-vue-next";
import {
  Badge,
  Card,
  Skeleton,
  Button,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui";
import SourceBadge from "@/components/shared/SourceBadge.vue";
import MarginBadge from "@/components/shared/MarginBadge.vue";
import { formatCurrency as fmt } from "@/lib/format";
import { useAuth } from "@/composables/useAuth";
import {
  GUEST_EVENTS_BY_FEATURE,
  GUEST_EVENTS_BY_MODEL,
  GUEST_EVENTS_BY_CUSTOMER,
} from "@/lib/guest-preview";

const router = useRouter();
const queryClient = useQueryClient();
const { isLoggedIn } = useAuth();

type Tab = "feature" | "model" | "customer" | "agent" | "mrr";
const activeTab = ref<Tab>("feature");

const { data: _usageLimits } = useQuery({
  queryKey: ["usage-limits"],
  queryFn: getUsageLimits,
});

// Source breakdown for data attribution
const { data: sourceBreakdown } = useQuery({
  queryKey: ["source-breakdown"],
  queryFn: getSourceBreakdown,
});

const activeSources = computed(() => {
  if (!sourceBreakdown.value?.sources) return [];
  return sourceBreakdown.value.sources
    .filter((s) => s.event_count > 0 && s.source !== "sample")
    .sort((a, b) => b.event_count - a.event_count);
});

// Analytics data — logged-in users hit the API, guests get hardcoded
// client-side preview (see src/lib/guest-preview.ts). Sample data
// cannot leak into a real account because the server never sees it.
const {
  data: realFeatureData,
  isLoading: featuresLoading,
  isError: featuresError,
} = useQuery({
  queryKey: ["events-by-feature"],
  queryFn: getEventsByFeature,
  enabled: computed(() => isLoggedIn.value),
  placeholderData: [],
});
const featureData = computed(() =>
  isLoggedIn.value ? realFeatureData.value : GUEST_EVENTS_BY_FEATURE,
);

const {
  data: realModelData,
  isLoading: modelsLoading,
  isError: modelsError,
} = useQuery({
  queryKey: ["events-by-model"],
  queryFn: getEventsByModel,
  enabled: computed(() => isLoggedIn.value),
  placeholderData: [],
});
const modelData = computed(() =>
  isLoggedIn.value ? realModelData.value : GUEST_EVENTS_BY_MODEL,
);

const {
  data: realCustomerData,
  isLoading: customersLoading,
  isError: customersError,
} = useQuery({
  queryKey: ["events-by-customer"],
  queryFn: getEventsByCustomer,
  enabled: computed(() => isLoggedIn.value),
  placeholderData: [],
});
const customerData = computed(() =>
  isLoggedIn.value ? realCustomerData.value : GUEST_EVENTS_BY_CUSTOMER,
);

const { data: agentData } = useQuery({
  queryKey: ["events-by-agent"],
  queryFn: getEventsByAgent,
  enabled: computed(() => activeTab.value === "agent"),
});

const sortedAgents = computed(() => {
  if (!agentData.value) return [];
  return [...agentData.value].sort((a, b) => b.total_cost - a.total_cost);
});

const {
  data: mrrData,
  isLoading: mrrLoading,
  isError: mrrError,
} = useQuery({
  queryKey: ["mrr-movements"],
  queryFn: getMrrMovements,
  enabled: computed(() => activeTab.value === "mrr"),
});

const mrrMovements = computed(() => mrrData.value?.movements ?? []);
const mrrSummary = computed(() => mrrData.value?.summary ?? null);

const isLoading = computed(
  () => featuresLoading.value || modelsLoading.value || customersLoading.value,
);
const isError = computed(
  () => featuresError.value || modelsError.value || customersError.value,
);
const hasData = computed(
  () =>
    !isLoading.value &&
    !isError.value &&
    (featureData.value?.length ||
      modelData.value?.length ||
      customerData.value?.length),
);

const totalCost = computed(() => {
  if (!featureData.value) return 0;
  return featureData.value.reduce((s, f) => s + f.total_cost, 0);
});

const totalRevenue = computed(() => {
  if (!customerData.value) return 0;
  return customerData.value.reduce((s, c) => s + (c.total_revenue || 0), 0);
});

const hasRevenue = computed(() => totalRevenue.value > 0);

const grossMarginPct = computed(() => {
  if (totalRevenue.value === 0) return null;
  return ((totalRevenue.value - totalCost.value) / totalRevenue.value) * 100;
});

const sortedFeatures = computed(() => {
  if (!featureData.value) return [];
  return [...featureData.value].sort((a, b) => b.total_cost - a.total_cost);
});
const maxFeatureCost = computed(() => {
  if (!sortedFeatures.value.length) return 1;
  return Math.max(...sortedFeatures.value.map((f) => f.total_cost), 0.01);
});

const sortedModels = computed(() => {
  if (!modelData.value) return [];
  return [...modelData.value].sort((a, b) => b.total_cost - a.total_cost);
});
const maxModelCost = computed(() => {
  if (!sortedModels.value.length) return 1;
  return Math.max(...sortedModels.value.map((m) => m.total_cost), 0.01);
});

const sortedCustomers = computed(() => {
  if (!customerData.value) return [];
  return [...customerData.value].sort((a, b) => b.total_cost - a.total_cost);
});
const maxCustomerCost = computed(() => {
  if (!sortedCustomers.value.length) return 1;
  return Math.max(...sortedCustomers.value.map((c) => c.total_cost), 0.01);
});

// Tabs — hide Agent / MRR when empty; Cost Type is gone (overlapped By Feature).
const visibleTabs = computed(() => {
  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: "feature", label: "By Feature", count: sortedFeatures.value.length },
    { key: "model", label: "By Model", count: sortedModels.value.length },
    {
      key: "customer",
      label: "By Customer",
      count: sortedCustomers.value.length,
    },
  ];
  if (sortedAgents.value.length > 0) {
    tabs.push({
      key: "agent",
      label: "By Agent",
      count: sortedAgents.value.length,
    });
  }
  const movements = mrrMovements.value.filter(
    (m) => m.category !== "stable",
  ).length;
  if (movements > 0) {
    tabs.push({ key: "mrr", label: "MRR Movement", count: movements });
  }
  return tabs;
});

watch(visibleTabs, (tabs) => {
  if (!tabs.some((t) => t.key === activeTab.value)) {
    activeTab.value = "feature";
  }
});

// Data quality for insights
const totalEvents = computed(() => {
  if (!featureData.value) return 0;
  return featureData.value.reduce((s, f) => s + (f.event_count || 0), 0);
});
const dataConfidence = computed(() => {
  const n = totalEvents.value;
  if (n === 0)
    return { label: "No data", color: "text-muted-foreground", pct: 0 };
  if (n < 10) return { label: "Very low", color: "text-destructive", pct: 15 };
  if (n < 50) return { label: "Low", color: "text-warning", pct: 35 };
  if (n < 200) return { label: "Medium", color: "text-warning", pct: 60 };
  if (n < 500) return { label: "Good", color: "text-success", pct: 80 };
  return { label: "High", color: "text-success", pct: 95 };
});

function retry() {
  queryClient.invalidateQueries({ queryKey: ["events-by-feature"] });
  queryClient.invalidateQueries({ queryKey: ["events-by-model"] });
  queryClient.invalidateQueries({ queryKey: ["events-by-customer"] });
}
</script>

<template>
  <div class="space-y-6">
    <!-- Page header -->
    <div class="flex items-start justify-between">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-semibold tracking-tight">Analytics</h1>
          <Tooltip>
            <TooltipTrigger as-child>
              <Badge
                v-if="
                  dataConfidence.label !== 'Good' &&
                  dataConfidence.label !== 'High'
                "
                :variant="
                  dataConfidence.color === 'text-destructive'
                    ? 'destructive'
                    : 'warning'
                "
              >
                {{ dataConfidence.label }} &middot; {{ totalEvents }} events
              </Badge>
            </TooltipTrigger>
            <TooltipContent
              >Data confidence: {{ dataConfidence.label }}. Send more events for
              higher accuracy.</TooltipContent
            >
          </Tooltip>
        </div>
        <div class="flex items-center gap-2 mt-1">
          <p class="text-muted-foreground">
            Revenue, cost, and margin by feature, model, and customer
          </p>
          <div v-if="activeSources.length" class="flex items-center gap-1">
            <SourceBadge
              v-for="s in activeSources"
              :key="s.source"
              :source="s.source"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Error state -->
    <div
      v-if="isError && !isLoading"
      class="flex flex-col items-center justify-center py-24 text-center"
    >
      <AlertCircle class="h-10 w-10 text-muted-foreground mb-4" />
      <p class="text-muted-foreground mb-4">Failed to load analytics data.</p>
      <Button @click="retry">Try Again</Button>
    </div>

    <!-- Loading state -->
    <div v-else-if="isLoading">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card v-for="i in 3" :key="i" class="p-6">
          <Skeleton class="h-4 w-24 mb-2" />
          <Skeleton class="h-8 w-20" />
        </Card>
      </div>
      <Card class="p-6">
        <Skeleton class="h-8 w-48 mb-4" />
        <Skeleton v-for="i in 5" :key="i" class="h-10 w-full mb-2" />
      </Card>
    </div>

    <!-- Empty state (logged-in users only — guests auto-load sample data) -->
    <div
      v-else-if="!hasData"
      class="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto"
    >
      <Plug class="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p class="text-sm font-medium mb-1">No analytics data yet</p>
      <p class="text-xs text-muted-foreground mb-4">
        Connect your SDK to see cost breakdowns by feature, model, and customer.
      </p>
      <Button size="sm" variant="outline" @click="router.push('/data-sources')">
        <Plug class="h-3.5 w-3.5 mr-1.5" />
        Data Sources
      </Button>
    </div>

    <!-- Data loaded -->
    <template v-else>
      <!-- KPI cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <!-- Card 1: Revenue or Customers -->
        <Card class="p-6">
          <div
            class="flex items-center gap-1 text-sm font-medium text-muted-foreground"
          >
            {{ hasRevenue ? "Usage Revenue" : "Customers Tracked" }}
            <Tooltip v-if="hasRevenue">
              <TooltipTrigger as-child>
                <Info class="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent class="max-w-xs"
                >Sum of per-event usage revenue (metered + tiered) for the
                selected period. Does not include flat subscription
                MRR.</TooltipContent
              >
            </Tooltip>
          </div>
          <div class="text-3xl font-semibold tabular-nums mt-1">
            {{ hasRevenue ? fmt(totalRevenue) : (customerData?.length ?? 0) }}
          </div>
        </Card>

        <!-- Card 2: Total Cost (always) -->
        <Card class="p-6">
          <div
            class="flex items-center gap-1 text-sm font-medium text-muted-foreground"
          >
            Total Cost
            <Tooltip>
              <TooltipTrigger as-child>
                <Info class="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent class="max-w-xs"
                >Sum of all tracked AI costs (LLM inference, embeddings, API
                calls). Does not include infrastructure overhead unless
                separately uploaded via CSV.</TooltipContent
              >
            </Tooltip>
          </div>
          <div class="text-3xl font-semibold tabular-nums mt-1">
            {{ fmt(totalCost) }}
          </div>
        </Card>

        <!-- Card 3: Gross Margin or Events Tracked -->
        <Card class="p-6">
          <div
            class="flex items-center gap-1 text-sm font-medium text-muted-foreground"
          >
            {{ hasRevenue ? "Gross Margin" : "Events Tracked" }}
            <Tooltip v-if="hasRevenue">
              <TooltipTrigger as-child>
                <Info class="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent class="max-w-xs"
                >Revenue minus cost, divided by revenue.</TooltipContent
              >
            </Tooltip>
          </div>
          <div v-if="hasRevenue" class="flex items-center gap-2 mt-1">
            <span
              class="text-3xl font-semibold tabular-nums"
              :class="
                grossMarginPct >= 70
                  ? 'text-green-600'
                  : grossMarginPct >= 30
                    ? 'text-amber-600'
                    : 'text-red-600'
              "
              >{{
                grossMarginPct > 99 && grossMarginPct < 100
                  ? ">99"
                  : Math.round(grossMarginPct)
              }}%</span
            >
          </div>
          <div v-else class="text-3xl font-semibold tabular-nums mt-1">
            {{ totalEvents.toLocaleString() }}
          </div>
        </Card>
      </div>

      <!-- Tab bar -->
      <div class="flex gap-1 border-b">
        <button
          v-for="tab in visibleTabs"
          :key="tab.key"
          class="px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px"
          :class="
            activeTab === tab.key
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <span class="ml-1.5 text-xs text-muted-foreground"
            >({{ tab.count }})</span
          >
        </button>
      </div>

      <!-- Feature tab -->
      <div v-if="activeTab === 'feature'" class="space-y-1">
        <div
          v-if="!sortedFeatures.length"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          No feature data yet
        </div>
        <div
          v-if="sortedFeatures.length"
          class="flex items-center gap-3 px-3 pb-1"
        >
          <span class="w-36 text-xs text-muted-foreground">Feature</span>
          <div class="flex-1" />
          <span class="w-20 text-right text-xs text-muted-foreground"
            >Cost</span
          >
          <span class="w-28 text-right text-xs text-muted-foreground"
            >Per event</span
          >
        </div>
        <div
          v-for="f in sortedFeatures"
          :key="f.feature_key"
          class="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
        >
          <span class="w-36 text-sm font-medium truncate">{{
            f.feature_key
          }}</span>
          <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full rounded-full bg-foreground"
              :style="{ width: `${(f.total_cost / maxFeatureCost) * 100}%` }"
            />
          </div>
          <span class="w-20 text-right text-sm tabular-nums">{{
            fmt(f.total_cost)
          }}</span>
          <span
            class="w-28 text-right text-xs text-muted-foreground tabular-nums"
          >
            ({{
              f.event_count ? fmt(f.total_cost / f.event_count) : "$0"
            }}/event)
          </span>
        </div>
      </div>

      <!-- Model tab -->
      <div v-if="activeTab === 'model'" class="space-y-1">
        <div
          v-if="!sortedModels.length"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          No model data yet
        </div>
        <div
          v-if="sortedModels.length"
          class="flex items-center gap-3 px-3 pb-1"
        >
          <span class="w-36 text-xs text-muted-foreground">Model</span>
          <div class="flex-1" />
          <span class="w-20 text-right text-xs text-muted-foreground"
            >Cost</span
          >
          <span class="w-28 text-right text-xs text-muted-foreground"
            >Per event</span
          >
        </div>
        <div
          v-for="m in sortedModels"
          :key="m.model"
          class="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
          @click="router.push(`/events?model=${encodeURIComponent(m.model)}`)"
        >
          <div class="w-36 min-w-0">
            <Tooltip>
              <TooltipTrigger as-child>
                <div class="text-sm font-medium truncate">
                  {{ m.model }}
                </div>
              </TooltipTrigger>
              <TooltipContent>{{ m.model }}</TooltipContent>
            </Tooltip>
            <div v-if="m.model_provider" class="text-xs text-muted-foreground">
              {{ m.model_provider }}
            </div>
          </div>
          <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full bg-foreground rounded-full"
              :style="{ width: `${(m.total_cost / maxModelCost) * 100}%` }"
            />
          </div>
          <span class="w-20 text-right text-sm tabular-nums">{{
            fmt(m.total_cost)
          }}</span>
        </div>
      </div>

      <!-- Customer tab -->
      <div v-if="activeTab === 'customer'" class="space-y-1">
        <div
          v-if="!sortedCustomers.length"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          No customer data yet
        </div>
        <div
          v-for="c in sortedCustomers"
          :key="c.customer_id"
          class="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
        >
          <div class="w-36 min-w-0 flex flex-col gap-0.5">
            <span
              v-if="c.customer_name && c.customer_name !== c.customer_id"
              class="text-sm font-medium truncate"
              >{{ c.customer_name }}</span
            >
            <code
              class="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded truncate w-fit"
              >{{ c.customer_id }}</code
            >
          </div>
          <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full rounded-full bg-foreground"
              :style="{ width: `${(c.total_cost / maxCustomerCost) * 100}%` }"
            />
          </div>
          <span class="w-20 text-right text-sm tabular-nums">{{
            fmt(c.total_cost)
          }}</span>
        </div>
      </div>

      <!-- MRR Movement tab -->
      <!-- By Agent tab -->
      <div v-if="activeTab === 'agent'" class="space-y-1">
        <div
          class="flex items-center gap-3 text-xs text-muted-foreground px-3 py-2 border-b"
        >
          <span class="w-36">Agent</span>
          <span class="flex-1"></span>
          <span class="w-20 text-right">Cost</span>
        </div>
        <div
          v-if="!sortedAgents.length"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          No agent data yet. Use
          <code class="bg-muted px-1 rounded">Observe-Agent</code> header or
          <code class="bg-muted px-1 rounded">Observe.agent()</code> to tag
          calls.
        </div>
        <div
          v-for="a in sortedAgents"
          :key="a.agent_id"
          class="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
        >
          <span class="w-36 text-sm font-medium truncate">{{
            a.agent_id
          }}</span>
          <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full rounded-full bg-foreground"
              :style="{
                width: `${sortedAgents.length ? (a.total_cost / sortedAgents[0].total_cost) * 100 : 0}%`,
              }"
            />
          </div>
          <span class="w-20 text-right text-sm tabular-nums">{{
            fmt(a.total_cost)
          }}</span>
        </div>
      </div>

      <div v-if="activeTab === 'mrr'">
        <div
          v-if="mrrLoading"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          Loading MRR data...
        </div>
        <div
          v-else-if="mrrError"
          class="py-8 text-center text-sm text-destructive"
        >
          Failed to load MRR movements
        </div>
        <template v-else-if="mrrSummary">
          <!-- Summary cards -->
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            <Card class="p-4">
              <div class="text-xs font-medium text-muted-foreground">
                New MRR
              </div>
              <div class="text-xl font-semibold tabular-nums mt-1 text-success">
                +{{ fmt(mrrSummary.new_mrr) }}
              </div>
            </Card>
            <Card class="p-4">
              <div class="text-xs font-medium text-muted-foreground">
                Expansion
              </div>
              <div class="text-xl font-semibold tabular-nums mt-1 text-success">
                +{{ fmt(mrrSummary.expansion_mrr) }}
              </div>
            </Card>
            <Card class="p-4">
              <div class="text-xs font-medium text-muted-foreground">
                Contraction
              </div>
              <div
                class="text-xl font-semibold tabular-nums mt-1"
                :class="
                  mrrSummary.contraction_mrr > 0
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                "
              >
                -{{ fmt(mrrSummary.contraction_mrr) }}
              </div>
            </Card>
            <Card class="p-4">
              <div class="text-xs font-medium text-muted-foreground">
                Churned
              </div>
              <div
                class="text-xl font-semibold tabular-nums mt-1"
                :class="
                  mrrSummary.churned_mrr > 0
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                "
              >
                -{{ fmt(mrrSummary.churned_mrr) }}
              </div>
            </Card>
            <Card class="p-4 border-foreground/20">
              <div class="text-xs font-medium text-muted-foreground">
                Net New MRR
              </div>
              <div
                class="text-xl font-bold tabular-nums mt-1"
                :class="
                  mrrSummary.net_new_mrr >= 0
                    ? 'text-success'
                    : 'text-destructive'
                "
              >
                {{
                  mrrSummary.net_new_mrr >= 0
                    ? "+" + fmt(mrrSummary.net_new_mrr)
                    : "-" + fmt(Math.abs(mrrSummary.net_new_mrr))
                }}
              </div>
            </Card>
          </div>

          <!-- Customer movement list -->
          <div class="space-y-1">
            <div v-if="!mrrMovements.length" class="py-12 text-center">
              <p class="text-sm font-medium text-muted-foreground">
                No MRR movement data yet
              </p>
              <p class="text-xs text-muted-foreground/70 mt-1 max-w-sm mx-auto">
                MRR movement data requires multiple months of revenue data.
                Import subscription history from Stripe or CSV to see new,
                expansion, contraction, and churned MRR.
              </p>
            </div>
            <div
              v-for="m in mrrMovements"
              :key="m.customer_id"
              class="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
            >
              <div class="w-36 min-w-0">
                <div class="text-sm font-medium truncate">
                  {{ m.customer_name }}
                </div>
                <div
                  v-if="m.customer_name !== m.customer_id"
                  class="text-xs text-muted-foreground truncate"
                >
                  {{ m.customer_id }}
                </div>
              </div>
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0"
                :class="{
                  'bg-success/10 text-success': m.category === 'new',
                  'bg-primary/10 text-primary': m.category === 'expansion',
                  'bg-warning/10 text-warning': m.category === 'contraction',
                  'bg-destructive/10 text-destructive':
                    m.category === 'churned',
                  'bg-muted text-muted-foreground': m.category === 'stable',
                }"
              >
                {{ m.category }}
              </span>
              <div class="flex-1" />
              <span
                class="w-20 text-right text-xs text-muted-foreground tabular-nums"
                >{{ fmt(m.prior_mrr) }}</span
              >
              <span class="text-xs text-muted-foreground">-></span>
              <span class="w-20 text-right text-sm tabular-nums font-medium">{{
                fmt(m.current_mrr)
              }}</span>
              <span
                class="w-20 text-right text-sm tabular-nums font-medium"
                :class="{
                  'text-success': m.change > 0,
                  'text-destructive': m.change < 0,
                  'text-muted-foreground': m.change === 0,
                }"
              >
                {{
                  m.change > 0
                    ? "+" + fmt(m.change)
                    : m.change < 0
                      ? "-" + fmt(Math.abs(m.change))
                      : fmt(0)
                }}
              </span>
            </div>
          </div>
        </template>
        <div v-else class="py-8 text-center text-sm text-muted-foreground">
          No MRR movement data
        </div>
      </div>
    </template>
  </div>
</template>
