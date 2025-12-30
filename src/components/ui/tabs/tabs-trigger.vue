<script setup lang="ts">
import { inject, computed } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  disabled?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
})

const tabsContext = inject<{
  currentValue: { value: string }
  setCurrentValue: (val: string) => void
}>('tabsContext')

const isActive = computed(() => tabsContext?.currentValue.value === props.value)

function handleClick() {
  if (!props.disabled && tabsContext) {
    tabsContext.setCurrentValue(props.value)
  }
}
</script>

<template>
  <button
    type="button"
    role="tab"
    :aria-selected="isActive"
    :disabled="disabled"
    :class="cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
      isActive
        ? 'bg-background text-foreground shadow-sm'
        : 'hover:bg-background/50 hover:text-foreground',
      props.class
    )"
    @click="handleClick"
  >
    <slot />
  </button>
</template>
