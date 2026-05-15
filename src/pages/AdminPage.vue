<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  Users,
  Activity,
  DollarSign,
  ShieldAlert,
  Mail,
  Settings2,
  Plus,
  X,
  Eye,
} from "lucide-vue-next";
import {
  Card,
  CardContent,
  Skeleton,
  Badge,
  Button,
  Input,
} from "@/components/ui";
import { formatCurrency } from "@/lib/format";
import { getAdminEmails, getAdminActivity } from "@/lib/api";
import { startImpersonation } from "@/lib/api/base";
import { useAuth } from "@/composables/useAuth";

const { account: selfAccount } = useAuth();

interface AdminUser {
  email: string;
  name: string;
  account_id: number | null;
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
  const { getAuthToken, isAuthenticated } = await import("@/lib/clerk");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (isAuthenticated()) {
    const token = await getAuthToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }
  const response = await fetch("/api/admin/usage", { headers });
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

const activeTab = ref<"users" | "emails" | "activity">("users");

const isForbidden = computed(
  () => isError.value && error.value?.message === "FORBIDDEN",
);

const { data: emailsData, isLoading: emailsLoading } = useQuery({
  queryKey: ["admin", "emails"],
  queryFn: getAdminEmails,
  retry: false,
  enabled: computed(() => !isForbidden.value),
});

const { data: activityData, isLoading: activityLoading } = useQuery({
  queryKey: ["admin", "activity"],
  queryFn: getAdminActivity,
  retry: false,
  enabled: computed(() => !isForbidden.value && activeTab.value === "activity"),
});

// Exclude filter — persisted to localStorage
const EXCLUDE_KEY = "observe:admin-exclude";

function loadExclude(): string[] {
  const saved = window.localStorage.getItem(EXCLUDE_KEY);
  if (!saved) return [];
  try {
    return JSON.parse(saved);
  } catch (err) {
    console.warn("AdminPage: failed to parse saved exclude patterns", err);
    return [];
  }
}

const excludePatterns = ref<string[]>(loadExclude());
const excludeInput = ref("");
const showExcludeEditor = ref(false);

function addExclude() {
  const p = excludeInput.value.trim().toLowerCase();
  if (!p || excludePatterns.value.includes(p)) return;
  excludePatterns.value.push(p);
  window.localStorage.setItem(
    EXCLUDE_KEY,
    JSON.stringify(excludePatterns.value),
  );
  excludeInput.value = "";
}

function removeExclude(i: number) {
  excludePatterns.value.splice(i, 1);
  window.localStorage.setItem(
    EXCLUDE_KEY,
    JSON.stringify(excludePatterns.value),
  );
}

const filteredUsers = computed(() => {
  if (!data.value) return [];
  let list = data.value.users;
  if (excludePatterns.value.length > 0) {
    list = list.filter((u) => {
      const email = (u.email || "").toLowerCase();
      const name = (u.name || "").toLowerCase();
      return !excludePatterns.value.some(
        (p) => email.includes(p) || name.includes(p),
      );
    });
  }
  return list;
});

const sortedUsers = computed(() => {
  return [...filteredUsers.value].sort(
    (a, b) => Number(b.events_this_month) - Number(a.events_this_month),
  );
});

function viewAs(user: AdminUser) {
  if (!user.account_id) return;
  startImpersonation(user.account_id, user.email || user.name);
  window.location.href = "/analytics";
}

const excludedCount = computed(() => {
  if (!data.value || excludePatterns.value.length === 0) return 0;
  return data.value.users.length - filteredUsers.value.length;
});

const totalUsers = computed(() => filteredUsers.value.length);

const totalEvents = computed(() =>
  filteredUsers.value.reduce((sum, u) => sum + Number(u.events_this_month), 0),
);

const totalCost = computed(() =>
  filteredUsers.value.reduce(
    (sum, u) => sum + Number(u.total_cost_this_month),
    0,
  ),
);

const totalRevenue = computed(() =>
  filteredUsers.value.reduce(
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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function emailStatusVariant(
  status: string,
): "success" | "destructive" | "default" | "secondary" {
  switch (status) {
    case "delivered":
      return "success";
    case "bounced":
      return "destructive";
    case "sent":
      return "default";
    default:
      return "secondary";
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
        <p class="text-sm text-muted-foreground mt-1">
          Usage overview across all accounts
        </p>
      </div>
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
            Hide accounts where email or name contains:
          </p>
          <div class="flex gap-1.5">
            <Input
              v-model="excludeInput"
              placeholder="e.g. test, @tansohq.com"
              class="flex-1 text-xs"
              @keydown.enter="addExclude"
            />
            <Button
              size="sm"
              variant="outline"
              class="h-9 px-2"
              @click="addExclude"
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
              <button class="hover:text-foreground" @click="removeExclude(i)">
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
    </div>
    <!-- Click-away for exclude editor -->
    <div
      v-if="showExcludeEditor"
      class="fixed inset-0 z-10"
      @click="showExcludeEditor = false"
    />

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

      <!-- Section tabs -->
      <div class="flex gap-1 border-b">
        <button
          class="px-4 py-2 text-sm font-medium transition-colors"
          :class="
            activeTab === 'users'
              ? 'border-b-2 border-foreground text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'users'"
        >
          <Users class="inline h-3.5 w-3.5 mr-1.5" />
          Users
        </button>
        <button
          class="px-4 py-2 text-sm font-medium transition-colors"
          :class="
            activeTab === 'emails'
              ? 'border-b-2 border-foreground text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'emails'"
        >
          <Mail class="inline h-3.5 w-3.5 mr-1.5" />
          Emails
        </button>
        <button
          class="px-4 py-2 text-sm font-medium transition-colors"
          :class="
            activeTab === 'activity'
              ? 'border-b-2 border-foreground text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'activity'"
        >
          <Activity class="inline h-3.5 w-3.5 mr-1.5" />
          Activity Log
        </button>
      </div>

      <!-- Users table -->
      <div
        v-if="activeTab === 'users'"
        class="rounded-lg border bg-card overflow-hidden"
      >
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
                <th class="px-4 py-3 font-medium text-center w-16"></th>
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
                <td class="px-4 py-3 text-center">
                  <button
                    v-if="user.account_id && user.email !== selfAccount?.email"
                    class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="View as this account"
                    @click="viewAs(user)"
                  >
                    <Eye class="h-3 w-3" />
                    View
                  </button>
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

      <!-- Emails table -->
      <div v-if="activeTab === 'emails'">
        <div v-if="emailsLoading" class="space-y-3">
          <Skeleton v-for="i in 5" :key="i" class="h-10 w-full" />
        </div>

        <div
          v-else-if="!emailsData?.emails?.length"
          class="flex items-center justify-center py-12 text-sm text-muted-foreground"
        >
          No emails sent yet
        </div>

        <div v-else class="rounded-lg border bg-card overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead
                class="bg-muted/50 text-muted-foreground text-xs font-medium uppercase tracking-wider"
              >
                <tr>
                  <th class="px-4 py-3 font-medium text-left">To</th>
                  <th class="px-4 py-3 font-medium text-left">Subject</th>
                  <th class="px-4 py-3 font-medium text-left">Status</th>
                  <th class="px-4 py-3 font-medium text-right">Sent At</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr
                  v-for="email in emailsData.emails"
                  :key="email.id"
                  class="hover:bg-muted/50 transition-colors"
                >
                  <td class="px-4 py-3">
                    <span class="font-mono text-xs">{{
                      Array.isArray(email.to) ? email.to.join(", ") : email.to
                    }}</span>
                  </td>
                  <td class="px-4 py-3">{{ email.subject || "—" }}</td>
                  <td class="px-4 py-3">
                    <Badge :variant="emailStatusVariant(email.status)">
                      {{ email.status }}
                    </Badge>
                  </td>
                  <td class="px-4 py-3 text-right text-muted-foreground">
                    {{ formatDateTime(email.created_at) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Activity Log tab -->
      <div v-if="activeTab === 'activity'">
        <div v-if="activityLoading" class="space-y-2 py-4">
          <Skeleton v-for="i in 8" :key="i" class="h-10 w-full" />
        </div>
        <div v-else-if="activityData" class="space-y-6">
          <!-- Recent signups -->
          <div v-if="activityData.signups.length > 0">
            <h3 class="text-sm font-medium mb-2">Recent Signups (7d)</h3>
            <div class="space-y-1">
              <div
                v-for="signup in activityData.signups"
                :key="signup.email"
                class="flex items-center gap-3 rounded-md px-3 py-2 bg-success/5 border border-success/20 text-sm"
              >
                <span class="font-mono text-xs">{{ signup.email }}</span>
                <span v-if="signup.name" class="text-muted-foreground">{{
                  signup.name
                }}</span>
                <div class="flex-1" />
                <span class="text-xs text-muted-foreground">{{
                  formatDateTime(signup.created_at)
                }}</span>
              </div>
            </div>
          </div>

          <!-- Recent recommendations -->
          <div v-if="activityData.recommendation_activity.length > 0">
            <h3 class="text-sm font-medium mb-2">
              Recommendation Activity (7d)
            </h3>
            <div class="space-y-1">
              <div
                v-for="(rec, i) in activityData.recommendation_activity"
                :key="i"
                class="flex items-center gap-3 rounded-md px-3 py-2 text-sm border"
              >
                <Badge
                  :variant="
                    rec.status === 'applied'
                      ? 'default'
                      : rec.status === 'dismissed'
                        ? 'secondary'
                        : 'outline'
                  "
                >
                  {{ rec.status }}
                </Badge>
                <span class="text-xs truncate flex-1">{{ rec.title }}</span>
                <span class="font-mono text-xs text-muted-foreground">{{
                  rec.email
                }}</span>
                <span class="text-xs text-muted-foreground">{{
                  formatDateTime(rec.created_at)
                }}</span>
              </div>
            </div>
          </div>

          <!-- Event stream -->
          <div>
            <h3 class="text-sm font-medium mb-2">
              Event Stream (7d, last 100)
            </h3>
            <div class="rounded-lg border overflow-hidden">
              <table class="w-full text-sm table-auto">
                <thead
                  class="bg-muted/50 text-muted-foreground text-xs font-medium uppercase tracking-wider"
                >
                  <tr>
                    <th class="px-3 py-2 text-left">User</th>
                    <th class="px-3 py-2 text-left">Source</th>
                    <th class="px-3 py-2 text-left">Model</th>
                    <th class="px-3 py-2 text-left">Customer</th>
                    <th class="px-3 py-2 text-left">Feature</th>
                    <th class="px-3 py-2 text-right">Cost</th>
                    <th class="px-3 py-2 text-right">Time</th>
                  </tr>
                </thead>
                <tbody class="divide-y">
                  <tr
                    v-for="(evt, i) in activityData.events"
                    :key="i"
                    class="hover:bg-muted/50"
                  >
                    <td class="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {{ evt.email }}
                    </td>
                    <td class="px-3 py-2">
                      <span class="text-xs rounded-full border px-1.5 py-0.5">{{
                        evt.source
                      }}</span>
                    </td>
                    <td class="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {{ evt.model || "—" }}
                    </td>
                    <td class="px-3 py-2 text-xs">
                      {{ evt.customer_id || "—" }}
                    </td>
                    <td class="px-3 py-2 text-xs">
                      {{ evt.feature_key || "—" }}
                    </td>
                    <td class="px-3 py-2 text-right text-xs tabular-nums">
                      {{ formatCurrency(Number(evt.cost_amount)) }}
                    </td>
                    <td
                      class="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap"
                    >
                      {{ formatDateTime(evt.timestamp) }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div
                v-if="activityData.events.length === 0"
                class="py-8 text-center text-sm text-muted-foreground"
              >
                No events in the last 7 days
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
