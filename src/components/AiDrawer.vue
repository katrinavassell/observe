<script setup lang="ts">
import { ref, nextTick, computed, onMounted, onBeforeUnmount } from "vue";
import { useRoute } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { Send, Loader2, Check, Sparkles, Trash2 } from "lucide-vue-next";
import { useAuth } from "@/composables/useAuth";
import { Button } from "@/components/ui";
import Sheet from "@/components/ui/sheet.vue";
import { sendChatMessage, executeChatAction, getUsageLimits } from "@/lib/api";
import type { ChatMessage, ChatAction } from "@/lib/api";

const { isLoggedIn } = useAuth();
const route = useRoute();

const { data: usageLimits } = useQuery({
  queryKey: ["usage-limits"],
  queryFn: getUsageLimits,
  enabled: isLoggedIn,
});

const messageUsage = computed(() => usageLimits.value?.ai_insights?.usage);

const open = ref(false);
const messages = ref<
  Array<ChatMessage & { action?: ChatAction | null; actionExecuted?: boolean }>
>([]);
const input = ref("");
const isLoading = ref(false);
const feedRef = ref<HTMLElement | null>(null);

const hasMessages = computed(() => messages.value.length > 0);

// Route-adaptive starter prompts.
const ROUTE_PROMPTS: Record<string, string[]> = {
  "/analytics": [
    "What's my overall margin and how can I improve it?",
    "Which features are unprofitable right now?",
    "Compare cost vs revenue by model this month",
  ],
  "/events": [
    "Show me the 5 most expensive events this week",
    "Which customer has the most events today?",
    "What's the error rate on my gateway?",
  ],
  "/traces": [
    "Which trace is costing the most and why?",
    "Find traces longer than 10 seconds",
    "Summarize the top 3 trace patterns",
  ],
  "/models": [
    "Which model has the worst margin?",
    "Switch my highest-cost customer to gpt-4o-mini",
    "What's my cheapest embedding model in use?",
  ],
  "/cohorts": [
    "Group my top 5 customers into a cohort",
    "Which cohort is most profitable?",
    "Create a cohort of customers over $50 cost",
  ],
  "/routing": [
    "Route unprofitable customers to gpt-4o-mini",
    "What routing rule would save the most?",
    "Explain my current routing rules",
  ],
  "/alerts": [
    "Create an alert when daily cost exceeds $50",
    "Alert me when a customer's margin drops below 40%",
    "What alerts have fired this week?",
  ],
  "/data-sources": [
    "Which of my connected sources sent the most events this week?",
    "Show me the last 10 events from the SDK",
    "When did each of my data sources last sync?",
  ],
};

const DEFAULT_PROMPTS = [
  "What's my overall margin?",
  "Which customers are unprofitable?",
  "How can I cut AI cost this month?",
];

const suggestions = computed(() => {
  return ROUTE_PROMPTS[route.path] ?? DEFAULT_PROMPTS;
});

const placeholder = computed(() => {
  if (route.path === "/analytics") return "Ask about margins, cost, revenue…";
  if (route.path === "/traces") return "Ask about a trace or span…";
  if (route.path === "/events") return "Ask about events, customers, models…";
  return "Ask Observe anything…";
});

function openDrawer() {
  open.value = true;
  nextTick(() => {
    document.getElementById("ai-drawer-input")?.focus();
  });
}

function onKeydown(e: KeyboardEvent) {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const modifier = isMac ? e.metaKey : e.ctrlKey;
  if (modifier && e.key.toLowerCase() === "k") {
    e.preventDefault();
    open.value = !open.value;
    if (open.value) {
      nextTick(() => document.getElementById("ai-drawer-input")?.focus());
    }
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function useSuggestion(text: string) {
  input.value = text;
  handleSend();
}

async function handleSend() {
  const text = input.value.trim();
  if (!text || isLoading.value) return;
  if (!isLoggedIn.value) {
    toast.error("Sign in to ask Observe");
    return;
  }

  input.value = "";
  messages.value.push({ role: "user", content: text });
  scrollToBottom();

  isLoading.value = true;
  try {
    const contextPrefix: ChatMessage = {
      role: "system",
      content: `The user is currently on the ${route.path} page.`,
    };
    const history: ChatMessage[] = messages.value
      .filter((m) => !("actionExecuted" in m))
      .map((m) => ({ role: m.role, content: m.content }));
    const result = await sendChatMessage([contextPrefix, ...history]);
    messages.value.push({
      role: "assistant",
      content: result.message,
      action: result.action,
    });
    scrollToBottom();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Something went wrong.";
    messages.value.push({ role: "assistant", content: msg });
  } finally {
    isLoading.value = false;
  }
}

async function handleExecuteAction(index: number) {
  const msg = messages.value[index];
  if (!msg.action) return;
  try {
    const result = await executeChatAction(msg.action);
    msg.actionExecuted = true;
    toast.success(result.message);
  } catch (err: unknown) {
    toast.error(err instanceof Error ? err.message : "Action failed");
  }
}

function handleKeyPress(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function clearChat() {
  messages.value = [];
  input.value = "";
  nextTick(() => document.getElementById("ai-drawer-input")?.focus());
}

function scrollToBottom() {
  nextTick(() => {
    if (feedRef.value) {
      feedRef.value.scrollTop = feedRef.value.scrollHeight;
    }
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

defineExpose({ openDrawer });
</script>

<template>
  <!-- Floating trigger -->
  <button
    class="fixed bottom-6 right-6 z-40 flex h-12 items-center gap-2 rounded-full bg-foreground pl-3.5 pr-4 text-background shadow-xl hover:scale-[1.02] transition-transform focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
    aria-label="Ask Observe"
    @click="openDrawer"
  >
    <Sparkles class="h-4 w-4" />
    <span class="text-xs font-medium">Ask</span>
    <span class="rounded bg-background/15 px-1.5 py-0.5 font-mono text-[10px]"
      >⌘K</span
    >
  </button>

  <Sheet :open="open" side="right" @update:open="open = $event">
    <div class="flex flex-col h-full">
      <!-- Header -->
      <div class="shrink-0 flex items-center justify-between px-5 pt-5 pb-3">
        <div class="flex items-center gap-2">
          <div
            class="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10"
          >
            <Sparkles class="h-3.5 w-3.5 text-primary" />
          </div>
          <div>
            <h2 class="text-sm font-semibold leading-none">Ask Observe</h2>
            <p
              v-if="messageUsage"
              class="mt-1 text-[11px] text-muted-foreground leading-none"
            >
              {{ messageUsage.remaining }}/{{ messageUsage.limit }} messages
              left this month
            </p>
            <p
              v-else
              class="mt-1 text-[11px] text-muted-foreground leading-none"
            >
              Press ⌘K to toggle
            </p>
          </div>
        </div>
        <button
          v-if="hasMessages"
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors mr-8"
          aria-label="Clear chat"
          @click="clearChat"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </button>
      </div>

      <!-- Feed -->
      <div ref="feedRef" class="flex-1 overflow-y-auto px-5 py-3 space-y-3">
        <!-- Empty state with route-adaptive starters -->
        <div v-if="!hasMessages && !isLoading" class="space-y-4 pt-2">
          <p class="text-xs text-muted-foreground">
            Ask anything about what you're looking at, or pick a starter.
          </p>
          <div class="flex flex-col gap-1.5">
            <button
              v-for="prompt in suggestions"
              :key="prompt"
              class="text-left text-xs rounded-lg border bg-card px-3 py-2.5 hover:bg-muted/60 hover:border-foreground/20 transition-colors"
              @click="useSuggestion(prompt)"
            >
              {{ prompt }}
            </button>
          </div>
        </div>

        <template v-for="(msg, i) in messages" :key="i">
          <div
            class="flex"
            :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
              :class="
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-md'
                  : 'bg-muted text-foreground rounded-bl-md'
              "
            >
              <div class="whitespace-pre-wrap break-words">
                {{ msg.content.replace(/```action[\s\S]*?```/g, "").trim() }}
              </div>

              <div
                v-if="msg.action && !msg.actionExecuted"
                class="mt-2.5 rounded-md border border-foreground/10 bg-background/80 p-2.5"
              >
                <div class="text-[11px] text-muted-foreground mb-1">
                  Suggested action
                </div>
                <div class="text-xs font-medium mb-2 text-foreground">
                  {{ formatActionLabel(msg.action) }}
                </div>
                <Button
                  size="sm"
                  class="h-7 text-xs"
                  @click="handleExecuteAction(i)"
                >
                  <Check class="h-3 w-3 mr-1" />
                  Do it
                </Button>
              </div>
              <div
                v-if="msg.action && msg.actionExecuted"
                class="mt-1.5 flex items-center gap-1 text-xs text-success"
              >
                <Check class="h-3 w-3" />
                Done
              </div>
            </div>
          </div>
        </template>

        <div v-if="isLoading" class="flex justify-start">
          <div
            class="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-xs text-muted-foreground flex items-center gap-2"
          >
            <Loader2 class="h-3 w-3 animate-spin" />
            Thinking…
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="shrink-0 border-t bg-background/80 backdrop-blur-sm p-3">
        <div class="flex items-end gap-2">
          <input
            id="ai-drawer-input"
            v-model="input"
            class="flex-1 h-10 rounded-lg border bg-background px-3.5 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40"
            :placeholder="placeholder"
            :disabled="isLoading || !isLoggedIn"
            @keydown="handleKeyPress"
          />
          <Button
            size="sm"
            class="h-10 w-10 p-0 shrink-0"
            :disabled="isLoading || !input.trim() || !isLoggedIn"
            @click="handleSend"
          >
            <Send class="h-3.5 w-3.5" />
          </Button>
        </div>
        <p
          v-if="!isLoggedIn"
          class="mt-2 text-[11px] text-muted-foreground text-center"
        >
          Sign in to ask Observe.
        </p>
      </div>
    </div>
  </Sheet>
</template>
