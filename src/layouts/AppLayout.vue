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
  CreditCard,
  Menu,
  X,
  MessageSquare,
  HelpCircle,
  Shield,
  UserCircle,
} from "lucide-vue-next";
import ErrorBoundary from "@/components/shared/ErrorBoundary.vue";
import FeedbackModal from "@/components/shared/FeedbackModal.vue";
import OnboardingChecklist from "@/components/onboarding/OnboardingChecklist.vue";
import { useTeam } from "@/composables/useTeam";
import { useAuth } from "@/composables/useAuth";
import { useDataMode } from "@/composables/useDataMode";
import { useAccounts } from "@/composables/useAccounts";
import AccountSwitcher from "@/components/accounts/AccountSwitcher.vue";

const route = useRoute();
const router = useRouter();
const { isViewer, fetchTeamInfo } = useTeam();
const { account, isLoggedIn, logout } = useAuth();
const { reset: resetDataMode } = useDataMode();

const isMobileLanding = computed(
  () => route.path === "/" || route.path === "/analytics",
);
const { accounts: myAccounts } = useAccounts();
const showAccountSwitcher = computed(() => (myAccounts.value?.length ?? 0) > 1);

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

onMounted(() => {
  fetchTeamInfo();
  // NOTE: do NOT auto-load sample data here. Previously this fired during
  // a brief window where isLoggedIn was false on first paint (before
  // useAuth finished initializing). Result: sample rows got seeded under
  // the real user's visitor_id and then leaked into their dashboard.
  // Sample data is no longer auto-loaded for anyone — guests see empty
  // state.
});

const navItems = computed(() => [
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
    label: "Customers",
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

const ADMIN_EMAILS = [
  "dogfood@tansohq.com",
  "kat@tansohq.com",
  "doug@tansohq.com",
];
const isAdmin = computed(() => {
  const email = account.value?.email?.toLowerCase();
  return !!email && ADMIN_EMAILS.includes(email);
});

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
        <!-- Logo / Account Switcher -->
        <div class="flex h-16 items-center border-b border-sidebar-border px-3">
          <AccountSwitcher v-if="showAccountSwitcher" class="w-full" />
          <div v-else class="flex items-center gap-3 px-2">
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
          <!-- Help + Feedback -->
          <div class="flex items-center gap-1 px-2 pt-1">
            <router-link
              to="/help"
              class="flex items-center gap-1.5 px-2 py-1 text-xs text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-150 rounded-md"
            >
              <HelpCircle class="h-3 w-3" />
              Help
            </router-link>
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
      <!-- Mobile landing — only on home route for logged-out visitors -->
      <div
        v-if="!isLoggedIn && isMobileLanding"
        class="md:hidden flex flex-col items-center justify-center min-h-[80vh] px-6 text-center"
      >
        <div
          class="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl mb-6"
        >
          O
        </div>
        <h1 class="text-2xl font-bold tracking-tight mb-3">
          Know what your AI costs per customer
        </h1>
        <p class="text-muted-foreground text-sm leading-relaxed mb-8 max-w-sm">
          Track every LLM call. See cost, revenue, and margin by customer and
          feature. Install in 30 seconds.
        </p>
        <router-link
          to="/signup"
          class="w-full max-w-xs flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold transition-all hover:opacity-90"
        >
          Start Free
        </router-link>
        <router-link
          to="/login"
          class="mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Already have an account? Log in
        </router-link>
        <div class="mt-10 space-y-3 text-left w-full max-w-sm">
          <div class="flex items-start gap-3">
            <div
              class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5"
            >
              <Zap class="h-3 w-3 text-primary" />
            </div>
            <div>
              <p class="text-sm font-medium">30-second install</p>
              <p class="text-xs text-muted-foreground">
                Paste one prompt into your AI coding agent. No SDK.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-3">
            <div
              class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5"
            >
              <Eye class="h-3 w-3 text-primary" />
            </div>
            <div>
              <p class="text-sm font-medium">Cost per customer</p>
              <p class="text-xs text-muted-foreground">
                See which customers cost you money and which are profitable.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-3">
            <div
              class="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5"
            >
              <CreditCard class="h-3 w-3 text-primary" />
            </div>
            <div>
              <p class="text-sm font-medium">Stripe revenue matching</p>
              <p class="text-xs text-muted-foreground">
                Connect Stripe to see margins automatically. Optional.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Page content — always renders except when mobile landing is shown -->
      <div
        v-if="isLoggedIn || !isMobileLanding"
        :class="isLoggedIn ? 'p-6 pb-24 md:pb-6' : 'p-6 pb-6'"
      >
        <ErrorBoundary>
          <slot />
        </ErrorBoundary>
      </div>
    </main>

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
