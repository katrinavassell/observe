<script setup lang="ts">
import { inject, ref, onMounted } from 'vue'

const tooltipContext = inject<{
  open: () => void
  close: () => void
  setTriggerRef: (el: HTMLElement | null) => void
}>('tooltipContext')

const triggerEl = ref<HTMLElement | null>(null)

onMounted(() => {
  tooltipContext?.setTriggerRef(triggerEl.value)
})
</script>

<template>
  <span
    ref="triggerEl"
    class="inline-flex"
    @mouseenter="tooltipContext?.open()"
    @mouseleave="tooltipContext?.close()"
    @focus="tooltipContext?.open()"
    @blur="tooltipContext?.close()"
  >
    <slot />
  </span>
</template>
