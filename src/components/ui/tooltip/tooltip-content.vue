<script setup lang="ts">
import { inject, computed, ref, watch, nextTick } from 'vue'
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
  triggerRef: { value: HTMLElement | null }
}>('tooltipContext')

const isOpen = computed(() => tooltipContext?.isOpen.value ?? false)
const tooltipRef = ref<HTMLElement | null>(null)
const position = ref({ top: 0, left: 0 })

watch(isOpen, async (open) => {
  if (open) {
    await nextTick()
    calculatePosition()
  }
})

function calculatePosition() {
  const trigger = tooltipContext?.triggerRef?.value
  const tooltip = tooltipRef.value
  if (!trigger || !tooltip) return

  const triggerRect = trigger.getBoundingClientRect()
  const tooltipRect = tooltip.getBoundingClientRect()
  const padding = 8

  let top = 0
  let left = 0

  // Default: position above (top)
  if (props.side === 'top' || props.side === 'bottom') {
    left = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2)
    top = props.side === 'top'
      ? triggerRect.top - tooltipRect.height - padding
      : triggerRect.bottom + padding
  } else {
    top = triggerRect.top + (triggerRect.height / 2) - (tooltipRect.height / 2)
    left = props.side === 'left'
      ? triggerRect.left - tooltipRect.width - padding
      : triggerRect.right + padding
  }

  // Clamp to viewport bounds
  const maxLeft = window.innerWidth - tooltipRect.width - padding
  const maxTop = window.innerHeight - tooltipRect.height - padding

  left = Math.max(padding, Math.min(left, maxLeft))
  top = Math.max(padding, Math.min(top, maxTop))

  position.value = { top, left }
}
</script>

<template>
  <div
    v-if="isOpen"
    ref="tooltipRef"
    role="tooltip"
    :class="cn(
      'fixed z-[100] rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 max-w-sm',
      props.class
    )"
    :style="{ top: position.top + 'px', left: position.left + 'px' }"
  >
    <slot />
  </div>
</template>
