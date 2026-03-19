<template>
  <span class="inline-flex items-center gap-0.5 text-sm" :class="trendClass">
    <TrendingUp v-if="direction === 'up'" class="h-3.5 w-3.5" />
    <TrendingDown v-else-if="direction === 'down'" class="h-3.5 w-3.5" />
    <Minus v-else class="h-3.5 w-3.5" />
    <span v-if="value !== undefined">
      {{ direction === 'up' ? '+' : direction === 'down' ? '-' : '' }}{{ Math.abs(value) }}{{ suffix }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TrendingUp, TrendingDown, Minus } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    direction: 'up' | 'down' | 'stable'
    value?: number
    suffix?: string
    invertColors?: boolean
  }>(),
  {
    suffix: '%',
    invertColors: false,
  }
)

const trendClass = computed(() => {
  const isPositive = props.direction === 'up'
  const isNegative = props.direction === 'down'
  if (props.invertColors) {
    if (isPositive) return 'text-red-600'
    if (isNegative) return 'text-green-600'
  } else {
    if (isPositive) return 'text-green-600'
    if (isNegative) return 'text-red-600'
  }
  return 'text-gray-500'
})
</script>
