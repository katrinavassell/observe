<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  TrendingUp,
  Info,
} from "lucide-vue-next";
import { useAuth } from "@/composables/useAuth";
import { Button } from "@/components/ui";
import { listInsights, generateInsights } from "@/lib/api";
import { useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { ref } from "vue";

const { isLoggedIn } = useAuth();
const queryClient = useQueryClient();

const { data: insights, isLoading } = useQuery({
  queryKey: ["insights"],
  queryFn: listInsights,
  enabled: isLoggedIn,
});

const sortedInsights = computed(() =>
  [...(insights.value ?? [])].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  ),
);

const isGenerating = ref(false);
async function runGenerate() {
  if (isGenerating.value) return;
  isGenerating.value = true;
  try {
    await generateInsights();
    await queryClient.invalidateQueries({ queryKey: ["insights"] });
    toast.success("New insights generated");
  } catch (err: unknown) {
    toast.error(err instanceof Error ? err.message : "Failed to generate");
  } finally {
    isGenerating.value = false;
  }
}

function severityIcon(sev: string) {
  if (sev === "high" || sev === "critical") return AlertTriangle;
  if (sev === "medium") return TrendingUp;
  return Info;
}

function severityTone(sev: string) {
  if (sev === "high" || sev === "critical") return "text-destructive";
  if (sev === "medium") return "text-warning";
  return "text-muted-foreground";
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Insights</h1>
        <p class="text-sm text-muted-foreground mt-1">
          Auto-generated findings from your data. Press
          <span class="rounded border px-1 py-0.5 font-mono text-[11px]"
            >⌘K</span
          >
          or tap the sparkle button to ask anything.
        </p>
      </div>
      <Button
        v-if="isLoggedIn"
        size="sm"
        :disabled="isGenerating"
        @click="runGenerate"
      >
        <Loader2 v-if="isGenerating" class="h-3 w-3 mr-1.5 animate-spin" />
        <Sparkles v-else class="h-3 w-3 mr-1.5" />
        {{ isGenerating ? "Generating…" : "Generate new" }}
      </Button>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="space-y-2">
      <div
        v-for="i in 3"
        :key="i"
        class="h-16 rounded-md border bg-muted/20 animate-pulse"
      />
    </div>

    <!-- Empty -->
    <div
      v-else-if="!sortedInsights.length"
      class="rounded-lg border border-dashed p-8 text-center"
    >
      <p class="text-sm font-medium mb-1">No insights yet</p>
      <p class="text-xs text-muted-foreground mb-4">
        Once you have some events, Observe will surface findings about cost,
        margin, and customer patterns here.
      </p>
      <Button
        v-if="isLoggedIn"
        size="sm"
        variant="outline"
        :disabled="isGenerating"
        @click="runGenerate"
      >
        <Sparkles class="h-3 w-3 mr-1.5" />
        Generate
      </Button>
    </div>

    <!-- Insights list -->
    <div v-else class="space-y-2">
      <div
        v-for="insight in sortedInsights"
        :key="insight.id"
        class="rounded-md border bg-card p-4 hover:bg-muted/30 transition-colors"
      >
        <div class="flex items-start gap-3">
          <component
            :is="severityIcon(insight.severity)"
            :class="['h-4 w-4 mt-0.5 shrink-0', severityTone(insight.severity)]"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline justify-between gap-4">
              <h3 class="text-sm font-medium">{{ insight.title }}</h3>
              <span class="text-[11px] text-muted-foreground shrink-0">{{
                formatDate(insight.created_at)
              }}</span>
            </div>
            <p class="text-xs text-muted-foreground mt-1 leading-relaxed">
              {{ insight.description }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
