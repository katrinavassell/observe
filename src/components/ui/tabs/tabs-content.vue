<script setup lang="ts">
import { inject, computed } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  class?: string
}

const props = defineProps<Props>()

const tabsContext = inject<{
  currentValue: { value: string }
}>('tabsContext')

const isActive = computed(() => tabsContext?.currentValue.value === props.value)
</script>

<template>
  <div
    v-if="isActive"
    role="tabpanel"
    :class="cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      props.class
    )"
  >
    <slot />
  </div>
</template>
