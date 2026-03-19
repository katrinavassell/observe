<script setup lang="ts">
import { computed } from 'vue'
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
  Sparkles,
} from 'lucide-vue-next'

const route = useRoute()

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
    path: '/insights',
    label: 'AI Insights',
    icon: Sparkles,
    description: 'AI-powered margin & pricing analysis',
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
                v-if="item.path === '/customers' || item.path === '/insights'"
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
      </div>
    </aside>

    <!-- Main Content -->
    <main class="ml-64 flex-1 min-h-screen">
      <div class="p-6">
        <slot />
      </div>
    </main>
  </div>
</template>
