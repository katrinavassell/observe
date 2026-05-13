<script setup lang="ts">
/**
 * Reusable button row for a recommendation card.
 *
 * Surfaces three actions:
 *   - Primary: "Talk to us about implementing this →" (emits `talk-to-us`)
 *   - Outline: "Apply" — POST /recommendations/:id/apply
 *   - Ghost:   "Dismiss" — POST /recommendations/:id/dismiss (confirmed)
 *
 * The component owns the optimistic mutation + cache invalidation. Parent
 * components only need to listen for the `talk-to-us` event to open the
 * contact form (TansoPlatformContactForm).
 */
import { ref } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { ArrowRight, Check, X } from "lucide-vue-next";
import {
  type Recommendation,
  applyRecommendation,
  dismissRecommendation,
} from "@/lib/api/recommendations";
import Button from "@/components/ui/button.vue";
import ConfirmDialog from "@/components/ui/confirm-dialog.vue";

defineProps<{
  recommendation: Recommendation;
}>();

const emit = defineEmits<{
  "talk-to-us": [rec: Recommendation];
  applied: [rec: Recommendation];
  dismissed: [rec: Recommendation];
}>();

const queryClient = useQueryClient();
const confirmDismiss = ref(false);

const applyMutation = useMutation({
  mutationFn: (rec: Recommendation) => applyRecommendation(rec.id),
  onSuccess: (_data, rec) => {
    toast.success("Applied", {
      description: "Recovery will show in your next margin update.",
    });
    queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    emit("applied", rec);
  },
  onError: (err) => {
    toast.error("Could not apply recommendation", {
      description: err instanceof Error ? err.message : "Try again in a moment.",
    });
  },
});

const dismissMutation = useMutation({
  mutationFn: (rec: Recommendation) => dismissRecommendation(rec.id),
  onSuccess: (_data, rec) => {
    toast.success("Dismissed", {
      description: "We won't suggest this again for 30 days.",
    });
    queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    emit("dismissed", rec);
  },
  onError: (err) => {
    toast.error("Could not dismiss recommendation", {
      description: err instanceof Error ? err.message : "Try again in a moment.",
    });
  },
});

function onTalkToUs(rec: Recommendation) {
  emit("talk-to-us", rec);
}
</script>

<template>
  <div class="flex flex-wrap items-center justify-end gap-2">
    <Button
      variant="default"
      size="sm"
      @click="onTalkToUs(recommendation)"
    >
      Talk to us about implementing this
      <ArrowRight class="ml-1.5 h-3.5 w-3.5" />
    </Button>

    <Button
      variant="outline"
      size="sm"
      :loading="applyMutation.isPending.value"
      :disabled="applyMutation.isPending.value || dismissMutation.isPending.value"
      @click="applyMutation.mutate(recommendation)"
    >
      <Check class="mr-1.5 h-3.5 w-3.5" />
      Apply
    </Button>

    <Button
      variant="ghost"
      size="sm"
      :disabled="applyMutation.isPending.value || dismissMutation.isPending.value"
      @click="confirmDismiss = true"
    >
      <X class="mr-1.5 h-3.5 w-3.5" />
      Dismiss
    </Button>

    <ConfirmDialog
      :open="confirmDismiss"
      title="Dismiss this recommendation?"
      description="You can recompute recommendations from the dashboard any time. We won't suggest this exact fix again for 30 days."
      cancel-text="Keep it"
      confirm-text="Dismiss"
      @cancel="confirmDismiss = false"
      @confirm="
        confirmDismiss = false;
        dismissMutation.mutate(recommendation);
      "
    />
  </div>
</template>
