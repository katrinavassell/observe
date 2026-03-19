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
      </div>
    </aside>

    <!-- Main Content -->
    <main class="ml-64 flex-1">
      <div class="container py-8">
        <slot />
      </div>
    </main>
  </div>
</template>
