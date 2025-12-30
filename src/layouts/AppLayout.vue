<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LayoutDashboard, Users, Link2, DollarSign, FolderOpen, Upload, Database, Plug } from 'lucide-vue-next'
import { useDataMode } from '@/composables/useDataMode'
import { useAppMode } from '@/composables/useAppMode'
import DataSourceBadge from '@/components/ui/data-source-badge.vue'
import Alert from '@/components/ui/alert.vue'

const route = useRoute()
const router = useRouter()
const { dataMode, isSampleMode, clearSample, isClearingSample } = useDataMode()
const { labels } = useAppMode()

const navItems = computed(() => [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, description: 'Overview of your key metrics' },
  {
    path: '/accounts',
    label: labels.value.accounts,
    icon: Users,
    description: 'All your customers in one place'
  },
  // Hidden for P0 scope - account matching is P1
  // {
  //   path: '/matches',
  //   label: 'Matches',
  //   icon: Link2,
  //   description: 'Review duplicate account suggestions'
  // },
  {
    path: '/pricing',
    label: 'Pricing',
    icon: DollarSign,
    description: 'Analyze your pricing model'
  },
  { path: '/projects', label: 'Projects', icon: FolderOpen, description: 'Manage data uploads' },
  { path: '/data-sources', label: 'Data Sources', icon: Plug, description: 'Connect integrations or upload files' },
])

const isActive = (path: string) => route.path === path

async function handleClearAndUpload() {
  await clearSample()
  router.push('/onboarding/upload')
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

        <!-- Data Source Badge -->
        <div class="px-4 py-3 border-b">
          <DataSourceBadge :mode="dataMode" :show-chevron="false" />
        </div>

        <!-- Navigation -->
        <nav class="flex-1 space-y-1 p-4">
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

        <!-- Footer -->
        <div class="border-t p-4">
          <p class="text-xs text-muted-foreground">v1.0.0</p>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="ml-64 flex-1">
      <!-- Sample Data Banner -->
      <Alert
        v-if="isSampleMode"
        variant="info"
        class="mx-6 mt-4 flex items-center justify-between"
      >
        <div class="flex items-center gap-3">
          <Database class="h-4 w-4 shrink-0" />
          <span>You're viewing <strong>sample data</strong>. This is demo data for exploration.</span>
        </div>
        <button
          class="flex items-center gap-1 text-sm font-medium underline underline-offset-2 hover:no-underline shrink-0"
          :disabled="isClearingSample"
          @click="handleClearAndUpload"
        >
          <Upload class="h-3 w-3" />
          Upload your data
        </button>
      </Alert>

      <div class="container py-8">
        <slot />
      </div>
    </main>
  </div>
</template>
