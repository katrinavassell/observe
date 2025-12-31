<script setup lang="ts">
import { inject, computed } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  side?: 'top' | 'right' | 'bottom' | 'left'
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  side: 'top',
})

const tooltipContext = inject<{
  isOpen: { value: boolean }
}>('tooltipContext')

const isOpen = computed(() => tooltipContext?.isOpen.value ?? false)

const positionClasses = computed(() => {
  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }
  return positions[props.side]
})
</script>

<template>
  <div
    v-if="isOpen"
    role="tooltip"
    :class="cn(
      'absolute z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 max-w-sm',
      positionClasses,
      props.class
    )"
  >
    <slot />
  </div>
</template>
