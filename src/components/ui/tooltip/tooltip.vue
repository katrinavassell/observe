<script setup lang="ts">
import { ref, provide } from 'vue'

const isOpen = ref(false)

provide('tooltipContext', {
  isOpen,
  open: () => { isOpen.value = true },
  close: () => { isOpen.value = false }
})
</script>

<template>
  <div class="relative inline-flex">
    <slot />
  </div>
</template>
