<script setup lang="ts">
/**
 * DataSourcesPage - Main data sources configuration page.
 *
 * Orchestrates the data import flow:
 * - Sample data loading (all sections at once)
 * - Individual section management (revenue, costs, usage)
 * - Progress tracking and navigation
 * - Unsaved changes confirmation
 */

import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import {
  TrendingUp,
  Eye,
  Key,
  Copy,
  Trash2,
  Plus,
  CreditCard,
  RefreshCw,
  Loader2,
  Unplug,
} from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import { CostsSection, UsageSection } from "@/components/data-sources";
import StripeApiKeyModal from "@/components/integrations/StripeApiKeyModal.vue";
import { useDataMode } from "@/composables/useDataMode";
import { useTeam } from "@/composables/useTeam";
import {
  clearCostData,
  clearUsageData,
  createSdkKey,
  listSdkKeys,
  revokeSdkKey,
  resetSdkKey,
  listFeaturePricing,
  upsertFeaturePricing,
  deleteFeaturePricing,
  listFeatureKeys,
} from "@/lib/api";
import {
  getStripeStatus,
  syncStripeData,
  disconnectStripe,
} from "@/api/client";
import type { SdkKey, FeaturePricingRule } from "@/lib/api";
import type { StripeStatus } from "@/api/client";

const router = useRouter();
const { isViewer } = useTeam();

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

const {
  dataMode,
  refetch: refetchDataMode,
  hasRevenue,
  hasCosts,
  hasUsage,
  lastSyncAt,
} = useDataMode();

/** Track file state for each section */
const costsFile = ref<{ name: string; isSample: boolean } | null>(null);
const usageFile = ref<{ name: string; isSample: boolean } | null>(null);

const ingestUrl =
  typeof window !== "undefined"
    ? `${window.location.origin}/api/events/ingest`
    : "/api/events/ingest";
const proxyBaseUrl =
  typeof window !== "undefined" ? `${window.location.origin}/v1` : "/v1";

/** Integration mode toggle */
const integrationTab = ref<"sdk" | "proxy">("sdk");

/** SDK API Key state */
const sdkKeys = ref<SdkKey[]>([]);
const showKeyGenerator = ref(false);
const newKeyName = ref("");
const isGeneratingKey = ref(false);
const generatedKey = ref<string | null>(null);
const keyCopied = ref(false);

async function loadSdkKeys() {
  try {
    sdkKeys.value = await listSdkKeys();
  } catch {
    // silently fail - keys list is not critical
  }
}

async function handleGenerateKey() {
  isGeneratingKey.value = true;
  try {
    const result = await createSdkKey(newKeyName.value || undefined);
    generatedKey.value = result.key;
    newKeyName.value = "";
    await loadSdkKeys();
  } catch (error) {
    toast.error("Failed to generate API key", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isGeneratingKey.value = false;
  }
}

async function handleRevokeKey(id: number) {
  try {
    await revokeSdkKey(id);
    sdkKeys.value = sdkKeys.value.filter((k) => k.id !== id);
    toast.success("API key revoked");
  } catch (error) {
    toast.error("Failed to revoke key", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }
}

function copyKeyToClipboard() {
  if (!generatedKey.value) return;
  navigator.clipboard.writeText(generatedKey.value);
  keyCopied.value = true;
  setTimeout(() => {
    keyCopied.value = false;
  }, 2000);
}

const apiKeyForSnippet = computed(() => {
  if (sdkKeys.value.length > 0) {
    return sdkKeys.value[0].full_key || sdkKeys.value[0].key_prefix + "...";
  }
  return "YOUR_API_KEY";
});

async function handleResetKey(id: number) {
  if (
    !confirm("Reset this API key? The old key will stop working immediately.")
  )
    return;
  try {
    await resetSdkKey(id);
    await loadSdkKeys();
    toast.success("API key reset");
  } catch (error) {
    toast.error("Failed to reset key", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }
}

const keyCopiedId = ref<number | null>(null);
const revealedKeyId = ref<number | null>(null);
function copyFullKey(key: SdkKey) {
  const text = key.full_key || key.key_prefix + "...";
  navigator.clipboard.writeText(text);
  keyCopiedId.value = key.id;
  toast.success("API key copied");
  setTimeout(() => {
    keyCopiedId.value = null;
  }, 2000);
}

const snippetCopied = ref(false);
const curlCopied = ref(false);
function copyCurl() {
  const apiKey = apiKeyForSnippet.value;
  const curl = `curl -X POST '${ingestUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${apiKey}' \\
  -d '{"events":[{"eventName":"chat_completion","customerReferenceId":"cus_test_123","featureKey":"ai_summarization","model":"gpt-4o","inputTokens":500,"outputTokens":100}]}'`;
  navigator.clipboard.writeText(curl);
  curlCopied.value = true;
  setTimeout(() => {
    curlCopied.value = false;
  }, 2000);
}
function copySnippet() {
  const apiKey = apiKeyForSnippet.value;
  const snippet = `await fetch('${ingestUrl}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json',
             'Authorization': 'Bearer ${apiKey}' },
  body: JSON.stringify({ events: [{
    eventName: 'chat_completion',
    customerReferenceId: userId,
    featureKey: 'ai_summarization',
    model: 'gpt-4o',
    inputTokens: response.usage.prompt_tokens,
    outputTokens: response.usage.completion_tokens,
  }]})
})`;
  navigator.clipboard.writeText(snippet);
  snippetCopied.value = true;
  setTimeout(() => {
    snippetCopied.value = false;
  }, 2000);
}

function dismissGeneratedKey() {
  generatedKey.value = null;
  showKeyGenerator.value = false;
}

/** Stripe connection state */
const showStripeModal = ref(false);
const stripeStatus = ref<StripeStatus>({
  connected: false,
  account_id: null,
  account_name: null,
});
const isSyncingStripe = ref(false);
const isDisconnectingStripe = ref(false);

async function loadStripeStatus() {
  try {
    stripeStatus.value = await getStripeStatus();
  } catch {
    // silently fail
  }
}

async function handleStripeConnected() {
  await loadStripeStatus();
  await refetchDataMode();
}

async function handleStripeSync() {
  isSyncingStripe.value = true;
  try {
    await syncStripeData();
    await loadStripeStatus();
    await refetchDataMode();
    toast.success("Stripe data synced");
  } catch (error) {
    toast.error("Failed to sync Stripe data", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isSyncingStripe.value = false;
  }
}

async function handleStripeDisconnect() {
  isDisconnectingStripe.value = true;
  try {
    await disconnectStripe(true);
    stripeStatus.value = {
      connected: false,
      account_id: null,
      account_name: null,
    };
    await refetchDataMode();
    toast.success("Stripe disconnected");
  } catch (error) {
    toast.error("Failed to disconnect Stripe", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isDisconnectingStripe.value = false;
  }
}

// =============================================================================
// FEATURE PRICING
// =============================================================================

const featurePricingRules = ref<FeaturePricingRule[]>([]);
const availableFeatureKeys = ref<string[]>([]);
const showAddPricing = ref(false);
const newPricingFeature = ref("");
const newPricingRevenue = ref<number | "">("");
const newPricingUnit = ref("call");
const isSavingPricing = ref(false);

async function loadFeaturePricing() {
  try {
    featurePricingRules.value = await listFeaturePricing();
  } catch {
    // Non-critical
  }
}

async function loadFeatureKeys() {
  try {
    availableFeatureKeys.value = await listFeatureKeys();
  } catch {
    // Non-critical
  }
}

async function _handleSaveFeaturePricing() {
  if (!newPricingFeature.value || newPricingRevenue.value === "") return;
  isSavingPricing.value = true;
  try {
    await upsertFeaturePricing(
      newPricingFeature.value,
      Number(newPricingRevenue.value),
      newPricingUnit.value,
    );
    await loadFeaturePricing();
    newPricingFeature.value = "";
    newPricingRevenue.value = "";
    newPricingUnit.value = "call";
    showAddPricing.value = false;
    toast.success("Feature pricing saved");
  } catch (error) {
    toast.error("Failed to save feature pricing", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isSavingPricing.value = false;
  }
}

async function _handleDeleteFeaturePricing(featureKey: string) {
  try {
    await deleteFeaturePricing(featureKey);
    featurePricingRules.value = featurePricingRules.value.filter(
      (r) => r.feature_key !== featureKey,
    );
    toast.success("Feature pricing removed");
  } catch (error) {
    toast.error("Failed to remove feature pricing", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }
}

onMounted(async () => {
  await Promise.all([
    loadSdkKeys(),
    loadStripeStatus(),
    loadFeaturePricing(),
    loadFeatureKeys(),
  ]);
});

// =============================================================================
// FILE CHANGE HANDLERS
// =============================================================================

async function handleCostsFileUploaded(file: {
  name: string;
  isSample: boolean;
}): Promise<void> {
  costsFile.value = file;
  await refetchDataMode();
}

async function handleCostsFileCleared(): Promise<void> {
  costsFile.value = null;
  try {
    await clearCostData();
    await refetchDataMode();
    toast.success("Cost data cleared");
  } catch (error) {
    toast.error("Failed to clear cost data", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }
}

async function handleUsageFileUploaded(file: {
  name: string;
  isSample: boolean;
}): Promise<void> {
  usageFile.value = file;
  await refetchDataMode();
}

async function handleUsageFileCleared(): Promise<void> {
  usageFile.value = null;
  try {
    await clearUsageData();
    await refetchDataMode();
    toast.success("Usage data cleared");
  } catch (error) {
    toast.error("Failed to clear usage data", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }
}

// =============================================================================
// DATA RESTORATION
// =============================================================================

// Restore file display state when returning to page with existing data
watch(
  [hasRevenue, hasCosts, hasUsage, () => dataMode.value],
  ([_hasRev, hasCst, hasUsg, mode]) => {
    if (mode === "sample") {
      if (hasCst && !costsFile.value) {
        costsFile.value = { name: "sample-costs.csv", isSample: true };
      }
      if (hasUsg && !usageFile.value) {
        usageFile.value = { name: "sample-usage.csv", isSample: true };
      }
    } else if (mode === "user") {
      if (hasCst && !costsFile.value) {
        costsFile.value = { name: "costs.csv", isSample: false };
      }
      if (hasUsg && !usageFile.value) {
        usageFile.value = { name: "usage.csv", isSample: false };
      }
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="space-y-6 pb-12">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Data Sources</h1>
      <p class="text-muted-foreground">
        Track AI costs per customer, feature, and model
      </p>
    </div>

    <!-- Viewer notice -->
    <div
      v-if="isViewer"
      class="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground"
    >
      <Eye class="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <strong>Viewer access</strong> -You can see your team's data but cannot
        upload, modify, or clear data. Contact your team admin to make changes.
      </div>
    </div>

    <!-- SECTION: Live Tracking -->
    <div class="space-y-1">
      <h2
        class="text-sm font-semibold text-muted-foreground uppercase tracking-wider"
      >
        Live Tracking
      </h2>
      <p class="text-sm text-muted-foreground">
        Track AI costs and revenue per customer, feature, and model in
        real-time.
      </p>
    </div>

    <!-- SDK Integration Section -PRIMARY integration, shown first -->
    <Card v-if="true" class="border-success/20">
      <CardContent class="p-6 space-y-5">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <div
              class="flex items-center justify-center w-8 h-8 rounded-lg bg-success/10 text-success text-xs font-bold"
            >
              {}
            </div>
            <h2 class="font-semibold">Integration</h2>
            <span
              class="ml-auto text-[10px] font-medium bg-success/10 text-success px-2 py-0.5 rounded-full"
              >Observe-only</span
            >
          </div>
          <p class="text-sm text-muted-foreground">
            Track AI costs automatically. No billing changes required.
          </p>
        </div>

        <!-- When to use which -->
        <div
          class="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1"
        >
          <div>
            <strong class="text-foreground">SDK Events</strong> -Best when you
            want full control. Send events after each AI call with custom cost,
            revenue, and metadata. Works with any provider or model.
          </div>
          <div>
            <strong class="text-foreground">Proxy Mode</strong> -Best for
            zero-effort setup. Change one URL and cost is captured
            automatically. Limited to OpenAI and Anthropic APIs.
          </div>
        </div>

        <!-- Integration mode toggle -->
        <div class="flex rounded-lg bg-muted p-1 w-fit">
          <button
            :class="[
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              integrationTab === 'sdk'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            ]"
            @click="integrationTab = 'sdk'"
          >
            SDK Events
          </button>
          <button
            :class="[
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              integrationTab === 'proxy'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            ]"
            @click="integrationTab = 'proxy'"
          >
            Proxy Mode
          </button>
        </div>

        <!-- ============ SDK Events Tab ============ -->
        <template v-if="integrationTab === 'sdk'">
          <!-- API Key Management -->
          <div v-if="!isViewer">
            <div class="flex items-center justify-between mb-2">
              <h3
                class="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                API Keys
              </h3>
              <Button
                v-if="!showKeyGenerator && !generatedKey"
                variant="outline"
                size="sm"
                class="h-7 text-xs"
                @click="showKeyGenerator = true"
              >
                <Plus class="h-3 w-3 mr-1" />
                Generate API Key
              </Button>
            </div>

            <!-- Key generator inline UI -->
            <div
              v-if="showKeyGenerator && !generatedKey"
              class="rounded-lg border bg-muted/30 p-4 mb-3 space-y-3"
            >
              <div class="flex gap-2">
                <input
                  v-model="newKeyName"
                  type="text"
                  placeholder="Key name (optional, e.g. 'production')"
                  class="flex-1 h-8 rounded-md border bg-background px-3 text-sm"
                  @keydown.enter="handleGenerateKey"
                />
                <Button
                  size="sm"
                  class="h-8"
                  :disabled="isGeneratingKey"
                  @click="handleGenerateKey"
                >
                  <Key class="h-3 w-3 mr-1" />
                  {{ isGeneratingKey ? "Generating..." : "Generate" }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-8"
                  @click="showKeyGenerator = false"
                  >Cancel</Button
                >
              </div>
            </div>

            <!-- Generated key display (show once) -->
            <div
              v-if="generatedKey"
              class="rounded-lg border bg-muted/40 p-4 mb-3 space-y-2"
            >
              <div
                class="flex items-center gap-2 text-xs font-medium text-success"
              >
                <Key class="h-3 w-3" />
                Key generated successfully
              </div>
              <div class="flex items-center gap-2">
                <code
                  class="flex-1 text-xs font-mono bg-background border rounded px-3 py-2 select-all break-all"
                  >{{ generatedKey }}</code
                >
                <Button
                  variant="outline"
                  size="sm"
                  class="h-8 shrink-0"
                  @click="copyKeyToClipboard"
                >
                  <Copy class="h-3 w-3 mr-1" />
                  {{ keyCopied ? "Copied!" : "Copy" }}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 text-xs"
                @click="dismissGeneratedKey"
                >Done</Button
              >
            </div>

            <!-- Existing keys list -->
            <div v-if="sdkKeys.length > 0" class="space-y-1.5 mb-3">
              <div
                v-for="key in sdkKeys"
                :key="key.id"
                class="rounded-md border bg-card px-3 py-2 text-xs space-y-1.5"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <span v-if="key.name" class="text-foreground font-medium">{{
                      key.name
                    }}</span>
                    <span class="text-muted-foreground">{{
                      new Date(key.created_at).toLocaleDateString()
                    }}</span>
                  </div>
                  <div class="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-6 px-2 text-xs text-muted-foreground"
                      @click="copyFullKey(key)"
                    >
                      <Copy class="h-3 w-3 mr-1" />
                      {{ keyCopiedId === key.id ? "Copied!" : "Copy" }}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-6 px-2 text-xs text-muted-foreground"
                      @click="handleResetKey(key.id)"
                    >
                      <RefreshCw class="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      @click="handleRevokeKey(key.id)"
                    >
                      <Trash2 class="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <code
                    class="font-mono text-muted-foreground select-all break-all"
                    >{{
                      revealedKeyId === key.id
                        ? key.full_key || key.key_prefix + "..."
                        : key.key_prefix + "..."
                    }}</code
                  >
                  <button
                    v-if="key.full_key"
                    class="text-[10px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    @click="
                      revealedKeyId = revealedKeyId === key.id ? null : key.id
                    "
                  >
                    <Eye class="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Quick Start -PostHog-style minimal snippet -->
          <div>
            <div class="flex items-center gap-2 mb-2">
              <h3
                class="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                Quick start
              </h3>
              <span class="text-[10px] text-muted-foreground">~ 2 minutes</span>
            </div>
            <div
              class="relative rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
            >
              <button
                class="absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-sans border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                @click="copySnippet"
              >
                {{ snippetCopied ? "Copied!" : "Copy" }}
              </button>
              <pre
                class="whitespace-pre text-zinc-100"
              ><span class="text-zinc-500">// Add after any AI API call. That's it.</span>
<span class="text-emerald-400">await</span> fetch(<span class="text-amber-300">'{{ ingestUrl }}'</span>, {
  method: <span class="text-amber-300">'POST'</span>,
  headers: { <span class="text-amber-300">'Content-Type'</span>: <span class="text-amber-300">'application/json'</span>,
             <span class="text-amber-300">'Authorization'</span>: <span class="text-amber-300">'Bearer {{ apiKeyForSnippet }}'</span> },
  body: JSON.stringify({ events: [{
    <span class="text-sky-300">eventName</span>: <span class="text-amber-300">'chat_completion'</span>,
    <span class="text-sky-300">customerReferenceId</span>: userId,
    <span class="text-sky-300">featureKey</span>: <span class="text-amber-300">'ai_summarization'</span>,
    <span class="text-sky-300">model</span>: <span class="text-amber-300">'gpt-4o'</span>,
    <span class="text-sky-300">inputTokens</span>: response.usage.prompt_tokens,
    <span class="text-sky-300">outputTokens</span>: response.usage.completion_tokens,
    <span class="text-zinc-500">// cost auto-calculated from model + tokens if omitted</span>
  }]})
})</pre>
            </div>
            <p class="text-[11px] text-muted-foreground mt-2">
              3 required fields: <span class="font-mono">eventName</span>,
              <span class="font-mono">customerReferenceId</span>,
              <span class="font-mono">featureKey</span>. Everything else is
              optional -pass <span class="font-mono">model</span> +
              <span class="font-mono">inputTokens</span>/<span class="font-mono"
                >outputTokens</span
              >
              and we auto-calculate cost. Provider is detected from the model
              name.
            </p>
          </div>

          <!-- Test with curl -->
          <details class="group">
            <summary
              class="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
            >
              Test with curl ▾
            </summary>
            <div
              class="mt-2 relative rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
            >
              <button
                class="absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-sans border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                @click="copyCurl"
              >
                {{ curlCopied ? "Copied!" : "Copy" }}
              </button>
              <pre
                class="whitespace-pre text-zinc-100"
              >curl -X POST <span class="text-amber-300">'{{ ingestUrl }}'</span> \
  -H <span class="text-amber-300">'Content-Type: application/json'</span> \
  -H <span class="text-amber-300">'Authorization: Bearer {{ apiKeyForSnippet }}'</span> \
  -d <span class="text-amber-300">'{"events":[{"eventName":"chat_completion","customerReferenceId":"cus_test_123","featureKey":"ai_summarization","model":"gpt-4o","inputTokens":500,"outputTokens":100}]}'</span></pre>
            </div>
          </details>

          <!-- Full example with comments -->
          <details class="group">
            <summary
              class="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
            >
              Show full example with all options ▾
            </summary>
            <div
              class="mt-2 rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
            >
              <pre
                class="whitespace-pre text-zinc-100"
              ><span class="text-zinc-500">// Full example -wrap your AI API call</span>
<span class="text-emerald-400">const</span> response = <span class="text-emerald-400">await</span> openai.chat.completions.create({ ... })

<span class="text-emerald-400">await</span> fetch(<span class="text-amber-300">'{{ ingestUrl }}'</span>, {
  method: <span class="text-amber-300">'POST'</span>,
  headers: {
    <span class="text-amber-300">'Content-Type'</span>: <span class="text-amber-300">'application/json'</span>,
    <span class="text-amber-300">'Authorization'</span>: <span class="text-amber-300">'Bearer {{ apiKeyForSnippet }}'</span>
  },
  body: JSON.stringify({ events: [{
    <span class="text-sky-300">eventName</span>: <span class="text-amber-300">'chat_completion'</span>,
    <span class="text-sky-300">customerReferenceId</span>: <span class="text-amber-300">'cus_123'</span>,  <span class="text-zinc-500">// your customer ID</span>
    <span class="text-sky-300">featureKey</span>: <span class="text-amber-300">'ai_summarization'</span>,  <span class="text-zinc-500">// which feature used it</span>
    <span class="text-sky-300">model</span>: <span class="text-amber-300">'gpt-4o'</span>,                 <span class="text-zinc-500">// auto-detects provider</span>
    <span class="text-sky-300">inputTokens</span>: 500,                <span class="text-zinc-500">// prompt tokens</span>
    <span class="text-sky-300">outputTokens</span>: 1000,              <span class="text-zinc-500">// completion tokens</span>
    <span class="text-sky-300">costAmount</span>: 0.24,                <span class="text-zinc-500">// or omit -auto-calculated from model + tokens</span>
    <span class="text-sky-300">revenueAmount</span>: 0.50,             <span class="text-zinc-500">// or auto-enriched from Stripe</span>
    <span class="text-sky-300">idempotencyKey</span>: <span class="text-amber-300">'evt_abc'</span>,       <span class="text-zinc-500">// prevents duplicates on retry</span>
    <span class="text-sky-300">properties</span>: { session: <span class="text-amber-300">'sess_xyz'</span> }, <span class="text-zinc-500">// any extra context</span>
  }]})
})</pre>
            </div>
          </details>

          <!-- Step 2: What you get -->
          <div>
            <h3
              class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2"
            >
              2. What you get
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div class="rounded-lg border bg-card p-3">
                <div class="text-xs font-medium mb-1">Per-feature costs</div>
                <div class="text-[11px] text-muted-foreground">
                  See which features (summarization, search, image gen) cost the
                  most
                </div>
              </div>
              <div class="rounded-lg border bg-card p-3">
                <div class="text-xs font-medium mb-1">Per-model breakdown</div>
                <div class="text-[11px] text-muted-foreground">
                  Compare GPT-4o vs Claude vs embeddings costs. Provider
                  auto-detected
                </div>
              </div>
              <div class="rounded-lg border bg-card p-3">
                <div class="text-xs font-medium mb-1">Margin tracking</div>
                <div class="text-[11px] text-muted-foreground">
                  Connect Stripe to auto-enrich revenue and see per-customer
                  margins
                </div>
              </div>
            </div>
          </div>

          <!-- Required vs optional fields -->
          <div>
            <h3
              class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2"
            >
              Event fields
            </h3>
            <div class="text-xs space-y-1.5">
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >eventName</span
                ><span class="text-red-500 text-[10px]">required</span
                ><span class="text-muted-foreground"
                  >What happened ("chat_completion", "image_generated")</span
                >
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >customerReferenceId</span
                ><span class="text-red-500 text-[10px]">required</span
                ><span class="text-muted-foreground"
                  >Your customer identifier</span
                >
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >featureKey</span
                ><span class="text-red-500 text-[10px]">required</span
                ><span class="text-muted-foreground"
                  >Which product feature ("ai_summarization", "search")</span
                >
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >model</span
                ><span class="text-muted-foreground/60 text-[10px]"
                  >optional</span
                ><span class="text-muted-foreground"
                  >Model name -provider auto-detected (claude-* → Anthropic,
                  gpt-* → OpenAI)</span
                >
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >inputTokens</span
                ><span class="text-muted-foreground/60 text-[10px]"
                  >optional</span
                ><span class="text-muted-foreground"
                  >Prompt tokens -used with model to auto-calculate cost</span
                >
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >outputTokens</span
                ><span class="text-muted-foreground/60 text-[10px]"
                  >optional</span
                ><span class="text-muted-foreground"
                  >Completion tokens -used with model to auto-calculate
                  cost</span
                >
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >costAmount</span
                ><span class="text-muted-foreground/60 text-[10px]"
                  >optional</span
                ><span class="text-muted-foreground"
                  >Cost in USD -or omit and we calculate from model +
                  tokens</span
                >
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >revenueAmount</span
                ><span class="text-muted-foreground/60 text-[10px]"
                  >optional</span
                ><span class="text-muted-foreground"
                  >Revenue for this event -auto-enriched from Stripe if
                  missing</span
                >
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >usageUnits</span
                ><span class="text-muted-foreground/60 text-[10px]"
                  >optional</span
                ><span class="text-muted-foreground"
                  >Tokens, requests, or any quantity</span
                >
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >idempotencyKey</span
                ><span class="text-muted-foreground/60 text-[10px]"
                  >optional</span
                ><span class="text-muted-foreground"
                  >Unique key for dedup on retry</span
                >
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >properties</span
                ><span class="text-muted-foreground/60 text-[10px]"
                  >optional</span
                ><span class="text-muted-foreground"
                  >JSON object with any extra context (session ID, etc.)</span
                >
              </div>
            </div>
          </div>

          <div
            class="text-[11px] text-muted-foreground border-t pt-3 space-y-1.5"
          >
            <div>
              Batch up to 1,000 events per request. All data tagged as
              <span
                class="font-mono bg-success/10 text-success px-1 py-0.5 rounded"
                >SDK</span
              >
              in the dashboard.
            </div>
            <div>
              <strong>How cost works:</strong> Pass
              <span class="font-mono">costAmount</span> directly, or pass
              <span class="font-mono">model</span> +
              <span class="font-mono">inputTokens</span>/<span class="font-mono"
                >outputTokens</span
              >
              and we calculate it automatically (100+ models, pricing
              auto-refreshed from OpenRouter).
            </div>
          </div>
        </template>

        <!-- ============ Proxy Mode Tab ============ -->
        <template v-else>
          <p class="text-sm text-muted-foreground">
            Route your OpenAI/Anthropic calls through Observe by changing one
            URL. We forward the request, capture tokens and cost from the
            response, then log it -zero code changes beyond the base URL.
          </p>

          <!-- OpenAI snippet -->
          <div>
            <h3
              class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2"
            >
              OpenAI
            </h3>
            <div
              class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
            >
              <pre
                class="whitespace-pre text-zinc-100"
              ><span class="text-zinc-500">// Just change baseURL -your existing code works as-is</span>
<span class="text-emerald-400">import</span> OpenAI <span class="text-emerald-400">from</span> <span class="text-amber-300">'openai'</span>

<span class="text-emerald-400">const</span> openai = <span class="text-emerald-400">new</span> OpenAI({
  <span class="text-sky-300">baseURL</span>: <span class="text-amber-300">'{{ proxyBaseUrl }}'</span>,
  <span class="text-sky-300">defaultHeaders</span>: {
    <span class="text-amber-300">'X-Observe-Key'</span>: <span class="text-amber-300">'{{ apiKeyForSnippet }}'</span>,
    <span class="text-amber-300">'X-Observe-Customer'</span>: userId,       <span class="text-zinc-500">// optional</span>
    <span class="text-amber-300">'X-Observe-Feature'</span>: <span class="text-amber-300">'ai_chat'</span>,  <span class="text-zinc-500">// optional</span>
  },
})

<span class="text-zinc-500">// Use openai normally -every call is tracked automatically</span>
<span class="text-emerald-400">const</span> response = <span class="text-emerald-400">await</span> openai.chat.completions.create({
  model: <span class="text-amber-300">'gpt-4o'</span>,
  messages: [{ role: <span class="text-amber-300">'user'</span>, content: prompt }],
})</pre>
            </div>
          </div>

          <!-- Anthropic snippet -->
          <details class="group">
            <summary
              class="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
            >
              Show Anthropic setup ▾
            </summary>
            <div class="mt-2">
              <div
                class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
              >
                <pre
                  class="whitespace-pre text-zinc-100"
                ><span class="text-emerald-400">import</span> Anthropic <span class="text-emerald-400">from</span> <span class="text-amber-300">'@anthropic-ai/sdk'</span>

<span class="text-emerald-400">const</span> anthropic = <span class="text-emerald-400">new</span> Anthropic({
  <span class="text-sky-300">baseURL</span>: <span class="text-amber-300">'{{ proxyBaseUrl }}'</span>,
  <span class="text-sky-300">defaultHeaders</span>: {
    <span class="text-amber-300">'X-Observe-Key'</span>: <span class="text-amber-300">'{{ apiKeyForSnippet }}'</span>,
  },
})</pre>
              </div>
            </div>
          </details>

          <!-- Benefits -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="rounded-lg border bg-card p-3">
              <div class="text-xs font-medium mb-1">Zero code changes</div>
              <div class="text-[11px] text-muted-foreground">
                Swap one URL. Your existing OpenAI/Anthropic code works as-is
              </div>
            </div>
            <div class="rounded-lg border bg-card p-3">
              <div class="text-xs font-medium mb-1">Auto cost tracking</div>
              <div class="text-[11px] text-muted-foreground">
                Token usage and cost captured from every API response
                automatically
              </div>
            </div>
            <div class="rounded-lg border bg-card p-3">
              <div class="text-xs font-medium mb-1">
                Works with existing SDKs
              </div>
              <div class="text-[11px] text-muted-foreground">
                Compatible with OpenAI and Anthropic official SDKs. No wrapper
                needed
              </div>
            </div>
          </div>

          <!-- Optional headers -->
          <div>
            <h3
              class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2"
            >
              Optional headers
            </h3>
            <div class="text-xs space-y-1.5">
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >X-Observe-Customer</span
                ><span class="text-muted-foreground"
                  >Customer ID -attributes cost to a specific customer</span
                >
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px] shrink-0"
                  >X-Observe-Feature</span
                ><span class="text-muted-foreground"
                  >Feature key -attributes cost to a product feature (defaults
                  to endpoint name)</span
                >
              </div>
            </div>
          </div>

          <!-- Supported endpoints -->
          <div>
            <h3
              class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2"
            >
              Supported endpoints
            </h3>
            <div class="text-xs space-y-1">
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]"
                  >POST /v1/chat/completions</span
                ><span class="text-muted-foreground">OpenAI chat</span>
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]"
                  >POST /v1/embeddings</span
                ><span class="text-muted-foreground">OpenAI embeddings</span>
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]"
                  >POST /v1/messages</span
                ><span class="text-muted-foreground">Anthropic messages</span>
              </div>
            </div>
          </div>

          <div class="text-[11px] text-muted-foreground border-t pt-3">
            Uses the same API keys as SDK Events. Generate one in the SDK Events
            tab if you haven't already. All data tagged as
            <span
              class="font-mono bg-success/10 text-success px-1 py-0.5 rounded"
              >Proxy</span
            >
            in the dashboard.
          </div>
        </template>
      </CardContent>
    </Card>

    <!-- Stripe Revenue Integration -->
    <Card class="border-[#635bff]/20">
      <CardContent class="p-6">
        <!-- Not connected state -->
        <template v-if="!stripeStatus.connected">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div
                class="flex items-center justify-center w-10 h-10 rounded-lg bg-[#635bff]/10"
              >
                <CreditCard class="h-5 w-5 text-[#635bff]" />
              </div>
              <div>
                <h3 class="font-semibold">Connect Stripe</h3>
                <p class="text-sm text-muted-foreground">
                  Auto-sync customers, subscriptions, and MRR. Revenue enriches
                  SDK events automatically.
                </p>
              </div>
            </div>
            <Button v-if="!isViewer" @click="showStripeModal = true">
              Connect
            </Button>
          </div>
        </template>

        <!-- Connected state -->
        <template v-else>
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div
                  class="flex items-center justify-center w-10 h-10 rounded-lg bg-[#635bff]/10"
                >
                  <CreditCard class="h-5 w-5 text-[#635bff]" />
                </div>
                <div>
                  <div class="flex items-center gap-2">
                    <h3 class="font-semibold">
                      {{ stripeStatus.account_name || "Stripe" }}
                    </h3>
                    <span
                      class="text-[10px] font-medium bg-success/10 text-success px-2 py-0.5 rounded-full"
                      >Connected</span
                    >
                  </div>
                  <p class="text-xs text-muted-foreground">
                    {{ stripeStatus.account_id }}
                    <span v-if="stripeStatus.last_synced_at">
                      · Last synced
                      {{
                        new Date(
                          stripeStatus.last_synced_at,
                        ).toLocaleDateString()
                      }}</span
                    >
                  </p>
                </div>
              </div>
              <div v-if="!isViewer" class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="isSyncingStripe"
                  @click="handleStripeSync"
                >
                  <Loader2
                    v-if="isSyncingStripe"
                    class="h-3 w-3 mr-1 animate-spin"
                  />
                  <RefreshCw v-else class="h-3 w-3 mr-1" />
                  Re-sync
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-muted-foreground hover:text-destructive"
                  :disabled="isDisconnectingStripe"
                  @click="handleStripeDisconnect"
                >
                  <Unplug class="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div
              class="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground"
            >
              Revenue is auto-enriched on SDK events when
              <span class="font-mono">customerReferenceId</span> matches a
              Stripe customer ID. Send events with your Stripe
              <span class="font-mono">cus_*</span> IDs to see margin
              calculations.
            </div>
          </div>
        </template>
      </CardContent>
    </Card>

    <!-- Feature Pricing UI hidden — backend retained for future use -->

    <!-- SECTION: Import historic data (optional) -->
    <div v-if="true" class="relative mt-4">
      <div class="absolute inset-0 flex items-center">
        <div class="w-full border-t"></div>
      </div>
      <div class="relative flex justify-center text-xs">
        <span class="bg-background px-3 text-muted-foreground">Optional</span>
      </div>
    </div>

    <div v-if="true" class="space-y-1">
      <h2
        class="text-sm font-semibold text-muted-foreground uppercase tracking-wider"
      >
        Import historic data
      </h2>
      <p class="text-sm text-muted-foreground">
        Already have cost or usage data from your AI providers? Upload CSVs to
        get insights faster.
      </p>
    </div>

    <!-- AI Cost CSVs + Provider Connections (hidden in demo mode) -->
    <CostsSection
      :file="costsFile"
      :readonly="isViewer"
      @file-uploaded="handleCostsFileUploaded"
      @file-cleared="handleCostsFileCleared"
    />

    <!-- Usage Section (hidden in demo mode) -->
    <UsageSection
      :file="usageFile"
      :readonly="isViewer"
      @file-uploaded="handleUsageFileUploaded"
      @file-cleared="handleUsageFileCleared"
    />
  </div>

  <!-- Stripe API Key Modal -->
  <StripeApiKeyModal
    :open="showStripeModal"
    @close="showStripeModal = false"
    @connected="handleStripeConnected"
  />
</template>
