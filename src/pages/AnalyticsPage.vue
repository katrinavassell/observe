<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import {
  getEventsByFeature,
  getEventsByModel,
  getEventsByCustomer,
  getEventsByAgent,
  getEventsByCostType,
  getMrrMovements,
  listInsights,
  generateInsights,
  getUsageLimits,
  listFeaturePricing,
  getSourceBreakdown,
} from "@/lib/api";
import type {} from "@/lib/api";
import { AlertCircle, AlertTriangle, Plug, Sparkles } from "lucide-vue-next";
import { useDataMode } from "@/composables/useDataMode";
import { useAuth } from "@/composables/useAuth";
import Sheet from "@/components/ui/sheet.vue";
import { Card, Skeleton, Button } from "@/components/ui";
import SourceBadge from "@/components/shared/SourceBadge.vue";
import { formatCurrency as fmt, formatPct as fmtPct } from "@/lib/format";

const router = useRouter();
const queryClient = useQueryClient();
const { isSampleMode } = useDataMode();

type Tab = "feature" | "model" | "customer" | "agent" | "cost_type" | "mrr";
const activeTab = ref<Tab>("feature");

// Insights drawer state
const insightsOpen = ref(false);
const isGenerating = ref(false);
const generateError = ref<string | null>(null);

const { data: insightsData, refetch: refetchInsights } = useQuery({
  queryKey: ["insights"],
  queryFn: listInsights,
  enabled: computed(() => insightsOpen.value),
});

const { data: usageLimits } = useQuery({
  queryKey: ["usage-limits"],
  queryFn: getUsageLimits,
});

const insightsAllowed = computed(
  () => usageLimits.value?.ai_insights?.allowed !== false,
);
const insightsUsage = computed(
  () => usageLimits.value?.ai_insights?.usage ?? null,
);

const { isLoggedIn } = useAuth();
async function handleGenerate() {
  isGenerating.value = true;
  generateError.value = null;
  try {
    await generateInsights();
    window.posthog?.capture("ai_insights_generated");
    window.localStorage.setItem("observe:insights_generated", "true");
    await refetchInsights();
    // Refresh usage limits
    queryClient.invalidateQueries({ queryKey: ["usage-limits"] });
  } catch (e: any) {
    generateError.value = e?.message || "Failed to generate insights";
  } finally {
    isGenerating.value = false;
  }
}

function marginBarClass(margin_pct: number | null): string {
  if (margin_pct == null) return "bg-foreground";
  if (margin_pct < 0) return "bg-destructive";
  if (margin_pct < 40) return "bg-amber-500";
  return "bg-emerald-500";
}

function marginTextClass(margin_pct: number | null): string {
  if (margin_pct == null) return "text-muted-foreground";
  if (margin_pct < 0) return "text-destructive";
  if (margin_pct < 40) return "text-amber-600";
  return "text-success";
}

function severityColor(severity: string) {
  switch (severity) {
    case "critical":
      return "border-destructive/30 bg-destructive/5 text-destructive";
    case "warning":
      return "border-warning/30 bg-warning/5 text-warning";
    case "positive":
      return "border-success/30 bg-success/5 text-success";
    default:
      return "border-border bg-card text-foreground";
  }
}

function severityBadge(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-destructive/10 text-destructive";
    case "warning":
      return "bg-warning/10 text-warning";
    case "positive":
      return "bg-success/10 text-success";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function insightTypeLabel(type: string) {
  switch (type) {
    case "pricing_recommendation":
      return "Pricing";
    case "usage_pricing_signal":
      return "Usage pattern";
    case "model_routing":
      return "Model routing";
    case "margin_alert":
      return "Margin";
    case "customer_risk":
      return "Customer";
    case "cost_optimization":
      return "Cost";
    case "pricing_opportunity":
      return "Pricing";
    default:
      return type.replace(/_/g, " ");
  }
}

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

// Analytics data
const {
  data: featureData,
  isLoading: featuresLoading,
  isError: featuresError,
} = useQuery({
  queryKey: ["events-by-feature"],
  queryFn: getEventsByFeature,
});

const {
  data: modelData,
  isLoading: modelsLoading,
  isError: modelsError,
} = useQuery({
  queryKey: ["events-by-model"],
  queryFn: getEventsByModel,
});

const {
  data: customerData,
  isLoading: customersLoading,
  isError: customersError,
} = useQuery({
  queryKey: ["events-by-customer"],
  queryFn: getEventsByCustomer,
});

const { data: agentData } = useQuery({
  queryKey: ["events-by-agent"],
  queryFn: getEventsByAgent,
  enabled: computed(() => activeTab.value === "agent"),
});

const sortedAgents = computed(() => {
  if (!agentData.value) return [];
  return [...agentData.value].sort((a, b) => b.total_cost - a.total_cost);
});

const { data: costTypeData } = useQuery({
  queryKey: ["events-by-cost-type"],
  queryFn: () => getEventsByCostType(),
  enabled: computed(() => activeTab.value === "cost_type"),
});

const sortedCostTypes = computed(() => {
  if (!costTypeData.value?.breakdown) return [];
  return [...costTypeData.value.breakdown].sort(
    (a, b) => b.total_cost - a.total_cost,
  );
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

// Check if user has configured feature pricing (for margin label)
const { data: featurePricingRules } = useQuery({
  queryKey: ["feature-pricing"],
  queryFn: listFeaturePricing,
  staleTime: 0,
});
const hasFeaturePricing = computed(
  () => (featurePricingRules.value?.length ?? 0) > 0,
);
const marginLabel = computed(() =>
  hasFeaturePricing.value ? "Net Margin" : "Est. Margin",
);
const marginHint = computed(() =>
  hasFeaturePricing.value
    ? "Revenue from configured feature pricing"
    : "Revenue estimated from Stripe MRR allocation. Configure feature pricing for precise margins.",
);

const totalCost = computed(() => {
  if (!featureData.value) return 0;
  return featureData.value.reduce((s, f) => s + f.total_cost, 0);
});
const totalRevenue = computed(() => {
  if (!featureData.value) return 0;
  return featureData.value.reduce((s, f) => s + f.total_revenue, 0);
});
const netMarginPct = computed(() => {
  if (totalRevenue.value === 0) return null;
  return ((totalRevenue.value - totalCost.value) / totalRevenue.value) * 100;
});

const negativeMarginsInfo = computed(() => {
  if (!featureData.value) return null;
  const negative = featureData.value.filter(
    (f) => f.margin_pct !== null && f.margin_pct < 0,
  );
  if (negative.length === 0) return null;
  const totalLoss = negative.reduce(
    (s, f) => s + (f.total_cost - f.total_revenue),
    0,
  );
  return { count: negative.length, totalLoss };
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
  return [...modelData.value]
    .filter((m) => m.total_cost > 0)
    .sort((a, b) => b.total_cost - a.total_cost);
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

// Data quality for insights
const totalEvents = computed(() => {
  if (!featureData.value) return 0;
  return featureData.value.reduce((s, f) => s + (f.event_count || 0), 0);
});
const _dataConfidence = computed(() => {
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

const insightCategories = [
  {
    title: "Margin analysis",
    description: "Which features cost more than they earn, and by how much.",
  },
  {
    title: "Model cost comparison",
    description:
      "Which AI models you spend the most on and cheaper alternatives.",
  },
  {
    title: "Customer profitability",
    description:
      "Which customers cost the most to serve relative to their revenue.",
  },
  {
    title: "Historic spend estimation",
    description:
      "Cross-references your SDK data with CSV uploads and provider imports to estimate where past spend went.",
  },
];
</script>

<template>
  <div class="space-y-6">
    <!-- Page header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Analytics</h1>
        <div class="flex items-center gap-2 mt-1">
          <p class="text-muted-foreground">Where your AI spend is going</p>
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

    <!-- AI Insights Drawer -->
    <Sheet
      :open="insightsOpen"
      side="right"
      @update:open="insightsOpen = $event"
    >
      <div class="w-full sm:w-[420px] p-6 space-y-5">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <Sparkles class="h-5 w-5 text-primary" />
            <h2 class="text-lg font-semibold">AI Insights</h2>
          </div>
          <p class="text-sm text-muted-foreground">
            AI analyzes your cost and revenue data to find margin issues,
            pricing opportunities, and model optimizations. Insights improve as
            you send more events.
          </p>
        </div>

        <!-- DEMO MODE: hardcoded preview (guests only) -->
        <template v-if="isSampleMode && !isLoggedIn">
          <div
            class="rounded-lg bg-muted/50 border border-dashed px-3 py-2 text-xs text-muted-foreground"
          >
            Preview mode. Connect your data to generate real insights.
          </div>

          <div class="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted-foreground">Data confidence</span>
              <span class="font-medium text-success">High</span>
            </div>
            <div class="h-2 rounded-full bg-muted overflow-hidden">
              <div class="h-full rounded-full bg-primary" style="width: 92%" />
            </div>
            <p class="text-[11px] text-muted-foreground">
              2,847 events tracked. Strong dataset for reliable insights.
            </p>
          </div>

          <div class="space-y-3">
            <div
              class="rounded-lg border p-3 space-y-1.5 border-destructive/30 bg-destructive/5"
            >
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-destructive/10 text-destructive"
                >critical</span
              >
              <div class="text-sm font-medium">
                ai_summarization margin is -23%
              </div>
              <div class="text-xs text-muted-foreground">
                This feature costs $0.82 per call but only earns $0.63. 5
                customers used it 1,847 times last month. Switching from
                claude-3-5-sonnet to claude-3-haiku for shorter inputs would cut
                cost 80%.
              </div>
            </div>
            <div
              class="rounded-lg border p-3 space-y-1.5 border-warning/30 bg-warning/5"
            >
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-warning/10 text-warning"
                >warning</span
              >
              <div class="text-sm font-medium">
                Acme Corp costs 3x more than other enterprise accounts
              </div>
              <div class="text-xs text-muted-foreground">
                Acme Corp generated $0.50 in revenue but $0.54 in AI costs last
                month. Their image_generation usage is 4x the account average.
                Consider usage-based pricing for this feature.
              </div>
            </div>
            <div
              class="rounded-lg border p-3 space-y-1.5 border-success/30 bg-success/5"
            >
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-success/10 text-success"
                >opportunity</span
              >
              <div class="text-sm font-medium">
                search feature has 78% margin with room to grow
              </div>
              <div class="text-xs text-muted-foreground">
                text-embedding-3-small costs $0.002 per query but you charge
                $0.01. Only 3 of 5 customers use it. Promoting this feature
                could increase revenue with minimal cost impact.
              </div>
            </div>
          </div>
        </template>

        <!-- REAL MODE -->
        <template v-else>
          <!-- Generated insights (show first when they exist) -->
          <div v-if="insightsData && insightsData.length > 0" class="space-y-3">
            <div
              v-for="insight in insightsData"
              :key="insight.id"
              class="rounded-lg border p-3 space-y-1.5"
              :class="severityColor(insight.severity)"
            >
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                  :class="severityBadge(insight.severity)"
                >
                  {{ insight.severity }}
                </span>
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary"
                >
                  {{ insightTypeLabel(insight.insight_type) }}
                </span>
                <span
                  v-if="insight.feature_key"
                  class="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded"
                  >{{ insight.feature_key }}</span
                >
              </div>
              <div class="text-sm font-medium">{{ insight.title }}</div>
              <div class="text-xs text-muted-foreground">
                {{ insight.description }}
              </div>
            </div>
          </div>

          <!-- No insights yet: show categories -->
          <div v-else-if="!isGenerating" class="space-y-2">
            <div
              class="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
            >
              What you'll get
            </div>
            <div
              v-for="(cat, i) in insightCategories"
              :key="i"
              class="flex gap-3 rounded-lg border p-3"
            >
              <div class="min-w-0">
                <div class="text-sm font-medium">{{ cat.title }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ cat.description }}
                </div>
              </div>
            </div>
          </div>

          <!-- Loading state -->
          <div v-if="isGenerating" class="flex items-center gap-3 py-4">
            <div
              class="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin"
            />
            <div>
              <div class="text-sm font-medium">Analyzing your data...</div>
              <div class="text-xs text-muted-foreground">
                This usually takes 5-10 seconds
              </div>
            </div>
          </div>

          <!-- Generate button -->
          <div class="space-y-3 border-t pt-4">
            <div v-if="totalEvents >= 10">
              <Button
                class="w-full"
                :disabled="isGenerating || !insightsAllowed"
                @click="handleGenerate"
              >
                <Sparkles class="h-4 w-4 mr-2" />
                {{ isGenerating ? "Analyzing..." : "Generate Insights" }}
              </Button>
              <p
                v-if="!isGenerating && insightsAllowed"
                class="text-xs text-muted-foreground text-center mt-1.5"
              >
                Uses 1 message
              </p>
            </div>
            <div v-else class="rounded-lg border bg-muted/30 p-3 text-center">
              <p class="text-sm font-medium mb-1">Upload more data to unlock</p>
              <p class="text-xs text-muted-foreground">
                AI Insights needs event data from your SDK or proxy integration
                to analyze.
              </p>
            </div>

            <!-- Usage info -->
            <div
              v-if="insightsUsage && totalEvents >= 10"
              class="text-xs text-muted-foreground text-center"
            >
              <template v-if="insightsUsage.used === 0">
                {{ insightsUsage.limit }} free insight{{
                  insightsUsage.limit === 1 ? "" : "s"
                }}
                included
              </template>
              <template v-else-if="insightsUsage.remaining > 0">
                {{ insightsUsage.used }} used,
                {{ insightsUsage.remaining }} remaining
              </template>
              <template v-else>
                All {{ insightsUsage.limit }} insights used.
                <router-link to="/plans" class="text-primary hover:underline"
                  >Upgrade to Growth</router-link
                >
                for unlimited.
              </template>
            </div>
          </div>

          <div v-if="generateError" class="text-sm text-destructive">
            {{ generateError }}
          </div>
        </template>
      </div>
    </Sheet>

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
        Connect your OpenAI or Anthropic SDK to see cost, revenue, and margin
        breakdowns by feature, model, and customer.
      </p>
      <Button size="sm" variant="outline" @click="router.push('/data-sources')">
        <Plug class="h-3.5 w-3.5 mr-1.5" />
        Data Sources
      </Button>
    </div>

    <!-- Data loaded -->
    <template v-else>
      <!-- Negative margin alert -->
      <div
        v-if="negativeMarginsInfo"
        class="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3"
      >
        <AlertTriangle class="h-5 w-5 text-warning shrink-0" />
        <span class="text-sm font-medium text-warning-foreground">
          {{ negativeMarginsInfo.count }} feature{{
            negativeMarginsInfo.count === 1 ? "" : "s"
          }}
          {{ negativeMarginsInfo.count === 1 ? "has" : "have" }} negative margin
          totaling {{ fmt(negativeMarginsInfo.totalLoss) }} in losses
        </span>
      </div>

      <!-- KPI cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card class="p-6">
          <div class="text-sm font-medium text-muted-foreground">
            Total Cost
          </div>
          <div class="text-3xl font-semibold tabular-nums mt-1">
            {{ fmt(totalCost) }}
          </div>
        </Card>
        <Card class="p-6">
          <div class="text-sm font-medium text-muted-foreground">
            Total Revenue
          </div>
          <div class="text-3xl font-semibold tabular-nums mt-1">
            {{ fmt(totalRevenue) }}
          </div>
        </Card>
        <Card class="p-6">
          <div
            class="text-sm font-medium text-muted-foreground"
            :title="marginHint"
          >
            {{ marginLabel }}
          </div>
          <div
            class="text-3xl font-bold tabular-nums mt-1"
            :class="marginTextClass(netMarginPct)"
          >
            {{ netMarginPct != null ? fmtPct(netMarginPct) : "—" }}
          </div>
          <div
            v-if="!hasFeaturePricing && totalRevenue > 0"
            class="text-[10px] text-muted-foreground mt-1"
          >
            from MRR allocation
          </div>
        </Card>
      </div>

      <!-- Tab bar -->
      <div class="flex gap-1 border-b">
        <button
          v-for="tab in [
            {
              key: 'feature',
              label: 'By Feature',
              count: sortedFeatures.length,
            },
            { key: 'model', label: 'By Model', count: sortedModels.length },
            {
              key: 'customer',
              label: 'By Customer',
              count: sortedCustomers.length,
            },
            {
              key: 'agent',
              label: 'By Agent',
              count: sortedAgents.length,
            },
            {
              key: 'cost_type',
              label: 'By Cost Type',
              count: sortedCostTypes.length,
            },
            {
              key: 'mrr',
              label: 'MRR Movement',
              count: mrrMovements.filter((m) => m.category !== 'stable').length,
            },
          ] as const"
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
          v-for="f in sortedFeatures"
          :key="f.feature_key"
          class="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
        >
          <span class="w-36 text-sm font-medium truncate">{{
            f.feature_key
          }}</span>
          <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full rounded-full"
              :class="marginBarClass(f.margin_pct)"
              :style="{ width: `${(f.total_cost / maxFeatureCost) * 100}%` }"
            />
          </div>
          <span class="w-20 text-right text-sm tabular-nums">{{
            fmt(f.total_cost)
          }}</span>
          <span
            class="w-20 text-right text-sm tabular-nums text-muted-foreground"
            >{{ fmt(f.total_revenue) }}</span
          >
          <span
            class="w-16 text-right text-sm tabular-nums font-medium"
            :class="marginTextClass(f.margin_pct)"
          >
            {{ f.margin_pct != null ? fmtPct(f.margin_pct) : "—" }}
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
          v-for="m in sortedModels"
          :key="m.model"
          class="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
          @click="router.push(`/events?model=${encodeURIComponent(m.model)}`)"
        >
          <div class="w-36 min-w-0">
            <div class="text-sm font-medium truncate">{{ m.model }}</div>
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
          <span
            class="w-20 text-right text-sm tabular-nums text-muted-foreground"
            >{{ fmt(m.total_revenue) }}</span
          >
          <span
            class="w-16 text-right text-sm tabular-nums font-medium"
            :class="marginTextClass(m.margin_pct)"
          >
            {{ m.margin_pct != null ? fmtPct(m.margin_pct) : "—" }}
          </span>
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
          <div class="w-36 min-w-0">
            <div
              v-if="c.customer_name && c.customer_name !== c.customer_id"
              class="text-sm font-medium truncate"
            >
              {{ c.customer_name }}
            </div>
            <code
              v-else
              class="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded truncate"
              >{{ c.customer_id }}</code
            >
            <div
              v-if="c.customer_name && c.customer_name !== c.customer_id"
              class="text-xs text-muted-foreground truncate"
            >
              {{ c.customer_id }}
            </div>
          </div>
          <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full rounded-full"
              :class="marginBarClass(c.margin_pct)"
              :style="{ width: `${(c.total_cost / maxCustomerCost) * 100}%` }"
            />
          </div>
          <span class="w-20 text-right text-sm tabular-nums">{{
            fmt(c.total_cost)
          }}</span>
          <span
            class="w-20 text-right text-sm tabular-nums text-muted-foreground"
            >{{ fmt(c.total_revenue) }}</span
          >
          <span
            class="w-16 text-right text-sm tabular-nums font-medium"
            :class="marginTextClass(c.margin_pct)"
          >
            {{ c.margin_pct != null ? fmtPct(c.margin_pct) : "—" }}
          </span>
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
          <span class="w-20 text-right">Revenue</span>
          <span class="w-16 text-right">Margin</span>
        </div>
        <div
          v-if="!sortedAgents.length"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          No agent data yet. Use
          <code class="bg-muted px-1 rounded">x-tanso-agent</code> header or
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
              class="h-full rounded-full"
              :class="marginBarClass(a.margin_pct)"
              :style="{
                width: `${sortedAgents.length ? (a.total_cost / sortedAgents[0].total_cost) * 100 : 0}%`,
              }"
            />
          </div>
          <span class="w-20 text-right text-sm tabular-nums">{{
            fmt(a.total_cost)
          }}</span>
          <span
            class="w-20 text-right text-sm tabular-nums text-muted-foreground"
            >{{ fmt(a.total_revenue) }}</span
          >
          <span
            class="w-16 text-right text-sm tabular-nums font-medium"
            :class="marginTextClass(a.margin_pct)"
          >
            {{ a.margin_pct != null ? fmtPct(a.margin_pct) : "—" }}
          </span>
        </div>
      </div>

      <!-- By Cost Type tab -->
      <div v-if="activeTab === 'cost_type'" class="space-y-1">
        <div
          class="flex items-center gap-3 text-xs text-muted-foreground px-3 py-2 border-b"
        >
          <span class="w-28">Type</span>
          <span class="flex-1"></span>
          <span class="w-16 text-right">Events</span>
          <span class="w-20 text-right">Cost</span>
          <span class="w-20 text-right">Revenue</span>
        </div>
        <div
          v-if="!sortedCostTypes.length"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          No cost type data yet. Events will be categorized as they arrive.
        </div>
        <div
          v-for="ct in sortedCostTypes"
          :key="ct.cost_type"
          class="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
        >
          <span class="w-28 text-sm font-medium">{{ ct.cost_type }}</span>
          <div class="flex-1 h-3 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full rounded-full bg-foreground"
              :style="{
                width: `${sortedCostTypes.length ? (ct.total_cost / sortedCostTypes[0].total_cost) * 100 : 0}%`,
              }"
            />
          </div>
          <span
            class="w-16 text-right text-sm tabular-nums text-muted-foreground"
            >{{ ct.event_count.toLocaleString() }}</span
          >
          <span class="w-20 text-right text-sm tabular-nums">{{
            fmt(ct.total_cost)
          }}</span>
          <span
            class="w-20 text-right text-sm tabular-nums text-muted-foreground"
            >{{ fmt(ct.total_revenue) }}</span
          >
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
