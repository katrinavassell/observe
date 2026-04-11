<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { getUsageLimits } from "@/lib/api";
import {
  BarChart3,
  Plug,
  Activity,
  Cpu,
  Bell,
  Layers,
  Users,
  Eye,
  LogIn,
  LogOut,
  Database,
  CreditCard,
  Menu,
  X,
  Sparkles,
  MessageSquare,
  Shield,
  GitBranch,
} from "lucide-vue-next";
import ErrorBoundary from "@/components/shared/ErrorBoundary.vue";
import FeedbackModal from "@/components/shared/FeedbackModal.vue";
import OnboardingChecklist from "@/components/onboarding/OnboardingChecklist.vue";
import { useTeam } from "@/composables/useTeam";
import { useAuth } from "@/composables/useAuth";
import { useDataMode } from "@/composables/useDataMode";

const route = useRoute();
const router = useRouter();
const { isViewer, fetchTeamInfo } = useTeam();
const { account, isLoggedIn, logout } = useAuth();
const {
  isSampleMode,
  switchToSampleData,
  hasData,
  reset: resetDataMode,
} = useDataMode();

// Reset data status when auth state changes (signup clears sample data)
watch(isLoggedIn, (loggedIn) => {
  if (loggedIn) {
    resetDataMode();
  }
});

const onboardingDismissed = ref(
  window.localStorage.getItem("observe:onboarding_dismissed") === "true",
);
function dismissOnboarding() {
  window.localStorage.setItem("observe:onboarding_dismissed", "true");
  onboardingDismissed.value = true;
}

const feedbackOpen = ref(false);
const queryClient = useQueryClient();

function handleFeedbackCredited() {
  queryClient.invalidateQueries({ queryKey: ["usage-limits"] });
}

onMounted(async () => {
  fetchTeamInfo();
  // Auto-load sample data for guests so they see a populated dashboard
  if (!isLoggedIn.value && !hasData.value && !isSampleMode.value) {
    try {
      await switchToSampleData();
    } catch {
      // Non-critical — guest will see empty state
    }
  }
});

const navItems = computed(() => [
  {
    path: "/insights",
    label: "Insights",
    icon: Sparkles,
    description: "Recommendations and AI analysis",
  },
  {
    path: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    description: "Revenue, costs & margin overview",
  },
  {
    path: "/events",
    label: "Events",
    icon: Activity,
    description: "Observed feature usage events",
  },
  {
    path: "/traces",
    label: "Traces",
    icon: Layers,
    description: "Multi-step agent execution traces",
  },
  {
    path: "/models",
    label: "Models",
    icon: Cpu,
    description: "AI model cost breakdown",
  },
  {
    path: "/cohorts",
    label: "Cohorts",
    icon: Users,
    description: "Customer segments by profitability and behavior",
  },
  {
    path: "/alerts",
    label: "Alerts",
    icon: Bell,
    description: "Cost spike and margin alerts",
  },
  {
    path: "/routing",
    label: "Routing",
    icon: GitBranch,
    description: "LLM provider routing & fallback chains",
  },
  {
    path: "/data-sources",
    label: "Data Sources",
    icon: Plug,
    description: "Connect integrations or upload files",
  },
  {
    path: "/plans",
    label: "Plans",
    icon: CreditCard,
    description: "Manage your subscription",
    dividerBefore: true,
  },
  {
    path: "/team",
    label: "Team Settings",
    icon: Users,
    description: "Manage team & invites",
  },
]);

const isAdmin = computed(
  () => account.value?.email?.toLowerCase() === "tansoadmin@tansohq.com",
);

const adminNavItem = computed(() =>
  isAdmin.value
    ? [
        {
          path: "/admin",
          label: "Admin",
          icon: Shield,
          description: "Admin dashboard",
          dividerBefore: true,
        },
      ]
    : [],
);

const allNavItems = computed(() => [...navItems.value, ...adminNavItem.value]);

// Usage meter
const { data: usageLimits } = useQuery({
  queryKey: ["usage-limits"],
  queryFn: getUsageLimits,
  enabled: isLoggedIn,
  refetchInterval: 60000,
});

const usageMeters = computed(() => {
  if (!usageLimits.value) return [];
  const meters: Array<{
    label: string;
    used: number;
    limit: number;
    pct: number;
  }> = [];
  const ev = usageLimits.value.event_ingest?.usage;
  if (ev?.limit) {
    meters.push({
      label: "Events",
      used: ev.used,
      limit: ev.limit,
      pct: Math.min(100, Math.round((ev.used / ev.limit) * 100)),
    });
  }
  const ai = usageLimits.value.ai_insights?.usage;
  if (ai?.limit) {
    meters.push({
      label: "Messages",
      used: ai.used,
      limit: ai.limit,
      pct: Math.min(100, Math.round((ai.used / ai.limit) * 100)),
    });
  }
  return meters;
});

function meterColor(pct: number): string {
  if (pct >= 100) return "bg-red-500";
  if (pct >= 80) return "bg-amber-500";
  return "bg-emerald-500";
}

const sidebarOpen = ref(false);

watch(
  () => route.path,
  (path) => {
    sidebarOpen.value = false;
    window.posthog?.capture("$pageview", { path });
  },
);

function isActive(path: string) {
  if (path === "/") return route.path === "/";
  return route.path === path || route.path.startsWith(path + "/");
}
</script>

<template>
  <div class="flex min-h-screen">
    <!-- Mobile top bar -->
    <div
      class="fixed top-0 left-0 right-0 z-50 flex h-14 items-center gap-3 border-b bg-sidebar text-sidebar-foreground px-4 md:hidden"
    >
      <button
        @click="sidebarOpen = !sidebarOpen"
        class="p-1.5 rounded-md hover:bg-sidebar-accent transition-colors"
        aria-label="Toggle menu"
      >
        <Menu v-if="!sidebarOpen" class="h-5 w-5" />
        <X v-else class="h-5 w-5" />
      </button>
      <div
        class="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm"
      >
        O
      </div>
      <span class="text-base font-semibold">Observe</span>
    </div>

    <!-- Mobile backdrop -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-black/50 md:hidden"
      @click="sidebarOpen = false"
    />

    <!-- Sidebar -->
    <aside
      :class="[
        'fixed left-0 top-0 z-40 h-screen w-64 border-r bg-sidebar text-sidebar-foreground transition-transform duration-200 ease-in-out md:translate-x-0',
        sidebarOpen
          ? 'translate-x-0 visible'
          : '-translate-x-full max-md:invisible',
      ]"
    >
      <div class="flex h-full flex-col">
        <!-- Logo -->
        <div
          class="flex h-16 items-center gap-3 border-b border-sidebar-border px-5"
        >
          <div
            class="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm"
          >
            O
          </div>
          <div class="flex flex-col">
            <span class="text-base font-semibold leading-tight">Observe</span>
            <span class="text-[10px] text-sidebar-foreground/40 leading-tight"
              >By Tanso</span
            >
          </div>
        </div>

        <!-- Open source CTA + Sign in for anonymous users -->
        <div v-if="!isLoggedIn" class="px-3 pt-4 pb-1 space-y-2">
          <router-link
            to="/signup"
            class="flex items-center justify-center gap-2 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground px-3 py-2 text-sm font-medium transition-all duration-150 hover:opacity-90"
          >
            <LogIn class="h-4 w-4 shrink-0" />
            Sign Up Free
          </router-link>
          <router-link
            to="/login"
            class="flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-xs text-sidebar-foreground/40 hover:text-sidebar-foreground transition-all duration-150"
          >
            Already have an account? Sign in
          </router-link>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 overflow-y-auto px-3 py-4">
          <div class="space-y-1">
            <template v-for="item in allNavItems" :key="item.path">
              <!-- Section divider with label -->
              <div v-if="item.dividerBefore" class="pt-4 pb-1">
                <div class="h-px bg-sidebar-border mb-3" />
                <span
                  class="px-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40"
                  >Account</span
                >
              </div>
              <router-link
                :to="item.path"
                :title="item.description"
                :class="[
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150',
                  isActive(item.path)
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                ]"
              >
                <div
                  v-if="isActive(item.path)"
                  class="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-sidebar-primary"
                />
                <component
                  :is="item.icon"
                  :class="[
                    'h-4 w-4 shrink-0 transition-colors duration-150',
                    isActive(item.path)
                      ? 'text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/40 group-hover:text-sidebar-foreground/70',
                  ]"
                />
                <span>{{ item.label }}</span>
              </router-link>
            </template>
          </div>
        </nav>

        <!-- Usage meter -->
        <div
          v-if="isLoggedIn && usageMeters.length > 0"
          class="border-t border-sidebar-border px-4 py-3 space-y-2 cursor-pointer hover:bg-sidebar-accent/30 transition-colors"
          @click="router.push('/plans')"
          title="View plan & usage"
        >
          <div v-for="m in usageMeters" :key="m.label" class="space-y-1">
            <div class="flex items-center justify-between text-[10px]">
              <span class="text-sidebar-foreground/50">{{ m.label }}</span>
              <span class="text-sidebar-foreground/50"
                >{{ m.used.toLocaleString() }}/{{
                  m.limit.toLocaleString()
                }}</span
              >
            </div>
            <div class="h-1 rounded-full bg-sidebar-accent overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="meterColor(m.pct)"
                :style="{ width: `${Math.max(2, m.pct)}%` }"
              />
            </div>
          </div>
        </div>

        <!-- Bottom section: Account & Team Settings -->
        <div class="border-t border-sidebar-border px-3 py-4 space-y-1">
          <!-- Role badge for viewers -->
          <div
            v-if="isViewer"
            class="flex items-center gap-2 px-3 py-1.5 text-xs text-warning bg-warning/10 rounded-lg mb-2"
          >
            <Eye class="h-3 w-3 shrink-0" />
            <span>Viewer access</span>
          </div>
          <!-- Account section -->
          <div
            v-if="isLoggedIn && account"
            class="flex items-center justify-between rounded-lg px-3 py-2.5 mt-2"
          >
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">
                {{ account.name || account.email }}
              </div>
              <div
                v-if="account.name"
                class="text-[10px] text-sidebar-foreground/40 truncate"
              >
                {{ account.email }}
              </div>
            </div>
            <button
              @click="logout"
              aria-label="Sign out"
              class="ml-2 p-1.5 rounded-md text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-150"
              title="Sign out"
            >
              <LogOut class="h-4 w-4" />
            </button>
          </div>
          <!-- Feedback -->
          <div class="flex items-center gap-1 px-2 pt-1">
            <button
              v-if="isLoggedIn"
              class="flex items-center gap-1.5 px-2 py-1 text-xs text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-150 rounded-md"
              @click="feedbackOpen = true"
            >
              <MessageSquare class="h-3 w-3" />
              Feedback
            </button>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 min-h-screen overflow-x-hidden pt-14 md:pt-0 md:ml-64">
      <!-- Guest banner (desktop only — mobile uses sticky bottom bar) -->
      <div
        v-if="!isLoggedIn && isSampleMode"
        class="hidden md:flex items-center justify-between px-4 py-2 bg-blue-50 text-blue-700 border-b border-blue-200 text-sm"
      >
        <div class="flex items-center gap-2">
          <Database class="h-4 w-4" />
          <span>Browsing as guest with sample data</span>
        </div>
        <router-link to="/signup" class="font-medium hover:underline">
          Sign up to connect your data
        </router-link>
      </div>
      <div class="p-6 pb-24 md:pb-6">
        <ErrorBoundary>
          <slot />
        </ErrorBoundary>
      </div>
    </main>

    <!-- Mobile sticky bottom CTA for guests -->
    <div
      v-if="!isLoggedIn"
      class="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t bg-background/95 backdrop-blur-sm px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <router-link
        to="/signup"
        class="flex items-center justify-center gap-2 w-full rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium transition-all hover:opacity-90"
      >
        <LogIn class="h-4 w-4" />
        Sign Up Free
      </router-link>
    </div>

    <FeedbackModal
      :open="feedbackOpen"
      @close="feedbackOpen = false"
      @credited="handleFeedbackCredited"
    />

    <OnboardingChecklist
      v-if="isLoggedIn && !onboardingDismissed"
      @dismiss="dismissOnboarding"
    />
  </div>
</template>
