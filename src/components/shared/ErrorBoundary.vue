<script setup lang="ts">
import { ref, onErrorCaptured } from "vue";

const props = withDefaults(
  defineProps<{
    fallbackMessage?: string;
  }>(),
  {
    fallbackMessage: "Something went wrong loading this section.",
  },
);

const error = ref<Error | null>(null);

onErrorCaptured((err) => {
  error.value = err instanceof Error ? err : new Error(String(err));
  console.error("ErrorBoundary caught:", err);
  return false;
});

function retry() {
  error.value = null;
}
</script>

<template>
  <div
    v-if="error"
    class="rounded-lg border border-red-200 bg-red-50 p-6 text-center"
  >
    <p class="text-sm font-medium text-red-800">{{ props.fallbackMessage }}</p>
    <button
      class="mt-3 text-xs text-red-600 underline hover:text-red-800"
      @click="retry"
    >
      Try again
    </button>
  </div>
  <slot v-else />
</template>
