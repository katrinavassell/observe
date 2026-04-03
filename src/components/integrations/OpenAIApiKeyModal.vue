<script setup lang="ts">
/**
 * OpenAIApiKeyModal - Connect OpenAI to sync usage costs
 *
 * Uses the OpenAI Usage API to fetch cost data.
 * Requires an API key with organization admin access for usage data.
 */
import { ref, computed } from "vue";
import { toast } from "vue-sonner";
import {
  X,
  Key,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  DollarSign,
  Zap,
} from "lucide-vue-next";
import { Button, Input } from "@/components/ui";
import { connectOpenAI } from "@/api/client";

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  connected: [provider: string];
}>();

const apiKey = ref("");
const showKey = ref(false);
const isConnecting = ref(false);

const isKeyValid = computed(() => {
  const key = apiKey.value.trim();
  // OpenAI keys start with 'sk-'
  return key.startsWith("sk-") && key.length > 20;
});

function resetForm() {
  apiKey.value = "";
  showKey.value = false;
}

async function handleSubmit() {
  if (!apiKey.value.trim()) return;

  const key = apiKey.value.trim();

  // Validate key format
  if (!key.startsWith("sk-")) {
    toast.error("Invalid API key format", {
      description: "OpenAI API keys should start with sk-",
    });
    return;
  }

  isConnecting.value = true;

  try {
    const result = await connectOpenAI(key);

    if (result.success) {
      window.posthog?.capture("openai_connected");
      toast.success("OpenAI connected!", {
        description: result.has_usage_access
          ? `Synced $${result.cost_synced.toFixed(2)} in costs.`
          : "Usage data requires org admin access.",
      });

      resetForm();
      emit("connected", "openai");
      emit("close");
    } else {
      toast.error("Failed to connect", {
        description: result.message,
      });
    }
  } catch (error) {
    toast.error("Failed to connect", {
      description: error instanceof Error ? error.message : "Invalid API key",
    });
  } finally {
    isConnecting.value = false;
  }
}

function handleClose() {
  resetForm();
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      @click.self="handleClose"
    >
      <div class="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <!-- Header -->
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <div
              class="h-8 w-8 rounded-lg bg-black flex items-center justify-center"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="white">
                <path
                  d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"
                />
              </svg>
            </div>
            <h2 class="text-lg font-semibold">Connect OpenAI</h2>
          </div>
          <Button variant="ghost" size="sm" @click="handleClose">
            <X class="h-4 w-4" />
          </Button>
        </div>

        <div class="space-y-4">
          <!-- What we'll sync -->
          <div class="grid grid-cols-2 gap-2">
            <div
              class="flex items-center gap-2 rounded-md border bg-muted/30 p-2.5"
            >
              <DollarSign class="h-4 w-4 text-primary" />
              <div>
                <p class="text-sm font-medium">Usage Costs</p>
                <p class="text-xs text-muted-foreground">Monthly spend</p>
              </div>
            </div>
            <div
              class="flex items-center gap-2 rounded-md border bg-muted/30 p-2.5"
            >
              <Zap class="h-4 w-4 text-primary" />
              <div>
                <p class="text-sm font-medium">Token Usage</p>
                <p class="text-xs text-muted-foreground">By model</p>
              </div>
            </div>
          </div>

          <!-- Instructions -->
          <div class="text-sm text-muted-foreground">
            <p>Enter your OpenAI API key to automatically sync usage costs.</p>
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 text-primary hover:underline mt-1"
            >
              Get your API key from OpenAI Platform
              <ExternalLink class="h-3 w-3" />
            </a>
          </div>

          <!-- API Key Input -->
          <div class="space-y-2">
            <label class="text-sm font-medium">API Key</label>
            <div class="relative">
              <Input
                v-model="apiKey"
                :type="showKey ? 'text' : 'password'"
                placeholder="sk-..."
                :class="`pr-10 font-mono text-sm ${apiKey.trim() && isKeyValid ? 'border-success/50' : ''}`"
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                @click="showKey = !showKey"
              >
                <Eye v-if="!showKey" class="h-4 w-4" />
                <EyeOff v-else class="h-4 w-4" />
              </button>
            </div>
            <p class="text-xs text-muted-foreground">
              Your key is encrypted and stored securely.
            </p>
          </div>

          <!-- Submit -->
          <div class="flex gap-2 pt-2">
            <Button
              class="flex-1"
              :disabled="!apiKey.trim() || !isKeyValid || isConnecting"
              @click="handleSubmit"
            >
              <Loader2 v-if="isConnecting" class="h-4 w-4 mr-2 animate-spin" />
              <Key v-else class="h-4 w-4 mr-2" />
              Connect
            </Button>
            <Button variant="outline" @click="handleClose"> Cancel </Button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
