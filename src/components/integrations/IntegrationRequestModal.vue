<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useQuery, useMutation } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { X, Plus, Loader2 } from "lucide-vue-next";
import { Button, Input } from "@/components/ui";
import { requestIntegration, getRequestableIntegrations } from "@/lib/api";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

// Fetch requestable integrations from API
const { data: requestableData } = useQuery({
  queryKey: ["requestable-integrations"],
  queryFn: getRequestableIntegrations,
  enabled: computed(() => props.open),
});

const integrations = computed(
  () =>
    requestableData.value?.integrations || {
      ai_llm: [],
      analytics: [],
      finance_ops: [],
    },
);

const email = ref("");
const selectedIntegrations = ref<string[]>([]);
const otherText = ref("");
const freeformNotes = ref("");

function resetForm() {
  email.value = "";
  selectedIntegrations.value = [];
  otherText.value = "";
  freeformNotes.value = "";
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      resetForm();
    }
  },
);

function toggleIntegration(provider: string) {
  const index = selectedIntegrations.value.indexOf(provider);
  if (index === -1) {
    selectedIntegrations.value.push(provider);
  } else {
    selectedIntegrations.value.splice(index, 1);
  }
}

const requestMutation = useMutation({
  mutationFn: requestIntegration,
  onSuccess: () => {
    toast.success("Request submitted!", {
      description: "We'll consider this for our roadmap.",
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
  if (!email.value) return;

  // Determine integration type - use first selected or "other"
  const integrationType =
    selectedIntegrations.value[0] || (otherText.value ? "other" : "unknown");

  requestMutation.mutate({
    email: email.value,
    integration_type: integrationType,
    category: "other",
    use_cases:
      selectedIntegrations.value.length > 1
        ? selectedIntegrations.value
        : undefined,
    other_description: otherText.value || undefined,
    freeform_notes: freeformNotes.value || undefined,
  });
}

function handleClose() {
  resetForm();
  emit("close");
}

const hasSelection = computed(
  () =>
    selectedIntegrations.value.length > 0 || otherText.value.trim().length > 0,
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      @click.self="handleClose"
    >
      <div
        class="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-lg border bg-card p-6 shadow-lg"
      >
        <!-- Header -->
        <div class="flex items-center justify-between mb-5">
          <div class="flex items-center gap-2">
            <Plus class="h-5 w-5 text-primary" />
            <h2 class="text-lg font-semibold">Request an integration</h2>
          </div>
          <Button variant="ghost" size="sm" @click="handleClose">
            <X class="h-4 w-4" />
          </Button>
        </div>

        <div class="space-y-6">
          <!-- AI / LLM Providers -->
          <div v-if="integrations.ai_llm?.length" class="space-y-3">
            <label class="text-sm font-medium text-muted-foreground"
              >AI / LLM Providers</label
            >
            <div class="grid grid-cols-2 gap-2">
              <label
                v-for="item in integrations.ai_llm"
                :key="item.provider"
                class="flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors"
                :class="
                  selectedIntegrations.includes(item.provider)
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                "
              >
                <input
                  type="checkbox"
                  :checked="selectedIntegrations.includes(item.provider)"
                  class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  @change="toggleIntegration(item.provider)"
                />
                <span class="text-sm">{{ item.name }}</span>
              </label>
            </div>
          </div>

          <!-- Analytics & Data -->
          <div v-if="integrations.analytics?.length" class="space-y-3">
            <label class="text-sm font-medium text-muted-foreground"
              >Analytics & Data</label
            >
            <div class="grid grid-cols-2 gap-2">
              <label
                v-for="item in integrations.analytics"
                :key="item.provider"
                class="flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors"
                :class="
                  selectedIntegrations.includes(item.provider)
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                "
              >
                <input
                  type="checkbox"
                  :checked="selectedIntegrations.includes(item.provider)"
                  class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  @change="toggleIntegration(item.provider)"
                />
                <span class="text-sm">{{ item.name }}</span>
              </label>
            </div>
          </div>

          <!-- Finance & Ops -->
          <div v-if="integrations.finance_ops?.length" class="space-y-3">
            <label class="text-sm font-medium text-muted-foreground"
              >Finance & Ops</label
            >
            <div class="grid grid-cols-2 gap-2">
              <label
                v-for="item in integrations.finance_ops"
                :key="item.provider"
                class="flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors"
                :class="
                  selectedIntegrations.includes(item.provider)
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                "
              >
                <input
                  type="checkbox"
                  :checked="selectedIntegrations.includes(item.provider)"
                  class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  @change="toggleIntegration(item.provider)"
                />
                <span class="text-sm">{{ item.name }}</span>
              </label>
            </div>
          </div>

          <!-- Other -->
          <div class="space-y-2">
            <label class="text-sm font-medium text-muted-foreground"
              >Other</label
            >
            <Input v-model="otherText" placeholder="Integration name..." />
          </div>

          <!-- What are you trying to see? -->
          <div class="space-y-2">
            <label class="text-sm font-medium"
              >What are you trying to see?</label
            >
            <textarea
              v-model="freeformNotes"
              rows="3"
              placeholder="Help us understand your use case..."
              class="w-full px-3 py-2 text-sm border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
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
              :disabled="
                !email || !hasSelection || requestMutation.isPending.value
              "
              @click="handleSubmit"
            >
              <Loader2
                v-if="requestMutation.isPending.value"
                class="h-4 w-4 mr-2 animate-spin"
              />
              Submit
            </Button>
            <Button variant="outline" @click="handleClose"> Cancel </Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
