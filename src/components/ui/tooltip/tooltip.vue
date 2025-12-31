<script setup lang="ts">
import { ref, provide } from 'vue'

const isOpen = ref(false)
const triggerRef = ref<HTMLElement | null>(null)

provide('tooltipContext', {
  isOpen,
  triggerRef,
  open: () => { isOpen.value = true },
  close: () => { isOpen.value = false },
  setTriggerRef: (el: HTMLElement | null) => { triggerRef.value = el }
})
</script>

<template>
  <div class="relative inline-flex">
    <slot />
  </div>
</template>
