<script setup lang="ts">
import { ref } from "vue";
import { toast } from "vue-sonner";
import { X, Sparkles, MessageSquare } from "lucide-vue-next";
import { Button } from "@/components/ui";
import { submitFeedback } from "@/lib/api";

defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "credited", amount: number): void;
}>();

const message = ref("");
const isSubmitting = ref(false);

async function handleSubmit() {
  if (message.value.trim().length < 10) {
    toast.error("Please write at least 10 characters");
    return;
  }
  isSubmitting.value = true;
  try {
    const result = await submitFeedback(message.value);
    window.posthog?.capture("feedback_submitted", {
      credits_granted: result.granted,
    });
    toast.success(`Thanks! You earned ${result.granted} bonus events`);
    emit("credited", result.granted);
    emit("close");
    message.value = "";
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Failed to submit feedback";
    if (msg.includes("already claimed")) {
      toast.error("You've already earned feedback credits this month");
    } else {
      toast.error(msg);
    }
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      @click.self="emit('close')"
    >
      <div
        class="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg space-y-4"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <MessageSquare class="h-4 w-4" />
            <h3 class="font-semibold">Give Feedback</h3>
          </div>
          <button
            class="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            @click="emit('close')"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <div
          class="flex items-center gap-2 text-xs bg-primary/5 border border-primary/20 rounded-md px-3 py-2"
        >
          <Sparkles class="h-3 w-3 text-primary shrink-0" />
          <span
            >Earn <strong>1,000 bonus events</strong> for your feedback</span
          >
        </div>

        <div class="space-y-1">
          <textarea
            v-model="message"
            placeholder="What's working? What could be better? Feature requests?"
            class="w-full h-28 rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p
            v-if="message.length > 0 && message.trim().length < 10"
            class="text-xs text-muted-foreground"
          >
            At least 10 characters required
          </p>
        </div>

        <div class="flex justify-end gap-2">
          <Button variant="outline" size="sm" @click="emit('close')">
            Cancel
          </Button>
          <Button
            size="sm"
            :disabled="isSubmitting || message.trim().length < 10"
            @click="handleSubmit"
          >
            {{ isSubmitting ? "Submitting..." : "Submit Feedback" }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
