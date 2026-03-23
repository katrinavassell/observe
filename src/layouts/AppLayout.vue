<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import {
  LayoutDashboard,
  DollarSign,
  BarChart3,
  Plug,
  FlaskConical,
  Activity,
  Layers,
  Cpu,
  Users,
  Gift,
  CreditCard,
  X,
  Settings,
  Eye,
  LogIn,
  LogOut,
  Sparkles,
} from 'lucide-vue-next'
import ErrorBoundary from '@/components/shared/ErrorBoundary.vue'
import { useDemoMode } from '@/composables/useDemoMode'
import { useTeam } from '@/composables/useTeam'
import { useAuth } from '@/composables/useAuth'

const route = useRoute()
const { isDemoMode, exitDemoMode, isLoadingDemo } = useDemoMode()
const { myRole, isViewer, fetchTeamInfo } = useTeam()
const { account, isLoggedIn, logout } = useAuth()

onMounted(() => {
  fetchTeamInfo()
})

const navItems = computed(() => [
  {
    path: '/',
    label: 'Overview',
    icon: DollarSign,
    description: 'Pricing analyzer & margin health',
  },
  {
    path: '/analytics',
    label: 'Analytics',
    icon: BarChart3,
    description: 'Revenue, costs & margin overview',
  },
  {
    path: '/events',
    label: 'Events',
    icon: Activity,
    description: 'Observed feature usage events',
  },
  {
    path: '/features',
    label: 'Features',
    icon: Layers,
    description: 'Feature-level cost & margin',
  },
  {
    path: '/models',
    label: 'Models',
    icon: Cpu,
    description: 'AI model cost breakdown',
  },
  {
    path: '/customers',
    label: 'Customers',
    icon: Users,
    description: 'Customer profiles & usage',
    dividerBefore: true,
  },
  {
    path: '/simulations',
    label: 'Simulations',
    icon: FlaskConical,
    description: 'What-if pricing scenarios',
  },
  {
    path: '/insights',
    label: 'Insights',
    icon: Sparkles,
    description: 'AI-powered analysis of your data',
  },
  {
    path: '/data-sources',
    label: 'Data Sources',
    icon: Plug,
    description: 'Connect integrations or upload files',
  },
])

function isActive(path: string) {
  if (path === '/') return route.path === '/'
  return route.path === path || route.path.startsWith(path + '/')
}
</script>

<template>
  <div class="flex min-h-screen">
    <!-- Sidebar -->
    <aside class="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-sidebar text-sidebar-foreground">
      <div class="flex h-full flex-col">
        <!-- Logo -->
        <div class="flex h-14 items-center gap-3 border-b border-sidebar-border px-4">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm">
            T
          </div>
          <span class="text-base font-semibold">Tanso</span>
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
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
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
          <div v-if="isViewer" class="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg mb-1">
            <Eye class="h-3 w-3 shrink-0" />
            <span>Viewer access</span>
          </div>
          <router-link
            to="/team"
            :class="[
              'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
              isActive('/team')
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            ]"
          >
            <Settings class="h-4 w-4 shrink-0" />
            <div class="min-w-0">
              <div class="text-sm font-medium">Team Settings</div>
              <div class="text-[10px] opacity-60">{{ myRole === 'admin' ? 'Manage team & invites' : 'View team members' }}</div>
            </div>
          </router-link>

          <!-- Account section -->
          <div v-if="isLoggedIn && account" class="flex items-center justify-between rounded-lg px-3 py-2.5">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">{{ account.name || account.email }}</div>
              <div v-if="account.name" class="text-[10px] opacity-60 truncate">{{ account.email }}</div>
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
          <router-link
            v-else
            to="/login"
            :class="[
              'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
              isActive('/login')
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            ]"
          >
            <LogIn class="h-4 w-4 shrink-0" />
            <div class="min-w-0">
              <div class="text-sm font-medium">Sign In</div>
              <div class="text-[10px] opacity-60">Create an account or log in</div>
            </div>
          </router-link>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="ml-64 flex-1 min-h-screen">
      <!-- Demo Mode Banner -->
      <div
        v-if="isDemoMode"
        class="sticky top-0 z-30 flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-amber-950"
      >
        <div class="flex items-center gap-2 text-sm font-medium">
          <FlaskConical class="h-4 w-4 shrink-0" />
          You're viewing demo data — changes are not saved
        </div>
        <button
          class="flex items-center gap-1.5 rounded-md bg-amber-600/30 px-3 py-1 text-xs font-semibold hover:bg-amber-600/50 transition-colors disabled:opacity-50"
          :disabled="isLoadingDemo"
          @click="exitDemoMode"
        >
          <X class="h-3 w-3" />
          Exit Demo
        </button>
      </div>

      <div class="p-6">
        <ErrorBoundary>
          <slot />
        </ErrorBoundary>
      </div>
    </main>
  </div>
</template>
