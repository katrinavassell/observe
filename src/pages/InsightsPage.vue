<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import {
  Lightbulb,
  Sparkles,
  Loader2,
  Check,
  X,
  AlertTriangle,
  AlertCircle,
  Info,
  GitBranch,
  Bell,
  Users,
  DollarSign,
} from "lucide-vue-next";
import { useAuth } from "@/composables/useAuth";
import { Card, Button, Skeleton } from "@/components/ui";
import {
  listInsights,
  generateInsights,
  getUsageLimits,
  listRecommendations,
  computeRecommendations,
  applyRecommendation,
  dismissRecommendation,
} from "@/lib/api";
import type { AiInsight, Recommendation } from "@/lib/api";

const queryClient = useQueryClient();
const { isLoggedIn } = useAuth();

// ── Unified insights: deterministic recommendations + AI insights ────────────

const { data: recsData, isLoading: recsLoading } = useQuery({
  queryKey: ["recommendations"],
  queryFn: () => listRecommendations("pending"),
  enabled: isLoggedIn,
});

const { data: insightsData, isLoading: insightsLoading } = useQuery({
  queryKey: ["insights"],
  queryFn: listInsights,
  enabled: isLoggedIn,
});

const { data: usageLimits } = useQuery({
  queryKey: ["usage-limits"],
  queryFn: getUsageLimits,
});

const insightsUsage = computed(
  () => usageLimits.value?.ai_insights?.usage ?? null,
);
const insightsAllowed = computed(
  () => usageLimits.value?.ai_insights?.allowed !== false,
);

// Merge both into one sorted list
interface UnifiedInsight {
  id: string;
  source: "recommendation" | "ai";
  severity: string;
  title: string;
  description: string;
  type: string;
  action?: { label: string; icon: typeof GitBranch; description: string };
  recId?: number;
}

const allInsights = computed<UnifiedInsight[]>(() => {
  const items: UnifiedInsight[] = [];

  // Recommendations (actionable)
  for (const rec of recsData.value?.recommendations ?? []) {
    const action = getActionForRec(rec);
    items.push({
      id: `rec-${rec.id}`,
      source: "recommendation",
      severity: rec.severity,
      title: rec.title,
      description: rec.description,
      type: rec.type,
      action,
      recId: rec.id,
    });
  }

  // AI insights (informational)
  for (const ins of insightsData.value ?? []) {
    items.push({
      id: `ai-${ins.id}`,
      source: "ai",
      severity: ins.severity,
      title: ins.title,
      description: ins.description,
      type: ins.insight_type,
    });
  }

  // Sort: critical first, then warning, then info. Within same severity, recommendations before AI.
  const severityOrder: Record<string, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    positive: 3,
  };
  return items.sort((a, b) => {
    const sa = severityOrder[a.severity] ?? 4;
    const sb = severityOrder[b.severity] ?? 4;
    if (sa !== sb) return sa - sb;
    if (a.source !== b.source) return a.source === "recommendation" ? -1 : 1;
    return 0;
  });
});

function getActionForRec(rec: Recommendation): UnifiedInsight["action"] {
  switch (rec.action_type) {
    case "create_routing_rule":
      return {
        label: "Create routing rule",
        icon: GitBranch,
        description: `Route ${(rec.action_payload as any).value || "this customer"} to a cheaper model`,
      };
    case "update_routing_target":
      return {
        label: "Switch model",
        icon: GitBranch,
        description: `Change from ${(rec.action_payload as any).current_model} to ${(rec.action_payload as any).suggested_model}`,
      };
    case "create_routing_config":
      return {
        label: "Add fallback provider",
        icon: GitBranch,
        description: "Create a routing config with provider fallbacks",
      };
    default:
      return {
        label: "Apply",
        icon: Check,
        description: "Apply this recommendation",
      };
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

const isAnalyzing = ref(false);
const isGeneratingAI = ref(false);

async function handleAnalyze() {
  isAnalyzing.value = true;
  try {
    await computeRecommendations();
    queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    queryClient.invalidateQueries({ queryKey: ["recommendations-count"] });
    toast.success("Analysis complete");
  } catch (err: any) {
    toast.error(err.message || "Analysis failed");
  } finally {
    isAnalyzing.value = false;
  }
}

async function handleGenerateAI() {
  isGeneratingAI.value = true;
  try {
    await generateInsights();
    queryClient.invalidateQueries({ queryKey: ["insights"] });
    queryClient.invalidateQueries({ queryKey: ["usage-limits"] });
    toast.success("AI insights generated");
  } catch (err: any) {
    toast.error(err.message || "Failed to generate");
  } finally {
    isGeneratingAI.value = false;
  }
}

const applyingId = ref<number | null>(null);

async function handleApply(recId: number) {
  applyingId.value = recId;
  try {
    const result = await applyRecommendation(recId);
    queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    queryClient.invalidateQueries({ queryKey: ["recommendations-count"] });
    const note = (result.action_result as any)?.note;
    toast.success(note || "Applied successfully");
  } catch (err: any) {
    toast.error(err.message || "Failed to apply");
  } finally {
    applyingId.value = null;
  }
}

async function handleDismiss(recId: number) {
  try {
    await dismissRecommendation(recId);
    queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    queryClient.invalidateQueries({ queryKey: ["recommendations-count"] });
  } catch (err: any) {
    toast.error(err.message || "Failed to dismiss");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function severityClass(severity: string) {
  switch (severity) {
    case "critical":
      return "border-destructive/30 bg-destructive/5";
    case "warning":
      return "border-warning/30 bg-warning/5";
    case "positive":
      return "border-success/30 bg-success/5";
    default:
      return "border-border bg-card";
  }
}

function severityBadge(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-destructive/10 text-destructive";
    case "warning":
      return "bg-warning/10 text-warning";
    case "positive":
      return "bg-success/10 text-success";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function severityIcon(severity: string) {
  switch (severity) {
    case "critical":
      return AlertCircle;
    case "warning":
      return AlertTriangle;
    default:
      return Info;
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Insights</h1>
        <p class="text-muted-foreground">
          Actionable recommendations from your cost and margin data
        </p>
      </div>
      <div class="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          :disabled="isAnalyzing"
          @click="handleAnalyze"
        >
          <Loader2 v-if="isAnalyzing" class="h-3.5 w-3.5 mr-1.5 animate-spin" />
          <Lightbulb v-else class="h-3.5 w-3.5 mr-1.5" />
          {{ isAnalyzing ? "Scanning..." : "Quick Scan" }}
        </Button>
        <Button
          size="sm"
          :disabled="isGeneratingAI || !insightsAllowed"
          @click="handleGenerateAI"
        >
          <Loader2
            v-if="isGeneratingAI"
            class="h-3.5 w-3.5 mr-1.5 animate-spin"
          />
          <Sparkles v-else class="h-3.5 w-3.5 mr-1.5" />
          {{ isGeneratingAI ? "Generating..." : "AI Analysis" }}
          <span v-if="insightsUsage" class="ml-1 text-xs opacity-60">
            ({{ insightsUsage.remaining }} credits)
          </span>
        </Button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="recsLoading && insightsLoading" class="space-y-3">
      <Skeleton v-for="i in 4" :key="i" class="h-28 w-full" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="allInsights.length === 0"
      class="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto"
    >
      <Lightbulb class="h-12 w-12 text-muted-foreground/30 mb-4" />
      <p class="text-sm font-medium mb-1">No insights yet</p>
      <p class="text-xs text-muted-foreground mb-5">
        Run a quick scan to analyze your margin data for optimization
        opportunities, or use AI analysis for deeper pattern detection.
      </p>
      <div class="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          :disabled="isAnalyzing"
          @click="handleAnalyze"
        >
          <Lightbulb class="h-3.5 w-3.5 mr-1.5" />
          Quick Scan (free)
        </Button>
        <Button
          size="sm"
          :disabled="isGeneratingAI || !insightsAllowed"
          @click="handleGenerateAI"
        >
          <Sparkles class="h-3.5 w-3.5 mr-1.5" />
          AI Analysis
        </Button>
      </div>
    </div>

    <!-- Insight cards -->
    <div v-else class="space-y-3">
      <Card
        v-for="insight in allInsights"
        :key="insight.id"
        class="p-4"
        :class="severityClass(insight.severity)"
      >
        <div class="flex gap-3">
          <!-- Severity icon -->
          <div class="pt-0.5 shrink-0">
            <component
              :is="severityIcon(insight.severity)"
              class="h-5 w-5"
              :class="
                severityBadge(insight.severity)
                  .replace('bg-', 'text-')
                  .split(' ')
                  .pop()
              "
            />
          </div>

          <!-- Content -->
          <div class="flex-1 min-w-0 space-y-1.5">
            <div class="flex items-center gap-2 flex-wrap">
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                :class="severityBadge(insight.severity)"
                >{{ insight.severity }}</span
              >
              <span class="text-[10px] text-muted-foreground font-mono">
                {{ insight.type.replace(/_/g, " ") }}
              </span>
              <span
                v-if="insight.source === 'ai'"
                class="inline-flex items-center gap-0.5 text-[10px] text-primary"
              >
                <Sparkles class="h-2.5 w-2.5" />
                AI
              </span>
            </div>

            <div class="text-sm font-medium">{{ insight.title }}</div>
            <div class="text-xs text-muted-foreground leading-relaxed">
              {{ insight.description }}
            </div>

            <!-- Action block (recommendations only) -->
            <div
              v-if="insight.action && insight.recId"
              class="flex items-center gap-3 pt-2 border-t border-border/50 mt-2"
            >
              <div class="flex-1">
                <div class="flex items-center gap-1.5 text-xs font-medium">
                  <component
                    :is="insight.action.icon"
                    class="h-3 w-3 text-primary"
                  />
                  {{ insight.action.label }}
                </div>
                <div class="text-[11px] text-muted-foreground">
                  {{ insight.action.description }}
                </div>
              </div>
              <Button
                size="sm"
                class="shrink-0"
                :disabled="applyingId === insight.recId"
                @click="handleApply(insight.recId!)"
              >
                <Loader2
                  v-if="applyingId === insight.recId"
                  class="h-3 w-3 mr-1 animate-spin"
                />
                <Check v-else class="h-3 w-3 mr-1" />
                Do it
              </Button>
              <button
                class="text-xs text-muted-foreground hover:text-foreground shrink-0"
                @click="handleDismiss(insight.recId!)"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  </div>
</template>
