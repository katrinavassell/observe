<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import {
  Check,
  Circle,
  X,
  Rocket,
  ChevronUp,
  MessageSquare,
  HelpCircle,
} from "lucide-vue-next";
import { useDataMode } from "@/composables/useDataMode";

const router = useRouter();
const emit = defineEmits<{ (e: "dismiss"): void }>();

const { hasData, hasCosts, hasRevenue, isSampleMode } = useDataMode();

const insightsGenerated = computed(
  () => window.localStorage.getItem("observe:insights_generated") === "true",
);

const steps = computed(() => [
  {
    label: "Connect your data sources",
    done:
      (hasData.value || hasCosts.value || hasRevenue.value) &&
      !isSampleMode.value,
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
    action: () => router.push("/insights"),
  },
]);

const completedCount = computed(() => steps.value.filter((s) => s.done).length);
const allDone = computed(() => completedCount.value === steps.value.length);
const expanded = ref(false);
</script>

<template>
  <div v-if="!allDone" class="fixed bottom-24 right-6 z-50">
    <!-- Expanded panel -->
    <div
      v-if="expanded"
      class="mb-2 w-72 rounded-lg border bg-background shadow-lg"
    >
      <div class="flex items-center justify-between px-4 py-3 border-b">
        <div class="flex items-center gap-2">
          <Rocket class="h-3.5 w-3.5 text-primary" />
          <span class="text-sm font-medium"
            >Get started ({{ completedCount }}/{{ steps.length }})</span
          >
        </div>
        <button
          class="text-muted-foreground hover:text-foreground transition-colors"
          @click="
            () => {
              emit('dismiss');
              window.posthog?.capture('onboarding_dismissed');
            }
          "
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
      <ul class="px-4 py-3 space-y-2">
        <li
          v-for="(step, i) in steps"
          :key="i"
          class="flex items-center gap-2.5 text-xs"
        >
          <Check v-if="step.done" class="h-3.5 w-3.5 text-green-500 shrink-0" />
          <Circle
            v-else
            class="h-3.5 w-3.5 text-muted-foreground/40 shrink-0"
          />
          <span
            class="flex-1"
            :class="step.done ? 'text-muted-foreground line-through' : ''"
            >{{ step.label }}</span
          >
          <button
            v-if="!step.done && step.action"
            class="text-primary text-[11px] font-medium hover:underline shrink-0"
            @click="step.action()"
          >
            Go
          </button>
        </li>
      </ul>
      <div class="border-t px-4 py-2.5 flex items-center gap-3">
        <a
          href="mailto:kat@tansohq.com"
          class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageSquare class="h-3 w-3" />
          Feedback
        </a>
        <a
          href="https://discord.gg/6GHcsaQTy7"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <HelpCircle class="h-3 w-3" />
          Help
        </a>
      </div>
    </div>

    <!-- Pill button -->
    <button
      class="flex items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-md hover:shadow-lg transition-all text-sm font-medium"
      @click="expanded = !expanded"
    >
      <Rocket class="h-3.5 w-3.5 text-primary" />
      <span>{{ completedCount }}/{{ steps.length }}</span>
      <ChevronUp
        class="h-3 w-3 text-muted-foreground transition-transform"
        :class="expanded ? '' : 'rotate-180'"
      />
    </button>
  </div>
</template>
