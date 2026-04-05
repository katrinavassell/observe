<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  Users,
  Activity,
  DollarSign,
  Lightbulb,
  ShieldAlert,
} from "lucide-vue-next";
import { Card, CardContent, Skeleton, Badge } from "@/components/ui";
import { formatCurrency } from "@/lib/format";

interface AdminUser {
  email: string;
  name: string;
  stripe_plan: string;
  created_at: string;
  events_this_month: string;
  total_cost_this_month: string;
  total_revenue_this_month: string;
  insights_this_month: string;
}

interface AdminUsageResponse {
  users: AdminUser[];
}

async function fetchAdminUsage(): Promise<AdminUsageResponse> {
  const response = await fetch("/api/admin/usage", {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("FORBIDDEN");
    }
    throw new Error(`API Error: ${response.status}`);
  }
  return response.json();
}

const { data, isLoading, isError, error } = useQuery({
  queryKey: ["admin", "usage"],
  queryFn: fetchAdminUsage,
  retry: false,
});

const isForbidden = computed(
  () => isError.value && error.value?.message === "FORBIDDEN",
);

const sortedUsers = computed(() => {
  if (!data.value) return [];
  return [...data.value.users].sort(
    (a, b) => Number(b.events_this_month) - Number(a.events_this_month),
  );
});

const totalUsers = computed(() => data.value?.users.length ?? 0);

const totalEvents = computed(() =>
  (data.value?.users ?? []).reduce(
    (sum, u) => sum + Number(u.events_this_month),
    0,
  ),
);

const totalCost = computed(() =>
  (data.value?.users ?? []).reduce(
    (sum, u) => sum + Number(u.total_cost_this_month),
    0,
  ),
);

const totalRevenue = computed(() =>
  (data.value?.users ?? []).reduce(
    (sum, u) => sum + Number(u.total_revenue_this_month),
    0,
  ),
);

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
      <p class="text-sm text-muted-foreground mt-1">
        Usage overview across all accounts
      </p>
    </div>

    <!-- Forbidden -->
    <div
      v-if="isForbidden"
      class="flex flex-col items-center justify-center py-24 text-center"
    >
      <ShieldAlert class="h-10 w-10 text-muted-foreground mb-4" />
      <p class="text-lg font-medium mb-1">Admin access required</p>
      <p class="text-sm text-muted-foreground">
        You don't have permission to view this page.
      </p>
    </div>

    <!-- Loading -->
    <div v-else-if="isLoading" class="space-y-4">
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

    <!-- Error (non-403) -->
    <div
      v-else-if="isError"
      class="flex flex-col items-center justify-center py-24 text-center"
    >
      <p class="text-muted-foreground">Failed to load admin data.</p>
    </div>

    <!-- Data -->
    <template v-else-if="data">
      <!-- Summary cards -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div class="rounded-lg border bg-card p-4">
          <div
            class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"
          >
            <Users class="h-3.5 w-3.5" />
            Total Users
          </div>
          <div class="text-2xl font-semibold">{{ totalUsers }}</div>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div
            class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"
          >
            <Activity class="h-3.5 w-3.5" />
            Events This Month
          </div>
          <div class="text-2xl font-semibold">
            {{ totalEvents.toLocaleString() }}
          </div>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div
            class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"
          >
            <DollarSign class="h-3.5 w-3.5" />
            Total Cost
          </div>
          <div class="text-2xl font-semibold">
            {{ formatCurrency(totalCost) }}
          </div>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <div
            class="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"
          >
            <DollarSign class="h-3.5 w-3.5" />
            Total Revenue
          </div>
          <div class="text-2xl font-semibold">
            {{ formatCurrency(totalRevenue) }}
          </div>
        </div>
      </div>

      <!-- Users table -->
      <div class="rounded-lg border bg-card overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead
              class="bg-muted/50 text-muted-foreground text-xs font-medium uppercase tracking-wider"
            >
              <tr>
                <th class="px-4 py-3 font-medium text-left">Email</th>
                <th class="px-4 py-3 font-medium text-left">Name</th>
                <th class="px-4 py-3 font-medium text-left">Plan</th>
                <th class="px-4 py-3 font-medium text-right">Events</th>
                <th class="px-4 py-3 font-medium text-right">Cost</th>
                <th class="px-4 py-3 font-medium text-right">Revenue</th>
                <th class="px-4 py-3 font-medium text-right">Insights</th>
                <th class="px-4 py-3 font-medium text-right">Joined</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <tr
                v-for="user in sortedUsers"
                :key="user.email"
                class="hover:bg-muted/50 transition-colors"
              >
                <td class="px-4 py-3">
                  <span class="font-mono text-xs">{{ user.email }}</span>
                </td>
                <td class="px-4 py-3">{{ user.name || "—" }}</td>
                <td class="px-4 py-3">
                  <Badge
                    :variant="
                      user.stripe_plan === 'growth' ? 'success' : 'secondary'
                    "
                  >
                    {{ user.stripe_plan }}
                  </Badge>
                </td>
                <td
                  class="px-4 py-3 text-right tabular-nums text-muted-foreground"
                >
                  {{ Number(user.events_this_month).toLocaleString() }}
                </td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ formatCurrency(Number(user.total_cost_this_month)) }}
                </td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ formatCurrency(Number(user.total_revenue_this_month)) }}
                </td>
                <td
                  class="px-4 py-3 text-right tabular-nums text-muted-foreground"
                >
                  {{ Number(user.insights_this_month).toLocaleString() }}
                </td>
                <td class="px-4 py-3 text-right text-muted-foreground">
                  {{ formatDate(user.created_at) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="sortedUsers.length === 0"
          class="flex items-center justify-center py-12 text-sm text-muted-foreground"
        >
          No users found.
        </div>
      </div>
    </template>
  </div>
</template>
