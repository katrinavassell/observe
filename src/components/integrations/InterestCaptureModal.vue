<script setup lang="ts">
import { ref, computed } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { X, Bell, Loader2 } from "lucide-vue-next";
import { Button, Input } from "@/components/ui";
import { requestIntegration } from "@/lib/api";
import type { ComingSoonIntegration } from "@/lib/api";

const props = defineProps<{
  integration: ComingSoonIntegration | null;
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const email = ref("");
const selectedUseCases = ref<string[]>([]);
const otherChecked = ref(false);
const otherText = ref("");

// Reset form when modal opens with new integration
function resetForm() {
  email.value = "";
  selectedUseCases.value = [];
  otherChecked.value = false;
  otherText.value = "";
}

const useCases = computed(() => props.integration?.use_cases || []);

function toggleUseCase(useCase: string) {
  const index = selectedUseCases.value.indexOf(useCase);
  if (index === -1) {
    selectedUseCases.value.push(useCase);
  } else {
    selectedUseCases.value.splice(index, 1);
  }
}

const requestMutation = useMutation({
  mutationFn: requestIntegration,
  onSuccess: () => {
    toast.success("You're on the list!", {
      description: `We'll notify you when ${props.integration?.name} is available.`,
    });
    resetForm();
    emit("close");
  },
  onError: (error) => {
    toast.error("Failed to submit", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  },
});

function handleSubmit() {
  if (!email.value || !props.integration) return;

  const allUseCases = [...selectedUseCases.value];
  if (otherChecked.value && otherText.value.trim()) {
    allUseCases.push(`Other: ${otherText.value.trim()}`);
  }

  requestMutation.mutate({
    email: email.value,
    integration_type: props.integration.provider,
    category: props.integration.category,
    use_cases: allUseCases.length > 0 ? allUseCases : undefined,
    other_description: otherChecked.value ? otherText.value : undefined,
  });
}

function handleClose() {
  resetForm();
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && integration"
      class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      @click.self="handleClose"
    >
      <div class="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <!-- Header -->
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <Bell class="h-5 w-5 text-primary" />
            <h2 class="text-lg font-semibold">
              Get notified when {{ integration.name }} is ready
            </h2>
          </div>
          <Button variant="ghost" size="sm" @click="handleClose">
            <X class="h-4 w-4" />
          </Button>
        </div>

        <div class="space-y-5">
          <!-- Use Cases -->
          <div v-if="useCases.length > 0" class="space-y-3">
            <label class="text-sm font-medium"
              >What would you use it for?</label
            >
            <div class="space-y-2">
              <label
                v-for="useCase in useCases"
                :key="useCase"
                class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                :class="
                  selectedUseCases.includes(useCase)
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                "
              >
                <input
                  type="checkbox"
                  :checked="selectedUseCases.includes(useCase)"
                  class="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  @change="toggleUseCase(useCase)"
                />
                <span class="text-sm">{{ useCase }}</span>
              </label>

              <!-- Other option -->
              <label
                class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                :class="
                  otherChecked
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                "
              >
                <input
                  v-model="otherChecked"
                  type="checkbox"
                  class="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <div class="flex-1 space-y-2">
                  <span class="text-sm">Other</span>
                  <Input
                    v-if="otherChecked"
                    v-model="otherText"
                    placeholder="Tell us more..."
                    class="mt-2"
                    @click.stop
                  />
                </div>
              </label>
            </div>
          </div>

          <!-- Email -->
          <div class="space-y-2">
            <label class="text-sm font-medium">Email</label>
            <Input v-model="email" type="email" placeholder="you@company.com" />
          </div>

          <!-- Submit -->
          <div class="flex gap-2 pt-2">
            <Button
              class="flex-1"
              :disabled="!email || requestMutation.isPending.value"
              @click="handleSubmit"
            >
              <Loader2
                v-if="requestMutation.isPending.value"
                class="h-4 w-4 mr-2 animate-spin"
              />
              Notify Me
            </Button>
            <Button variant="outline" @click="handleClose"> Cancel </Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
