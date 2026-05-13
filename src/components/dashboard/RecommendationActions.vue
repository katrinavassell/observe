<script setup lang="ts">
import { ref } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { ThumbsUp, ThumbsDown } from "lucide-vue-next";
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
  applied: [rec: Recommendation];
  dismissed: [rec: Recommendation];
}>();

const queryClient = useQueryClient();
const confirmDismiss = ref(false);

const applyMutation = useMutation({
  mutationFn: (rec: Recommendation) => applyRecommendation(rec.id),
  onSuccess: (_data, rec) => {
    toast.success("Marked helpful", {
      description: "Thanks — this helps us improve recommendations.",
    });
    queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    emit("applied", rec);
  },
  onError: (err) => {
    toast.error("Could not save feedback", {
      description:
        err instanceof Error ? err.message : "Try again in a moment.",
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
      description:
        err instanceof Error ? err.message : "Try again in a moment.",
    });
  },
});
</script>

<template>
  <div class="flex flex-wrap items-center justify-end gap-2">
    <Button
      variant="outline"
      size="sm"
      :loading="applyMutation.isPending.value"
      :disabled="
        applyMutation.isPending.value || dismissMutation.isPending.value
      "
      @click="applyMutation.mutate(recommendation)"
    >
      <ThumbsUp class="mr-1.5 h-3.5 w-3.5" />
      Helpful
    </Button>

    <Button
      variant="ghost"
      size="sm"
      :disabled="
        applyMutation.isPending.value || dismissMutation.isPending.value
      "
      @click="confirmDismiss = true"
    >
      <ThumbsDown class="mr-1.5 h-3.5 w-3.5" />
      Not useful
    </Button>

    <ConfirmDialog
      :open="confirmDismiss"
      title="Mark as not useful?"
      description="We'll use this to improve future recommendations. You can recompute from the dashboard any time."
      cancel-text="Keep it"
      confirm-text="Not useful"
      @cancel="confirmDismiss = false"
      @confirm="
        confirmDismiss = false;
        dismissMutation.mutate(recommendation);
      "
    />
  </div>
</template>
