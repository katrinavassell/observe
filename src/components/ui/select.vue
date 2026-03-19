<script setup lang="ts">
defineProps<{
  modelValue?: string | number
  placeholder?: string
  disabled?: boolean
  class?: string
}>()

defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <select
    :value="modelValue"
    :disabled="disabled"
    :class="[
      'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm',
      'focus:outline-none focus:ring-1 focus:ring-ring',
      'disabled:cursor-not-allowed disabled:opacity-50',
      $props.class
    ]"
    @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
    <slot />
  </select>
</template>
