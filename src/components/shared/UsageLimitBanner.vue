<script setup lang="ts">
import { ArrowUpRight, AlertTriangle, Zap } from "lucide-vue-next";

defineProps<{
  featureLabel: string;
  allowed: boolean;
  usage: number;
  limit: number;
  usagePercent: number;
  barColor: string;
  hasLimit: boolean;
}>();
</script>

<template>
  <div
    v-if="hasLimit"
    class="rounded-lg border px-4 py-3"
    :class="
      !allowed
        ? 'border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800'
        : usagePercent >= 70
          ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800'
          : 'border-border bg-card'
    "
  >
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2 text-sm">
        <AlertTriangle v-if="!allowed" class="h-4 w-4 text-red-500 shrink-0" />
        <Zap
          v-else-if="usagePercent >= 70"
          class="h-4 w-4 text-amber-500 shrink-0"
        />
        <span
          class="font-medium"
          :class="
            !allowed
              ? 'text-red-700 dark:text-red-400'
              : usagePercent >= 70
                ? 'text-amber-700 dark:text-amber-400'
                : ''
          "
        >
          {{ featureLabel }}
        </span>
      </div>
      <div
        class="text-xs tabular-nums"
        :class="
          !allowed ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
        "
      >
        {{ usage }} / {{ limit }} used
      </div>
    </div>
    <div class="h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        class="h-full rounded-full transition-all"
        :class="barColor"
        :style="{ width: usagePercent + '%' }"
      />
    </div>
    <div v-if="!allowed" class="mt-2 flex items-center justify-between">
      <span class="text-xs text-red-600 dark:text-red-400"
        >Limit reached — upgrade to continue</span
      >
      <router-link
        to="/plans"
        class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        Upgrade <ArrowUpRight class="h-3 w-3" />
      </router-link>
    </div>
    <div
      v-else-if="usagePercent >= 70"
      class="mt-2 flex items-center justify-between"
    >
      <span class="text-xs text-amber-600 dark:text-amber-400"
        >Approaching limit</span
      >
      <router-link
        to="/plans"
        class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        View plans <ArrowUpRight class="h-3 w-3" />
      </router-link>
    </div>
  </div>
</template>
