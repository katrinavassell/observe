<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import {
  BarChart3,
  Plug,
  Activity,
  Cpu,
  Bell,
  Users,
  Settings,
  Eye,
  LogIn,
  LogOut,
  Database,
  CreditCard,
} from "lucide-vue-next";
import { toast } from "vue-sonner";
import ErrorBoundary from "@/components/shared/ErrorBoundary.vue";
import { useTeam } from "@/composables/useTeam";
import { useAuth } from "@/composables/useAuth";
import { useDataMode } from "@/composables/useDataMode";

const route = useRoute();
const { myRole, isViewer, fetchTeamInfo } = useTeam();
const { account, isLoggedIn, logout } = useAuth();
const { isSampleMode, clearSample, isClearingSample } = useDataMode();

async function handleClearSample() {
  try {
    await clearSample();
  } catch {
    toast.error("Failed to clear sample data");
  }
}

onMounted(() => {
  fetchTeamInfo();
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

function isActive(path: string) {
  if (path === "/") return route.path === "/";
  return route.path === path || route.path.startsWith(path + "/");
}
</script>

<template>
  <div class="flex min-h-screen">
    <!-- Sidebar -->
    <aside
      class="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-sidebar text-sidebar-foreground"
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
            to="/team"
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
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="ml-64 flex-1 min-h-screen overflow-x-hidden">
      <!-- Signup CTA is in the sidebar; no top banner needed -->
      <!-- Sample data banner -->
      <div
        v-if="isSampleMode"
        class="flex items-center justify-between px-4 py-2 bg-blue-50 text-blue-700 border-b border-blue-200 text-sm"
      >
        <div class="flex items-center gap-2">
          <Database class="h-4 w-4" />
          <span>Viewing sample data</span>
        </div>
        <div class="flex items-center gap-3">
          <router-link to="/data-sources" class="font-medium hover:underline"
            >Connect your data</router-link
          >
          <button
            class="text-blue-500 hover:text-blue-700 text-xs disabled:opacity-50"
            :disabled="isClearingSample"
            @click="handleClearSample"
          >
            {{ isClearingSample ? "Clearing..." : "Clear" }}
          </button>
        </div>
      </div>
      <div class="p-6">
        <ErrorBoundary>
          <slot />
        </ErrorBoundary>
      </div>
    </main>
  </div>
</template>
