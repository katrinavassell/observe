<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import {
  getAnalyticsOverview,
  getDailySummary,
  getCostToServe,
  type AnalyticsOverview,
  type OverviewFeatureROI,
  type OverviewCustomerPnL,
} from "@/lib/api";
import { GUEST_ANALYTICS_OVERVIEW } from "@/lib/guest-preview";
import {
  AlertCircle,
  Plug,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Bell,
  Download,
  Lightbulb,
  TrendingUp,
} from "lucide-vue-next";
import DailyCostRevenueChart from "@/components/charts/DailyCostRevenueChart.vue";
import { Badge, Card, CardContent, Skeleton, Button } from "@/components/ui";
import { formatCurrency as fmt, formatPct } from "@/lib/format";
import { useAuth } from "@/composables/useAuth";
import { useMarginThresholds } from "@/composables/useMarginThresholds";

const router = useRouter();
const { isLoggedIn } = useAuth();
const { getStatus } = useMarginThresholds();

const {
  data: realOverview,
  isLoading,
  isError,
} = useQuery({
  queryKey: ["analytics-overview"],
  queryFn: () => getAnalyticsOverview(),
  enabled: computed(() => isLoggedIn.value),
});

const overview = computed<AnalyticsOverview | undefined>(() =>
  isLoggedIn.value ? realOverview.value : GUEST_ANALYTICS_OVERVIEW,
);

const { data: dailyData } = useQuery({
  queryKey: computed(() => ["daily-summary", 30]),
  queryFn: () => getDailySummary(30),
  enabled: computed(() => isLoggedIn.value),
});

const { data: costToServeData } = useQuery({
  queryKey: ["cost-to-serve"],
  queryFn: getCostToServe,
  enabled: computed(() => isLoggedIn.value),
});

const dailySeries = computed(() => dailyData.value?.data ?? []);
const hasData = computed(() => !!overview.value?.summary?.event_count);
const hasRevenue = computed(
  () => (overview.value?.summary?.total_revenue ?? 0) > 0,
);

const marginColor = (pct: number | null) => {
  if (pct === null) return "";
  if (pct >= 50) return "text-emerald-500";
  if (pct >= 20) return "text-amber-500";
  return "text-red-500";
};

const trendDelta = computed(() => {
  const t = overview.value?.margin_trend;
  if (!t || t.length < 2) return null;
  const latest = t[t.length - 1];
  const prior = t[t.length - 2];
  if (latest.margin_pct == null || prior.margin_pct == null) return null;
  return Math.round((latest.margin_pct - prior.margin_pct) * 10) / 10;
});

const costDelta = computed(() => {
  const t = overview.value?.margin_trend;
  if (!t || t.length < 2) return null;
  const latest = t[t.length - 1];
  const prior = t[t.length - 2];
  if (prior.cost === 0) return null;
  return Math.round(((latest.cost - prior.cost) / prior.cost) * 1000) / 10;
});

const revenueDelta = computed(() => {
  const t = overview.value?.margin_trend;
  if (!t || t.length < 2) return null;
  const latest = t[t.length - 1];
  const prior = t[t.length - 2];
  if (prior.revenue === 0) return null;
  return (
    Math.round(((latest.revenue - prior.revenue) / prior.revenue) * 1000) / 10
  );
});

const sortedFeatures = computed(() => {
  if (!overview.value?.feature_roi) return [];
  return [...overview.value.feature_roi].sort(
    (a: OverviewFeatureROI, b: OverviewFeatureROI) => {
      const am = a.margin_pct ?? -Infinity;
      const bm = b.margin_pct ?? -Infinity;
      return am - bm;
    },
  );
});

const sortedCustomers = computed(() => {
  if (!overview.value?.customer_pnl) return [];
  return [...overview.value.customer_pnl].sort(
    (a: OverviewCustomerPnL, b: OverviewCustomerPnL) => {
      const am = a.margin_pct ?? -Infinity;
      const bm = b.margin_pct ?? -Infinity;
      return am - bm;
    },
  );
});

const severityBadge = (severity: string) => {
  if (severity === "critical") return "destructive" as const;
  if (severity === "warning") return "warning" as const;
  return "secondary" as const;
};

function downloadCsv() {
  if (!overview.value) return;
  const rows: string[][] = [];

  rows.push([
    "Section",
    "Name",
    "Cost",
    "Revenue",
    "Margin %",
    "Cost/Unit",
    "Rev/Unit",
    "Events",
    "Customers",
  ]);

  rows.push([
    "Summary",
    "Total",
    String(overview.value.summary.total_cost),
    String(overview.value.summary.total_revenue),
    String(overview.value.summary.margin_pct ?? ""),
    "",
    "",
    String(overview.value.summary.event_count),
    String(overview.value.summary.customer_count),
  ]);

  for (const f of overview.value.feature_roi) {
    rows.push([
      "Feature",
      f.feature_key,
      String(f.cost),
      String(f.revenue),
      String(f.margin_pct ?? ""),
      String(f.cost_per_unit),
      String(f.revenue_per_unit),
      String(f.event_count),
      String(f.customer_count),
    ]);
  }

  for (const c of overview.value.customer_pnl) {
    rows.push([
      "Customer",
      c.customer_name,
      String(c.cost),
      String(c.revenue),
      String(c.margin_pct ?? ""),
      "",
      "",
      String(c.event_count),
      "",
    ]);
  }

  for (const p of overview.value.provider_breakdown) {
    rows.push([
      "Provider",
      `${p.provider} / ${p.model}`,
      String(p.cost),
      "",
      "",
      String(p.avg_cost_per_call),
      "",
      String(p.event_count),
      "",
    ]);
  }

  for (const t of overview.value.margin_trend) {
    rows.push([
      "Trend",
      t.month,
      String(t.cost),
      String(t.revenue),
      String(t.margin_pct ?? ""),
      "",
      "",
      String(t.event_count),
      String(t.customer_count),
    ]);
  }

  const csv = rows
    .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `observe-overview-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Overview</h1>
        <p class="text-muted-foreground text-sm mt-0.5">
          For every dollar you spend, here's what value it produced
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Button v-if="hasData" size="sm" variant="outline" @click="downloadCsv">
          <Download class="h-3.5 w-3.5 mr-1.5" />
          Export CSV
        </Button>
      </div>
    </div>

    <!-- Error -->
    <div
      v-if="isError && !isLoading"
      class="flex flex-col items-center justify-center py-24 text-center"
    >
      <AlertCircle class="h-10 w-10 text-muted-foreground mb-4" />
      <p class="text-muted-foreground mb-4">Failed to load analytics.</p>
      <Button @click="$router.go(0)">Try Again</Button>
    </div>

    <!-- Loading -->
    <div v-else-if="isLoading">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card v-for="i in 4" :key="i" class="p-4">
          <Skeleton class="h-4 w-24 mb-2" />
          <Skeleton class="h-8 w-20" />
        </Card>
      </div>
      <Card class="p-4">
        <Skeleton class="h-[250px] w-full" />
      </Card>
    </div>

    <!-- Empty -->
    <div
      v-else-if="!hasData"
      class="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto"
    >
      <Plug class="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p class="text-sm font-medium mb-1">No analytics data yet</p>
      <p class="text-xs text-muted-foreground mb-4">
        Connect your SDK to see cost and value breakdowns.
      </p>
      <Button size="sm" variant="outline" @click="router.push('/data-sources')">
        <Plug class="h-3.5 w-3.5 mr-1.5" />
        Data Sources
      </Button>
    </div>

    <!-- Dashboard -->
    <template v-else-if="overview">
      <!-- KPI cards -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card class="p-4">
          <div class="text-xs text-muted-foreground uppercase tracking-wider">
            Revenue
          </div>
          <div class="text-2xl font-semibold tabular-nums mt-1">
            {{ fmt(overview.summary.total_revenue) }}
          </div>
          <div
            v-if="revenueDelta != null"
            class="flex items-center gap-0.5 text-xs mt-1"
            :class="revenueDelta >= 0 ? 'text-emerald-500' : 'text-red-500'"
          >
            <ArrowUpRight v-if="revenueDelta >= 0" class="h-3 w-3" />
            <ArrowDownRight v-else class="h-3 w-3" />
            {{ Math.abs(revenueDelta) }}% vs prior month
          </div>
        </Card>

        <Card class="p-4">
          <div class="text-xs text-muted-foreground uppercase tracking-wider">
            Total Cost
          </div>
          <div class="text-2xl font-semibold tabular-nums mt-1">
            {{ fmt(overview.summary.total_cost) }}
          </div>
          <div
            v-if="costDelta != null"
            class="flex items-center gap-0.5 text-xs mt-1"
            :class="costDelta <= 0 ? 'text-emerald-500' : 'text-red-500'"
          >
            <ArrowDownRight v-if="costDelta <= 0" class="h-3 w-3" />
            <ArrowUpRight v-else class="h-3 w-3" />
            {{ Math.abs(costDelta) }}% vs prior month
          </div>
        </Card>

        <Card class="p-4">
          <div class="text-xs text-muted-foreground uppercase tracking-wider">
            Gross Margin
          </div>
          <div class="text-2xl font-semibold tabular-nums mt-1">
            {{ formatPct(overview.summary.margin_pct) }}
          </div>
          <div
            v-if="trendDelta != null"
            class="flex items-center gap-0.5 text-xs mt-1"
            :class="trendDelta >= 0 ? 'text-emerald-500' : 'text-red-500'"
          >
            <ArrowUpRight v-if="trendDelta >= 0" class="h-3 w-3" />
            <ArrowDownRight v-else class="h-3 w-3" />
            {{ Math.abs(trendDelta) }}pp vs prior month
          </div>
        </Card>

        <Card class="p-4">
          <div class="text-xs text-muted-foreground uppercase tracking-wider">
            Active Customers
          </div>
          <div class="text-2xl font-semibold tabular-nums mt-1">
            {{ overview.summary.customer_count }}
          </div>
          <div class="text-xs mt-1 text-muted-foreground">
            {{ overview.summary.event_count.toLocaleString() }} events
          </div>
        </Card>
      </div>

      <!-- Daily chart -->
      <Card v-if="dailySeries.length >= 3" class="p-4">
        <DailyCostRevenueChart :data="dailySeries" />
      </Card>

      <!-- Alerts + Recommendations bar -->
      <div
        v-if="
          overview.active_alert_count > 0 ||
          overview.pending_recommendation_count > 0
        "
        class="flex gap-3"
      >
        <router-link
          v-if="overview.active_alert_count > 0"
          to="/alerts"
          class="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2.5 text-sm hover:bg-red-500/10 transition-colors"
        >
          <Bell class="h-4 w-4 text-red-500" />
          <span class="font-medium">{{ overview.active_alert_count }}</span>
          <span class="text-muted-foreground"
            >alert{{ overview.active_alert_count === 1 ? "" : "s" }} fired
            (24h)</span
          >
        </router-link>
        <router-link
          v-if="overview.pending_recommendation_count > 0"
          to="/cohorts"
          class="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-sm hover:bg-amber-500/10 transition-colors"
        >
          <Lightbulb class="h-4 w-4 text-amber-500" />
          <span class="font-medium">{{
            overview.pending_recommendation_count
          }}</span>
          <span class="text-muted-foreground"
            >recommendation{{
              overview.pending_recommendation_count === 1 ? "" : "s"
            }}</span
          >
        </router-link>
      </div>

      <!-- Top recommendations -->
      <Card v-if="overview.top_recommendations.length > 0">
        <CardContent class="p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-base font-semibold">Top Actions</h3>
            <router-link
              to="/cohorts"
              class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              View all <ArrowRight class="h-3 w-3" />
            </router-link>
          </div>
          <div class="space-y-2">
            <div
              v-for="rec in overview.top_recommendations"
              :key="rec.title"
              class="flex items-start gap-3 rounded-md border p-3"
            >
              <Badge
                :variant="severityBadge(rec.severity)"
                class="mt-0.5 shrink-0"
              >
                {{ rec.severity }}
              </Badge>
              <span class="text-sm">{{ rec.title }}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Feature table -->
      <Card v-if="sortedFeatures.length > 0">
        <CardContent class="p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-base font-semibold">Feature Unit Economics</h3>
            <router-link
              to="/features"
              class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              View all <ArrowRight class="h-3 w-3" />
            </router-link>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b text-xs text-muted-foreground">
                  <th class="text-left pb-2 font-medium">Feature</th>
                  <th class="text-right pb-2 font-medium">Cost</th>
                  <th class="text-right pb-2 font-medium">Revenue</th>
                  <th class="text-right pb-2 font-medium">Cost/Unit</th>
                  <th class="text-right pb-2 font-medium">Rev/Unit</th>
                  <th class="text-right pb-2 font-medium">Margin</th>
                  <th class="text-right pb-2 font-medium">Customers</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="f in sortedFeatures"
                  :key="f.feature_key"
                  class="border-b last:border-0 hover:bg-muted/50 transition-colors"
                >
                  <td class="py-2.5 font-medium">{{ f.feature_key }}</td>
                  <td class="py-2.5 text-right font-mono tabular-nums">
                    {{ fmt(f.cost) }}
                  </td>
                  <td class="py-2.5 text-right font-mono tabular-nums">
                    {{ fmt(f.revenue) }}
                  </td>
                  <td class="py-2.5 text-right font-mono tabular-nums">
                    {{ fmt(f.cost_per_unit) }}
                  </td>
                  <td class="py-2.5 text-right font-mono tabular-nums">
                    {{ fmt(f.revenue_per_unit) }}
                  </td>
                  <td class="py-2.5 text-right">
                    <span
                      :class="marginColor(f.margin_pct)"
                      class="font-mono tabular-nums"
                    >
                      {{ formatPct(f.margin_pct) }}
                    </span>
                  </td>
                  <td class="py-2.5 text-right text-muted-foreground">
                    {{ f.customer_count }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <!-- Customer P&L -->
      <Card v-if="sortedCustomers.length > 0">
        <CardContent class="p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-base font-semibold">Customer P&L</h3>
            <router-link
              to="/cohorts"
              class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              View all <ArrowRight class="h-3 w-3" />
            </router-link>
          </div>
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b text-xs text-muted-foreground">
                <th class="text-left pb-2 font-medium">Customer</th>
                <th class="text-right pb-2 font-medium">Cost</th>
                <th class="text-right pb-2 font-medium">Revenue</th>
                <th class="text-right pb-2 font-medium">Margin</th>
                <th class="text-right pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in sortedCustomers"
                :key="c.customer_id"
                class="border-b last:border-0 hover:bg-muted/50 transition-colors"
              >
                <td class="py-2.5">
                  <router-link
                    :to="`/customers/${c.customer_id}`"
                    class="text-sm font-medium hover:underline"
                  >
                    {{ c.customer_name }}
                  </router-link>
                </td>
                <td class="py-2.5 text-right font-mono tabular-nums">
                  {{ fmt(c.cost) }}
                </td>
                <td class="py-2.5 text-right font-mono tabular-nums">
                  {{ fmt(c.revenue) }}
                </td>
                <td class="py-2.5 text-right">
                  <span
                    :class="marginColor(c.margin_pct)"
                    class="font-mono tabular-nums"
                  >
                    {{ formatPct(c.margin_pct) }}
                  </span>
                </td>
                <td class="py-2.5 text-right">
                  <Badge
                    :variant="getStatus(c.margin_pct, c.revenue > 0).variant"
                  >
                    {{ getStatus(c.margin_pct, c.revenue > 0).label }}
                  </Badge>
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <!-- Cost-to-Serve (only when contracts exist) -->
      <Card v-if="costToServeData?.customers?.length">
        <CardContent class="p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-base font-semibold">
              Cost-to-Serve vs Contract Value
            </h3>
          </div>
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b text-xs text-muted-foreground">
                <th class="text-left pb-2 font-medium">Customer</th>
                <th class="text-right pb-2 font-medium">Contract</th>
                <th class="text-right pb-2 font-medium">AI Cost</th>
                <th class="text-right pb-2 font-medium">Cost-to-Serve</th>
                <th class="text-right pb-2 font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in costToServeData.customers"
                :key="c.customer_id"
                class="border-b last:border-0 hover:bg-muted/50 transition-colors"
              >
                <td class="py-2.5">
                  <router-link
                    :to="`/customers/${c.customer_id}`"
                    class="text-sm font-medium hover:underline"
                  >
                    {{ c.customer_name }}
                  </router-link>
                </td>
                <td class="py-2.5 text-right font-mono tabular-nums">
                  {{ fmt(c.contract_value) }}
                </td>
                <td class="py-2.5 text-right font-mono tabular-nums">
                  {{ fmt(c.total_cost) }}
                </td>
                <td class="py-2.5 text-right">
                  <span
                    class="font-mono tabular-nums"
                    :class="
                      (c.cost_to_serve_pct ?? 0) > 50
                        ? 'text-red-500'
                        : (c.cost_to_serve_pct ?? 0) > 20
                          ? 'text-amber-500'
                          : 'text-emerald-500'
                    "
                  >
                    {{
                      c.cost_to_serve_pct != null
                        ? `${c.cost_to_serve_pct}%`
                        : "—"
                    }}
                  </span>
                </td>
                <td class="py-2.5 text-right text-muted-foreground text-xs">
                  {{ c.contract_type || "—" }}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <!-- Provider breakdown -->
      <Card v-if="overview.provider_breakdown.length > 0">
        <CardContent class="p-5">
          <h3 class="text-base font-semibold mb-3">Provider Costs</h3>
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b text-xs text-muted-foreground">
                <th class="text-left pb-2 font-medium">Provider</th>
                <th class="text-left pb-2 font-medium">Model</th>
                <th class="text-right pb-2 font-medium">Total Cost</th>
                <th class="text-right pb-2 font-medium">Avg/Call</th>
                <th class="text-right pb-2 font-medium">Calls</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in overview.provider_breakdown.slice(0, 10)"
                :key="`${p.provider}-${p.model}`"
                class="border-b last:border-0 hover:bg-muted/50 transition-colors"
              >
                <td class="py-2.5 text-muted-foreground">{{ p.provider }}</td>
                <td class="py-2.5 font-medium">{{ p.model }}</td>
                <td class="py-2.5 text-right font-mono tabular-nums">
                  {{ fmt(p.cost) }}
                </td>
                <td class="py-2.5 text-right font-mono tabular-nums">
                  {{ fmt(p.avg_cost_per_call) }}
                </td>
                <td class="py-2.5 text-right text-muted-foreground">
                  {{ p.event_count.toLocaleString() }}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <!-- Margin trend (monthly) -->
      <Card v-if="overview.margin_trend.length >= 2">
        <CardContent class="p-5">
          <div class="flex items-center gap-2 mb-3">
            <TrendingUp class="h-4 w-4 text-muted-foreground" />
            <h3 class="text-base font-semibold">Monthly Trend</h3>
          </div>
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b text-xs text-muted-foreground">
                <th class="text-left pb-2 font-medium">Month</th>
                <th class="text-right pb-2 font-medium">Cost</th>
                <th class="text-right pb-2 font-medium">Revenue</th>
                <th class="text-right pb-2 font-medium">Margin</th>
                <th class="text-right pb-2 font-medium">Events</th>
                <th class="text-right pb-2 font-medium">Customers</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="t in overview.margin_trend"
                :key="t.month"
                class="border-b last:border-0"
              >
                <td class="py-2 font-medium">{{ t.month }}</td>
                <td class="py-2 text-right font-mono tabular-nums">
                  {{ fmt(t.cost) }}
                </td>
                <td class="py-2 text-right font-mono tabular-nums">
                  {{ fmt(t.revenue) }}
                </td>
                <td class="py-2 text-right">
                  <span
                    :class="marginColor(t.margin_pct)"
                    class="font-mono tabular-nums"
                  >
                    {{ formatPct(t.margin_pct) }}
                  </span>
                </td>
                <td class="py-2 text-right text-muted-foreground">
                  {{ t.event_count.toLocaleString() }}
                </td>
                <td class="py-2 text-right text-muted-foreground">
                  {{ t.customer_count }}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
