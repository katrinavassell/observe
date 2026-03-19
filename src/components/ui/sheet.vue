<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  open?: boolean
  side?: 'left' | 'right' | 'top' | 'bottom'
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const isOpen = ref(props.open ?? false)

watch(() => props.open, (val) => { if (val !== undefined) isOpen.value = val })

function close() {
  isOpen.value = false
  emit('update:open', false)
}
</script>

<template>
  <teleport to="body">
    <transition name="sheet-fade">
      <div v-if="isOpen" class="fixed inset-0 z-50 flex">
        <!-- Backdrop -->
        <div class="fixed inset-0 bg-black/50" @click="close" />

        <!-- Panel -->
        <div
          :class="[
            'relative z-50 bg-background shadow-xl overflow-y-auto',
            side === 'left' ? 'w-80 h-full' :
            side === 'top' ? 'w-full h-auto' :
            side === 'bottom' ? 'w-full h-auto mt-auto' :
            'w-80 h-full ml-auto',
          ]"
        >
          <slot :close="close" />
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.sheet-fade-enter-active,
.sheet-fade-leave-active {
  transition: opacity 0.2s ease;
}
.sheet-fade-enter-from,
.sheet-fade-leave-to {
  opacity: 0;
}
</style>
