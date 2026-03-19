<script setup lang="ts">
import { RouterView } from 'vue-router'
import { Toaster } from 'vue-sonner'
import { WifiOff } from 'lucide-vue-next'
import AppLayout from '@/layouts/AppLayout.vue'
import { useOnline } from '@/composables/useOnline'
import { useAuth } from '@/composables/useAuth'

const { isOnline } = useOnline()
const { isLoading } = useAuth()
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

  <!-- Loading state while session initializes -->
  <div v-if="isLoading" class="flex items-center justify-center min-h-screen">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
  </div>

  <!-- Main app -->
  <AppLayout v-else>
    <RouterView />
  </AppLayout>
</template>
