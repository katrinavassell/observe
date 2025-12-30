<script setup lang="ts">
import { inject } from 'vue'

const tooltipContext = inject<{
  open: () => void
  close: () => void
}>('tooltipContext')
</script>

<template>
  <span
    class="inline-flex"
    @mouseenter="tooltipContext?.open()"
    @mouseleave="tooltipContext?.close()"
    @focus="tooltipContext?.open()"
    @blur="tooltipContext?.close()"
  >
    <slot />
  </span>
</template>
