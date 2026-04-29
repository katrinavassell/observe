<script setup lang="ts">
import { computed } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import {
  getEventsByFeature,
  getEventsByModel,
  getEventsByCustomer,
  getUsageLimits,
  getSourceBreakdown,
  getMarginTrends,
  getDailySummary,
} from "@/lib/api";
import { AlertCircle, Plug, Info } from "lucide-vue-next";
import DailyCostRevenueChart from "@/components/charts/DailyCostRevenueChart.vue";
import {
  Badge,
  Card,
  CardContent,
  Skeleton,
  Button,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui";
import SourceBadge from "@/components/shared/SourceBadge.vue";
import { formatCurrency as fmt, formatPct } from "@/lib/format";
import { useAuth } from "@/composables/useAuth";
import {
  GUEST_EVENTS_BY_FEATURE,
  GUEST_EVENTS_BY_MODEL,
  GUEST_EVENTS_BY_CUSTOMER,
} from "@/lib/guest-preview";

const router = useRouter();
const queryClient = useQueryClient();
const { isLoggedIn } = useAuth();

const { data: _usageLimits } = useQuery({
  queryKey: ["usage-limits"],
  queryFn: getUsageLimits,
});

// Source breakdown for data attribution
const { data: sourceBreakdown } = useQuery({
  queryKey: ["source-breakdown"],
  queryFn: getSourceBreakdown,
});

// Margin trends for period-over-period badges
const { data: trendsData } = useQuery({
  queryKey: ["margin-trends"],
  queryFn: () => getMarginTrends(12),
  enabled: computed(() => isLoggedIn.value),
});

const latestTrend = computed(() => {
  const months = trendsData.value?.months;
  if (!months?.length) return null;
  return months[months.length - 1];
});

const priorTrend = computed(() => {
  const months = trendsData.value?.months;
  if (!months || months.length < 2) return null;
  return months[months.length - 2];
});

const marginChangePp = computed(() => {
  const curr = latestTrend.value?.margin_pct;
  const prev = priorTrend.value?.margin_pct;
  if (curr == null || prev == null) return null;
  return Math.round((curr - prev) * 10) / 10;
});

// Daily summary for cost vs revenue chart
const { data: dailyData } = useQuery({
  queryKey: ["daily-summary"],
  queryFn: () => getDailySummary(30),
  enabled: computed(() => isLoggedIn.value),
});

const dailySeries = computed(() => dailyData.value?.data ?? []);

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

const topCustomersByCost = computed(() => {
  if (!customerData.value) return [];
  return [...customerData.value]
    .sort((a, b) => b.total_cost - a.total_cost)
    .slice(0, 5);
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
          <h1 class="text-2xl font-semibold tracking-tight">Overview</h1>
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
            <TooltipContent class="normal-case"
              >Data confidence: {{ dataConfidence.label }}. Send more events for
              higher accuracy.</TooltipContent
            >
          </Tooltip>
        </div>
        <div class="flex items-center gap-2 mt-1">
          <p class="text-muted-foreground">
            Cost, revenue, and margin across all features and customers
          </p>
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
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card v-for="i in 4" :key="i" class="p-4">
          <Skeleton class="h-4 w-24 mb-2" />
          <Skeleton class="h-8 w-20" />
        </Card>
      </div>
      <Card class="p-4">
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
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <!-- Card 1: Revenue or Customers -->
        <Card class="p-4">
          <div
            class="flex items-center gap-1 text-xs text-muted-foreground uppercase tracking-wider"
          >
            {{ hasRevenue ? "Usage Revenue" : "Customers Tracked" }}
            <Tooltip v-if="hasRevenue">
              <TooltipTrigger as-child>
                <Info class="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent class="max-w-xs normal-case"
                >Sum of per-event usage revenue (metered + tiered) for the
                selected period. Does not include flat subscription
                MRR.</TooltipContent
              >
            </Tooltip>
          </div>
          <div class="text-2xl font-semibold tabular-nums mt-1">
            {{ hasRevenue ? fmt(totalRevenue) : (customerData?.length ?? 0) }}
          </div>
          <div
            v-if="hasRevenue && latestTrend?.revenue_change_pct != null"
            class="text-xs mt-1"
            :class="
              latestTrend.revenue_change_pct >= 0
                ? 'text-emerald-500'
                : 'text-destructive'
            "
          >
            {{ latestTrend.revenue_change_pct >= 0 ? "+" : ""
            }}{{ latestTrend.revenue_change_pct }}% vs prior period
          </div>
          <div
            v-else-if="hasRevenue && isLoggedIn"
            class="text-xs mt-1 text-muted-foreground"
          >
            No prior period
          </div>
        </Card>

        <!-- Card 2: Total Cost (always) -->
        <Card class="p-4">
          <div
            class="flex items-center gap-1 text-xs text-muted-foreground uppercase tracking-wider"
          >
            Total Cost
            <Tooltip>
              <TooltipTrigger as-child>
                <Info class="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent class="max-w-xs normal-case"
                >Sum of all tracked AI costs (LLM inference, embeddings, API
                calls). Does not include infrastructure overhead unless
                separately uploaded via CSV.</TooltipContent
              >
            </Tooltip>
          </div>
          <div class="text-2xl font-semibold tabular-nums mt-1">
            {{ fmt(totalCost) }}
          </div>
          <div
            v-if="latestTrend?.cost_change_pct != null"
            class="text-xs mt-1"
            :class="
              latestTrend.cost_change_pct <= 0
                ? 'text-emerald-500'
                : 'text-destructive'
            "
          >
            {{ latestTrend.cost_change_pct >= 0 ? "+" : ""
            }}{{ latestTrend.cost_change_pct }}% vs prior period
          </div>
          <div
            v-else-if="isLoggedIn"
            class="text-xs mt-1 text-muted-foreground"
          >
            No prior period
          </div>
        </Card>

        <!-- Card 3: Gross Margin or Events Tracked -->
        <Card class="p-4">
          <div
            class="flex items-center gap-1 text-xs text-muted-foreground uppercase tracking-wider"
          >
            {{ hasRevenue ? "Gross Margin" : "Events Tracked" }}
            <Tooltip v-if="hasRevenue">
              <TooltipTrigger as-child>
                <Info class="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent class="max-w-xs normal-case"
                >Revenue minus cost, divided by revenue.</TooltipContent
              >
            </Tooltip>
          </div>
          <div v-if="hasRevenue" class="flex items-center gap-2 mt-1">
            <span
              class="text-2xl font-semibold tabular-nums"
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
          <div
            v-if="hasRevenue && marginChangePp != null"
            class="text-xs mt-1"
            :class="
              marginChangePp >= 0 ? 'text-emerald-500' : 'text-destructive'
            "
          >
            {{ marginChangePp >= 0 ? "+" : "" }}{{ marginChangePp }}% vs prior
            period
          </div>
          <div
            v-else-if="hasRevenue && isLoggedIn"
            class="text-xs mt-1 text-muted-foreground"
          >
            No prior period
          </div>
          <div
            v-else-if="!hasRevenue"
            class="text-2xl font-semibold tabular-nums mt-1"
          >
            {{ totalEvents.toLocaleString() }}
          </div>
        </Card>

        <!-- Card 4: Events Tracked -->
        <Card class="p-4">
          <div class="text-xs text-muted-foreground uppercase tracking-wider">
            Events Tracked
          </div>
          <div class="text-2xl font-semibold tabular-nums mt-1">
            {{ totalEvents.toLocaleString() }}
          </div>
          <div
            v-if="latestTrend?.event_count_change_pct != null"
            class="text-xs mt-1"
            :class="
              latestTrend.event_count_change_pct >= 0
                ? 'text-emerald-500'
                : 'text-destructive'
            "
          >
            {{ latestTrend.event_count_change_pct >= 0 ? "+" : ""
            }}{{ latestTrend.event_count_change_pct }}% vs prior period
          </div>
          <div
            v-else-if="isLoggedIn"
            class="text-xs mt-1 text-muted-foreground"
          >
            No prior period
          </div>
        </Card>
      </div>

      <!-- Daily Cost vs Revenue chart -->
      <Card v-if="dailySeries.length >= 3" class="p-4">
        <h3 class="text-base font-semibold mb-4">Cost vs Revenue (Daily)</h3>
        <DailyCostRevenueChart :data="dailySeries" />
      </Card>

      <!-- Top Customers by Cost -->
      <Card v-if="topCustomersByCost.length > 0">
        <CardContent class="pt-6">
          <h3 class="text-base font-semibold mb-4">Top Customers by Cost</h3>
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b text-xs text-muted-foreground">
                <th class="text-left pb-2 font-medium">Customer</th>
                <th class="text-right pb-2 font-medium">Cost</th>
                <th class="text-right pb-2 font-medium">Revenue</th>
                <th class="text-right pb-2 font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in topCustomersByCost"
                :key="c.customer_id"
                class="border-b last:border-0 hover:bg-muted/50 transition-colors"
              >
                <td class="py-2.5">
                  <router-link
                    :to="`/customers/${c.customer_id}`"
                    class="text-sm font-medium hover:underline"
                  >
                    {{ c.customer_name || c.customer_id }}
                  </router-link>
                </td>
                <td class="py-2.5 text-right font-mono tabular-nums">
                  {{ fmt(c.total_cost) }}
                </td>
                <td class="py-2.5 text-right font-mono tabular-nums">
                  {{ fmt(c.total_revenue || 0) }}
                </td>
                <td class="py-2.5 text-right font-mono tabular-nums">
                  {{ formatPct(c.margin_pct) }}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
