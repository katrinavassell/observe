<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  variant?: 'default' | 'info' | 'warning' | 'destructive'
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
})

const variantClasses = computed(() => ({
  default: 'bg-background text-foreground border-border',
  info: 'bg-primary/10 text-foreground border-primary/20',
  warning: 'bg-warning/10 text-warning-foreground border-warning/30',
  destructive: 'bg-destructive/10 text-destructive border-destructive/20',
}[props.variant]))
</script>

<template>
  <div
    :class="cn(
      'flex items-center gap-3 rounded-lg border px-4 py-3 text-sm',
      variantClasses
    )"
    role="alert"
  >
    <slot />
  </div>
</template>
