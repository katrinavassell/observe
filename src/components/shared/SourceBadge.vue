<script setup lang="ts">
defineProps<{
  source: string;
  isInferred?: boolean;
}>();

const config: Record<string, { label: string; classes: string }> = {
  proxy: { label: "Proxy", classes: "bg-sky-100 text-sky-700 border-sky-200" },
  sdk: {
    label: "SDK",
    classes: "bg-green-100 text-green-700 border-green-200",
  },
  csv: {
    label: "CSV Import",
    classes: "bg-gray-100 text-gray-700 border-gray-200",
  },
  stripe: {
    label: "Stripe",
    classes: "bg-purple-100 text-purple-700 border-purple-200",
  },
  openai: {
    label: "OpenAI",
    classes: "bg-emerald-100 text-emerald-700 border-emerald-200",
  },
  anthropic: {
    label: "Anthropic",
    classes: "bg-orange-100 text-orange-700 border-orange-200",
  },
  internal: {
    label: "System",
    classes: "bg-zinc-100 text-zinc-600 border-zinc-200",
  },
  sample: {
    label: "Sample",
    classes: "bg-blue-100 text-blue-700 border-blue-200",
  },
};

function badgeConfig(source: string) {
  return (
    config[source] ?? {
      label: source,
      classes: "bg-muted text-muted-foreground border-border",
    }
  );
}
</script>

<template>
  <span
    v-if="isInferred"
    class="inline-flex items-center rounded-full border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
  >
    Inferred
  </span>
  <span
    v-else
    :class="[
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
      badgeConfig(source).classes,
    ]"
  >
    {{ badgeConfig(source).label }}
  </span>
</template>
