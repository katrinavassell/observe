<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
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
  DollarSign,
  Send,
  Bot,
  User,
} from "lucide-vue-next";
import { useAuth } from "@/composables/useAuth";
import { Card, Button, Skeleton } from "@/components/ui";
import OnboardingChecklist from "@/components/onboarding/OnboardingChecklist.vue";
import {
  listInsights,
  generateInsights,
  getUsageLimits,
  listRecommendations,
  computeRecommendations,
  applyRecommendation,
  dismissRecommendation,
  sendChatMessage,
  executeChatAction,
} from "@/lib/api";
import type {
  AiInsight,
  Recommendation,
  ChatMessage,
  ChatAction,
} from "@/lib/api";

const queryClient = useQueryClient();
const { isLoggedIn } = useAuth();

const onboardingDismissed = ref(
  window.localStorage.getItem("observe:onboarding_dismissed") === "true",
);
function dismissOnboarding() {
  window.localStorage.setItem("observe:onboarding_dismissed", "true");
  onboardingDismissed.value = true;
}

// ── Recommendations + AI insights ────────────────────────────────────────────

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

// Merge into one sorted list
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
  for (const rec of recsData.value?.recommendations ?? []) {
    items.push({
      id: `rec-${rec.id}`,
      source: "recommendation",
      severity: rec.severity,
      title: rec.title,
      description: rec.description,
      type: rec.type,
      action: getActionForRec(rec),
      recId: rec.id,
    });
  }
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
  const order: Record<string, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    positive: 3,
  };
  return items.sort(
    (a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4),
  );
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

// ── Scan & generate actions ──────────────────────────────────────────────────

const isAnalyzing = ref(false);
const isGeneratingAI = ref(false);

async function handleAnalyze() {
  isAnalyzing.value = true;
  try {
    await computeRecommendations();
    queryClient.invalidateQueries({ queryKey: ["recommendations"] });
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
    toast.success((result.action_result as any)?.note || "Applied");
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
  } catch (err: any) {
    toast.error(err.message || "Failed to dismiss");
  }
}

// ── Chat ─────────────────────────────────────────────────────────────────────

const chatMessages = ref<
  Array<ChatMessage & { action?: ChatAction | null; actionExecuted?: boolean }>
>([]);
const chatInput = ref("");
const chatLoading = ref(false);
const feedRef = ref<HTMLElement | null>(null);

const SUGGESTIONS = [
  "Which customers are losing money?",
  "Route unprofitable customers to gpt-4o-mini",
  "Create an alert if daily cost exceeds $50",
  "Group my EU customers into a cohort",
];

async function handleChatSend() {
  const text = chatInput.value.trim();
  if (!text || chatLoading.value) return;

  chatInput.value = "";
  chatMessages.value.push({ role: "user", content: text });
  scrollToBottom();

  chatLoading.value = true;
  try {
    const msgs: ChatMessage[] = chatMessages.value.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const result = await sendChatMessage(msgs);
    chatMessages.value.push({
      role: "assistant",
      content: result.message,
      action: result.action,
    });
    scrollToBottom();
  } catch (err: any) {
    chatMessages.value.push({
      role: "assistant",
      content: err.message || "Something went wrong.",
    });
  } finally {
    chatLoading.value = false;
  }
}

async function handleChatAction(index: number) {
  const msg = chatMessages.value[index];
  if (!msg.action) return;
  try {
    const result = await executeChatAction(msg.action);
    msg.actionExecuted = true;
    toast.success(result.message);
    queryClient.invalidateQueries({ queryKey: ["recommendations"] });
  } catch (err: any) {
    toast.error(err.message || "Failed to execute");
  }
}

function handleSuggestion(text: string) {
  chatInput.value = text;
  handleChatSend();
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleChatSend();
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (feedRef.value) feedRef.value.scrollTop = feedRef.value.scrollHeight;
  });
}

function formatActionLabel(action: ChatAction): string {
  switch (action.type) {
    case "create_routing_rule":
      return `Create routing rule: ${action.field} ${action.operator} "${action.value}"`;
    case "create_alert":
      return `Create alert: ${action.name}`;
    case "create_cohort":
      return `Create cohort "${action.name}" with ${(action.customer_ids as string[])?.length || 0} customers`;
    default:
      return `Execute: ${action.type}`;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function severityClass(s: string) {
  switch (s) {
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
function severityBadge(s: string) {
  switch (s) {
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
function severityIcon(s: string) {
  switch (s) {
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
    <!-- Onboarding -->
    <OnboardingChecklist
      v-if="isLoggedIn && !onboardingDismissed"
      @dismiss="dismissOnboarding"
    />

    <!-- Header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Insights</h1>
        <p class="text-muted-foreground">
          Recommendations, AI analysis, and actions
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
        </Button>
      </div>
    </div>

    <!-- Insight cards -->
    <div v-if="recsLoading && insightsLoading" class="space-y-3">
      <Skeleton v-for="i in 3" :key="i" class="h-24 w-full" />
    </div>

    <div v-else-if="allInsights.length > 0" class="space-y-3">
      <Card
        v-for="insight in allInsights"
        :key="insight.id"
        class="p-4"
        :class="severityClass(insight.severity)"
      >
        <div class="flex gap-3">
          <component
            :is="severityIcon(insight.severity)"
            class="h-5 w-5 shrink-0 mt-0.5"
          />
          <div class="flex-1 min-w-0 space-y-1.5">
            <div class="flex items-center gap-2 flex-wrap">
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                :class="severityBadge(insight.severity)"
                >{{ insight.severity }}</span
              >
              <span class="text-[10px] text-muted-foreground font-mono">{{
                insight.type.replace(/_/g, " ")
              }}</span>
              <span
                v-if="insight.source === 'ai'"
                class="inline-flex items-center gap-0.5 text-[10px] text-primary"
                ><Sparkles class="h-2.5 w-2.5" /> AI</span
              >
            </div>
            <div class="text-sm font-medium">{{ insight.title }}</div>
            <div class="text-xs text-muted-foreground leading-relaxed">
              {{ insight.description }}
            </div>
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

    <!-- Chat section -->
    <div class="border-t pt-6">
      <div class="flex items-center gap-2 mb-3">
        <Bot class="h-4 w-4 text-primary" />
        <span class="text-sm font-medium">Ask anything</span>
      </div>

      <!-- Suggestion chips (when no messages) -->
      <div v-if="chatMessages.length === 0" class="flex flex-wrap gap-2 mb-4">
        <button
          v-for="s in SUGGESTIONS"
          :key="s"
          class="text-xs rounded-full border px-3 py-1.5 hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
          @click="handleSuggestion(s)"
        >
          {{ s }}
        </button>
      </div>

      <!-- Chat messages -->
      <div
        v-if="chatMessages.length > 0"
        ref="feedRef"
        class="space-y-3 max-h-96 overflow-y-auto mb-4"
      >
        <div
          v-for="(msg, i) in chatMessages"
          :key="i"
          class="flex gap-3"
          :class="msg.role === 'user' ? 'justify-end' : ''"
        >
          <div
            v-if="msg.role === 'assistant'"
            class="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary/10"
          >
            <Bot class="h-3.5 w-3.5 text-primary" />
          </div>
          <div
            class="max-w-[80%] rounded-lg px-3 py-2 text-sm"
            :class="
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted'
            "
          >
            <div class="whitespace-pre-wrap">
              {{ msg.content.replace(/```action[\s\S]*?```/g, "").trim() }}
            </div>
            <div
              v-if="msg.action && !msg.actionExecuted"
              class="mt-2 rounded border bg-background p-2"
            >
              <div class="text-xs font-medium mb-1.5">
                {{ formatActionLabel(msg.action) }}
              </div>
              <Button size="sm" @click="handleChatAction(i)">
                <Check class="h-3 w-3 mr-1" /> Do it
              </Button>
            </div>
            <div
              v-if="msg.action && msg.actionExecuted"
              class="mt-1.5 flex items-center gap-1 text-xs text-success"
            >
              <Check class="h-3 w-3" /> Done
            </div>
          </div>
          <div
            v-if="msg.role === 'user'"
            class="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/10"
          >
            <User class="h-3.5 w-3.5" />
          </div>
        </div>
        <div v-if="chatLoading" class="flex gap-3">
          <div
            class="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-primary/10"
          >
            <Bot class="h-3.5 w-3.5 text-primary" />
          </div>
          <div
            class="bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground flex items-center gap-2"
          >
            <Loader2 class="h-3.5 w-3.5 animate-spin" /> Thinking...
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="flex gap-2">
        <input
          v-model="chatInput"
          class="flex-1 rounded-lg border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="Ask about your costs, margins, or take an action..."
          :disabled="chatLoading || !isLoggedIn"
          @keydown="handleKeydown"
        />
        <Button
          :disabled="chatLoading || !chatInput.trim() || !isLoggedIn"
          @click="handleChatSend"
        >
          <Send class="h-4 w-4" />
        </Button>
      </div>
    </div>
  </div>
</template>
