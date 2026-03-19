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
  X,
  Settings,
  Eye,
} from 'lucide-vue-next'
import { useDemoMode } from '@/composables/useDemoMode'
import { useTeam } from '@/composables/useTeam'

const route = useRoute()
const { isDemoMode, exitDemoMode, isLoadingDemo } = useDemoMode()
const { myRole, isViewer, fetchTeamInfo } = useTeam()

onMounted(() => {
  fetchTeamInfo()
})

const navItems = computed(() => [
  {
    path: '/',
    label: 'Pricing',
    icon: DollarSign,
    description: 'Margin analysis & plan health',
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
  },
  {
    path: '/simulations',
    label: 'Simulations',
    icon: FlaskConical,
    description: 'What-if pricing scenarios',
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
    <aside class="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-card">
      <div class="flex h-full flex-col">
        <!-- Logo -->
        <div class="flex h-16 items-center gap-3 border-b px-6">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LayoutDashboard class="h-4 w-4" />
          </div>
          <span class="text-lg font-semibold tracking-tight">Tanso</span>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 space-y-1 overflow-y-auto p-4">
          <router-link
            v-for="item in navItems"
            :key="item.path"
            :to="item.path"
            :title="item.description"
            :class="[
              'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors group',
              isActive(item.path)
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            ]"
          >
            <component :is="item.icon" class="h-4 w-4 shrink-0" />
            <div class="min-w-0">
              <div class="text-sm font-medium">{{ item.label }}</div>
              <div class="text-[10px] opacity-60 truncate">{{ item.description }}</div>
            </div>
          </router-link>
        </nav>

        <!-- Bottom section: Team Settings -->
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
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="ml-64 flex-1">
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

      <div class="container py-8">
        <slot />
      </div>
    </main>
  </div>
</template>
