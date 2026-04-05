<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  BarChart3,
  Plug,
  Activity,
  Cpu,
  Bell,
  Layers,
  Users,
  Settings,
  Eye,
  LogIn,
  LogOut,
  Database,
  CreditCard,
  Menu,
  X,
  Sparkles,
  MessageSquare,
} from "lucide-vue-next";
import { toast } from "vue-sonner";
import ErrorBoundary from "@/components/shared/ErrorBoundary.vue";
import FeedbackModal from "@/components/shared/FeedbackModal.vue";
import { useTeam } from "@/composables/useTeam";
import { useAuth } from "@/composables/useAuth";
import { useDataMode } from "@/composables/useDataMode";
import { getUsageLimits } from "@/lib/api";

const route = useRoute();
const { myRole, isViewer, fetchTeamInfo } = useTeam();
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

const { data: usageLimits } = useQuery({
  queryKey: ["usage-limits"],
  queryFn: getUsageLimits,
  staleTime: 60_000,
});

const aiCredits = computed(() => usageLimits.value?.ai_insights?.usage ?? null);

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
    path: "/",
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
    path: "/alerts",
    label: "Alerts",
    icon: Bell,
    description: "Cost spike and margin alerts",
  },
  {
    path: "/cohorts",
    label: "Cohorts",
    icon: Users,
    description: "Customer segments by profitability and behavior",
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
]);

const sidebarOpen = ref(false);

watch(
  () => route.path,
  () => {
    sidebarOpen.value = false;
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
          class="flex h-14 items-center gap-3 border-b border-sidebar-border px-4"
        >
          <div
            class="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm"
          >
            O
          </div>
          <span class="text-base font-semibold">Observe</span>
        </div>

        <!-- Sign in CTA for anonymous users -->
        <div v-if="!isLoggedIn" class="px-3 pt-3 pb-1">
          <router-link
            to="/signup"
            class="flex items-center justify-center gap-2 rounded-md bg-sidebar-primary text-sidebar-primary-foreground px-3 py-2 text-sm font-medium transition-colors hover:opacity-90"
          >
            <LogIn class="h-4 w-4 shrink-0" />
            Sign Up Free
          </router-link>
          <router-link
            to="/login"
            class="flex items-center justify-center gap-2 rounded-md px-3 py-1.5 mt-1 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
          >
            Already have an account? Sign in
          </router-link>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 overflow-y-auto px-3 py-3">
          <!-- Main section -->
          <div class="space-y-0.5">
            <template v-for="(item, idx) in navItems" :key="item.path">
              <!-- Section dividers -->
              <div
                v-if="item.dividerBefore"
                class="h-px bg-sidebar-border mx-2 my-2"
              />
              <router-link
                :to="item.path"
                :title="item.description"
                :class="[
                  'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
                  isActive(item.path)
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                ]"
              >
                <component :is="item.icon" class="h-4 w-4 shrink-0" />
                <span>{{ item.label }}</span>
                <span
                  v-if="item.path === '/alerts'"
                  class="ml-auto text-[10px] font-medium text-muted-foreground"
                  >Growth</span
                >
              </router-link>
            </template>
          </div>
        </nav>

        <!-- Bottom section: Account & Team Settings -->
        <div class="border-t p-4 space-y-1">
          <!-- Role badge for viewers -->
          <div
            v-if="isViewer"
            class="flex items-center gap-2 px-3 py-1.5 text-xs text-warning bg-warning/10 rounded-lg mb-1"
          >
            <Eye class="h-3 w-3 shrink-0" />
            <span>Viewer access</span>
          </div>
          <router-link
            :to="isLoggedIn ? '/team' : '/signup'"
            :class="[
              'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
              isActive('/team')
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            ]"
          >
            <Settings class="h-4 w-4 shrink-0" />
            <div class="min-w-0">
              <div class="text-sm font-medium">Team Settings</div>
              <div class="text-[10px] opacity-60">
                {{
                  myRole === "admin"
                    ? "Manage team & invites"
                    : "View team members"
                }}
              </div>
            </div>
          </router-link>

          <!-- Account section -->
          <div
            v-if="isLoggedIn && account"
            class="flex items-center justify-between rounded-lg px-3 py-2.5"
          >
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">
                {{ account.name || account.email }}
              </div>
              <div v-if="account.name" class="text-[10px] opacity-60 truncate">
                {{ account.email }}
              </div>
            </div>
            <button
              @click="logout"
              aria-label="Sign out"
              class="ml-2 p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title="Sign out"
            >
              <LogOut class="h-4 w-4" />
            </button>
          </div>
          <div v-else class="px-3 py-2.5 text-xs text-muted-foreground">
            Browsing as guest
          </div>
          <!-- Feedback & Discord -->
          <div class="flex items-center gap-1 px-2 pt-1">
            <button
              v-if="isLoggedIn"
              class="flex items-center gap-1.5 px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
              @click="feedbackOpen = true"
            >
              <MessageSquare class="h-3 w-3" />
              Feedback
            </button>
            <a
              href="https://discord.gg/zSVwxgvxCj"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-1.5 px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
            >
              Discord
            </a>
          </div>
          <!-- AI credits in sidebar -->
          <router-link
            v-if="aiCredits"
            to="/plans"
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            :title="`${aiCredits.remaining} of ${aiCredits.limit} AI credits remaining this month`"
          >
            <Sparkles class="h-3 w-3" />
            <span
              :class="
                aiCredits.remaining === 0 ? 'text-destructive font-medium' : ''
              "
            >
              {{ aiCredits.remaining }}/{{ aiCredits.limit }} AI credits
            </span>
          </router-link>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 min-h-screen overflow-x-hidden pt-14 md:pt-0 md:ml-64">
      <!-- Guest banner -->
      <div
        v-if="!isLoggedIn && isSampleMode"
        class="flex items-center justify-between px-4 py-2 bg-blue-50 text-blue-700 border-b border-blue-200 text-sm"
      >
        <div class="flex items-center gap-2">
          <Database class="h-4 w-4" />
          <span>Browsing as guest with sample data</span>
        </div>
        <router-link to="/signup" class="font-medium hover:underline">
          Sign up to connect your data
        </router-link>
      </div>
      <div class="p-6">
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
  </div>
</template>
