<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import {
  Key,
  Copy,
  Check,
  Trash2,
  CreditCard,
  RefreshCw,
  Loader2,
  Unplug,
  Upload,
  Zap,
  CheckCircle2,
  Radio,
  ArrowRight,
  AlertTriangle,
} from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import { CostsSection, UsageSection } from "@/components/data-sources";
import StripeApiKeyModal from "@/components/integrations/StripeApiKeyModal.vue";
import OpenAIApiKeyModal from "@/components/integrations/OpenAIApiKeyModal.vue";
import AnthropicApiKeyModal from "@/components/integrations/AnthropicApiKeyModal.vue";
import { useDataMode } from "@/composables/useDataMode";
import { useAuth } from "@/composables/useAuth";
import {
  clearData,
  clearCostData,
  clearUsageData,
  createSdkKey,
  listSdkKeys,
  revokeSdkKey,
  resetSdkKey,
  getEvents,
  uploadProviderCsv,
  backfillTokens,
} from "@/lib/api";
import type { SdkKey } from "@/lib/api";
import {
  getStripeStatus,
  syncStripeData,
  disconnectStripe,
  getOpenAIStatus,
  getAnthropicStatus,
} from "@/api/client";
import type { StripeStatus } from "@/api/client";

const router = useRouter();
const queryClient = useQueryClient();
const { isLoggedIn } = useAuth();

const canEdit = computed(() => isLoggedIn.value);

// =============================================================================
// DATA MODE
// =============================================================================

const {
  dataMode,
  refetch: refetchDataMode,
  hasCosts,
  hasUsage,
} = useDataMode();

const costsFile = ref<{ name: string; isSample: boolean } | null>(null);
const usageFile = ref<{ name: string; isSample: boolean } | null>(null);

const ingestUrl =
  typeof window !== "undefined"
    ? `${window.location.origin}/api/events/ingest`
    : "/api/events/ingest";
const proxyBaseUrl =
  typeof window !== "undefined" ? `${window.location.origin}/v1` : "/v1";

// =============================================================================
// SDK API KEYS
// =============================================================================

const sdkKeys = ref<SdkKey[]>([]);
const showKeyGenerator = ref(false);
const newKeyName = ref("");
const isGeneratingKey = ref(false);
const generatedKey = ref<string | null>(null);
const keyCopied = ref(false);
const copiedPrefixId = ref<number | null>(null);

async function loadSdkKeys() {
  try {
    sdkKeys.value = await listSdkKeys();
    if (sdkKeys.value.length === 0) {
      await createSdkKey("Default");
      sdkKeys.value = await listSdkKeys();
    }
  } catch {
    // silently fail - keys list is not critical
  }
}

async function handleGenerateKey() {
  isGeneratingKey.value = true;
  try {
    await createSdkKey(newKeyName.value || undefined);
    newKeyName.value = "";
    showKeyGenerator.value = false;
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
    await loadSdkKeys();
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

function copyKeyValue(key: SdkKey) {
  const value = key.full_key ?? key.key_prefix;
  window.navigator.clipboard.writeText(value);
  copiedPrefixId.value = key.id;
  setTimeout(() => {
    if (copiedPrefixId.value === key.id) copiedPrefixId.value = null;
  }, 2000);
}

async function handleResetKey(id: number) {
  if (
    !window.confirm(
      "Roll this API key? The current key will stop working immediately — update your SDK with the new one.",
    )
  )
    return;
  try {
    const result = await resetSdkKey(id);
    await loadSdkKeys();
    generatedKey.value = result.key;
    toast.success("API key rolled — copy the new one now");
  } catch (error) {
    toast.error("Failed to roll key", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }
}

const apiKeyForSnippet = computed(() => {
  if (sdkKeys.value.length > 0) {
    return sdkKeys.value[0].full_key || sdkKeys.value[0].key_prefix + "...";
  }
  return "YOUR_API_KEY";
});

// =============================================================================
// INSTALL PROMPT
// =============================================================================

const aiInstallPromptCopied = ref(false);
const loomEmbedUrl = ref("");

function buildAiInstallPrompt(apiKey: string) {
  return `Install Observe by Tanso in this repo so every feature is tracked — LLM calls with cost, model, and tokens, plus non-LLM features (API calls, compute jobs, etc.) for usage and revenue attribution.

My Observe API key: ${apiKey}

## Step 0 — detect the user's current setup before touching anything

Grep the codebase for \`portkey-ai\`, \`litellm\`, \`helicone\`, \`openrouter\`, and any custom \`baseURL\` on \`new OpenAI()\` / \`new Anthropic()\`. If ANY of those exist, the user is on an AI gateway. Do NOT rip it out — use Path 2 (gateway headers): add Observe headers (\`observe-key\`, \`observe-customer\`, \`observe-feature\`) to their existing gateway config. Ask the user before making structural gateway changes.

If there is no gateway, use Path 1 (direct ingest) below. **Direct ingest is the default.** Do not install any package. Do not wrap the provider client. Do not change \`baseURL\`. Observe stays off the critical path of LLM calls.

## Step 1 — environment

If \`.env\` doesn't exist yet, create it. Add \`OBSERVE_API_KEY=${apiKey}\` to \`.env\`, and a placeholder line \`OBSERVE_API_KEY=\` to \`.env.example\` (create that file too if it's missing). Do not hardcode the key anywhere else.

## Step 2 — direct ingest (Path 1, the default)

Find every place the app calls OpenAI / Anthropic / another LLM provider. After each call returns, POST a single event to Observe. Example:

\`\`\`ts
const started = Date.now()
const res = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages })

fetch('https://observe.tansohq.com/api/events/ingest', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${process.env.OBSERVE_API_KEY!}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    events: [{
      eventName: 'chat',
      customerReferenceId: user.id,
      featureKey: 'ai_chat',
      model: 'gpt-4o-mini',
      modelProvider: 'openai',
      inputTokens: res.usage?.prompt_tokens,
      outputTokens: res.usage?.completion_tokens,
      durationMs: Date.now() - started,
      idempotencyKey: res.id,
      meta: user.stripeCustomerId ? { stripe_customer_id: user.stripeCustomerId } : undefined,
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
- For non-LLM costs (API calls, compute jobs, file processing), skip \`model\` and include \`costAmount\` (number, in \`costUnit\` which defaults to \`"usd"\`) and/or \`usageUnits\` (number — minutes, images, requests, etc.).
- **Recommended**: \`requestBody\` (the messages you sent) and \`responseBody\` (the provider's response) — without these, the event detail view can't show the prompt and completion.
- Other optional fields: \`timestamp\` (ISO 8601, defaults to now), \`revenueAmount\` (overrides auto-computed revenue), \`costType\` (defaults to \`"llm"\` if model is set, else \`"generic"\`), \`properties\` (arbitrary JSON metadata).
- Batch up to 1000 events per request.

## Step 3 — only if the user asks for auto-instrumentation (Path 3)

**Do not do this by default.** Only install the SDK if the user explicitly says "I want auto-instrumentation" or "I don't want to add a fetch call to every call site" AND they accept that wrapping routes every LLM call through \`observe.tansohq.com\`.

If they do:
1. \`npm install @tansohq/observe\` — with the \`hq\`. The package \`@tanso/observe\` (no hq) does NOT exist on npm. If your install command fails to resolve, STOP and tell the user; do not substitute a similar-looking package.
2. At app startup: \`Observe.configure({ apiKey: process.env.OBSERVE_API_KEY! })\`
3. Per authenticated request: \`Observe.identify({ customerId: user.id })\`
4. Wrap \`new OpenAI()\` and \`new Anthropic()\` with \`Observe.wrap(...)\`. Do not replace the client, just wrap. Do not alter the existing provider API key.
5. Tag each AI feature with \`Observe.feature('<feature_key>')\` or a per-call \`Observe-Feature\` header.

## Do not

- Do not install \`@tanso/observe\`. Correct name: \`@tansohq/observe\`.
- Do not install \`@tansohq/observe\` unless the user explicitly asked for auto-instrumentation. Path 1 requires no SDK.
- Do not replace OpenAI / Anthropic with anything else.
- Do not change \`baseURL\` on an existing provider client unless the user explicitly chose Path 3.
- Do not touch an existing AI gateway (Portkey, LiteLLM, etc.) without asking.
- Do not add Stripe integration as part of Observe setup — Stripe is optional and the user can connect it later from Data Sources → Stripe. If using a restricted Stripe key, it needs read-only access to: Customers, Subscriptions, Products, and Prices.
- Do not log the API key.

## Verify

After wiring up, run the app once and make one LLM call. Use \`"Observe Test"\` as the \`customerReferenceId\` for this first event so it's clearly not a real user. The Data Sources page at https://observe.tansohq.com/data-sources will show "Event received" once it lands.

## What to expect

- **Data Sources page**: Shows connection status and confirms events are flowing.
- **Analytics page**: Shows cost breakdown by feature, model, and customer. Populates as real events come in — you won't see data here until your app sends real traffic. This is normal.
- **Events page**: Shows individual events with cost, model, tokens, and customer. Same as above — fills up with real usage.
- **Customers page**: If you connect Stripe, all your customers appear here immediately with revenue data. As SDK events flow in, cost data gets layered on top for margin calculations.
- **Stripe is optional**: You can connect it later from Data Sources → Connect Stripe. It syncs customers, subscriptions, and MRR for margin analysis. Not required for cost tracking.`;
}

async function copyAiInstallPrompt() {
  const key =
    generatedKey.value ||
    sdkKeys.value[0]?.full_key ||
    (sdkKeys.value[0]?.key_prefix ? sdkKeys.value[0].key_prefix + "..." : null);

  if (!key) {
    toast.error("Generate an API key first");
    return;
  }
  window.navigator.clipboard.writeText(buildAiInstallPrompt(key));
  aiInstallPromptCopied.value = true;
  window.posthog?.capture("install_prompt_copied");
  setTimeout(() => {
    aiInstallPromptCopied.value = false;
  }, 2000);
}

// =============================================================================
// EVENT VERIFICATION (poll until first event arrives)
// =============================================================================

const eventCount = ref<number | null>(null);
const isCheckingEvents = ref(false);
let eventPollTimer: ReturnType<typeof setInterval> | null = null;

const hasEvents = computed(() => (eventCount.value ?? 0) > 0);

async function checkForEvents() {
  if (!isLoggedIn.value) return;
  isCheckingEvents.value = true;
  try {
    const result = await getEvents({ limit: 1 });
    eventCount.value = result.total;
    if (result.total > 0 && eventPollTimer) {
      clearInterval(eventPollTimer);
      eventPollTimer = null;
    }
  } catch {
    // Non-critical
  } finally {
    isCheckingEvents.value = false;
  }
}

function startEventPolling() {
  if (eventPollTimer) return;
  checkForEvents();
  eventPollTimer = setInterval(checkForEvents, 5000);
}

onUnmounted(() => {
  if (eventPollTimer) {
    clearInterval(eventPollTimer);
    eventPollTimer = null;
  }
});

// =============================================================================
// STRIPE
// =============================================================================

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
    const result = await syncStripeData();
    await loadStripeStatus();
    await refetchDataMode();
    const warnings = (result as { warnings?: string[] }).warnings;
    if (warnings?.length) {
      toast.warning(warnings[0]);
    } else {
      toast.success(
        `Synced ${result.synced?.customers ?? 0} customers, ${result.synced?.subscriptions ?? 0} subscriptions`,
      );
    }
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
// PROVIDER MODALS + CSV IMPORT
// =============================================================================

const showOpenAIModal = ref(false);
const showAnthropicModal = ref(false);
const isUploadingProviderCsv = ref(false);
const providerCsvFileInput = ref<HTMLInputElement | null>(null);

// Connection status drives whether the "Backfill historical tokens" button
// is visible for each provider.
const openaiConnected = ref(false);
const anthropicConnected = ref(false);
const isBackfillingOpenAI = ref(false);
const isBackfillingAnthropic = ref(false);

async function loadProviderStatus() {
  try {
    const [oa, an] = await Promise.all([
      getOpenAIStatus(),
      getAnthropicStatus(),
    ]);
    openaiConnected.value = oa.connected;
    anthropicConnected.value = an.connected;
  } catch (err) {
    // Non-critical — backfill button just won't appear.
    console.error("loadProviderStatus failed:", err);
  }
}

async function handleBackfillTokens(provider: "openai" | "anthropic") {
  const flag =
    provider === "openai" ? isBackfillingOpenAI : isBackfillingAnthropic;
  flag.value = true;
  try {
    const summary = await backfillTokens(provider);
    toast.success(`Backfill complete (${provider})`, {
      description: `${summary.rows_updated.toLocaleString()} rows updated across ${summary.buckets_processed} buckets. ${summary.rows_skipped_no_data.toLocaleString()} skipped (no match), ${summary.rows_out_of_retention.toLocaleString()} beyond retention.`,
    });
    queryClient.invalidateQueries({ queryKey: ["events"] });
  } catch (error) {
    toast.error(`Backfill failed (${provider})`, {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    flag.value = false;
  }
}

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
// RESET ACCOUNT DATA
// =============================================================================

const isResettingData = ref(false);

async function handleResetAccountData() {
  const confirmation = window.prompt(
    'This will permanently delete ALL data for this account. Type "RESET" to confirm.',
  );
  if (confirmation !== "RESET") return;

  isResettingData.value = true;
  try {
    await clearData();
    await queryClient.invalidateQueries();
    toast.success("All account data has been reset");
  } catch (error) {
    toast.error("Failed to reset account data", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  } finally {
    isResettingData.value = false;
  }
}

// =============================================================================
// INIT
// =============================================================================

onMounted(async () => {
  if (!isLoggedIn.value) return;
  await Promise.all([loadSdkKeys(), loadStripeStatus(), loadProviderStatus()]);

  window.localStorage.removeItem("observe:fresh_sdk_key");

  startEventPolling();
});

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
        Three steps: get your key, install, verify events are flowing.
      </p>
    </div>

    <!-- Guest: sign-in banner + preview of integration steps -->
    <template v-if="!isLoggedIn">
      <Card class="border-primary/40 bg-primary/5">
        <CardContent
          class="p-5 flex items-center justify-between gap-4 flex-wrap"
        >
          <div>
            <h2 class="font-semibold text-base">Sign up to start tracking</h2>
            <p class="text-sm text-muted-foreground">
              Get an API key, paste one prompt, see events in 30 seconds. Free.
            </p>
          </div>
          <div class="flex gap-2">
            <Button @click="router.push('/signup')">Sign up free</Button>
            <Button variant="outline" @click="router.push('/login')">
              Log in
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- Preview: How it works -->
      <div class="space-y-4">
        <h2
          class="text-sm font-semibold text-muted-foreground uppercase tracking-wider"
        >
          How it works
        </h2>

        <!-- Step 1 preview -->
        <Card class="border-muted">
          <CardContent class="p-5 space-y-3">
            <div class="flex items-center gap-2">
              <div
                class="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold"
              >
                1
              </div>
              <h3 class="font-semibold">Copy one prompt</h3>
            </div>
            <p class="text-sm text-muted-foreground">
              Sign up, click "Copy install prompt", and paste it into Cursor,
              Claude Code, or Copilot. The prompt includes your API key and
              tells the agent exactly how to wire Observe into your repo. No
              config, no SDK, no code to write.
            </p>
            <div class="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div class="flex items-center gap-3 text-sm">
                <div
                  class="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0"
                >
                  1
                </div>
                <span>Sign up and get your API key (auto-generated)</span>
              </div>
              <div class="flex items-center gap-3 text-sm">
                <div
                  class="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0"
                >
                  2
                </div>
                <span
                  >Click
                  <span class="font-medium">"Copy install prompt"</span></span
                >
              </div>
              <div class="flex items-center gap-3 text-sm">
                <div
                  class="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0"
                >
                  3
                </div>
                <span
                  >Paste into your AI coding agent. It handles the rest.</span
                >
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Step 2 preview -->
        <Card class="border-muted">
          <CardContent class="p-5">
            <div class="flex items-center gap-3">
              <div
                class="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold"
              >
                2
              </div>
              <div>
                <h3 class="font-semibold">Events flow in automatically</h3>
                <p class="text-sm text-muted-foreground">
                  Run your app, make one LLM call, and Observe picks it up.
                  Cost, model, customer, and feature are all tracked per event.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Step 3 preview -->
        <Card class="border-muted">
          <CardContent class="p-5">
            <div class="flex items-center gap-3">
              <div
                class="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-muted-foreground text-xs font-bold"
              >
                3
              </div>
              <div>
                <h3 class="font-semibold">
                  Connect revenue
                  <span class="text-xs font-normal text-muted-foreground"
                    >(optional)</span
                  >
                </h3>
                <p class="text-sm text-muted-foreground">
                  Link Stripe to see margins per feature and customer. Also
                  supports OpenAI and Anthropic dashboard syncs for historical
                  cost data.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </template>

    <!-- ================================================================== -->
    <!-- STEP 1: Install — hero prompt + API key                            -->
    <!-- ================================================================== -->
    <Card
      v-if="isLoggedIn"
      class="border-primary/40 bg-gradient-to-br from-violet-500/10 via-primary/5 to-blue-500/10"
    >
      <CardContent class="p-6 space-y-5">
        <!-- Install prompt hero -->
        <div class="flex items-start justify-between gap-6 flex-wrap">
          <div class="flex-1 min-w-[260px] space-y-2">
            <div class="flex items-center gap-2">
              <Zap class="h-5 w-5 text-primary" />
              <h2 class="font-semibold text-lg">
                Step 1 · Install Observe in 30 seconds
              </h2>
            </div>
            <p class="text-sm text-muted-foreground max-w-prose">
              Open your project in Cursor, Claude Code, or Copilot, then paste
              this prompt.
            </p>
            <p class="text-sm text-muted-foreground max-w-prose">
              The prompt includes your API key and tells the agent to wire
              Observe into the repo, create <code class="font-mono">.env</code>,
              and make the first ingest call. You don't need to touch any
              config.
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

        <div
          v-if="loomEmbedUrl && sdkKeys.length === 0"
          class="border-t border-primary/10 pt-5"
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

        <!-- API key inline -->
        <div class="border-t border-primary/10 pt-5 space-y-3">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div class="flex items-center gap-2">
              <Key class="h-4 w-4 text-primary" />
              <h3 class="font-medium text-sm">Your API key</h3>
            </div>
            <!-- Add another key hidden for now — single key per org is simpler -->
          </div>

          <!-- Fresh key -->
          <div
            v-if="generatedKey"
            class="rounded-lg border bg-muted/40 p-4 space-y-2"
          >
            <div
              class="flex items-center gap-2 text-xs font-medium text-success"
            >
              <Key class="h-3 w-3" />
              Key ready
            </div>
            <div class="flex items-center gap-2">
              <code
                class="flex-1 text-sm font-mono bg-background border rounded px-3 py-2 select-all break-all"
                >{{ generatedKey.slice(0, 11) }}••••••••••••••••••••</code
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
              Already embedded in the install prompt above. Also add it to your
              <code class="font-mono">.env</code> as
              <code class="font-mono">OBSERVE_API_KEY</code>.
            </p>
          </div>

          <!-- Existing keys -->
          <div v-else-if="sdkKeys.length > 0" class="space-y-2">
            <div
              v-for="key in sdkKeys"
              :key="key.id"
              class="rounded-md border bg-card px-3 py-2.5 flex items-center justify-between gap-3"
            >
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <span class="text-xs font-medium whitespace-nowrap">{{
                  key.name || "default"
                }}</span>
                <code
                  class="font-mono text-xs text-muted-foreground truncate min-w-0 flex-1"
                  >{{ key.key_prefix + "••••••••••••" }}</code
                >
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  class="h-8 text-xs"
                  :disabled="!key.full_key"
                  :title="
                    !key.full_key
                      ? 'Legacy key — roll to view full key'
                      : copiedPrefixId === key.id
                        ? 'Copied!'
                        : 'Copy key'
                  "
                  @click="copyKeyValue(key)"
                >
                  <Check
                    v-if="copiedPrefixId === key.id"
                    class="h-3.5 w-3.5 mr-1"
                  />
                  <Copy v-else class="h-3.5 w-3.5 mr-1" />
                  {{ copiedPrefixId === key.id ? "Copied" : "Copy" }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="h-8 text-xs"
                  title="Roll — invalidates the old key and shows the new one"
                  @click="handleResetKey(key.id)"
                >
                  <RefreshCw class="h-3.5 w-3.5 mr-1" />
                  Roll
                </Button>
                <Button
                  v-if="sdkKeys.length > 1"
                  variant="outline"
                  size="sm"
                  class="h-8 text-xs hover:text-destructive"
                  title="Delete key"
                  @click="handleRevokeKey(key.id)"
                >
                  <Trash2 class="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
            <p class="text-[11px] text-muted-foreground">
              Keys stay visible here. Roll any time the current one is
              compromised — the old key stops working immediately.
            </p>
          </div>

          <!-- No keys -->
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

          <!-- Secondary key generator -->
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
        </div>
      </CardContent>
    </Card>

    <!-- ================================================================== -->
    <!-- STEP 2: Verify — listening for events                              -->
    <!-- ================================================================== -->
    <Card
      v-if="isLoggedIn"
      :class="
        hasEvents
          ? 'border-success/40 bg-success/5'
          : 'border-amber-500/30 bg-amber-500/5'
      "
    >
      <CardContent class="p-6">
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <div class="flex items-center gap-3">
            <CheckCircle2
              v-if="hasEvents"
              class="h-5 w-5 text-success shrink-0"
            />
            <Radio
              v-else
              class="h-5 w-5 text-amber-500 shrink-0 animate-pulse"
            />
            <div>
              <h2 class="font-semibold text-lg">
                Step 2 ·
                {{
                  hasEvents
                    ? `${eventCount!.toLocaleString()} ${eventCount === 1 ? "event" : "events"} received`
                    : "Listening for events…"
                }}
              </h2>
              <p class="text-sm text-muted-foreground">
                {{
                  hasEvents
                    ? "Your integration is working. Events are flowing into Observe."
                    : "Paste the install prompt into your AI coding agent, run your app, and make one LLM call."
                }}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Button
              v-if="hasEvents"
              variant="outline"
              size="sm"
              class="h-8 text-xs"
              @click="router.push('/events')"
            >
              View events
              <ArrowRight class="h-3 w-3 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- ================================================================== -->
    <!-- STEP 3: Connect revenue (Stripe)                                   -->
    <!-- ================================================================== -->
    <div v-if="isLoggedIn" class="space-y-2">
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
                    <h3 class="font-semibold">Step 3 · Connect Stripe</h3>
                    <span
                      class="text-[10px] font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full"
                      >Revenue data</span
                    >
                  </div>
                  <p class="text-sm text-muted-foreground">
                    Auto-sync customers, subscriptions, and MRR so Observe can
                    calculate margins per feature and customer.
                  </p>
                  <p class="text-xs text-muted-foreground/60 mt-1">
                    Using a restricted key? Enable read-only access to:
                    Customers, Subscriptions, Products, and Prices.
                  </p>
                </div>
              </div>
              <Button
                v-if="canEdit"
                class="ml-4"
                @click="showStripeModal = true"
              >
                Connect
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
    </div>

    <!-- ================================================================== -->
    <!-- ADVANCED: manual snippet (collapsed)                               -->
    <!-- ================================================================== -->
    <details class="group">
      <summary
        class="text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
      >
        Manual integration (code snippets)
      </summary>
      <div class="mt-4">
        <Card class="border-muted">
          <CardContent class="p-6 space-y-5">
            <div>
              <div class="flex items-center gap-2">
                <h2 class="font-semibold text-lg">Direct ingest</h2>
                <span
                  class="text-[10px] font-medium bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full"
                  >Off critical path · body-only</span
                >
              </div>
              <p class="text-sm text-muted-foreground">
                Call OpenAI / Anthropic / anything else directly, then post one
                event to Observe after the call returns.
              </p>
            </div>

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
      <span class="text-sky-300">customerReferenceId</span>: user.id,              <span class="text-zinc-500">// your app's user ID</span>
      <span class="text-sky-300">featureKey</span>: <span class="text-amber-300">'ai_chat'</span>,                  <span class="text-zinc-500">// which product feature</span>
      <span class="text-sky-300">model</span>: <span class="text-amber-300">'gpt-4o-mini'</span>,
      <span class="text-sky-300">modelProvider</span>: <span class="text-amber-300">'openai'</span>,
      <span class="text-sky-300">inputTokens</span>: res.usage?.prompt_tokens,
      <span class="text-sky-300">outputTokens</span>: res.usage?.completion_tokens,
      <span class="text-sky-300">durationMs</span>: Date.now() - started,
      <span class="text-sky-300">idempotencyKey</span>: res.id,                   <span class="text-zinc-500">// safe retries</span>
      <span class="text-sky-300">requestBody</span>: { messages },                 <span class="text-zinc-500">// shows prompt in detail view</span>
      <span class="text-sky-300">responseBody</span>: { <span class="text-sky-300">choices</span>: [{ <span class="text-sky-300">message</span>: res.choices[0].message }] },
      <span class="text-sky-300">meta</span>: { <span class="text-sky-300">stripe_customer_id</span>: user.stripeId }, <span class="text-zinc-500">// optional: links to Stripe</span>
    }],
  }),
}).catch((err) => console.error(<span class="text-amber-300">'observe ingest failed:'</span>, err))</pre>
            </div>

            <p class="text-[11px] text-muted-foreground">
              Use any stable user ID as customerReferenceId. To link to Stripe,
              add meta.stripe_customer_id. No Stripe? Just the user ID works.
            </p>

            <!-- Other provider snippets -->
            <details class="group">
              <summary
                class="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              >
                Google Gemini, Cohere, and Mistral examples
              </summary>
              <div class="mt-3 space-y-4">
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
<span class="text-zinc-500">// Add Observe-Key, Observe-Customer, Observe-Feature via fetch override or headers.</span></pre>
                  </div>
                </div>
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
<span class="text-zinc-500">// Add Observe-Key, Observe-Customer, Observe-Feature via additionalHeaders.</span></pre>
                  </div>
                </div>
              </div>
            </details>

            <!-- Other integration methods -->
            <details class="group">
              <summary
                class="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              >
                Other integration methods (SDK wrapper, REST API)
              </summary>
              <div class="mt-3 space-y-4">
                <div>
                  <h4 class="text-xs font-semibold mb-2">
                    Auto-instrumentation (SDK wrap)
                  </h4>
                  <p class="text-[11px] text-muted-foreground mb-2">
                    <span class="font-mono">npm install @tansohq/observe</span>
                    — wraps your provider client so every call is auto-tracked.
                    Only pick this if you accept that Observe sits in front of
                    your LLM calls.
                  </p>
                  <div
                    class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
                  >
                    <pre
                      class="whitespace-pre text-zinc-100"
                    ><span class="text-emerald-400">import</span> { Observe } <span class="text-emerald-400">from</span> <span class="text-amber-300">'@tansohq/observe'</span>
<span class="text-emerald-400">import</span> OpenAI <span class="text-emerald-400">from</span> <span class="text-amber-300">'openai'</span>

Observe.configure({ <span class="text-sky-300">apiKey</span>: <span class="text-amber-300">'{{ apiKeyForSnippet }}'</span> })
Observe.identify({ <span class="text-sky-300">customerId</span>: user.id })  <span class="text-zinc-500">// your app's user ID</span>

<span class="text-emerald-400">const</span> openai = Observe.wrap(<span class="text-emerald-400">new</span> OpenAI())
<span class="text-zinc-500">// All calls auto-tracked — no headers to manage</span></pre>
                  </div>
                </div>
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

            <!-- Infrastructure / non-AI costs -->
            <details class="group">
              <summary
                class="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
              >
                Infrastructure costs (Pinecone, Supabase, AWS, etc.)
              </summary>
              <div class="mt-3 space-y-3">
                <p class="text-[11px] text-muted-foreground">
                  Track any cost alongside your AI costs. Set
                  <code class="font-mono bg-muted px-1 rounded">costType</code>
                  to categorize it (e.g. "database", "vector_db", "compute",
                  "storage"). No model or tokens needed.
                </p>
                <div
                  class="rounded-md bg-zinc-950 border border-zinc-800 p-4 font-mono text-xs leading-relaxed overflow-x-auto"
                >
                  <pre
                    class="whitespace-pre text-zinc-100"
                  ><span class="text-zinc-500">// Track infrastructure costs alongside AI costs</span>
fetch(<span class="text-amber-300">'{{ ingestUrl }}'</span>, {
  <span class="text-sky-300">method</span>: <span class="text-amber-300">'POST'</span>,
  <span class="text-sky-300">headers</span>: {
    <span class="text-amber-300">'Authorization'</span>: <span class="text-amber-300">`Bearer {{ apiKeyForSnippet }}`</span>,
    <span class="text-amber-300">'Content-Type'</span>: <span class="text-amber-300">'application/json'</span>,
  },
  <span class="text-sky-300">body</span>: JSON.stringify({
    <span class="text-sky-300">events</span>: [{
      <span class="text-sky-300">eventName</span>: <span class="text-amber-300">'pinecone_query'</span>,
      <span class="text-sky-300">customerReferenceId</span>: user.id,
      <span class="text-sky-300">featureKey</span>: <span class="text-amber-300">'rag_search'</span>,
      <span class="text-sky-300">costAmount</span>: 0.0012,                  <span class="text-zinc-500">// explicit cost in USD</span>
      <span class="text-sky-300">costType</span>: <span class="text-amber-300">'vector_db'</span>,               <span class="text-zinc-500">// categorize the cost</span>
    }],
  }),
}).catch(console.error)</pre>
                </div>
                <p class="text-[11px] text-muted-foreground">
                  Common cost types:
                  <code class="font-mono bg-muted px-1 rounded">llm</code>
                  (default),
                  <code class="font-mono bg-muted px-1 rounded">vector_db</code
                  >,
                  <code class="font-mono bg-muted px-1 rounded">database</code>,
                  <code class="font-mono bg-muted px-1 rounded">compute</code>,
                  <code class="font-mono bg-muted px-1 rounded">storage</code>,
                  <code class="font-mono bg-muted px-1 rounded">search</code>,
                  or any string you choose.
                </p>
              </div>
            </details>

            <!-- Supported endpoints -->
            <div class="text-xs space-y-1 border-t pt-3">
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]"
                  >POST /v1/chat/completions</span
                >
                <span class="text-muted-foreground">OpenAI chat</span>
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]"
                  >POST /v1/embeddings</span
                >
                <span class="text-muted-foreground">OpenAI embeddings</span>
              </div>
              <div class="flex gap-2">
                <span
                  class="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]"
                  >POST /v1/messages</span
                >
                <span class="text-muted-foreground">Anthropic messages</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </details>

    <!-- IMPORT HISTORICAL DATA — hidden pending QA -->
    <details v-if="false" class="group">
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
              <div class="flex items-center gap-2">
                <Button
                  v-if="canEdit && openaiConnected"
                  variant="outline"
                  size="sm"
                  :disabled="isBackfillingOpenAI"
                  title="Fill in input/output token splits for historical events using OpenAI's daily usage API (last 30 days only)."
                  @click="handleBackfillTokens('openai')"
                >
                  <Loader2
                    v-if="isBackfillingOpenAI"
                    class="mr-2 h-4 w-4 animate-spin"
                  />
                  {{
                    isBackfillingOpenAI
                      ? "Backfilling…"
                      : "Backfill historical tokens"
                  }}
                </Button>
                <p v-else-if="canEdit" class="text-xs text-muted-foreground">
                  Connect OpenAI above to enable backfill
                </p>
              </div>
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
              <div class="flex items-center gap-2">
                <Button
                  v-if="canEdit && anthropicConnected"
                  variant="outline"
                  size="sm"
                  :disabled="isBackfillingAnthropic"
                  title="Fill in input/output token splits for historical events using Anthropic's daily usage API (last 90 days only)."
                  @click="handleBackfillTokens('anthropic')"
                >
                  <Loader2
                    v-if="isBackfillingAnthropic"
                    class="mr-2 h-4 w-4 animate-spin"
                  />
                  {{
                    isBackfillingAnthropic
                      ? "Backfilling…"
                      : "Backfill historical tokens"
                  }}
                </Button>
                <p v-else-if="canEdit" class="text-xs text-muted-foreground">
                  Connect Anthropic above to enable backfill
                </p>
              </div>
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

    <!-- ================================================================== -->
    <details v-if="isLoggedIn" class="group">
      <summary
        class="text-sm font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
      >
        Reset account data
      </summary>
      <div class="mt-3">
        <Card class="border-destructive/40">
          <CardContent class="p-4 space-y-3">
            <p class="text-xs text-muted-foreground">
              Permanently deletes <strong>all</strong> events, customers,
              subscriptions, integrations, SDK keys, features, alerts, and
              cohorts. Your account and team members are kept.
              <strong>Your existing API key will stop working.</strong>
              After reset: update your app with the new API key, re-connect
              Stripe, and send events to start fresh.
            </p>
            <Button
              variant="destructive"
              size="sm"
              :disabled="isResettingData"
              @click="handleResetAccountData"
            >
              <Loader2
                v-if="isResettingData"
                class="h-3 w-3 mr-1.5 animate-spin"
              />
              <Trash2 v-else class="h-3 w-3 mr-1.5" />
              {{ isResettingData ? "Resetting…" : "Reset Account Data" }}
            </Button>
          </CardContent>
        </Card>
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
