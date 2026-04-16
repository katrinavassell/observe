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
    class="rounded-lg border border-red-200 bg-red-50 p-6 text-left space-y-2"
  >
    <p class="text-sm font-medium text-red-800 text-center">
      {{ props.fallbackMessage }}
    </p>
    <pre
      class="text-[11px] text-red-700 bg-red-100/60 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap break-words"
      >{{ error.message
      }}{{
        error.stack
          ? "\n\n" + error.stack.split("\n").slice(0, 5).join("\n")
          : ""
      }}</pre
    >
    <div class="text-center">
      <button
        class="mt-1 text-xs text-red-600 underline hover:text-red-800"
        @click="retry"
      >
        Try again
      </button>
    </div>
  </div>
  <slot v-else />
</template>
