<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
} from "@/components/ui";
import { Check, Circle, X, Rocket } from "lucide-vue-next";
import { useDataMode } from "@/composables/useDataMode";

const router = useRouter();
const emit = defineEmits<{ (e: "dismiss"): void }>();

const { hasData, hasCosts, hasRevenue, isSampleMode } = useDataMode();

const insightsGenerated = computed(
  () => localStorage.getItem("observe:insights_generated") === "true",
);

const steps = computed(() => [
  {
    label: "Connect your data sources",
    done: hasData.value || hasCosts.value || hasRevenue.value,
    action: () => router.push("/data-sources"),
  },
  {
    label: "Send your first event through the proxy",
    done: hasData.value && !isSampleMode.value,
    action: () => router.push("/data-sources"),
  },
  {
    label: "Generate AI insights",
    done: insightsGenerated.value,
    action: () => window.scrollTo({ top: 0, behavior: "smooth" }),
  },
]);

const completedCount = computed(() => steps.value.filter((s) => s.done).length);
const allDone = computed(() => completedCount.value === steps.value.length);
</script>

<template>
  <Card v-if="!allDone" class="mb-6 border-primary/20 bg-primary/5">
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Rocket class="h-4 w-4 text-primary" />
          <CardTitle class="text-sm">
            Get started ({{ completedCount }}/{{ steps.length }})
          </CardTitle>
        </div>
        <button
          class="text-muted-foreground hover:text-foreground transition-colors"
          @click="emit('dismiss')"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
    </CardHeader>
    <CardContent class="pt-0">
      <ul class="space-y-2">
        <li
          v-for="(step, i) in steps"
          :key="i"
          class="flex items-center gap-3 text-sm"
        >
          <Check v-if="step.done" class="h-4 w-4 text-green-500 shrink-0" />
          <Circle v-else class="h-4 w-4 text-muted-foreground/40 shrink-0" />
          <span :class="step.done ? 'text-muted-foreground line-through' : ''">
            {{ step.label }}
          </span>
          <Button
            v-if="!step.done && step.action"
            variant="link"
            size="sm"
            class="ml-auto h-auto p-0 text-xs"
            @click="step.action"
          >
            Go
          </Button>
        </li>
      </ul>
    </CardContent>
  </Card>
</template>
