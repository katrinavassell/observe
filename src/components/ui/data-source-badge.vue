<script setup lang="ts">
import { computed } from 'vue'
import { Database, Upload, ChevronDown } from 'lucide-vue-next'
import type { DataMode } from '@/composables/useDataMode'

interface Props {
  mode: DataMode
  showChevron?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showChevron: true,
})

const emit = defineEmits<{
  click: []
}>()

const config = computed(() => ({
  sample: {
    label: 'Sample Data',
    icon: Database,
    bgClass: 'bg-blue-100 dark:bg-blue-900/30',
    textClass: 'text-blue-700 dark:text-blue-300',
    iconClass: 'text-blue-600 dark:text-blue-400',
  },
  user: {
    label: 'Your Data',
    icon: Upload,
    bgClass: 'bg-green-100 dark:bg-green-900/30',
    textClass: 'text-green-700 dark:text-green-300',
    iconClass: 'text-green-600 dark:text-green-400',
  },
  none: {
    label: 'No Data',
    icon: Database,
    bgClass: 'bg-muted',
    textClass: 'text-muted-foreground',
    iconClass: 'text-muted-foreground',
  },
}[props.mode]))
</script>

<template>
  <button
    type="button"
    :class="[
      'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
      'hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
      config.bgClass,
      config.textClass,
    ]"
    @click="emit('click')"
  >
    <component :is="config.icon" :class="['h-4 w-4', config.iconClass]" />
    <span>{{ config.label }}</span>
    <ChevronDown v-if="showChevron" class="h-3 w-3 opacity-60" />
  </button>
</template>
