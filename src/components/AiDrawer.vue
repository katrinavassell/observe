<script setup lang="ts">
import { ref, nextTick, computed, onMounted, onBeforeUnmount } from "vue";
import { toast } from "vue-sonner";
import { Send, Loader2, Check, Sparkles } from "lucide-vue-next";
import { useAuth } from "@/composables/useAuth";
import { Button } from "@/components/ui";
import Sheet from "@/components/ui/sheet.vue";
import { sendChatMessage, executeChatAction } from "@/lib/api";
import type { ChatMessage, ChatAction } from "@/lib/api";

const { isLoggedIn } = useAuth();

const open = ref(false);
const messages = ref<
  Array<ChatMessage & { action?: ChatAction | null; actionExecuted?: boolean }>
>([]);
const input = ref("");
const isLoading = ref(false);
const feedRef = ref<HTMLElement | null>(null);

const hasMessages = computed(() => messages.value.length > 0);

function openDrawer() {
  open.value = true;
  nextTick(() => {
    const el = document.getElementById("ai-drawer-input");
    el?.focus();
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
  <!-- Floating trigger button -->
  <button
    class="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background shadow-lg hover:scale-105 transition-transform focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
    aria-label="Ask Observe"
    @click="openDrawer"
  >
    <Sparkles class="h-5 w-5" />
  </button>

  <Sheet :open="open" side="right" @update:open="open = $event">
    <div class="flex flex-col h-full">
      <!-- Header -->
      <div class="shrink-0 px-6 pt-6 pb-4 border-b">
        <div class="flex items-center gap-2">
          <Sparkles class="h-4 w-4 text-primary" />
          <h2 class="text-base font-semibold">Ask Observe</h2>
        </div>
        <p class="text-xs text-muted-foreground mt-1">
          Questions, recommendations, actions.
          <span class="ml-1 rounded border px-1 py-0.5 font-mono text-[10px]"
            >⌘K</span
          >
        </p>
      </div>

      <!-- Feed -->
      <div ref="feedRef" class="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        <div
          v-if="!hasMessages && !isLoading"
          class="text-xs text-muted-foreground"
        >
          Ask anything about your costs, margins, customers, or models.
        </div>

        <template v-for="(msg, i) in messages" :key="i">
          <div
            class="flex"
            :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed"
              :class="
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : 'bg-muted text-foreground rounded-bl-sm'
              "
            >
              <div class="whitespace-pre-wrap break-words">
                {{ msg.content.replace(/```action[\s\S]*?```/g, "").trim() }}
              </div>

              <div
                v-if="msg.action && !msg.actionExecuted"
                class="mt-2 rounded-md border bg-background p-2.5"
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

        <div
          v-if="isLoading"
          class="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Loader2 class="h-3 w-3 animate-spin" />
          Thinking…
        </div>
      </div>

      <!-- Input -->
      <div class="shrink-0 border-t p-4">
        <div class="flex gap-2">
          <input
            id="ai-drawer-input"
            v-model="input"
            class="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Ask Observe…"
            :disabled="isLoading || !isLoggedIn"
            @keydown="handleKeyPress"
          />
          <Button
            size="sm"
            :disabled="isLoading || !input.trim() || !isLoggedIn"
            @click="handleSend"
          >
            <Send class="h-3.5 w-3.5" />
          </Button>
        </div>
        <p v-if="!isLoggedIn" class="text-[11px] text-muted-foreground mt-2">
          Sign in to ask Observe.
        </p>
      </div>
    </div>
  </Sheet>
</template>
