<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import {
  Check,
  CreditCard,
  Upload,
  Rocket,
  Copy,
  ChevronLeft,
  ChevronRight,
  SkipForward,
  Loader2,
} from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import StripeApiKeyModal from "@/components/integrations/StripeApiKeyModal.vue";
import { getStripeStatus, syncStripeData } from "@/api/client";
import { uploadProviderCsv, createSdkKey } from "@/lib/api";
import type { StripeStatus, SyncResult } from "@/api/client";

const router = useRouter();

// ---------------------------------------------------------------------------
// Step management
// ---------------------------------------------------------------------------

const currentStep = ref(1);
const totalSteps = 3;

function goNext() {
  if (currentStep.value < totalSteps) currentStep.value++;
}

function goBack() {
  if (currentStep.value > 1) currentStep.value--;
}

// ---------------------------------------------------------------------------
// Step 1: Stripe
// ---------------------------------------------------------------------------

const stripeStatus = ref<StripeStatus | null>(null);
const stripeLoading = ref(false);
const showStripeModal = ref(false);
const syncResult = ref<SyncResult | null>(null);
const isSyncing = ref(false);

async function checkStripe() {
  stripeLoading.value = true;
  try {
    stripeStatus.value = await getStripeStatus();
    if (stripeStatus.value.connected && !syncResult.value) {
      isSyncing.value = true;
      syncResult.value = await syncStripeData();
    }
  } catch (error) {
    toast.error("Failed to check Stripe status", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    stripeLoading.value = false;
    isSyncing.value = false;
  }
}

async function handleStripeConnected() {
  showStripeModal.value = false;
  await checkStripe();
  toast.success("Stripe connected successfully");
}

// Check on mount
checkStripe();

const stripeConnected = computed(() => stripeStatus.value?.connected ?? false);

// ---------------------------------------------------------------------------
// Step 2: Provider CSV
// ---------------------------------------------------------------------------

const isUploadingCsv = ref(false);
const csvResult = ref<{
  provider: string;
  rows: number;
  models: string[];
} | null>(null);
const csvFileInput = ref<HTMLInputElement | null>(null);

async function handleCsvUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  isUploadingCsv.value = true;
  try {
    const rawCsv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });

    const result = await uploadProviderCsv(rawCsv);
    csvResult.value = result;
    toast.success(
      `Imported ${result.rows} rows from ${result.provider} (${result.models.join(", ")})`,
    );
  } catch (error) {
    toast.error("Failed to import provider CSV", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isUploadingCsv.value = false;
    if (input) input.value = "";
  }
}

// ---------------------------------------------------------------------------
// Step 3: Start observing
// ---------------------------------------------------------------------------

const proxyUrl =
  typeof window !== "undefined" ? `${window.location.origin}/v1` : "/v1";

const sdkKey = ref<string | null>(null);
const isGeneratingKey = ref(false);
const copiedProxy = ref(false);
const copiedSnippet = ref(false);

async function generateKey() {
  isGeneratingKey.value = true;
  try {
    const result = await createSdkKey("onboarding");
    sdkKey.value = result.key;
  } catch (error) {
    toast.error("Failed to generate SDK key", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isGeneratingKey.value = false;
  }
}

function copyToClipboard(text: string, which: "proxy" | "snippet") {
  navigator.clipboard.writeText(text);
  if (which === "proxy") {
    copiedProxy.value = true;
    setTimeout(() => (copiedProxy.value = false), 2000);
  } else {
    copiedSnippet.value = true;
    setTimeout(() => (copiedSnippet.value = false), 2000);
  }
  toast.success("Copied to clipboard");
}

const sdkSnippet = computed(() => {
  const key = sdkKey.value ?? "obs_your_api_key";
  return `import Anthropic from "@anthropic-ai/sdk";
import { withObserve } from "@anthropic-ai/sdk/observe";

const client = withObserve(new Anthropic(), {
  apiKey: "${key}",
  baseUrl: "${proxyUrl}",
});`;
});

function goToDashboard() {
  router.push("/");
}

// ---------------------------------------------------------------------------
// Step indicator state
// ---------------------------------------------------------------------------

const stepMeta = [
  { label: "Revenue", icon: CreditCard },
  { label: "Costs", icon: Upload },
  { label: "Observe", icon: Rocket },
];

function stepState(n: number): "completed" | "active" | "upcoming" {
  if (n < currentStep.value) return "completed";
  if (n === currentStep.value) return "active";
  return "upcoming";
}

const canContinue = computed(() => {
  if (currentStep.value === 1) return stripeConnected.value;
  if (currentStep.value === 2) return csvResult.value !== null;
  return true;
});
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
    <!-- Step indicator -->
    <div class="pt-12 pb-8 flex justify-center">
      <div class="flex items-center gap-0">
        <template v-for="(step, i) in stepMeta" :key="i">
          <!-- Connector line (before step, skip first) -->
          <div
            v-if="i > 0"
            class="w-16 h-0.5"
            :class="
              stepState(i + 1) === 'upcoming' ? 'bg-zinc-700' : 'bg-emerald-500'
            "
          />
          <!-- Circle -->
          <button
            class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-colors shrink-0"
            :class="{
              'bg-emerald-500 text-white': stepState(i + 1) === 'completed',
              'bg-zinc-100 text-zinc-900 ring-2 ring-emerald-500':
                stepState(i + 1) === 'active',
              'bg-zinc-800 text-zinc-400': stepState(i + 1) === 'upcoming',
            }"
            @click="stepState(i + 1) === 'completed' && (currentStep = i + 1)"
          >
            <Check v-if="stepState(i + 1) === 'completed'" class="w-5 h-5" />
            <span v-else>{{ i + 1 }}</span>
          </button>
        </template>
      </div>
    </div>

    <!-- Content area -->
    <div class="flex-1 flex items-start justify-center px-4 pb-24">
      <div class="w-full max-w-xl">
        <!-- Step 1: Connect Revenue -->
        <div v-if="currentStep === 1">
          <h1 class="text-2xl font-semibold mb-2">Connect Revenue</h1>
          <p class="text-zinc-400 mb-6">
            Connect your Stripe account so Observe can track MRR and customer
            data.
          </p>

          <Card class="bg-zinc-900 border-zinc-800">
            <CardContent class="p-6">
              <!-- Loading -->
              <div
                v-if="stripeLoading"
                class="flex items-center gap-3 text-zinc-400"
              >
                <Loader2 class="w-5 h-5 animate-spin" />
                Checking Stripe status...
              </div>

              <!-- Connected -->
              <div v-else-if="stripeConnected" class="space-y-4">
                <div class="flex items-center gap-3">
                  <div
                    class="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center"
                  >
                    <Check class="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <p class="font-medium">Stripe Connected</p>
                    <p class="text-sm text-zinc-400">
                      {{
                        stripeStatus?.account_name ?? stripeStatus?.account_id
                      }}
                    </p>
                  </div>
                </div>

                <div
                  v-if="syncResult"
                  class="grid grid-cols-2 gap-4 pt-2 border-t border-zinc-800"
                >
                  <div>
                    <p class="text-xs text-zinc-500 uppercase tracking-wider">
                      Customers
                    </p>
                    <p class="text-lg font-semibold">
                      {{ syncResult.total_customers.toLocaleString() }}
                    </p>
                  </div>
                  <div>
                    <p class="text-xs text-zinc-500 uppercase tracking-wider">
                      MRR
                    </p>
                    <p class="text-lg font-semibold">
                      ${{
                        (syncResult.subscriptions_synced > 0
                          ? syncResult.total_subscriptions
                          : 0
                        ).toLocaleString()
                      }}
                    </p>
                  </div>
                </div>

                <div
                  v-if="isSyncing"
                  class="flex items-center gap-2 text-sm text-zinc-400"
                >
                  <Loader2 class="w-4 h-4 animate-spin" />
                  Syncing data...
                </div>
              </div>

              <!-- Not connected -->
              <div v-else class="space-y-4">
                <p class="text-sm text-zinc-400">
                  Provide a Stripe restricted API key with read access to
                  customers, subscriptions, and invoices.
                </p>
                <Button class="w-full" @click="showStripeModal = true">
                  <CreditCard class="w-4 h-4 mr-2" />
                  Connect Stripe
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <!-- Step 2: Connect Costs -->
        <div v-if="currentStep === 2">
          <h1 class="text-2xl font-semibold mb-2">Connect Costs</h1>
          <p class="text-zinc-400 mb-6">
            Upload a CSV export from your AI provider (OpenAI, Anthropic, etc.)
            to import cost data.
          </p>

          <Card class="bg-zinc-900 border-zinc-800">
            <CardContent class="p-6">
              <!-- Upload result -->
              <div v-if="csvResult" class="space-y-4">
                <div class="flex items-center gap-3">
                  <div
                    class="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center"
                  >
                    <Check class="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <p class="font-medium">CSV Imported</p>
                    <p class="text-sm text-zinc-400">
                      {{ csvResult.provider }} detected
                    </p>
                  </div>
                </div>

                <div
                  class="grid grid-cols-2 gap-4 pt-2 border-t border-zinc-800"
                >
                  <div>
                    <p class="text-xs text-zinc-500 uppercase tracking-wider">
                      Rows
                    </p>
                    <p class="text-lg font-semibold">
                      {{ csvResult.rows.toLocaleString() }}
                    </p>
                  </div>
                  <div>
                    <p class="text-xs text-zinc-500 uppercase tracking-wider">
                      Models
                    </p>
                    <p class="text-lg font-semibold">
                      {{ csvResult.models.length }}
                    </p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  class="w-full"
                  @click="csvResult = null"
                >
                  Upload Different File
                </Button>
              </div>

              <!-- Upload form -->
              <div v-else class="space-y-4">
                <p class="text-sm text-zinc-400">
                  Export your usage CSV from your provider's billing dashboard
                  and upload it here.
                </p>
                <input
                  ref="csvFileInput"
                  type="file"
                  accept=".csv"
                  class="hidden"
                  @change="handleCsvUpload"
                />
                <Button
                  class="w-full"
                  :disabled="isUploadingCsv"
                  @click="csvFileInput?.click()"
                >
                  <Loader2
                    v-if="isUploadingCsv"
                    class="w-4 h-4 mr-2 animate-spin"
                  />
                  <Upload v-else class="w-4 h-4 mr-2" />
                  {{ isUploadingCsv ? "Uploading..." : "Upload Provider CSV" }}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <!-- Step 3: Start Observing -->
        <div v-if="currentStep === 3">
          <h1 class="text-2xl font-semibold mb-2">Start Observing</h1>
          <p class="text-zinc-400 mb-6">
            Route your AI traffic through the Observe proxy or use the SDK to
            track costs per feature and customer.
          </p>

          <div class="space-y-4">
            <!-- Proxy URL -->
            <Card class="bg-zinc-900 border-zinc-800">
              <CardContent class="p-6 space-y-3">
                <p class="text-sm font-medium text-zinc-300">Proxy URL</p>
                <div class="flex items-center gap-2">
                  <code
                    class="flex-1 bg-zinc-800 rounded px-3 py-2 text-sm font-mono text-emerald-400 truncate"
                  >
                    {{ proxyUrl }}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    @click="copyToClipboard(proxyUrl, 'proxy')"
                  >
                    <Check v-if="copiedProxy" class="w-4 h-4" />
                    <Copy v-else class="w-4 h-4" />
                  </Button>
                </div>
                <p class="text-xs text-zinc-500">
                  Point your OpenAI or Anthropic SDK base URL here.
                </p>
              </CardContent>
            </Card>

            <!-- SDK snippet -->
            <Card class="bg-zinc-900 border-zinc-800">
              <CardContent class="p-6 space-y-3">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-medium text-zinc-300">SDK Snippet</p>
                  <Button
                    v-if="!sdkKey"
                    variant="outline"
                    size="sm"
                    :disabled="isGeneratingKey"
                    @click="generateKey"
                  >
                    <Loader2
                      v-if="isGeneratingKey"
                      class="w-3 h-3 mr-1 animate-spin"
                    />
                    Generate API Key
                  </Button>
                </div>
                <div class="relative">
                  <pre
                    class="bg-zinc-800 rounded px-3 py-3 text-xs font-mono text-zinc-300 overflow-x-auto whitespace-pre"
                    >{{ sdkSnippet }}</pre
                  >
                  <Button
                    variant="outline"
                    size="sm"
                    class="absolute top-2 right-2"
                    @click="copyToClipboard(sdkSnippet, 'snippet')"
                  >
                    <Check v-if="copiedSnippet" class="w-4 h-4" />
                    <Copy v-else class="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <!-- Go to dashboard -->
            <Button class="w-full" size="lg" @click="goToDashboard">
              <Rocket class="w-4 h-4 mr-2" />
              Go to Dashboard
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom navigation -->
    <div
      class="fixed bottom-0 left-0 right-0 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur px-6 py-4"
    >
      <div class="max-w-xl mx-auto flex items-center justify-between">
        <Button v-if="currentStep > 1" variant="outline" @click="goBack">
          <ChevronLeft class="w-4 h-4 mr-1" />
          Back
        </Button>
        <div v-else />

        <div class="flex items-center gap-3">
          <Button
            v-if="currentStep < totalSteps"
            variant="ghost"
            class="text-zinc-400"
            @click="goNext"
          >
            <SkipForward class="w-4 h-4 mr-1" />
            Skip
          </Button>
          <Button
            v-if="currentStep < totalSteps"
            :disabled="!canContinue"
            @click="goNext"
          >
            Continue
            <ChevronRight class="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>

    <!-- Stripe modal -->
    <StripeApiKeyModal
      :open="showStripeModal"
      @close="showStripeModal = false"
      @connected="handleStripeConnected"
    />
  </div>
</template>
