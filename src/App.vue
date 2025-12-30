<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { Toaster } from 'vue-sonner'
import AppLayout from '@/layouts/AppLayout.vue'

const route = useRoute()

// Skip layout for onboarding routes
const skipLayout = computed(() => route.meta.skipDataCheck === true)
</script>

<template>
  <!-- Toast notifications (global) -->
  <Toaster
    position="top-right"
    :toastOptions="{
      style: {
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        color: 'hsl(var(--card-foreground))',
      },
    }"
  />

  <!-- Conditional layout -->
  <template v-if="skipLayout">
    <RouterView />
  </template>
  <AppLayout v-else>
    <RouterView />
  </AppLayout>
</template>
