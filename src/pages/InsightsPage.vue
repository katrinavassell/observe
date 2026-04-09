<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { Loader2, Check, Send, Bot, User, X } from "lucide-vue-next";
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogClose,
} from "radix-vue";
import { useAuth } from "@/composables/useAuth";
import { Button } from "@/components/ui";
import { getUsageLimits, sendChatMessage, executeChatAction } from "@/lib/api";
import type { ChatMessage, ChatAction } from "@/lib/api";

const queryClient = useQueryClient();
const router = useRouter();
const { isLoggedIn } = useAuth();

const { data: usageLimits } = useQuery({
  queryKey: ["usage-limits"],
  queryFn: getUsageLimits,
});

const insightsUsage = computed(
  () => usageLimits.value?.ai_insights?.usage ?? null,
);
const creditsRemaining = computed(() => insightsUsage.value?.remaining ?? null);
const outOfCredits = computed(
  () => creditsRemaining.value !== null && creditsRemaining.value <= 0,
);

// ── Chat ─────────────────────────────────────────────────────────────────────

const chatMessages = ref<
  Array<ChatMessage & { action?: ChatAction | null; actionExecuted?: boolean }>
>([]);
const chatInput = ref("");
const chatLoading = ref(false);
const feedRef = ref<HTMLElement | null>(null);

const hasMessages = computed(() => chatMessages.value.length > 0);

const SUGGESTIONS = [
  "Which customers are unprofitable?",
  "Compare costs across my AI models",
  "Create an alert when daily cost exceeds $50",
  "Route my highest-cost customer to gpt-4o-mini",
  "Group my top 5 customers into a cohort",
  "What's my overall margin and how can I improve it?",
];

const showSignupPrompt = ref(false);

function requireAuth(): boolean {
  if (!isLoggedIn.value) {
    showSignupPrompt.value = true;
    return false;
  }
  return true;
}

async function handleChatSend() {
  const text = chatInput.value.trim();
  if (!text || chatLoading.value) return;
  if (!requireAuth()) return;

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
    queryClient.invalidateQueries({ queryKey: ["usage-limits"] });
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
  if (!requireAuth()) return;
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

function renderMarkdown(text: string): string {
  return text
    .replace(/```action[\s\S]*?```/g, "")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /`([^`]+)`/g,
      '<code class="rounded bg-muted px-1 py-0.5 text-xs">$1</code>',
    )
    .replace(/\n/g, "<br>");
}

// ── Helpers ──────────────────────────────────────────────────────────────────
</script>

<template>
  <div class="flex flex-col h-[calc(100vh-theme(spacing.6)*2)]">
    <!-- Header -->
    <div class="shrink-0 pb-4">
      <h1 class="text-2xl font-semibold tracking-tight">Insights</h1>
      <p class="text-sm text-muted-foreground mt-1">
        Ask questions, get recommendations, and take action
      </p>
    </div>

    <!-- Chat area -->
    <div ref="feedRef" class="flex-1 overflow-y-auto space-y-4 pb-4">
      <!-- Empty state -->
      <div
        v-if="!hasMessages && !chatLoading"
        class="flex flex-col items-center justify-center h-full text-center max-w-lg mx-auto"
      >
        <Bot class="h-12 w-12 text-primary/30 mb-4" />
        <p class="text-lg font-semibold mb-2">What do you want to know?</p>
        <p class="text-sm text-muted-foreground mb-6">
          Ask about costs, margins, customers — or take action like creating
          routing rules, alerts, and cohorts.
        </p>
        <div class="grid grid-cols-2 gap-2 w-full">
          <button
            v-for="suggestion in SUGGESTIONS"
            :key="suggestion"
            class="text-left text-xs rounded-lg border px-3 py-2.5 hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
            @click="handleSuggestion(suggestion)"
          >
            {{ suggestion }}
          </button>
        </div>
      </div>

      <!-- Message bubbles -->
      <template v-for="(msg, i) in chatMessages" :key="i">
        <div
          class="flex gap-3"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            v-if="msg.role === 'assistant'"
            class="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10"
          >
            <Bot class="h-4 w-4 text-primary" />
          </div>

          <div
            class="max-w-[75%] rounded-lg px-4 py-2.5 text-sm leading-relaxed"
            :class="
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted'
            "
          >
            <div
              v-if="msg.role === 'assistant'"
              class="whitespace-pre-wrap"
              v-html="renderMarkdown(msg.content)"
            />
            <div v-else class="whitespace-pre-wrap">
              {{ msg.content }}
            </div>

            <div
              v-if="msg.action && !msg.actionExecuted"
              class="mt-3 rounded-md border bg-background p-3"
            >
              <div class="text-xs text-muted-foreground mb-2">
                Suggested action:
              </div>
              <div class="text-xs font-medium mb-2">
                {{ formatActionLabel(msg.action) }}
              </div>
              <Button size="sm" @click="handleChatAction(i)">
                <Check class="h-3 w-3 mr-1" />
                Do it
              </Button>
            </div>

            <div
              v-if="msg.action && msg.actionExecuted"
              class="mt-2 flex items-center gap-1.5 text-xs text-success"
            >
              <Check class="h-3 w-3" />
              Done
            </div>
          </div>

          <div
            v-if="msg.role === 'user'"
            class="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-foreground/10"
          >
            <User class="h-4 w-4" />
          </div>
        </div>
      </template>

      <!-- Loading indicator -->
      <div v-if="chatLoading" class="flex gap-3">
        <div
          class="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10"
        >
          <Bot class="h-4 w-4 text-primary" />
        </div>
        <div class="bg-muted rounded-lg px-4 py-3">
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 class="h-3.5 w-3.5 animate-spin" />
            Thinking...
          </div>
        </div>
      </div>
    </div>

    <!-- Input area -->
    <div class="shrink-0 border-t pt-4">
      <div class="flex gap-2">
        <input
          v-model="chatInput"
          class="flex-1 rounded-lg border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          :disabled="chatLoading || outOfCredits"
          :placeholder="
            outOfCredits
              ? 'No messages remaining'
              : 'Ask about your costs, margins, or take an action...'
          "
          @keydown="handleKeydown"
        />
        <Button
          :disabled="chatLoading || !chatInput.trim() || outOfCredits"
          @click="handleChatSend"
        >
          <Send class="h-4 w-4" />
        </Button>
      </div>
      <div class="flex items-center justify-between mt-2">
        <p v-if="!isLoggedIn" class="text-xs text-muted-foreground">
          <router-link to="/signup" class="text-primary hover:underline"
            >Sign up</router-link
          >
          to use AI features.
        </p>
        <template v-else-if="insightsUsage">
          <p v-if="outOfCredits" class="text-xs text-destructive font-medium">
            No messages remaining.
            <router-link to="/plans" class="underline">Upgrade</router-link>
          </p>
          <p
            v-else
            class="text-xs"
            :class="
              creditsRemaining! <= 5
                ? 'text-warning font-medium'
                : 'text-muted-foreground'
            "
          >
            {{ insightsUsage.remaining }}/{{ insightsUsage.limit }} messages
            remaining
          </p>
        </template>
      </div>
    </div>
  </div>

  <!-- Signup prompt modal -->
  <DialogRoot :open="showSignupPrompt" @update:open="showSignupPrompt = $event">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent
        class="fixed left-[50%] top-[50%] z-50 w-full max-w-sm translate-x-[-50%] translate-y-[-50%] border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg text-center"
      >
        <DialogClose
          class="absolute right-3 top-3 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X class="h-4 w-4" />
        </DialogClose>
        <Bot class="h-10 w-10 text-primary/40 mx-auto mb-3" />
        <p class="text-lg font-semibold mb-1">Sign up to continue</p>
        <p class="text-sm text-muted-foreground mb-4">
          Create a free account to use the AI assistant and get 25 messages per
          month.
        </p>
        <div class="flex flex-col gap-2">
          <Button
            @click="
              router.push('/signup');
              showSignupPrompt = false;
            "
          >
            Sign Up Free
          </Button>
          <router-link
            to="/login"
            class="text-xs text-muted-foreground hover:text-foreground"
            @click="showSignupPrompt = false"
          >
            Already have an account? Sign in
          </router-link>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
