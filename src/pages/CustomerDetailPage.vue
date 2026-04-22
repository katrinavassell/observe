<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import {
  getCustomerDetail,
  getCustomerTimeseries,
  getCohorts,
  getHealthHistory,
} from "@/lib/api";
import type { CohortCustomer, CohortLabel } from "@/lib/api";
import {
  ArrowLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  Zap,
  Cpu,
  Activity,
} from "lucide-vue-next";
import { Card, CardContent, Skeleton, Button } from "@/components/ui";
import MarginBadge from "@/components/shared/MarginBadge.vue";
import CustomerTrendChart from "@/components/charts/CustomerTrendChart.vue";
import { formatCurrency as fmt } from "@/lib/format";
import { useAuth } from "@/composables/useAuth";

const route = useRoute();
const router = useRouter();
const { isLoggedIn } = useAuth();

const customerId = computed(() => route.params.id as string);

const { data: detail, isLoading: detailLoading } = useQuery({
  queryKey: ["customer-detail", customerId],
  queryFn: () => getCustomerDetail(customerId.value),
  enabled: () => isLoggedIn.value && !!customerId.value,
});

const { data: timeseries, isLoading: tsLoading } = useQuery({
  queryKey: ["customer-timeseries", customerId],
  queryFn: () => getCustomerTimeseries(customerId.value),
  enabled: () => isLoggedIn.value && !!customerId.value,
});

const { data: cohortsData } = useQuery({
  queryKey: ["cohorts"],
  queryFn: () => getCohorts(),
  enabled: isLoggedIn,
});

const { data: _healthData } = useQuery({
  queryKey: ["customer-health", customerId],
  queryFn: () => getHealthHistory(customerId.value),
  enabled: () => isLoggedIn.value && !!customerId.value,
});

const cohortCustomer = computed<CohortCustomer | null>(() => {
  if (!cohortsData.value) return null;
  return (
    cohortsData.value.customers.find(
      (c) => c.customer_id === customerId.value,
    ) ?? null
  );
});

const isLoading = computed(() => detailLoading.value || tsLoading.value);

// Signals
const signals = computed(() => {
  const cc = cohortCustomer.value;
  if (!cc) return [];

  const items: {
    type: "danger" | "warning" | "success" | "info";
    icon: typeof AlertTriangle;
    title: string;
    description: string;
  }[] = [];

  // Unprofitable — negative margin OR cost with zero revenue (margin_pct is
  // null when revenue is zero, so the naive `< 0` check missed this case)
  if (cc.margin_pct !== null && cc.margin_pct < 0) {
    items.push({
      type: "danger",
      icon: AlertTriangle,
      title: "Unprofitable customer",
      description: `Margin is ${cc.margin_pct}% — cost exceeds revenue by ${fmt(cc.total_cost - cc.total_revenue)}.`,
    });
  } else if (cc.total_cost > 0 && cc.total_revenue === 0) {
    items.push({
      type: "danger",
      icon: AlertTriangle,
      title: "Unprofitable customer",
      description: `No revenue recorded — ${fmt(cc.total_cost)} of cost is unrecovered. Connect Stripe or set feature pricing.`,
    });
  }

  // Usage declining — include magnitude from cost_trend_pct
  if (cc.cost_trend === "down" && cc.active_days_30d < 20) {
    const magnitude =
      cc.cost_trend_pct != null
        ? `Usage down ${Math.abs(cc.cost_trend_pct)}% — `
        : "";
    items.push({
      type: "warning",
      icon: TrendingDown,
      title: "Usage declining",
      description: `${magnitude}cost trending down with only ${cc.active_days_30d} active days in the last 30. Possible churn risk.`,
    });
  }

  // Usage growing — include magnitude
  if (cc.cost_trend === "up") {
    const magnitude =
      cc.cost_trend_pct != null ? `Usage up ${cc.cost_trend_pct}% — ` : "";
    items.push({
      type: "success",
      icon: TrendingUp,
      title: "Usage growing",
      description: `${magnitude}cost trending up, potential expansion opportunity.`,
    });
  }

  // Inactive — add historical context when we have >= 2 prior months of data
  if (cc.active_days_30d < 3) {
    const historical =
      cc.active_days_prior_avg != null
        ? ` (usually ${cc.active_days_prior_avg})`
        : "";
    items.push({
      type: "warning",
      icon: Clock,
      title: "Inactive",
      description: `Only ${cc.active_days_30d} active day${cc.active_days_30d === 1 ? "" : "s"} in the last 30${historical}.`,
    });
  }

  // Model swap
  if (cc.model_swap_suggestion) {
    const s = cc.model_swap_suggestion;
    items.push({
      type: "info",
      icon: Cpu,
      title: "Model optimization available",
      description: `Switch from ${cc.top_model} to ${s.suggested_model} — save ~${s.potential_savings_pct}% per event.`,
    });
  }

  return items;
});

function signalBorderClass(type: string): string {
  switch (type) {
    case "danger":
      return "border-l-red-500";
    case "warning":
      return "border-l-yellow-500";
    case "success":
      return "border-l-green-500";
    case "info":
      return "border-l-blue-500";
    default:
      return "border-l-gray-300";
  }
}

function signalIconClass(type: string): string {
  switch (type) {
    case "danger":
      return "text-red-500";
    case "warning":
      return "text-yellow-500";
    case "success":
      return "text-green-500";
    case "info":
      return "text-blue-500";
    default:
      return "text-gray-500";
  }
}

function cohortBadgeClass(cohort: CohortLabel | null): string {
  if (!cohort) return "";
  const map: Record<CohortLabel, string> = {
    unprofitable: "bg-red-100 text-red-700 border-red-200",
    rising_cost: "bg-orange-100 text-orange-700 border-orange-200",
    inactive: "bg-gray-100 text-gray-600 border-gray-200",
    champion: "bg-green-100 text-green-700 border-green-200",
  };
  return map[cohort] ?? "bg-gray-100 text-gray-600";
}

function healthDotClass(score: number): string {
  if (score < 30) return "bg-red-500";
  if (score < 60) return "bg-yellow-500";
  return "bg-green-500";
}

function formatDate(date: string): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const avgEventsPerDay = computed(() => {
  if (!timeseries.value?.timeseries.length) return null;
  const ts = timeseries.value.timeseries;
  const totalEvents = ts.reduce((s, t) => s + t.event_count, 0);
  const months = ts.length || 1;
  return Math.round(totalEvents / (months * 30));
});

const costPerEvent = computed(() => {
  if (!detail.value || detail.value.total_cost === 0) return null;
  const events = detail.value.by_feature.reduce((s, f) => s + f.event_count, 0);
  if (events === 0) return null;
  return detail.value.total_cost / events;
});
</script>

<template>
  <div class="space-y-6 pb-12">
    <!-- Loading -->
    <div v-if="isLoading" class="space-y-4">
      <Skeleton class="h-8 w-48" />
      <Skeleton class="h-[300px] w-full" />
      <div class="grid grid-cols-5 gap-4">
        <Skeleton v-for="i in 5" :key="i" class="h-20" />
      </div>
    </div>

    <template v-else-if="detail">
      <!-- Breadcrumb -->
      <nav aria-label="Breadcrumb" class="flex items-center gap-1.5 text-sm">
        <button
          class="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          @click="router.push('/customers')"
        >
          <ArrowLeft class="h-3.5 w-3.5" />
          Customers
        </button>
        <ChevronRight class="h-3.5 w-3.5 text-muted-foreground/50" />
        <span class="text-foreground font-medium truncate max-w-[400px]">
          {{ detail.customer.name }}
        </span>
      </nav>

      <!-- Header -->
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div class="flex items-center gap-3">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-2xl font-semibold tracking-tight">
                {{ detail.customer.name }}
              </h1>
              <span
                v-if="cohortCustomer?.cohort"
                class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                :class="cohortBadgeClass(cohortCustomer.cohort)"
              >
                {{ cohortCustomer.cohort }}
              </span>
            </div>
            <div class="flex items-center gap-3 text-sm text-muted-foreground">
              <span v-if="detail.customer.email">{{
                detail.customer.email
              }}</span>
              <span
                v-if="detail.customer.segment"
                class="px-1.5 py-0.5 rounded bg-muted text-xs"
              >
                {{ detail.customer.segment }}
              </span>
              <span v-if="cohortCustomer">
                Last active {{ formatDate(cohortCustomer.last_seen) }}
              </span>
            </div>
          </div>
        </div>
        <MarginBadge :margin="detail.margin_pct" />
      </div>

      <!-- Trend chart -->
      <Card v-if="timeseries?.timeseries.length">
        <CardContent class="p-6">
          <h2 class="font-semibold mb-4">Revenue vs Cost</h2>
          <CustomerTrendChart :data="timeseries.timeseries" />
        </CardContent>
      </Card>

      <!-- KPI cards -->
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Card>
          <CardContent class="p-4">
            <p class="text-xs text-muted-foreground">Revenue</p>
            <p class="text-xl font-semibold">{{ fmt(detail.total_revenue) }}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-xs text-muted-foreground">Cost</p>
            <p class="text-xl font-semibold">{{ fmt(detail.total_cost) }}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-xs text-muted-foreground">Margin</p>
            <p class="text-xl font-semibold">
              {{ detail.margin_pct !== null ? `${detail.margin_pct}%` : "—" }}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-xs text-muted-foreground">Avg Events/Day</p>
            <p class="text-xl font-semibold">
              {{
                avgEventsPerDay !== null
                  ? avgEventsPerDay.toLocaleString()
                  : "—"
              }}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-xs text-muted-foreground">Cost per Event</p>
            <p class="text-xl font-semibold">
              {{ costPerEvent !== null ? fmt(costPerEvent) : "—" }}
            </p>
          </CardContent>
        </Card>
      </div>

      <!-- Empty state — no events + no features + no subscriptions -->
      <Card
        v-if="
          !detail.by_feature.length &&
          !detail.recent_events.length &&
          !detail.subscriptions.length &&
          !timeseries?.timeseries.length
        "
        class="border-dashed"
      >
        <CardContent class="p-10 text-center space-y-3">
          <div
            class="mx-auto h-10 w-10 rounded-full bg-muted flex items-center justify-center"
          >
            <Activity class="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 class="font-semibold">No activity yet</h2>
          <p class="text-sm text-muted-foreground max-w-sm mx-auto">
            This customer hasn't sent events, hasn't been tied to a feature, and
            has no subscriptions. They'll light up here once your app starts
            emitting events with their customer_id.
          </p>
          <div class="flex justify-center gap-2 pt-1">
            <Button size="sm" @click="router.push('/data-sources')">
              Set up ingest
            </Button>
            <Button size="sm" variant="outline" @click="router.push('/events')">
              View all events
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- Signals — hidden until calcs are trustworthy (no revenue guard,
           hardcoded thresholds, no trend magnitude, model-swap compares
           unrelated model families). Code kept for when we reintroduce. -->
      <Card v-if="false && signals.length > 0">
        <CardContent class="p-6 space-y-3">
          <h2 class="font-semibold flex items-center gap-2">
            <Zap class="h-4 w-4 text-primary" />
            Signals
          </h2>
          <div
            v-for="(signal, i) in signals"
            :key="i"
            class="rounded-md border border-l-4 p-3 flex items-start gap-3"
            :class="signalBorderClass(signal.type)"
          >
            <component
              :is="signal.icon"
              class="h-4 w-4 mt-0.5 shrink-0"
              :class="signalIconClass(signal.type)"
            />
            <div>
              <p class="text-sm font-medium">{{ signal.title }}</p>
              <p class="text-xs text-muted-foreground">
                {{ signal.description }}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Usage by feature -->
      <Card v-if="detail.by_feature.length > 0">
        <CardContent class="p-6">
          <h2 class="font-semibold mb-4">Usage by Feature</h2>
          <div class="rounded-lg border overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b bg-muted/30 text-left">
                  <th class="px-3 py-2 font-medium text-muted-foreground">
                    Feature
                  </th>
                  <th
                    class="px-3 py-2 font-medium text-muted-foreground text-right"
                  >
                    Events
                  </th>
                  <th
                    class="px-3 py-2 font-medium text-muted-foreground text-right"
                  >
                    Cost
                  </th>
                  <th
                    class="px-3 py-2 font-medium text-muted-foreground text-right"
                  >
                    Revenue
                  </th>
                  <th
                    class="px-3 py-2 font-medium text-muted-foreground text-right"
                  >
                    Margin
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="f in detail.by_feature"
                  :key="f.feature_key"
                  class="border-b last:border-0"
                >
                  <td class="px-3 py-2">
                    <button
                      class="hover:underline"
                      @click="
                        router.push(
                          `/events?customer=${encodeURIComponent(customerId)}&feature=${encodeURIComponent(f.feature_key)}`,
                        )
                      "
                    >
                      <code class="text-xs bg-muted px-1.5 py-0.5 rounded">{{
                        f.feature_key
                      }}</code>
                    </button>
                  </td>
                  <td class="px-3 py-2 text-right font-mono">
                    {{ f.event_count.toLocaleString() }}
                  </td>
                  <td class="px-3 py-2 text-right font-mono">
                    {{ fmt(f.total_cost) }}
                  </td>
                  <td class="px-3 py-2 text-right font-mono">
                    {{ fmt(f.total_revenue) }}
                  </td>
                  <td
                    class="px-3 py-2 text-right font-mono"
                    :class="{
                      'text-destructive':
                        f.total_revenue > 0 &&
                        ((f.total_revenue - f.total_cost) / f.total_revenue) *
                          100 <
                          0,
                      'text-success':
                        f.total_revenue > 0 &&
                        ((f.total_revenue - f.total_cost) / f.total_revenue) *
                          100 >
                          0,
                      'text-muted-foreground': f.total_revenue === 0,
                    }"
                  >
                    {{
                      f.total_revenue > 0
                        ? Math.round(
                            ((f.total_revenue - f.total_cost) /
                              f.total_revenue) *
                              100,
                          ) + "%"
                        : "—"
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <!-- Usage by model -->
      <Card v-if="detail.by_model.length > 0">
        <CardContent class="p-6">
          <h2 class="font-semibold mb-4">Usage by Model</h2>
          <div class="rounded-lg border overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b bg-muted/30 text-left">
                  <th class="px-3 py-2 font-medium text-muted-foreground">
                    Model
                  </th>
                  <th
                    class="px-3 py-2 font-medium text-muted-foreground text-right"
                  >
                    Events
                  </th>
                  <th
                    class="px-3 py-2 font-medium text-muted-foreground text-right"
                  >
                    Cost
                  </th>
                  <th
                    class="px-3 py-2 font-medium text-muted-foreground text-right"
                  >
                    Revenue
                  </th>
                  <th
                    class="px-3 py-2 font-medium text-muted-foreground text-right"
                  >
                    Margin
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="m in detail.by_model"
                  :key="m.model"
                  class="border-b last:border-0"
                >
                  <td class="px-3 py-2">
                    <button
                      class="text-left hover:underline"
                      @click="
                        router.push(
                          `/events?customer=${encodeURIComponent(customerId)}&model=${encodeURIComponent(m.model)}`,
                        )
                      "
                    >
                      <div class="text-sm font-medium">{{ m.model }}</div>
                      <div
                        v-if="m.model_provider"
                        class="text-xs text-muted-foreground"
                      >
                        {{ m.model_provider }}
                      </div>
                    </button>
                  </td>
                  <td class="px-3 py-2 text-right font-mono">
                    {{ m.event_count.toLocaleString() }}
                  </td>
                  <td class="px-3 py-2 text-right font-mono">
                    {{ fmt(m.total_cost) }}
                  </td>
                  <td class="px-3 py-2 text-right font-mono">
                    {{ fmt(m.total_revenue) }}
                  </td>
                  <td
                    class="px-3 py-2 text-right font-mono"
                    :class="{
                      'text-destructive':
                        m.total_revenue > 0 &&
                        ((m.total_revenue - m.total_cost) / m.total_revenue) *
                          100 <
                          0,
                      'text-success':
                        m.total_revenue > 0 &&
                        ((m.total_revenue - m.total_cost) / m.total_revenue) *
                          100 >
                          0,
                      'text-muted-foreground': m.total_revenue === 0,
                    }"
                  >
                    {{
                      m.total_revenue > 0
                        ? Math.round(
                            ((m.total_revenue - m.total_cost) /
                              m.total_revenue) *
                              100,
                          ) + "%"
                        : "—"
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <!-- Recent events -->
      <details v-if="detail.recent_events.length > 0" class="group">
        <summary
          class="text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
        >
          Recent events ({{ detail.recent_events.length }})
        </summary>
        <div class="mt-3 rounded-lg border overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b bg-muted/30 text-left">
                <th class="px-3 py-2 font-medium text-muted-foreground">
                  Time
                </th>
                <th class="px-3 py-2 font-medium text-muted-foreground">
                  Event
                </th>
                <th class="px-3 py-2 font-medium text-muted-foreground">
                  Feature
                </th>
                <th class="px-3 py-2 font-medium text-muted-foreground">
                  Model
                </th>
                <th
                  class="px-3 py-2 font-medium text-muted-foreground text-right"
                >
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(e, i) in detail.recent_events"
                :key="i"
                class="border-b last:border-0"
              >
                <td
                  class="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap"
                >
                  {{ formatDate(e.timestamp) }}
                </td>
                <td class="px-3 py-2">{{ e.event_name }}</td>
                <td class="px-3 py-2">
                  <code
                    v-if="e.feature_key"
                    class="text-xs bg-muted px-1 py-0.5 rounded"
                    >{{ e.feature_key }}</code
                  >
                  <span v-else class="text-muted-foreground">—</span>
                </td>
                <td class="px-3 py-2 text-xs">{{ e.model || "—" }}</td>
                <td class="px-3 py-2 text-right font-mono">
                  {{ e.cost_amount != null ? fmt(e.cost_amount) : "—" }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <!-- Subscriptions -->
      <details v-if="detail.subscriptions.length > 0" class="group">
        <summary
          class="text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
        >
          Subscriptions ({{ detail.subscriptions.length }})
        </summary>
        <div class="mt-3 rounded-lg border overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b bg-muted/30 text-left">
                <th class="px-3 py-2 font-medium text-muted-foreground">
                  Plan
                </th>
                <th
                  class="px-3 py-2 font-medium text-muted-foreground text-right"
                >
                  Price
                </th>
                <th
                  class="px-3 py-2 font-medium text-muted-foreground text-center"
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(s, i) in detail.subscriptions"
                :key="i"
                class="border-b last:border-0"
              >
                <td class="px-3 py-2">{{ s.plan_name || s.plan_id }}</td>
                <td class="px-3 py-2 text-right font-mono">
                  {{ s.price_amount != null ? fmt(s.price_amount) : "—" }}
                </td>
                <td class="px-3 py-2 text-center">
                  <span
                    class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                    :class="
                      s.is_active
                        ? 'bg-green-100 text-green-700 border-green-200'
                        : 'bg-gray-100 text-gray-600 border-gray-200'
                    "
                  >
                    {{ s.is_active ? "Active" : "Inactive" }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </template>

    <!-- Not logged in -->
    <Card
      v-else-if="!isLoggedIn"
      class="border-dashed border-muted-foreground/30"
    >
      <CardContent class="p-8 text-center">
        <p class="text-sm text-muted-foreground mb-3">
          Sign up to view individual customer details.
        </p>
        <Button size="sm" @click="router.push('/signup')">
          Sign up to get started
        </Button>
      </CardContent>
    </Card>

    <!-- Not found -->
    <Card v-else class="border-dashed">
      <CardContent class="p-8 text-center">
        <p class="text-sm text-muted-foreground">Customer not found.</p>
        <Button size="sm" class="mt-3" @click="router.push('/customers')">
          Back to Customers
        </Button>
      </CardContent>
    </Card>
  </div>
</template>
