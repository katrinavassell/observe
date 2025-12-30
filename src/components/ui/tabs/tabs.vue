<script setup lang="ts">
import { provide, ref, computed } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  defaultValue?: string
  modelValue?: string
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  defaultValue: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const internalValue = ref(props.defaultValue)

const currentValue = computed({
  get: () => props.modelValue ?? internalValue.value,
  set: (val) => {
    internalValue.value = val
    emit('update:modelValue', val)
  }
})

provide('tabsContext', {
  currentValue,
  setCurrentValue: (val: string) => {
    currentValue.value = val
  }
})
</script>

<template>
  <div :class="cn('w-full', props.class)">
    <slot />
  </div>
</template>
