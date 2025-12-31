<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { Toaster } from 'vue-sonner'
import { WifiOff } from 'lucide-vue-next'
import AppLayout from '@/layouts/AppLayout.vue'
import { useOnline } from '@/composables/useOnline'

const route = useRoute()
const { isOnline } = useOnline()

// Skip layout for auth pages (login, etc.)
const skipLayout = computed(() => route.meta.requiresAuth === false)
</script>

<template>
  <!-- Offline Banner -->
  <div
    v-if="!isOnline"
    class="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-amber-950 px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2"
  >
    <WifiOff class="h-4 w-4" />
    You're offline. Some features may not work until you reconnect.
  </div>

  <!-- Toast notifications (global) -->
  <Toaster
    position="top-center"
    richColors
  />

  <!-- Conditional layout -->
  <template v-if="skipLayout">
    <RouterView />
  </template>
  <AppLayout v-else>
    <RouterView />
  </AppLayout>
</template>
