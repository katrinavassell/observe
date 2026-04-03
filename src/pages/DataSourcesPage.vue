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
import { useQueryClient } from "@tanstack/vue-query";
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
  Upload,
} from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import { CostsSection, UsageSection } from "@/components/data-sources";
import StripeApiKeyModal from "@/components/integrations/StripeApiKeyModal.vue";
import OpenAIApiKeyModal from "@/components/integrations/OpenAIApiKeyModal.vue";
import AnthropicApiKeyModal from "@/components/integrations/AnthropicApiKeyModal.vue";
import { useDataMode } from "@/composables/useDataMode";
import { useAuth } from "@/composables/useAuth";
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
  syncStripeInvoices,
  uploadProviderCsv,
} from "@/lib/api";
import {
  getStripeStatus,
  syncStripeData,
  disconnectStripe,
} from "@/api/client";
import type { SdkKey, FeaturePricingRule } from "@/lib/api";
import type { StripeStatus } from "@/api/client";

const router = useRouter();
const queryClient = useQueryClient();
const { isLoggedIn } = useAuth();
const { isViewer } = useTeam();

/** True when the user can interact with data sources (logged in + not a viewer) */
const canEdit = computed(() => isLoggedIn.value && !isViewer.value);

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
const integrationTab = ref<"proxy" | "wrapper" | "api">("proxy");

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

function scrollToStripe() {
  document
    .getElementById("stripe-section")
    ?.scrollIntoView({ behavior: "smooth" });
}

/** Provider modals */
const showOpenAIModal = ref(false);
const showAnthropicModal = ref(false);

/** Stripe connection state */
const showStripeModal = ref(false);
const stripeStatus = ref<StripeStatus>({
  connected: false,
  account_id: null,
  account_name: null,
});
const isSyncingStripe = ref(false);
const isDisconnectingStripe = ref(false);
const isSyncingInvoices = ref(false);

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

async function handleInvoiceSync() {
  isSyncingInvoices.value = true;
  try {
    const result = await syncStripeInvoices();
    await refetchDataMode();
    toast.success(
      `Imported ${result.line_items} line items from ${result.invoices} invoices`,
    );
  } catch (error) {
    toast.error("Failed to import invoices", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isSyncingInvoices.value = false;
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
  if (!isLoggedIn.value) return;
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
// PROVIDER CSV IMPORT
// =============================================================================

const isUploadingProviderCsv = ref(false);
const providerCsvFileInput = ref<HTMLInputElement | null>(null);

async function handleProviderCsvFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  isUploadingProviderCsv.value = true;
  try {
    const rawCsv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });

    const result = await uploadProviderCsv(rawCsv);
    toast.success(
      `Imported ${result.rows} rows from ${result.provider} (${result.models.join(", ")})`,
    );
    await refetchDataMode();
    queryClient.invalidateQueries({ queryKey: ["events"] });
    queryClient.invalidateQueries({ queryKey: ["costs"] });
  } catch (error) {
    toast.error("Failed to import provider CSV", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isUploadingProviderCsv.value = false;
    if (input) input.value = "";
  }
}

// =============================================================================
// DATA RESTORATION
// =============================================================================

// Restore file display state when returning to page with existing data
// Only restore file display for real user uploads — never for sample data
watch(
  [hasCosts, hasUsage, () => dataMode.value],
  ([hasCst, hasUsg, mode]) => {
    if (mode === "user") {
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
        Start tracking AI costs in one line. Add revenue data when you're ready.
      </p>
    </div>

    <!-- Viewer notice -->
    <div
      v-if="isViewer"
      class="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground"
    >
      <Eye class="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <strong>Viewer access</strong> — You can see your team's data but cannot
        upload, modify, or clear data. Contact your team admin to make changes.
      </div>
    </div>

    <!-- ================================================================== -->
    <!-- HERO: One-line proxy integration                                    -->
    <!-- ================================================================== -->
    <Card class="border-success/20">
      <CardContent class="p-6 space-y-5">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="font-semibold text-lg">Live tracking</h2>
            <span
              class="text-[10px] font-medium bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full"
              >Real-time, per-call</span
            >
          </div>
          <p class="text-sm text-muted-foreground">
            Route your AI calls through the Observe proxy. Every call is logged
            with model, tokens, cost, customer, and feature — automatically.
          </p>
        </div>

        <!-- The one snippet that matters -->
        <div
          class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
        >
          <pre
            class="whitespace-pre text-zinc-100"
          ><span class="text-emerald-400">import</span> OpenAI <span class="text-emerald-400">from</span> <span class="text-amber-300">'openai'</span>

<span class="text-emerald-400">const</span> openai = <span class="text-emerald-400">new</span> OpenAI({
  <span class="text-sky-300">baseURL</span>: <span class="text-amber-300">'{{ proxyBaseUrl }}'</span>,
  <span class="text-sky-300">defaultHeaders</span>: {
    <span class="text-amber-300">'x-tanso-key'</span>: <span class="text-amber-300">'{{ apiKeyForSnippet }}'</span>,
    <span class="text-amber-300">'x-tanso-customer'</span>: customerId,       <span class="text-zinc-500">// Stripe ID (cus_...) or your user ID</span>
    <span class="text-amber-300">'x-tanso-feature'</span>: <span class="text-amber-300">'ai_chat'</span>,          <span class="text-zinc-500">// which product feature</span>
  },
})
<span class="text-zinc-500">// Every call is tracked with cost, model, customer, and feature.</span></pre>
        </div>

        <!-- API Key section — compact -->
        <div
          v-if="!isLoggedIn"
          class="rounded-lg border border-dashed border-muted-foreground/30 p-4 text-center"
        >
          <p class="text-sm text-muted-foreground mb-2">
            Sign up to generate an API key and start tracking.
          </p>
          <Button size="sm" @click="router.push('/signup')"
            >Sign up to get started</Button
          >
        </div>
        <div v-else-if="!isViewer">
          <div class="flex items-center justify-between mb-2">
            <h3
              class="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
            >
              Your API Key
            </h3>
            <Button
              v-if="!showKeyGenerator && !generatedKey && sdkKeys.length === 0"
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              @click="handleGenerateKey"
            >
              <Plus class="h-3 w-3 mr-1" />
              {{ isGeneratingKey ? "Generating..." : "Generate Key" }}
            </Button>
          </div>

          <!-- Existing keys (compact) -->
          <div v-if="sdkKeys.length > 0" class="space-y-1.5 mb-3">
            <div
              v-for="key in sdkKeys"
              :key="key.id"
              class="rounded-md border bg-card px-3 py-2 text-xs flex items-center justify-between"
            >
              <div class="flex items-center gap-3">
                <code class="font-mono text-muted-foreground select-all">{{
                  revealedKeyId === key.id
                    ? key.full_key || key.key_prefix + "..."
                    : key.key_prefix + "..."
                }}</code>
                <button
                  v-if="key.full_key"
                  class="text-muted-foreground hover:text-foreground transition-colors"
                  @click="
                    revealedKeyId = revealedKeyId === key.id ? null : key.id
                  "
                >
                  <Eye class="h-3 w-3" />
                </button>
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
                  class="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  @click="handleRevokeKey(key.id)"
                >
                  <Trash2 class="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          <!-- Key generator (only shown when manually triggered for additional keys) -->
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

          <!-- Generated key display -->
          <div
            v-if="generatedKey"
            class="rounded-lg border bg-muted/40 p-4 mb-3 space-y-2"
          >
            <div
              class="flex items-center gap-2 text-xs font-medium text-success"
            >
              <Key class="h-3 w-3" />
              Key generated — copy it now, you won't see it again
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

          <Button
            v-if="sdkKeys.length > 0"
            variant="ghost"
            size="sm"
            class="h-7 text-xs text-muted-foreground"
            @click="showKeyGenerator = true"
          >
            <Plus class="h-3 w-3 mr-1" />
            Add another key
          </Button>
        </div>

        <!-- Other integration methods (collapsed) -->
        <details class="group">
          <summary
            class="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
          >
            Other integration methods (SDK wrapper, REST API)
          </summary>
          <div class="mt-3 space-y-4">
            <!-- SDK Wrapper -->
            <div>
              <h4 class="text-xs font-semibold mb-2">SDK Wrapper</h4>
              <p class="text-[11px] text-muted-foreground mb-2">
                <span class="font-mono">npm install @tanso/observe</span> —
                wraps your client for automatic tracking.
              </p>
              <div
                class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
              >
                <pre
                  class="whitespace-pre text-zinc-100"
                ><span class="text-emerald-400">import</span> { TansoObserve } <span class="text-emerald-400">from</span> <span class="text-amber-300">'@tanso/observe'</span>
<span class="text-emerald-400">import</span> { wrapOpenAI } <span class="text-emerald-400">from</span> <span class="text-amber-300">'@tanso/observe/openai'</span>

<span class="text-emerald-400">const</span> observe = <span class="text-emerald-400">new</span> TansoObserve({ apiKey: <span class="text-amber-300">'{{ apiKeyForSnippet }}'</span> })
<span class="text-emerald-400">const</span> openai = wrapOpenAI(<span class="text-emerald-400">new</span> OpenAI(), observe)</pre>
              </div>
            </div>
            <!-- REST API -->
            <div>
              <h4 class="text-xs font-semibold mb-2">REST API</h4>
              <div
                class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
              >
                <pre
                  class="whitespace-pre text-zinc-100"
                >curl -X POST <span class="text-amber-300">'{{ ingestUrl }}'</span> \
  -H <span class="text-amber-300">'Authorization: Bearer {{ apiKeyForSnippet }}'</span> \
  -H <span class="text-amber-300">'Content-Type: application/json'</span> \
  -d <span class="text-amber-300">'{"events":[{"eventName":"chat","customerReferenceId":"cus_123","featureKey":"ai_chat","model":"gpt-4o"}]}'</span></pre>
              </div>
            </div>
          </div>
        </details>

        <!-- Supported endpoints -->
        <div class="text-xs space-y-1 border-t pt-3">
          <div class="flex gap-2">
            <span class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]"
              >POST /v1/chat/completions</span
            >
            <span class="text-muted-foreground">OpenAI chat</span>
          </div>
          <div class="flex gap-2">
            <span class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]"
              >POST /v1/embeddings</span
            >
            <span class="text-muted-foreground">OpenAI embeddings</span>
          </div>
          <div class="flex gap-2">
            <span class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]"
              >POST /v1/messages</span
            >
            <span class="text-muted-foreground">Anthropic messages</span>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- ================================================================== -->
    <!-- REVENUE: Stripe (single card, no duplicate CTA)                    -->
    <!-- ================================================================== -->
    <Card id="stripe-section" class="border-[#635bff]/20">
      <CardContent class="p-6">
        <template v-if="!stripeStatus.connected">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div
                class="flex items-center justify-center w-10 h-10 rounded-lg bg-[#635bff]/10"
              >
                <CreditCard class="h-5 w-5 text-[#635bff]" />
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="font-semibold">Connect Stripe</h3>
                  <span
                    class="text-[10px] font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full"
                    >Revenue data</span
                  >
                </div>
                <p class="text-sm text-muted-foreground">
                  Auto-sync customers, subscriptions, and MRR so Observe can
                  calculate margins per feature and customer.
                </p>
              </div>
            </div>
            <Button v-if="canEdit" class="ml-4" @click="showStripeModal = true">
              Connect
            </Button>
            <Button
              v-else-if="!isLoggedIn"
              variant="outline"
              class="ml-4"
              @click="router.push('/signup')"
            >
              Sign up to connect
            </Button>
          </div>
        </template>

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
              <div v-if="canEdit" class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 w-7 p-0 text-muted-foreground"
                  :disabled="isSyncingStripe"
                  title="Re-sync Stripe data"
                  @click="handleStripeSync"
                >
                  <Loader2
                    v-if="isSyncingStripe"
                    class="h-3 w-3 animate-spin"
                  />
                  <RefreshCw v-else class="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  :disabled="isDisconnectingStripe"
                  title="Disconnect Stripe"
                  @click="handleStripeDisconnect"
                >
                  <Unplug class="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </template>
      </CardContent>
    </Card>

    <!-- ================================================================== -->
    <!-- GRANULARITY CALLOUT                                                -->
    <!-- ================================================================== -->
    <div
      class="flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
    >
      <span class="font-medium text-foreground shrink-0">Data sources:</span>
      <span>
        The proxy above logs every individual call with model, tokens, and cost.
        The imports below bring in monthly totals for trend history. Both show
        on the dashboard — use the Source filter on the Events page to tell them
        apart.
      </span>
    </div>

    <!-- ================================================================== -->
    <!-- IMPORT HISTORICAL DATA                                             -->
    <!-- ================================================================== -->
    <div class="space-y-4">
      <div>
        <h2 class="text-base font-semibold">Import Historical Data</h2>
        <p class="text-sm text-muted-foreground">
          Pull monthly aggregates from your provider dashboards or upload CSVs.
        </p>
      </div>

      <!-- OpenAI connect -->
      <Card>
        <CardContent class="p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div
                class="h-10 w-10 rounded-lg bg-black flex items-center justify-center"
              >
                <svg class="h-5 w-5" viewBox="0 0 24 24" fill="white">
                  <path
                    d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"
                  />
                </svg>
              </div>
              <div>
                <p class="font-medium">OpenAI</p>
                <p class="text-xs text-muted-foreground">
                  Pull monthly token usage from your OpenAI dashboard
                </p>
              </div>
            </div>
            <Button
              v-if="canEdit"
              variant="outline"
              size="sm"
              @click="showOpenAIModal = true"
            >
              Connect
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- Anthropic connect -->
      <Card>
        <CardContent class="p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div
                class="h-10 w-10 rounded-lg bg-[#D4A574]/10 flex items-center justify-center"
              >
                <span class="text-lg font-semibold text-[#D4A574]">A</span>
              </div>
              <div>
                <p class="font-medium">Anthropic</p>
                <p class="text-xs text-muted-foreground">
                  Pull monthly token usage from your Anthropic console
                </p>
              </div>
            </div>
            <Button
              v-if="canEdit"
              variant="outline"
              size="sm"
              @click="showAnthropicModal = true"
            >
              Connect
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- Provider CSV quick-import -->
      <div v-if="canEdit" class="flex items-center gap-3 px-1">
        <p class="text-xs text-muted-foreground flex-1">
          Or drop a billing export CSV from OpenAI or Anthropic to quick-import.
        </p>
        <input
          ref="providerCsvFileInput"
          type="file"
          accept=".csv"
          class="hidden"
          :disabled="isUploadingProviderCsv"
          @change="handleProviderCsvFile"
        />
        <Button
          variant="outline"
          size="sm"
          :disabled="isUploadingProviderCsv"
          @click="providerCsvFileInput?.click()"
        >
          <Loader2
            v-if="isUploadingProviderCsv"
            class="mr-2 h-4 w-4 animate-spin"
          />
          <Upload v-else class="mr-2 h-4 w-4" />
          {{ isUploadingProviderCsv ? "Importing..." : "Quick Import CSV" }}
        </Button>
      </div>

      <!-- CSV uploads -->
      <CostsSection
        :file="costsFile"
        :readonly="!canEdit"
        @file-uploaded="handleCostsFileUploaded"
        @file-cleared="handleCostsFileCleared"
      />
      <UsageSection
        :file="usageFile"
        :readonly="!canEdit"
        @file-uploaded="handleUsageFileUploaded"
        @file-cleared="handleUsageFileCleared"
      />
    </div>
  </div>

  <StripeApiKeyModal
    :open="showStripeModal"
    @close="showStripeModal = false"
    @connected="handleStripeConnected"
  />
  <OpenAIApiKeyModal
    :open="showOpenAIModal"
    @close="showOpenAIModal = false"
    @connected="refetchDataMode"
  />
  <AnthropicApiKeyModal
    :open="showAnthropicModal"
    @close="showAnthropicModal = false"
    @connected="refetchDataMode"
  />
</template>
