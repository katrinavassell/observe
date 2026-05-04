<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { getUsageLimits, getEntitlements } from "@/lib/api";
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
} from "lucide-vue-next";
import { OrganizationSwitcher, OrganizationProfile } from "@clerk/vue";
import ErrorBoundary from "@/components/shared/ErrorBoundary.vue";
import FeedbackModal from "@/components/shared/FeedbackModal.vue";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

import { useAuth } from "@/composables/useAuth";
import { useDataMode } from "@/composables/useDataMode";

const route = useRoute();
const { account, isLoggedIn, logout } = useAuth();
const { reset: resetDataMode } = useDataMode();

const isMobileLanding = computed(
  () => route.path === "/" || route.path === "/analytics",
);

// Reset data status when auth state changes (signup clears sample data)
watch(isLoggedIn, (loggedIn) => {
  if (loggedIn) {
    resetDataMode();
  }
});

const { data: entitlements } = useQuery({
  queryKey: ["entitlements"],
  queryFn: getEntitlements,
  enabled: isLoggedIn,
});
const canCreateOrg = computed(
  () => entitlements.value?.organizations?.allowed !== false,
);

const feedbackOpen = ref(false);
const mobileLandingEmail = ref("");

onMounted(() => {
  window.addEventListener("observe:open-feedback", () => {
    feedbackOpen.value = true;
  });
});

const navItems = computed(() => [
  {
    path: "/analytics",
    label: "Overview",
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
    description: "Customer health, profitability, and usage trends",
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
    label: "Plans & Usage",
    icon: CreditCard,
    description: "View limits and usage",
    dividerBefore: true,
  },
]);

const orgProfileOpen = ref(false);

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

const _usageMeters = computed(() => {
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
        T
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
          : '-translate-x-full max-md:hidden',
      ]"
    >
      <div class="flex h-full flex-col">
        <!-- Header: Logo + Org Switcher -->
        <div class="flex h-16 items-center border-b border-sidebar-border px-3">
          <div class="flex items-center gap-3 px-2 flex-1 min-w-0">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm shrink-0"
            >
              T
            </div>
            <div class="flex flex-col min-w-0">
              <span class="text-base font-semibold leading-tight">Observe</span>
              <span class="text-[10px] text-sidebar-foreground/40 leading-tight"
                >By Tanso</span
              >
            </div>
          </div>
          <div v-if="isLoggedIn" class="shrink-0 org-switcher-minimal">
            <OrganizationSwitcher
              :hide-personal="true"
              :appearance="{
                elements: {
                  organizationSwitcherTrigger:
                    'p-1.5 hover:bg-muted rounded-md',
                  organizationSwitcherTriggerIcon:
                    'h-4 w-4 text-muted-foreground',
                  ...(canCreateOrg
                    ? {}
                    : {
                        organizationSwitcherPopoverActionButton__createOrganization:
                          'cl-hidden',
                      }),
                },
              }"
            />
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
            <button
              v-if="isLoggedIn"
              class="group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-all duration-150 w-full text-left"
              @click="orgProfileOpen = true"
            >
              <Users
                class="h-4 w-4 shrink-0 text-sidebar-foreground/40 group-hover:text-sidebar-foreground/70 transition-colors duration-150"
              />
              <span>Team</span>
            </button>
          </div>
        </nav>

        <!-- Org Profile Modal -->
        <Teleport to="body">
          <div
            v-if="orgProfileOpen"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            @click.self="orgProfileOpen = false"
          >
            <div class="relative">
              <OrganizationProfile />
            </div>
          </div>
        </Teleport>

        <!-- Bottom section: Account & Team Settings -->
        <div class="border-t border-sidebar-border px-3 py-4 space-y-1">
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
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  @click="logout"
                  aria-label="Sign out"
                  class="ml-2 p-1.5 rounded-md text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all duration-150"
                >
                  <LogOut class="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Sign out</TooltipContent>
            </Tooltip>
          </div>
          <!-- Help + Feedback -->
          <div class="flex items-center gap-1 px-2 pt-1">
            <router-link
              to="/help"
              class="flex items-center gap-1.5 px-2 py-1 text-xs text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-150 rounded-md"
            >
              <HelpCircle class="h-3 w-3" />
              FAQ
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
        class="md:hidden px-6 pt-8 pb-20"
      >
        <h1 class="text-3xl font-bold tracking-tight leading-tight mb-3">
          Know the true cost of every feature you ship
        </h1>
        <p class="text-muted-foreground text-sm leading-relaxed mb-6">
          Track AI costs per customer. See margins in real time. Install in 30
          seconds.
        </p>

        <!-- Email capture -->
        <form
          class="mb-4"
          @submit.prevent="
            $router.push({
              path: '/signup',
              query: { email: mobileLandingEmail },
            })
          "
        >
          <input
            v-model="mobileLandingEmail"
            type="email"
            placeholder="you@company.com"
            required
            class="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary mb-3"
          />
          <button
            type="submit"
            class="w-full rounded-lg bg-primary text-primary-foreground px-6 py-3.5 text-sm font-semibold transition-all hover:opacity-90"
          >
            Start Free
          </button>
        </form>
        <router-link
          to="/login"
          class="w-full flex items-center justify-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1 mb-8"
        >
          Already have an account? Log in
        </router-link>

        <!-- Social proof -->
        <p class="text-xs text-muted-foreground mb-6">
          Free tier includes 10,000 events/month. No credit card required.
        </p>

        <!-- Features -->
        <div class="space-y-5 border-t pt-6">
          <div class="flex items-start gap-3">
            <div
              class="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0"
            >
              <CreditCard class="h-4 w-4" />
            </div>
            <div>
              <p class="text-sm font-semibold">Margin and pricing analysis</p>
              <p class="text-xs text-muted-foreground leading-relaxed">
                See exactly how much each plan, feature, and customer costs you
                — and where you're leaving money on the table.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-3">
            <div
              class="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0"
            >
              <Eye class="h-4 w-4" />
            </div>
            <div>
              <p class="text-sm font-semibold">Revenue and cost analytics</p>
              <p class="text-xs text-muted-foreground leading-relaxed">
                Track revenue, AI model costs, and unit economics across your
                entire product in one view.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-3">
            <div
              class="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0"
            >
              <CreditCard class="h-4 w-4" />
            </div>
            <div>
              <p class="text-sm font-semibold">Feature-level cost tracking</p>
              <p class="text-xs text-muted-foreground leading-relaxed">
                Break down costs per feature so you know which capabilities to
                invest in — and which to rethink.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Page content -->
      <div
        :class="[
          isLoggedIn ? 'p-6 pb-24 md:pb-6' : 'p-6 pb-6',
          !isLoggedIn && isMobileLanding ? 'hidden md:block' : '',
        ]"
      >
        <ErrorBoundary>
          <slot />
        </ErrorBoundary>
      </div>
    </main>

    <FeedbackModal :open="feedbackOpen" @close="feedbackOpen = false" />
  </div>
</template>

<style>
.org-switcher-minimal .cl-organizationPreview {
  display: none !important;
}
.org-switcher-minimal .cl-organizationSwitcherTrigger__organizationPreview {
  display: none !important;
}
.org-switcher-minimal .cl-userPreview {
  display: none !important;
}
.org-switcher-minimal .cl-organizationPreviewAvatarBox {
  display: none !important;
}
.org-switcher-minimal .cl-organizationPreviewTextContainer {
  display: none !important;
}
.cl-hidden {
  display: none !important;
}
</style>
