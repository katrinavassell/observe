<script setup lang="ts">
import { ref, nextTick, computed } from "vue";
import { toast } from "vue-sonner";
import { Send, Loader2, Sparkles, Check, Bot, User } from "lucide-vue-next";
import { useAuth } from "@/composables/useAuth";
import { Button, Input, Card } from "@/components/ui";
import { sendChatMessage, executeChatAction } from "@/lib/api";
import type { ChatMessage, ChatAction } from "@/lib/api";

const { isLoggedIn } = useAuth();

const messages = ref<
  Array<ChatMessage & { action?: ChatAction | null; actionExecuted?: boolean }>
>([]);
const input = ref("");
const isLoading = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);

const hasMessages = computed(() => messages.value.length > 0);

const SUGGESTIONS = [
  "Which customers are losing money?",
  "What model should I switch to for cost savings?",
  "Create an alert if daily cost exceeds $50",
  "Route unprofitable customers to gpt-4o-mini",
  "Group my EU customers into a cohort",
  "How can I improve my margins?",
];

async function handleSend() {
  const text = input.value.trim();
  if (!text || isLoading.value) return;

  input.value = "";
  messages.value.push({ role: "user", content: text });
  scrollToBottom();

  isLoading.value = true;
  try {
    const chatMessages: ChatMessage[] = messages.value
      .filter((m) => !("actionExecuted" in m))
      .map((m) => ({ role: m.role, content: m.content }));

    const result = await sendChatMessage(chatMessages);
    messages.value.push({
      role: "assistant",
      content: result.message,
      action: result.action,
    });
    scrollToBottom();
  } catch (err: any) {
    messages.value.push({
      role: "assistant",
      content: err.message || "Something went wrong. Try again.",
    });
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
  } catch (err: any) {
    toast.error(err.message || "Failed to execute action");
  }
}

function handleSuggestion(text: string) {
  input.value = text;
  handleSend();
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
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
</script>

<template>
  <div class="flex flex-col h-[calc(100vh-theme(spacing.6)*2)]">
    <!-- Header -->
    <div class="shrink-0 pb-4">
      <div class="flex items-center gap-2">
        <Sparkles class="h-5 w-5 text-primary" />
        <h1 class="text-2xl font-semibold tracking-tight">Chat</h1>
      </div>
      <p class="text-muted-foreground text-sm mt-0.5">
        Ask questions about your data, get recommendations, and take action
      </p>
    </div>

    <!-- Messages area -->
    <div ref="messagesContainer" class="flex-1 overflow-y-auto space-y-4 pb-4">
      <!-- Empty state with suggestions -->
      <div
        v-if="!hasMessages && !isLoading"
        class="flex flex-col items-center justify-center h-full text-center max-w-lg mx-auto"
      >
        <Bot class="h-12 w-12 text-primary/30 mb-4" />
        <p class="text-lg font-semibold mb-2">What do you want to know?</p>
        <p class="text-sm text-muted-foreground mb-6">
          Ask about your costs, margins, customers, or models. I can also create
          routing rules and alerts for you.
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
      <template v-for="(msg, i) in messages" :key="i">
        <div
          class="flex gap-3"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <!-- Avatar -->
          <div
            v-if="msg.role === 'assistant'"
            class="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary/10"
          >
            <Bot class="h-4 w-4 text-primary" />
          </div>

          <!-- Bubble -->
          <div
            class="max-w-[75%] rounded-lg px-4 py-2.5 text-sm leading-relaxed"
            :class="
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted'
            "
          >
            <div class="whitespace-pre-wrap">
              {{ msg.content.replace(/```action[\s\S]*?```/g, "").trim() }}
            </div>

            <!-- Action block -->
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
              <Button size="sm" @click="handleExecuteAction(i)">
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

          <!-- User avatar -->
          <div
            v-if="msg.role === 'user'"
            class="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-foreground/10"
          >
            <User class="h-4 w-4" />
          </div>
        </div>
      </template>

      <!-- Loading indicator -->
      <div v-if="isLoading" class="flex gap-3">
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
          v-model="input"
          class="flex-1 rounded-lg border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="Ask about your costs, margins, or take an action..."
          :disabled="isLoading || !isLoggedIn"
          @keydown="handleKeydown"
        />
        <Button
          :disabled="isLoading || !input.trim() || !isLoggedIn"
          @click="handleSend"
        >
          <Send class="h-4 w-4" />
        </Button>
      </div>
      <p v-if="!isLoggedIn" class="text-xs text-muted-foreground mt-2">
        Sign in to use the AI chat assistant.
      </p>
    </div>
  </div>
</template>
