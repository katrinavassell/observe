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

import { ref, computed, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import {
  Key,
  Copy,
  Trash2,
  Plus,
  CreditCard,
  RefreshCw,
  Loader2,
  Unplug,
  Upload,
  Cloud,
  Database,
  Zap,
} from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import { CostsSection, UsageSection } from "@/components/data-sources";
import StripeApiKeyModal from "@/components/integrations/StripeApiKeyModal.vue";
import OpenAIApiKeyModal from "@/components/integrations/OpenAIApiKeyModal.vue";
import AnthropicApiKeyModal from "@/components/integrations/AnthropicApiKeyModal.vue";
import { useDataMode } from "@/composables/useDataMode";
import { useAuth } from "@/composables/useAuth";
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
  getCloudCostStatus,
  connectCloudProvider,
  syncCloudCosts,
  disconnectCloudProvider,
} from "@/lib/api";
import type { CloudIntegrationStatus } from "@/lib/api";
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

/** True when the user can interact with data sources (logged in). */
const canEdit = computed(() => isLoggedIn.value);

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

const {
  dataMode,
  refetch: refetchDataMode,
  hasCosts,
  hasUsage,
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
    window.posthog?.capture("sdk_key_created");
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
    window.posthog?.capture("sdk_key_revoked");
  } catch (error) {
    toast.error("Failed to revoke key", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }
}

function copyKeyToClipboard() {
  if (!generatedKey.value) return;
  window.navigator.clipboard.writeText(generatedKey.value);
  keyCopied.value = true;
  setTimeout(() => {
    keyCopied.value = false;
  }, 2000);
}

const aiInstallPromptCopied = ref(false);

// Paste a Loom share URL here to enable the walkthrough video on the
// Data Sources empty state. Leave empty string to hide the block.
// Format: "https://www.loom.com/embed/<share-id>"
const loomEmbedUrl = ref("");
function buildAiInstallPrompt(apiKey: string) {
  return `Install Observe by Tanso in this repo so every LLM call is tracked with cost, model, customer, and feature.

READ THIS FIRST — full reference: https://observemetrics.com/llms.txt
It documents three integration paths and the full POST body schema. Use it as the source of truth; do not improvise.

My Observe API key: ${apiKey}

## Step 0 — detect the user's current setup before touching anything

Grep the codebase for \`portkey-ai\`, \`litellm\`, \`helicone\`, \`openrouter\`, and any custom \`baseURL\` on \`new OpenAI()\` / \`new Anthropic()\`. If ANY of those exist, the user is on an AI gateway. Do NOT rip it out — use Path 2 (gateway headers) from llms.txt: add Observe headers to their existing gateway config. Ask the user before making structural gateway changes.

If there is no gateway, use Path 1 (direct ingest) below. **Direct ingest is the default.** Do not install any package. Do not wrap the provider client. Do not change \`baseURL\`. Observe stays off the critical path of LLM calls.

## Step 1 — environment

Add \`OBSERVE_API_KEY=${apiKey}\` to \`.env\` and \`.env.example\` (placeholder in the example file). Do not hardcode it anywhere.

## Step 2 — direct ingest (Path 1, the default)

Find every place the app calls OpenAI / Anthropic / another LLM provider. After each call returns, POST a single event to Observe. Example:

\`\`\`ts
const started = Date.now()
const res = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages })

fetch('https://observemetrics.com/api/events/ingest', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${process.env.OBSERVE_API_KEY!}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    events: [{
      eventName: 'chat',
      customerReferenceId: user.stripeCustomerId ?? user.id,
      featureKey: 'ai_chat',
      model: 'gpt-4o-mini',
      modelProvider: 'openai',
      inputTokens: res.usage?.prompt_tokens,
      outputTokens: res.usage?.completion_tokens,
      durationMs: Date.now() - started,
      idempotencyKey: res.id,
    }],
  }),
}).catch((err) => console.error('observe ingest failed:', err))
\`\`\`

Rules for Path 1:
- Use the end-user's stable ID (Stripe customer ID preferred) as \`customerReferenceId\`. Never a hardcoded value.
- Use one stable \`featureKey\` per user-facing AI feature — e.g. \`ai_chat\`, \`summarize_email\`, \`code_autocomplete\`. Not per model.
- Include \`model\` + \`modelProvider\` + \`inputTokens\` + \`outputTokens\` whenever available so Observe computes cost automatically.
- \`idempotencyKey\` (use the provider's request ID when possible) makes retries safe.
- Fire-and-forget is fine. Catch + log the error; do not block the user request on Observe.
- For non-LLM costs, skip \`model\` and pass \`costAmount\` + \`costUnit\` explicitly.
- Full body schema in llms.txt under "POST /api/events/ingest — full body schema".

## Step 3 — only if the user asks for auto-instrumentation (Path 3)

**Do not do this by default.** Only install the SDK if the user explicitly says "I want auto-instrumentation" or "I don't want to add a fetch call to every call site" AND they accept that wrapping routes every LLM call through \`observemetrics.com\`.

If they do:
1. \`npm install @tansohq/observe\` — with the \`hq\`. The package \`@tanso/observe\` (no hq) does NOT exist on npm. If your install command fails to resolve, STOP and tell the user; do not substitute a similar-looking package.
2. At app startup: \`Observe.configure({ apiKey: process.env.OBSERVE_API_KEY! })\`
3. Per authenticated request: \`Observe.identify({ customerId: user.stripeCustomerId })\`
4. Wrap \`new OpenAI()\` and \`new Anthropic()\` with \`Observe.wrap(...)\`. Do not replace the client, just wrap. Do not alter the existing provider API key.
5. Tag each AI feature with \`Observe.feature('<feature_key>')\` or a per-call \`Observe-Feature\` header.

## Do not

- Do not install \`@tanso/observe\`. Correct name: \`@tansohq/observe\`.
- Do not install \`@tansohq/observe\` unless the user explicitly asked for auto-instrumentation. Path 1 requires no SDK.
- Do not replace OpenAI / Anthropic with anything else.
- Do not change \`baseURL\` on an existing provider client unless the user explicitly chose Path 3.
- Do not touch an existing AI gateway (Portkey, LiteLLM, etc.) without asking.
- Do not add Stripe integration as part of Observe setup — Stripe is optional and the user can connect it later from Data Sources → Stripe.
- Do not log the API key.

## Verify

After wiring up, run the app once, make one LLM call, and confirm the event appears at https://observemetrics.com/events.`;
}

async function copyAiInstallPrompt() {
  // Auto-generate a key on first click so new users with zero keys still
  // get a working prompt. One click, zero decisions.
  if (sdkKeys.value.length === 0 && !generatedKey.value) {
    try {
      const result = await createSdkKey("default");
      generatedKey.value = result.key;
      await loadSdkKeys();
      window.posthog?.capture("sdk_key_created", { source: "install_prompt" });
    } catch (error) {
      toast.error("Couldn't generate an API key", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
      return;
    }
  }

  const key =
    generatedKey.value ||
    sdkKeys.value[0]?.full_key ||
    sdkKeys.value[0]?.key_prefix + "..." ||
    "YOUR_API_KEY";
  window.navigator.clipboard.writeText(buildAiInstallPrompt(key));
  aiInstallPromptCopied.value = true;
  window.posthog?.capture("install_prompt_copied");
  setTimeout(() => {
    aiInstallPromptCopied.value = false;
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
    !window.confirm(
      "Rotate this API key? The current key will stop working immediately — update your SDK with the new one.",
    )
  )
    return;
  try {
    const result = await resetSdkKey(id);
    await loadSdkKeys();
    generatedKey.value = result.key;
    toast.success("API key rotated — copy the new one now");
  } catch (error) {
    toast.error("Failed to rotate key", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }
}

const snippetCopied = ref(false);
const curlCopied = ref(false);
function _copyCurl() {
  const apiKey = apiKeyForSnippet.value;
  const curl = `curl -X POST '${ingestUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${apiKey}' \\
  -d '{"events":[{"eventName":"chat_completion","customerReferenceId":"cus_test_123","featureKey":"ai_summarization","model":"gpt-4o","inputTokens":500,"outputTokens":100}]}'`;
  window.navigator.clipboard.writeText(curl);
  curlCopied.value = true;
  setTimeout(() => {
    curlCopied.value = false;
  }, 2000);
}
function _copySnippet() {
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
  window.navigator.clipboard.writeText(snippet);
  snippetCopied.value = true;
  setTimeout(() => {
    snippetCopied.value = false;
  }, 2000);
}

function _scrollToStripe() {
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

async function _handleInvoiceSync() {
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
    window.posthog?.capture("stripe_disconnected");
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

// =============================================================================
// CLOUD COST PROVIDERS (AWS / GCP)
// =============================================================================

const cloudStatus = ref<CloudIntegrationStatus[]>([]);
const showAwsForm = ref(false);
const showGcpForm = ref(false);
const awsAccessKeyId = ref("");
const awsSecretAccessKey = ref("");
const awsRegion = ref("us-east-1");
const gcpServiceAccountJson = ref("");
const isConnectingCloud = ref(false);
const isSyncingCloud = ref<string | null>(null);
const isDisconnectingCloud = ref<string | null>(null);

function cloudProviderStatus(
  provider: string,
): CloudIntegrationStatus | undefined {
  return cloudStatus.value.find((s) => s.provider === provider);
}

async function loadCloudStatus() {
  try {
    cloudStatus.value = await getCloudCostStatus();
  } catch {
    // Non-critical
  }
}

async function handleConnectAws() {
  if (!awsAccessKeyId.value || !awsSecretAccessKey.value || !awsRegion.value) {
    toast.error("All AWS fields are required");
    return;
  }
  isConnectingCloud.value = true;
  try {
    await connectCloudProvider("aws", {
      accessKeyId: awsAccessKeyId.value,
      secretAccessKey: awsSecretAccessKey.value,
      region: awsRegion.value,
    });
    awsAccessKeyId.value = "";
    awsSecretAccessKey.value = "";
    awsRegion.value = "us-east-1";
    showAwsForm.value = false;
    await loadCloudStatus();
    toast.success("AWS connected");
  } catch (error) {
    toast.error("Failed to connect AWS", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isConnectingCloud.value = false;
  }
}

async function handleConnectGcp() {
  if (!gcpServiceAccountJson.value) {
    toast.error("Service account JSON is required");
    return;
  }
  try {
    JSON.parse(gcpServiceAccountJson.value);
  } catch {
    toast.error(
      "Invalid JSON — paste the full service account key file contents",
    );
    return;
  }
  isConnectingCloud.value = true;
  try {
    await connectCloudProvider("gcp", {
      serviceAccountJson: gcpServiceAccountJson.value,
    });
    gcpServiceAccountJson.value = "";
    showGcpForm.value = false;
    await loadCloudStatus();
    toast.success("GCP connected");
  } catch (error) {
    toast.error("Failed to connect GCP", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isConnectingCloud.value = false;
  }
}

async function handleSyncCloud(provider: string) {
  isSyncingCloud.value = provider;
  try {
    const result = await syncCloudCosts(provider);
    toast.success(result.message);
    await loadCloudStatus();
    await refetchDataMode();
    queryClient.invalidateQueries({ queryKey: ["events"] });
  } catch (error) {
    toast.error(`Failed to sync ${provider.toUpperCase()} costs`, {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isSyncingCloud.value = null;
  }
}

async function handleDisconnectCloud(provider: string) {
  isDisconnectingCloud.value = provider;
  try {
    await disconnectCloudProvider(provider);
    await loadCloudStatus();
    toast.success(`${provider.toUpperCase()} disconnected`);
  } catch (error) {
    toast.error(`Failed to disconnect ${provider.toUpperCase()}`, {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isDisconnectingCloud.value = null;
  }
}

onMounted(async () => {
  if (!isLoggedIn.value) return;
  await Promise.all([
    loadSdkKeys(),
    loadStripeStatus(),
    loadFeaturePricing(),
    loadFeatureKeys(),
    loadCloudStatus(),
  ]);

  // Doug's feedback: "I don't know where to get my api key / should already
  // be generated." Three paths to make sure a working key is visible on
  // first view:
  //
  // 1. Signup-complete stashed a fresh raw key in localStorage. Consume it.
  // 2. Zero keys on record — auto-provision one now (covers users whose
  //    signup-complete key gen failed, or who landed here via some other
  //    path without going through signup).
  // 3. Otherwise the masked prefix is shown + user can rotate to reveal.
  const stashed = window.localStorage.getItem("observe:fresh_sdk_key");
  if (stashed) {
    generatedKey.value = stashed;
    window.localStorage.removeItem("observe:fresh_sdk_key");
  } else if (sdkKeys.value.length === 0) {
    try {
      const result = await createSdkKey("default");
      generatedKey.value = result.key;
      await loadSdkKeys();
      window.posthog?.capture("sdk_key_created", {
        source: "data_sources_mount",
      });
    } catch {
      // Non-fatal — user can click "Generate Key" manually.
    }
  }
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

    <!-- ================================================================== -->
    <!-- PRIMARY HERO: one-click install prompt for your AI coding agent     -->
    <!-- ================================================================== -->
    <Card
      v-if="isLoggedIn"
      class="border-primary/40 bg-gradient-to-br from-violet-500/10 via-primary/5 to-blue-500/10"
    >
      <CardContent class="p-6">
        <div class="flex items-start justify-between gap-6 flex-wrap">
          <div class="flex-1 min-w-[260px] space-y-2">
            <div class="flex items-center gap-2">
              <Zap class="h-5 w-5 text-primary" />
              <h2 class="font-semibold text-lg">
                Install Observe in 30 seconds
              </h2>
            </div>
            <p class="text-sm text-muted-foreground max-w-prose">
              Copy this prompt and paste it into Cursor, Claude Code, or
              Copilot. Your AI agent will wire up Observe in your repo — API key
              included. No config to read, no boilerplate to copy.
            </p>
          </div>
          <Button
            size="lg"
            class="shrink-0 min-w-[220px]"
            @click="copyAiInstallPrompt"
          >
            <Copy class="h-4 w-4 mr-2" />
            {{
              aiInstallPromptCopied
                ? "Copied — paste into your AI"
                : "Copy install prompt"
            }}
          </Button>
        </div>

        <!-- Optional 90-second walkthrough. Drop a Loom share URL into
             loomEmbedUrl to show it. Leave empty to hide the whole block. -->
        <div
          v-if="loomEmbedUrl && sdkKeys.length === 0"
          class="mt-5 border-t border-primary/10 pt-5"
        >
          <p
            class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2"
          >
            Watch a 90-second walkthrough
          </p>
          <div
            class="relative rounded-lg overflow-hidden border aspect-video max-w-2xl"
          >
            <iframe
              :src="loomEmbedUrl"
              frameborder="0"
              allowfullscreen
              class="absolute inset-0 w-full h-full"
            />
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- ================================================================== -->
    <!-- API KEY: dedicated card, always visible (Doug: "should already be   -->
    <!-- generated or have an entire section of its own")                    -->
    <!-- ================================================================== -->
    <Card v-if="isLoggedIn" class="border-primary/20">
      <CardContent class="p-6 space-y-4">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="flex items-center gap-2">
            <Key class="h-5 w-5 text-primary" />
            <h2 class="font-semibold text-lg">Your Observe API key</h2>
          </div>
          <Button
            v-if="sdkKeys.length > 0"
            variant="ghost"
            size="sm"
            class="h-8 text-xs text-muted-foreground"
            @click="showKeyGenerator = true"
          >
            <Plus class="h-3 w-3 mr-1" />
            Add another key
          </Button>
        </div>

        <!-- Fresh key (just generated or just signed up) — show in full -->
        <div
          v-if="generatedKey"
          class="rounded-lg border bg-muted/40 p-4 space-y-2"
        >
          <div class="flex items-center gap-2 text-xs font-medium text-success">
            <Key class="h-3 w-3" />
            Key ready — copy it now, you won't see it again
          </div>
          <div class="flex items-center gap-2">
            <code
              class="flex-1 text-sm font-mono bg-background border rounded px-3 py-2 select-all break-all"
              >{{ generatedKey }}</code
            >
            <Button
              variant="outline"
              size="sm"
              class="h-9 shrink-0"
              @click="copyKeyToClipboard"
            >
              <Copy class="h-3 w-3 mr-1" />
              {{ keyCopied ? "Copied!" : "Copy" }}
            </Button>
          </div>
          <p class="text-[11px] text-muted-foreground">
            Paste this into your <code class="font-mono">.env</code> as
            <code class="font-mono">OBSERVE_API_KEY</code>. Observe will only
            show it once — if you lose it, rotate the key to generate a new one.
          </p>
        </div>

        <!-- Existing masked keys — user already has one but the full value
             isn't recoverable. Show the prefix + a clear path to rotate. -->
        <div v-else-if="sdkKeys.length > 0" class="space-y-2">
          <div
            v-for="key in sdkKeys"
            :key="key.id"
            class="rounded-md border bg-card px-3 py-2.5 flex items-center justify-between gap-3"
          >
            <div class="flex items-center gap-3 min-w-0">
              <code class="font-mono text-sm text-muted-foreground truncate">{{
                key.key_prefix + "…"
              }}</code>
              <span class="text-[11px] text-muted-foreground whitespace-nowrap"
                >({{ key.name || "default" }})</span
              >
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <Button
                variant="outline"
                size="sm"
                class="h-8 text-xs"
                title="Rotate — invalidates the old key and shows the new one"
                @click="handleResetKey(key.id)"
              >
                <RefreshCw class="h-3 w-3 mr-1" />
                Rotate
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                title="Delete key"
                @click="handleRevokeKey(key.id)"
              >
                <Trash2 class="h-3 w-3" />
              </Button>
            </div>
          </div>
          <p class="text-[11px] text-muted-foreground">
            The full key is only shown once, at creation. If you've lost it,
            rotate — the old key stops working immediately and a new one is
            displayed.
          </p>
        </div>

        <!-- No keys at all (auto-gen failed) — manual generate button -->
        <div v-else class="space-y-2">
          <p class="text-sm text-muted-foreground">
            No keys yet — generate one to start tracking.
          </p>
          <Button
            size="sm"
            :disabled="isGeneratingKey"
            @click="handleGenerateKey"
          >
            <Key class="h-3 w-3 mr-1.5" />
            {{ isGeneratingKey ? "Generating…" : "Generate API key" }}
          </Button>
        </div>

        <!-- Secondary key generator (when adding an extra key) -->
        <div
          v-if="showKeyGenerator && !generatedKey"
          class="rounded-lg border bg-muted/30 p-4 space-y-3"
        >
          <div class="flex gap-2">
            <input
              v-model="newKeyName"
              type="text"
              placeholder="Key name (e.g. 'production')"
              class="flex-1 h-9 rounded-md border bg-background px-3 text-sm"
              @keydown.enter="handleGenerateKey"
            />
            <Button
              size="sm"
              class="h-9"
              :disabled="isGeneratingKey"
              @click="handleGenerateKey"
            >
              <Key class="h-3 w-3 mr-1" />
              {{ isGeneratingKey ? "Generating…" : "Generate" }}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="h-9"
              @click="showKeyGenerator = false"
              >Cancel</Button
            >
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Signed-out sign-up nudge (only when not logged in) -->
    <Card v-else class="border-dashed border-muted-foreground/30">
      <CardContent class="p-6 text-center">
        <Key class="h-5 w-5 text-muted-foreground mx-auto mb-2" />
        <p class="text-sm text-muted-foreground mb-3">
          Sign up to get your Observe API key — you'll see it here immediately
          after.
        </p>
        <Button size="sm" @click="router.push('/signup')"
          >Sign up to get started</Button
        >
      </CardContent>
    </Card>

    <!-- ================================================================== -->
    <!-- LIVE TRACKING: direct ingest example (Path 1, the default)          -->
    <!-- ================================================================== -->
    <Card class="border-success/20">
      <CardContent class="p-6 space-y-5">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="font-semibold text-lg">Live tracking</h2>
            <span
              class="text-[10px] font-medium bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full"
              >Off critical path · body-only</span
            >
          </div>
          <p class="text-sm text-muted-foreground">
            Call OpenAI / Anthropic / anything else directly, then post one
            event to Observe after the call returns. Observe never sits in front
            of your LLM calls.
          </p>
        </div>

        <!-- The one snippet that matters — Path 1 direct ingest -->
        <div
          class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
        >
          <pre
            class="whitespace-pre text-zinc-100"
          ><span class="text-zinc-500">// 1. Call your provider directly — no wrapper, no baseURL change</span>
<span class="text-emerald-400">const</span> started = Date.now()
<span class="text-emerald-400">const</span> res = <span class="text-emerald-400">await</span> openai.chat.completions.create({
  <span class="text-sky-300">model</span>: <span class="text-amber-300">'gpt-4o-mini'</span>,
  <span class="text-sky-300">messages</span>,
})

<span class="text-zinc-500">// 2. Log the event after the call returns (fire-and-forget)</span>
fetch(<span class="text-amber-300">'{{ ingestUrl }}'</span>, {
  <span class="text-sky-300">method</span>: <span class="text-amber-300">'POST'</span>,
  <span class="text-sky-300">headers</span>: {
    <span class="text-amber-300">'Authorization'</span>: <span class="text-amber-300">`Bearer {{ apiKeyForSnippet }}`</span>,
    <span class="text-amber-300">'Content-Type'</span>: <span class="text-amber-300">'application/json'</span>,
  },
  <span class="text-sky-300">body</span>: JSON.stringify({
    <span class="text-sky-300">events</span>: [{
      <span class="text-sky-300">eventName</span>: <span class="text-amber-300">'chat'</span>,
      <span class="text-sky-300">customerReferenceId</span>: user.stripeId,       <span class="text-zinc-500">// any stable user ID</span>
      <span class="text-sky-300">featureKey</span>: <span class="text-amber-300">'ai_chat'</span>,                  <span class="text-zinc-500">// which product feature</span>
      <span class="text-sky-300">model</span>: <span class="text-amber-300">'gpt-4o-mini'</span>,
      <span class="text-sky-300">modelProvider</span>: <span class="text-amber-300">'openai'</span>,
      <span class="text-sky-300">inputTokens</span>: res.usage?.prompt_tokens,
      <span class="text-sky-300">outputTokens</span>: res.usage?.completion_tokens,
      <span class="text-sky-300">durationMs</span>: Date.now() - started,
      <span class="text-sky-300">idempotencyKey</span>: res.id,                   <span class="text-zinc-500">// safe retries</span>
    }],
  }),
}).catch((err) => console.error(<span class="text-amber-300">'observe ingest failed:'</span>, err))</pre>
        </div>
        <p class="text-[11px] text-muted-foreground">
          Use your Stripe customer ID so Observe can automatically join costs
          with revenue. No Stripe yet? Any stable customer ID works — you can
          map it later.
        </p>

        <!-- Other provider snippets (collapsed) -->
        <details class="group">
          <summary
            class="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
          >
            Google Gemini, Cohere, and Mistral examples
          </summary>
          <div class="mt-3 space-y-4">
            <!-- Google Gemini -->
            <div>
              <h4 class="text-xs font-semibold mb-2">Google Gemini</h4>
              <div
                class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
              >
                <pre
                  class="whitespace-pre text-zinc-100"
                ><span class="text-zinc-500">// Pass your Google API key as a Bearer token.</span>
<span class="text-zinc-500">// Observe extracts it and forwards via ?key= to Google.</span>

curl -X POST <span class="text-amber-300">'{{ proxyBaseUrl }}/google/generateContent'</span> \
  -H <span class="text-amber-300">'Authorization: Bearer YOUR_GOOGLE_API_KEY'</span> \
  -H <span class="text-amber-300">'Observe-Key: {{ apiKeyForSnippet }}'</span> \
  -H <span class="text-amber-300">'Observe-Customer: cus_123'</span> \
  -H <span class="text-amber-300">'Observe-Feature: ai_chat'</span> \
  -H <span class="text-amber-300">'Content-Type: application/json'</span> \
  -d <span class="text-amber-300">'{"model":"gemini-2.5-flash","contents":[{"parts":[{"text":"Hello"}]}]}'</span></pre>
              </div>
            </div>
            <!-- Cohere -->
            <div>
              <h4 class="text-xs font-semibold mb-2">Cohere</h4>
              <div
                class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
              >
                <pre
                  class="whitespace-pre text-zinc-100"
                ><span class="text-emerald-400">import</span> { CohereClient } <span class="text-emerald-400">from</span> <span class="text-amber-300">'cohere-ai'</span>

<span class="text-zinc-500">// Point the Cohere SDK at the Observe proxy</span>
<span class="text-emerald-400">const</span> cohere = <span class="text-emerald-400">new</span> CohereClient({
  <span class="text-sky-300">token</span>: <span class="text-amber-300">'YOUR_COHERE_KEY'</span>,
  <span class="text-sky-300">baseUrl</span>: <span class="text-amber-300">'{{ proxyBaseUrl }}/cohere'</span>,
})
<span class="text-zinc-500">// Add Observe-Key, Observe-Customer, Observe-Feature via fetch override or headers.</span>

<span class="text-zinc-500">// Or use curl directly:</span>
<span class="text-zinc-500">// curl -X POST '{{ proxyBaseUrl }}/cohere/chat' \</span>
<span class="text-zinc-500">//   -H 'Authorization: Bearer YOUR_COHERE_KEY' \</span>
<span class="text-zinc-500">//   -H 'Observe-Key: {{ apiKeyForSnippet }}' \</span>
<span class="text-zinc-500">//   -H 'Observe-Customer: cus_123' \</span>
<span class="text-zinc-500">//   -d '{"model":"command-r-plus","messages":[{"role":"user","content":"Hello"}]}'</span></pre>
              </div>
            </div>
            <!-- Mistral -->
            <div>
              <h4 class="text-xs font-semibold mb-2">Mistral</h4>
              <div
                class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
              >
                <pre
                  class="whitespace-pre text-zinc-100"
                ><span class="text-emerald-400">import</span> { Mistral } <span class="text-emerald-400">from</span> <span class="text-amber-300">'@mistralai/mistralai'</span>

<span class="text-emerald-400">const</span> mistral = <span class="text-emerald-400">new</span> Mistral({
  <span class="text-sky-300">apiKey</span>: <span class="text-amber-300">'YOUR_MISTRAL_KEY'</span>,
  <span class="text-sky-300">serverURL</span>: <span class="text-amber-300">'{{ proxyBaseUrl }}/mistral'</span>,
})
<span class="text-zinc-500">// Add Observe-Key, Observe-Customer, Observe-Feature via additionalHeaders.</span>

<span class="text-zinc-500">// Or use curl directly:</span>
<span class="text-zinc-500">// curl -X POST '{{ proxyBaseUrl }}/mistral/chat/completions' \</span>
<span class="text-zinc-500">//   -H 'Authorization: Bearer YOUR_MISTRAL_KEY' \</span>
<span class="text-zinc-500">//   -H 'Observe-Key: {{ apiKeyForSnippet }}' \</span>
<span class="text-zinc-500">//   -H 'Observe-Customer: cus_123' \</span>
<span class="text-zinc-500">//   -d '{"model":"mistral-large-latest","messages":[{"role":"user","content":"Hello"}]}'</span></pre>
              </div>
            </div>
          </div>
        </details>

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
              <h4 class="text-xs font-semibold mb-2">
                Auto-instrumentation (SDK wrap)
              </h4>
              <p class="text-[11px] text-muted-foreground mb-2">
                <span class="font-mono">npm install @tansohq/observe</span> —
                wraps your provider client so every call is auto-tracked. Only
                pick this if you accept that Observe sits in front of your LLM
                calls (Observe outage = LLM outage).
              </p>
              <div
                class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
              >
                <pre
                  class="whitespace-pre text-zinc-100"
                ><span class="text-emerald-400">import</span> { Observe } <span class="text-emerald-400">from</span> <span class="text-amber-300">'@tansohq/observe'</span>
<span class="text-emerald-400">import</span> OpenAI <span class="text-emerald-400">from</span> <span class="text-amber-300">'openai'</span>

Observe.configure({ <span class="text-sky-300">apiKey</span>: <span class="text-amber-300">'{{ apiKeyForSnippet }}'</span> })
Observe.identify({ <span class="text-sky-300">customerId</span>: user.stripeId })  <span class="text-zinc-500">// call once on login</span>

<span class="text-emerald-400">const</span> openai = Observe.wrap(<span class="text-emerald-400">new</span> OpenAI())
<span class="text-zinc-500">// All calls auto-tracked — no headers to manage</span></pre>
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
              <div v-if="canEdit" class="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  class="h-8 text-xs"
                  :disabled="isSyncingStripe"
                  @click="handleStripeSync"
                >
                  <Loader2
                    v-if="isSyncingStripe"
                    class="h-3 w-3 mr-1.5 animate-spin"
                  />
                  <RefreshCw v-else class="h-3 w-3 mr-1.5" />
                  {{ isSyncingStripe ? "Syncing…" : "Sync" }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-8 text-xs text-muted-foreground hover:text-destructive"
                  :disabled="isDisconnectingStripe"
                  @click="handleStripeDisconnect"
                >
                  <Unplug class="h-3 w-3 mr-1.5" />
                  Disconnect
                </Button>
              </div>
            </div>
          </div>
        </template>
      </CardContent>
    </Card>

    <!-- ================================================================== -->
    <!-- CLOUD COST PROVIDERS (AWS / GCP)                                   -->
    <!-- ================================================================== -->
    <div class="space-y-3">
      <h2
        class="text-sm font-semibold text-muted-foreground uppercase tracking-wider"
      >
        Cloud Compute Costs
      </h2>

      <!-- AWS Card -->
      <Card>
        <CardContent class="p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div
                class="flex items-center justify-center w-10 h-10 rounded-lg bg-orange-500/10"
              >
                <Cloud class="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <p class="font-medium">AWS Cost Explorer</p>
                  <span
                    class="text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full"
                    >Beta · Coming soon</span
                  >
                </div>
                <p class="text-xs text-muted-foreground">
                  Import compute costs grouped by service
                  <span v-if="cloudProviderStatus('aws')?.last_sync_at">
                    · Last synced
                    {{
                      new Date(
                        cloudProviderStatus("aws")!.last_sync_at!,
                      ).toLocaleDateString()
                    }}
                  </span>
                </p>
              </div>
            </div>
            <div v-if="canEdit" class="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled> Connect </Button>
            </div>
          </div>

          <!-- AWS credentials form (inline) -->
          <div v-if="false && showAwsForm" class="mt-4 space-y-3 border-t pt-4">
            <div class="space-y-2">
              <label class="text-xs font-medium">Access Key ID</label>
              <input
                v-model="awsAccessKeyId"
                type="text"
                placeholder="AKIA..."
                class="w-full h-8 rounded-md border bg-background px-3 text-sm font-mono"
              />
            </div>
            <div class="space-y-2">
              <label class="text-xs font-medium">Secret Access Key</label>
              <input
                v-model="awsSecretAccessKey"
                type="password"
                placeholder="Secret access key"
                class="w-full h-8 rounded-md border bg-background px-3 text-sm font-mono"
              />
            </div>
            <div class="space-y-2">
              <label class="text-xs font-medium">Region</label>
              <input
                v-model="awsRegion"
                type="text"
                placeholder="us-east-1"
                class="w-full h-8 rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <p class="text-[11px] text-muted-foreground">
              Needs <code class="text-xs">ce:GetCostAndUsage</code> permission.
              Credentials are encrypted at rest.
            </p>
            <div class="flex gap-2">
              <Button
                size="sm"
                :disabled="isConnectingCloud"
                @click="handleConnectAws"
              >
                {{ isConnectingCloud ? "Connecting..." : "Save & Connect" }}
              </Button>
              <Button variant="ghost" size="sm" @click="showAwsForm = false">
                Cancel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- GCP Card -->
      <Card>
        <CardContent class="p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div
                class="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-500/10"
              >
                <Database class="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <p class="font-medium">GCP Billing</p>
                  <span
                    class="text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full"
                    >Beta · Coming soon</span
                  >
                </div>
                <p class="text-xs text-muted-foreground">
                  Import compute costs from BigQuery billing export
                  <span v-if="cloudProviderStatus('gcp')?.last_sync_at">
                    · Last synced
                    {{
                      new Date(
                        cloudProviderStatus("gcp")!.last_sync_at!,
                      ).toLocaleDateString()
                    }}
                  </span>
                </p>
              </div>
            </div>
            <div v-if="canEdit" class="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled> Connect </Button>
            </div>
          </div>

          <!-- GCP credentials form (inline) -->
          <div v-if="false && showGcpForm" class="mt-4 space-y-3 border-t pt-4">
            <div class="space-y-2">
              <label class="text-xs font-medium">Service Account JSON</label>
              <textarea
                v-model="gcpServiceAccountJson"
                rows="6"
                placeholder='Paste the full JSON key file contents ({"type": "service_account", ...})'
                class="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
              />
            </div>
            <p class="text-[11px] text-muted-foreground">
              Needs BigQuery read access to your billing export table.
              Credentials are encrypted at rest.
            </p>
            <div class="flex gap-2">
              <Button
                size="sm"
                :disabled="isConnectingCloud"
                @click="handleConnectGcp"
              >
                {{ isConnectingCloud ? "Connecting..." : "Save & Connect" }}
              </Button>
              <Button variant="ghost" size="sm" @click="showGcpForm = false">
                Cancel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- ================================================================== -->
    <!-- IMPORT HISTORICAL DATA (collapsed)                                 -->
    <!-- ================================================================== -->
    <details class="group">
      <summary
        class="text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
      >
        Import historical data
        <span class="text-[10px] font-normal ml-1"
          >(monthly aggregates from provider dashboards or CSVs)</span
        >
      </summary>
      <div class="mt-4 space-y-4">
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
            Or drop a billing export CSV from OpenAI or Anthropic to
            quick-import.
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
    </details>
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
