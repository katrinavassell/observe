<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { getCohorts } from "@/lib/api";
import type { CohortCustomer, CohortLabel } from "@/lib/api";
import {
  Search,
  Database,
  Plug,
  ChevronDown,
  ChevronUp,
} from "lucide-vue-next";
import { Card, CardContent, Skeleton, Button, Input } from "@/components/ui";
import MarginBadge from "@/components/shared/MarginBadge.vue";
import TrendIndicator from "@/components/shared/TrendIndicator.vue";
import { formatCurrency as fmt } from "@/lib/format";
import { useAuth } from "@/composables/useAuth";
import {
  GUEST_COHORT_CUSTOMERS,
  GUEST_COHORT_TOTALS,
} from "@/lib/guest-preview";

const router = useRouter();
const { isLoggedIn } = useAuth();

const { data, isLoading } = useQuery({
  queryKey: ["cohorts"],
  queryFn: () => getCohorts(true),
  enabled: isLoggedIn,
  placeholderData: { customers: [], totals: null },
});

const customers = computed<CohortCustomer[]>(
  () =>
    data.value?.customers ?? (isLoggedIn.value ? [] : GUEST_COHORT_CUSTOMERS),
);
const totals = computed(
  () => data.value?.totals ?? (isLoggedIn.value ? null : GUEST_COHORT_TOTALS),
);

// Search + filters
const searchQuery = ref("");
const activeCohortFilter = ref<CohortLabel | null>(null);
const activeTrendFilter = ref<"up" | "down" | "stable" | null>(null);

type SortKey =
  | "total_revenue"
  | "total_cost"
  | "margin_pct"
  | "health_score"
  | "last_seen";
const sortKey = ref<SortKey>("total_revenue");
const sortDir = ref<"asc" | "desc">("desc");

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortDir.value = "desc";
  }
}

const filteredCustomers = computed(() => {
  let list = customers.value;

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter(
      (c) =>
        (c.customer_name ?? "").toLowerCase().includes(q) ||
        (c.customer_id ?? "").toLowerCase().includes(q) ||
        (c.customer_email?.toLowerCase().includes(q) ?? false),
    );
  }

  if (activeCohortFilter.value) {
    list = list.filter((c) => c.cohort === activeCohortFilter.value);
  }

  if (activeTrendFilter.value) {
    list = list.filter((c) => c.cost_trend === activeTrendFilter.value);
  }

  const dir = sortDir.value === "desc" ? -1 : 1;
  return [...list].sort((a, b) => {
    const av = a[sortKey.value] ?? -Infinity;
    const bv = b[sortKey.value] ?? -Infinity;
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv) * dir;
    }
    return ((av as number) - (bv as number)) * dir;
  });
});

const cohortLabels: { label: string; value: CohortLabel; color: string }[] = [
  {
    label: "Unprofitable",
    value: "unprofitable",
    color: "bg-red-100 text-red-700 border-red-200",
  },
  {
    label: "At Risk",
    value: "at_risk",
    color: "bg-yellow-100 text-yellow-700 border-yellow-200",
  },
  {
    label: "Rising Cost",
    value: "rising_cost",
    color: "bg-orange-100 text-orange-700 border-orange-200",
  },
  {
    label: "Inactive",
    value: "inactive",
    color: "bg-gray-100 text-gray-600 border-gray-200",
  },
  {
    label: "Champion",
    value: "champion",
    color: "bg-green-100 text-green-700 border-green-200",
  },
  {
    label: "Healthy",
    value: "healthy",
    color: "bg-blue-100 text-blue-700 border-blue-200",
  },
];

function cohortBadgeClass(cohort: CohortLabel): string {
  return (
    cohortLabels.find((c) => c.value === cohort)?.color ??
    "bg-gray-100 text-gray-600"
  );
}

function healthDotClass(score: number): string {
  if (score < 30) return "bg-red-500";
  if (score < 60) return "bg-yellow-500";
  return "bg-green-500";
}

function trendDirection(trend: string): "up" | "down" | "stable" {
  if (trend === "up") return "up";
  if (trend === "down") return "down";
  return "stable";
}

function formatLastSeen(date: string): string {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const days = Math.floor(
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sortIcon(key: SortKey) {
  if (sortKey.value !== key) return null;
  return sortDir.value === "desc" ? ChevronDown : ChevronUp;
}
</script>

<template>
  <div class="space-y-6 pb-12">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Customers</h1>
      <p class="text-muted-foreground">
        Individual customer health, profitability, and usage trends.
      </p>
    </div>

    <!-- KPI cards -->
    <div v-if="totals" class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <Card>
        <CardContent class="p-4">
          <p class="text-xs text-muted-foreground">Customers</p>
          <p class="text-2xl font-semibold">
            {{ (totals.customers ?? 0).toLocaleString() }}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="p-4">
          <p class="text-xs text-muted-foreground">Total Revenue</p>
          <p class="text-2xl font-semibold">{{ fmt(totals.revenue) }}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="p-4">
          <p class="text-xs text-muted-foreground">Avg Margin</p>
          <p class="text-2xl font-semibold">
            {{
              totals.margin_pct !== null
                ? `${Math.round(totals.margin_pct)}%`
                : "—"
            }}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="p-4">
          <p class="text-xs text-muted-foreground">Avg Health</p>
          <p class="text-2xl font-semibold">
            {{ Math.round(totals.avg_health_score ?? 0) }}
          </p>
        </CardContent>
      </Card>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative flex-1 min-w-[200px] max-w-sm">
        <Search
          class="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
        />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search by name, ID, or email…"
          class="w-full h-9 rounded-md border bg-background pl-9 pr-3 text-sm"
        />
      </div>

      <!-- Cohort chips -->
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="c in cohortLabels"
          :key="c.value"
          class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer"
          :class="[
            activeCohortFilter === c.value
              ? c.color + ' ring-2 ring-offset-1 ring-current'
              : 'bg-muted text-muted-foreground hover:bg-muted/80',
          ]"
          @click="
            activeCohortFilter = activeCohortFilter === c.value ? null : c.value
          "
        >
          {{ c.label }}
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="space-y-3">
      <Skeleton v-for="i in 5" :key="i" class="h-12 w-full" />
    </div>

    <!-- Empty -->
    <Card
      v-else-if="customers.length === 0"
      class="border-dashed border-muted-foreground/30"
    >
      <CardContent class="p-8 text-center">
        <Database class="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p class="text-sm text-muted-foreground mb-4">
          No customer data yet. Connect a data source to see customers here.
        </p>
        <Button size="sm" @click="router.push('/data-sources')">
          <Plug class="h-3 w-3 mr-1.5" />
          Connect data sources
        </Button>
      </CardContent>
    </Card>

    <!-- Table -->
    <div v-else class="rounded-lg border bg-card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b bg-muted/30 text-left">
            <th class="px-3 py-2.5 font-medium text-muted-foreground">
              Customer
            </th>
            <th class="px-3 py-2.5 font-medium text-muted-foreground">
              Segment
            </th>
            <th
              class="px-3 py-2.5 font-medium text-muted-foreground text-right cursor-pointer select-none"
              @click="toggleSort('total_revenue')"
            >
              <span class="inline-flex items-center gap-1">
                MRR
                <component
                  :is="sortIcon('total_revenue')"
                  v-if="sortIcon('total_revenue')"
                  class="h-3 w-3"
                />
              </span>
            </th>
            <th
              class="px-3 py-2.5 font-medium text-muted-foreground text-right cursor-pointer select-none"
              @click="toggleSort('total_cost')"
            >
              <span class="inline-flex items-center gap-1">
                Cost
                <component
                  :is="sortIcon('total_cost')"
                  v-if="sortIcon('total_cost')"
                  class="h-3 w-3"
                />
              </span>
            </th>
            <th
              class="px-3 py-2.5 font-medium text-muted-foreground text-right cursor-pointer select-none"
              @click="toggleSort('margin_pct')"
            >
              <span class="inline-flex items-center gap-1">
                Margin
                <component
                  :is="sortIcon('margin_pct')"
                  v-if="sortIcon('margin_pct')"
                  class="h-3 w-3"
                />
              </span>
            </th>
            <th
              class="px-3 py-2.5 font-medium text-muted-foreground text-center"
            >
              Trend
            </th>
            <th
              class="px-3 py-2.5 font-medium text-muted-foreground text-center cursor-pointer select-none"
              @click="toggleSort('health_score')"
            >
              <span class="inline-flex items-center gap-1">
                Health
                <component
                  :is="sortIcon('health_score')"
                  v-if="sortIcon('health_score')"
                  class="h-3 w-3"
                />
              </span>
            </th>
            <th
              class="px-3 py-2.5 font-medium text-muted-foreground text-right cursor-pointer select-none"
              @click="toggleSort('last_seen')"
            >
              <span class="inline-flex items-center gap-1">
                Last Active
                <component
                  :is="sortIcon('last_seen')"
                  v-if="sortIcon('last_seen')"
                  class="h-3 w-3"
                />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in filteredCustomers"
            :key="c.customer_id"
            class="border-b last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
            @click="
              isLoggedIn
                ? router.push(`/customers/${c.customer_id}`)
                : router.push('/signup')
            "
          >
            <td class="px-3 py-2.5">
              <div class="flex items-center gap-2">
                <div class="min-w-0">
                  <div class="font-medium truncate max-w-[200px]">
                    {{ c.customer_name }}
                  </div>
                  <div
                    v-if="c.customer_email"
                    class="text-xs text-muted-foreground truncate max-w-[200px]"
                  >
                    {{ c.customer_email }}
                  </div>
                </div>
                <span
                  class="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium shrink-0"
                  :class="cohortBadgeClass(c.cohort)"
                >
                  {{ c.cohort }}
                </span>
              </div>
            </td>
            <td class="px-3 py-2.5 text-muted-foreground">
              {{ c.segment || "—" }}
            </td>
            <td class="px-3 py-2.5 text-right font-mono">
              {{ fmt(c.total_revenue) }}
            </td>
            <td class="px-3 py-2.5 text-right font-mono">
              {{ fmt(c.total_cost) }}
            </td>
            <td class="px-3 py-2.5 text-right">
              <MarginBadge :margin="c.margin_pct" />
            </td>
            <td class="px-3 py-2.5 text-center">
              <TrendIndicator
                :direction="trendDirection(c.cost_trend)"
                :invert-colors="true"
              />
            </td>
            <td class="px-3 py-2.5 text-center">
              <div class="inline-flex items-center gap-1.5">
                <span
                  class="h-2.5 w-2.5 rounded-full shrink-0"
                  :class="healthDotClass(c.health_score)"
                />
                <span class="text-xs">{{ c.health_score }}</span>
              </div>
            </td>
            <td class="px-3 py-2.5 text-right text-muted-foreground text-xs">
              {{ formatLastSeen(c.last_seen) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-xs text-muted-foreground">
      {{ filteredCustomers.length }} of {{ customers.length }} customers shown
    </p>
  </div>
</template>
