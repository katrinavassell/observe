<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { Toaster } from 'vue-sonner'
import AppLayout from '@/layouts/AppLayout.vue'

const route = useRoute()

// Skip layout for auth pages (login, etc.)
const skipLayout = computed(() => route.meta.requiresAuth === false)
</script>

<template>
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
