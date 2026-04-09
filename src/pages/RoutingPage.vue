<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import {
  GitBranch,
  Plus,
  Trash2,
  ChevronRight,
  ArrowLeft,
  Settings2,
  Zap,
  Shield,
  TestTube,
  Loader2,
  Copy,
  Check,
} from "lucide-vue-next";
import { useAuth } from "@/composables/useAuth";
import { Card, Button, Input, Skeleton, Badge } from "@/components/ui";
import {
  listRoutingConfigs,
  getRoutingConfig,
  createRoutingConfig,
  deleteRoutingConfig,
  addRoutingTarget,
  deleteRoutingTarget,
  addRoutingRule,
  deleteRoutingRule,
  testRoutingConfig,
  listGatewayProviders,
} from "@/lib/api";
import type { RoutingRule } from "@/lib/api";

const queryClient = useQueryClient();
const { isLoggedIn } = useAuth();

// ── State ────────────────────────────────────────────────────────────────────

const selectedConfigId = ref<number | null>(null);
const showCreateForm = ref(false);
const showTargetForm = ref(false);
const showRuleForm = ref(false);
const showTestPanel = ref(false);
const isSubmitting = ref(false);
const copied = ref(false);

// Create form
const newConfigName = ref("");
const newConfigDescription = ref("");

// Target form
const targetProvider = ref("openai");
const targetModel = ref("");
const targetApiKey = ref("");
const targetBaseUrl = ref("");
const targetPriority = ref(0);
const targetTimeoutMs = ref(25000);

// Rule form
const ruleField = ref("region");
const ruleOperator = ref("eq");
const ruleValue = ref("");
const ruleTargetId = ref<number | null>(null);

// Test panel
const testMetadata = ref<Record<string, string>>({
  region: "",
  customer_id: "",
  feature_key: "",
});
const testResult = ref<{
  config: string;
  matched_rule: RoutingRule | null;
  target_order: Array<{
    id: number;
    provider: string;
    model: string;
    priority: number;
  }>;
} | null>(null);

// ── Queries ──────────────────────────────────────────────────────────────────

const { data: configsData, isLoading: configsLoading } = useQuery({
  queryKey: ["routing-configs"],
  queryFn: listRoutingConfigs,
  enabled: isLoggedIn,
});

const configs = computed(() => configsData.value?.configs ?? []);

const { data: selectedConfig, isLoading: configLoading } = useQuery({
  queryKey: computed(() => ["routing-config", selectedConfigId.value]),
  queryFn: () => getRoutingConfig(selectedConfigId.value!),
  enabled: computed(() => selectedConfigId.value !== null),
});

const { data: providersData } = useQuery({
  queryKey: ["gateway-providers"],
  queryFn: listGatewayProviders,
});

const providers = computed(() => providersData.value?.providers ?? []);
const targets = computed(() => selectedConfig.value?.targets ?? []);
const rules = computed(() => selectedConfig.value?.rules ?? []);

// ── Provider styling ─────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  openai: "bg-green-100 text-green-700 border-green-200",
  anthropic: "bg-orange-100 text-orange-700 border-orange-200",
  google: "bg-blue-100 text-blue-700 border-blue-200",
  togetherai: "bg-purple-100 text-purple-700 border-purple-200",
  nebius: "bg-cyan-100 text-cyan-700 border-cyan-200",
  groq: "bg-red-100 text-red-700 border-red-200",
  fireworks: "bg-amber-100 text-amber-700 border-amber-200",
  deepseek: "bg-indigo-100 text-indigo-700 border-indigo-200",
};

function providerClass(provider: string) {
  return (
    PROVIDER_COLORS[provider] || "bg-muted text-muted-foreground border-border"
  );
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function handleCreateConfig() {
  if (!newConfigName.value.trim()) return;
  isSubmitting.value = true;
  try {
    const created = await createRoutingConfig({
      name: newConfigName.value.trim(),
      description: newConfigDescription.value.trim() || undefined,
    });
    queryClient.invalidateQueries({ queryKey: ["routing-configs"] });
    selectedConfigId.value = created.id;
    showCreateForm.value = false;
    newConfigName.value = "";
    newConfigDescription.value = "";
    toast.success("Config created");
  } catch (err: any) {
    toast.error(err.message || "Failed to create config");
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDeleteConfig(id: number) {
  try {
    await deleteRoutingConfig(id);
    queryClient.invalidateQueries({ queryKey: ["routing-configs"] });
    if (selectedConfigId.value === id) selectedConfigId.value = null;
    toast.success("Config deleted");
  } catch (err: any) {
    toast.error(err.message || "Failed to delete config");
  }
}

async function handleAddTarget() {
  if (!targetModel.value.trim() || !selectedConfigId.value) return;
  isSubmitting.value = true;
  try {
    await addRoutingTarget(selectedConfigId.value, {
      provider: targetProvider.value,
      model: targetModel.value.trim(),
      api_key: targetApiKey.value || undefined,
      api_base_url: targetBaseUrl.value || undefined,
      priority: targetPriority.value,
      timeout_ms: targetTimeoutMs.value,
    });
    queryClient.invalidateQueries({
      queryKey: ["routing-config", selectedConfigId.value],
    });
    showTargetForm.value = false;
    targetModel.value = "";
    targetApiKey.value = "";
    targetBaseUrl.value = "";
    targetPriority.value = targets.value.length;
    toast.success("Target added");
  } catch (err: any) {
    toast.error(err.message || "Failed to add target");
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDeleteTarget(targetId: number) {
  if (!selectedConfigId.value) return;
  try {
    await deleteRoutingTarget(selectedConfigId.value, targetId);
    queryClient.invalidateQueries({
      queryKey: ["routing-config", selectedConfigId.value],
    });
    toast.success("Target removed");
  } catch (err: any) {
    toast.error(err.message || "Failed to delete target");
  }
}

async function handleAddRule() {
  if (!ruleValue.value.trim() || !selectedConfigId.value) return;
  isSubmitting.value = true;
  try {
    await addRoutingRule(selectedConfigId.value, {
      field: ruleField.value,
      operator: ruleOperator.value,
      value: ruleValue.value.trim(),
      target_id: ruleTargetId.value || undefined,
    });
    queryClient.invalidateQueries({
      queryKey: ["routing-config", selectedConfigId.value],
    });
    showRuleForm.value = false;
    ruleValue.value = "";
    ruleTargetId.value = null;
    toast.success("Rule added");
  } catch (err: any) {
    toast.error(err.message || "Failed to add rule");
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDeleteRule(ruleId: number) {
  if (!selectedConfigId.value) return;
  try {
    await deleteRoutingRule(selectedConfigId.value, ruleId);
    queryClient.invalidateQueries({
      queryKey: ["routing-config", selectedConfigId.value],
    });
    toast.success("Rule removed");
  } catch (err: any) {
    toast.error(err.message || "Failed to delete rule");
  }
}

async function handleTest() {
  if (!selectedConfigId.value) return;
  try {
    const result = await testRoutingConfig(
      selectedConfigId.value,
      testMetadata.value,
    );
    testResult.value = result;
  } catch (err: any) {
    toast.error(err.message || "Test failed");
  }
}

function copyEndpoint() {
  navigator.clipboard.writeText("POST /api/v1/gateway/chat/completions");
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Routing</h1>
        <p class="text-sm text-muted-foreground mt-1">
          Route LLM requests to providers with fallback chains
        </p>
      </div>
      <div class="flex gap-2">
        <Button
          v-if="!selectedConfigId"
          size="sm"
          @click="showCreateForm = true"
        >
          <Plus class="h-3.5 w-3.5 mr-1.5" />
          New Config
        </Button>
        <Button
          v-if="selectedConfigId"
          variant="outline"
          size="sm"
          @click="selectedConfigId = null"
        >
          <ArrowLeft class="h-3.5 w-3.5 mr-1.5" />
          All Configs
        </Button>
      </div>
    </div>

    <!-- Endpoint hint -->
    <div
      v-if="!selectedConfigId && configs.length > 0"
      class="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm"
    >
      <Zap class="h-4 w-4 text-primary shrink-0" />
      <div class="flex-1">
        <span class="font-medium">Gateway endpoint:</span>
        <code class="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-xs font-mono"
          >POST /api/v1/gateway/chat/completions</code
        >
      </div>
      <button
        class="text-muted-foreground hover:text-foreground"
        @click="copyEndpoint"
      >
        <Check v-if="copied" class="h-3.5 w-3.5 text-success" />
        <Copy v-else class="h-3.5 w-3.5" />
      </button>
    </div>

    <!-- Loading -->
    <div v-if="configsLoading" class="space-y-3">
      <Card v-for="i in 3" :key="i" class="p-4">
        <Skeleton class="h-5 w-40 mb-2" />
        <Skeleton class="h-4 w-24" />
      </Card>
    </div>

    <!-- Create form -->
    <Card v-if="showCreateForm" class="p-4 space-y-3 border-primary/30">
      <div class="text-sm font-medium">New Routing Config</div>
      <Input
        v-model="newConfigName"
        placeholder="Config name (e.g., default, eu-routing)"
      />
      <Input
        v-model="newConfigDescription"
        placeholder="Description (optional)"
      />
      <div class="flex gap-2">
        <Button
          size="sm"
          :disabled="isSubmitting || !newConfigName.trim()"
          @click="handleCreateConfig"
        >
          <Loader2
            v-if="isSubmitting"
            class="h-3.5 w-3.5 mr-1.5 animate-spin"
          />
          Create
        </Button>
        <Button variant="outline" size="sm" @click="showCreateForm = false"
          >Cancel</Button
        >
      </div>
    </Card>

    <!-- Config list -->
    <div v-if="!selectedConfigId && !configsLoading" class="space-y-2">
      <div
        v-if="configs.length === 0 && !showCreateForm"
        class="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto"
      >
        <GitBranch class="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p class="text-sm font-medium mb-1">No routing configs yet</p>
        <p class="text-xs text-muted-foreground">
          Create a routing config to define provider targets, fallback chains,
          and conditional routing rules. Use the button above to get started.
        </p>
      </div>

      <Card
        v-for="config in configs"
        :key="config.id"
        class="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
        @click="selectedConfigId = config.id"
      >
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-medium text-sm">{{ config.name }}</span>
              <Badge
                v-if="config.is_active"
                class="bg-success/10 text-success text-[10px]"
                >Active</Badge
              >
              <Badge v-else class="bg-muted text-muted-foreground text-[10px]"
                >Inactive</Badge
              >
            </div>
            <div class="text-xs text-muted-foreground mt-0.5">
              {{ config.description || "No description" }}
              <span class="mx-1">&middot;</span>
              {{ config.target_count || 0 }} target{{
                (config.target_count || 0) === 1 ? "" : "s"
              }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="text-muted-foreground hover:text-destructive p-1"
              @click.stop="handleDeleteConfig(config.id)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </button>
            <ChevronRight class="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </Card>
    </div>

    <!-- Config detail -->
    <template v-if="selectedConfigId">
      <div v-if="configLoading" class="space-y-3">
        <Skeleton class="h-8 w-48" />
        <Skeleton class="h-32 w-full" />
      </div>

      <template v-else-if="selectedConfig">
        <!-- Config header -->
        <div class="flex items-center gap-3">
          <h2 class="text-lg font-semibold">{{ selectedConfig.name }}</h2>
          <Badge
            v-if="selectedConfig.is_active"
            class="bg-success/10 text-success text-[10px]"
            >Active</Badge
          >
        </div>

        <!-- Targets section -->
        <Card>
          <div class="p-4 border-b flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Settings2 class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-medium">Targets</span>
              <span class="text-xs text-muted-foreground"
                >(ordered by priority — first match wins, rest are
                fallbacks)</span
              >
            </div>
            <Button
              size="sm"
              variant="outline"
              @click="showTargetForm = !showTargetForm"
            >
              <Plus class="h-3 w-3 mr-1" />
              Add Target
            </Button>
          </div>

          <!-- Add target form -->
          <div v-if="showTargetForm" class="p-4 border-b bg-muted/20 space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >Provider</label
                >
                <select
                  v-model="targetProvider"
                  class="w-full h-9 rounded-md border bg-background px-3 pr-8 py-2 text-sm appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
                >
                  <option v-for="p in providers" :key="p" :value="p">
                    {{ p }}
                  </option>
                </select>
              </div>
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >Model</label
                >
                <Input
                  v-model="targetModel"
                  placeholder="e.g., gpt-4o, claude-sonnet-4-20250514"
                />
              </div>
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >API Key</label
                >
                <Input
                  v-model="targetApiKey"
                  type="password"
                  placeholder="sk-..."
                />
              </div>
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >Base URL (optional, for EU endpoints)</label
                >
                <Input
                  v-model="targetBaseUrl"
                  placeholder="https://eu.api.together.xyz"
                />
              </div>
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >Priority (lower = tried first)</label
                >
                <Input v-model.number="targetPriority" type="number" />
              </div>
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >Timeout (ms)</label
                >
                <Input v-model.number="targetTimeoutMs" type="number" />
              </div>
            </div>
            <div class="flex gap-2">
              <Button
                size="sm"
                :disabled="isSubmitting || !targetModel.trim()"
                @click="handleAddTarget"
              >
                <Loader2
                  v-if="isSubmitting"
                  class="h-3.5 w-3.5 mr-1.5 animate-spin"
                />
                Add Target
              </Button>
              <Button
                variant="outline"
                size="sm"
                @click="showTargetForm = false"
                >Cancel</Button
              >
            </div>
          </div>

          <!-- Target list -->
          <div
            v-if="targets.length === 0 && !showTargetForm"
            class="p-8 text-center text-sm text-muted-foreground"
          >
            No targets configured. Add a provider target to start routing.
          </div>
          <div v-else class="divide-y">
            <div
              v-for="(target, i) in targets"
              :key="target.id"
              class="px-4 py-3 flex items-center gap-3"
            >
              <span
                class="text-xs text-muted-foreground font-mono w-6 text-right"
                >{{ i + 1 }}</span
              >
              <span
                :class="[
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
                  providerClass(target.provider),
                ]"
                >{{ target.provider }}</span
              >
              <span class="font-mono text-xs bg-muted px-2 py-0.5 rounded">{{
                target.model
              }}</span>
              <span
                v-if="target.api_base_url"
                class="text-[10px] text-muted-foreground truncate max-w-[200px]"
              >
                {{ target.api_base_url }}
              </span>
              <div class="flex-1" />
              <span class="text-[10px] text-muted-foreground"
                >{{ target.timeout_ms / 1000 }}s timeout</span
              >
              <button
                class="text-muted-foreground hover:text-destructive p-1"
                @click="handleDeleteTarget(target.id)"
              >
                <Trash2 class="h-3 w-3" />
              </button>
            </div>
          </div>
        </Card>

        <!-- Rules section -->
        <Card>
          <div class="p-4 border-b flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Shield class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-medium">Rules</span>
              <span class="text-xs text-muted-foreground"
                >(conditional routing based on metadata)</span
              >
            </div>
            <Button
              size="sm"
              variant="outline"
              @click="showRuleForm = !showRuleForm"
            >
              <Plus class="h-3 w-3 mr-1" />
              Add Rule
            </Button>
          </div>

          <!-- Add rule form -->
          <div v-if="showRuleForm" class="p-4 border-b bg-muted/20 space-y-3">
            <div class="grid grid-cols-4 gap-3">
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >Field</label
                >
                <select
                  v-model="ruleField"
                  class="w-full h-9 rounded-md border bg-background px-3 pr-8 py-2 text-sm appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
                >
                  <option value="region">region</option>
                  <option value="customer_id">customer_id</option>
                  <option value="feature_key">feature_key</option>
                </select>
              </div>
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >Operator</label
                >
                <select
                  v-model="ruleOperator"
                  class="w-full h-9 rounded-md border bg-background px-3 pr-8 py-2 text-sm appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
                >
                  <option value="eq">equals</option>
                  <option value="neq">not equals</option>
                  <option value="in">in list</option>
                  <option value="contains">contains</option>
                </select>
              </div>
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >Value</label
                >
                <Input v-model="ruleValue" placeholder="e.g., eu, acme_corp" />
              </div>
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >Route to target</label
                >
                <select
                  v-model="ruleTargetId"
                  class="w-full h-9 rounded-md border bg-background px-3 pr-8 py-2 text-sm appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
                >
                  <option :value="null">Auto (priority order)</option>
                  <option v-for="t in targets" :key="t.id" :value="t.id">
                    {{ t.provider }} / {{ t.model }}
                  </option>
                </select>
              </div>
            </div>
            <div class="flex gap-2">
              <Button
                size="sm"
                :disabled="isSubmitting || !ruleValue.trim()"
                @click="handleAddRule"
                >Add Rule</Button
              >
              <Button variant="outline" size="sm" @click="showRuleForm = false"
                >Cancel</Button
              >
            </div>
          </div>

          <!-- Rule list -->
          <div
            v-if="rules.length === 0 && !showRuleForm"
            class="p-6 text-center text-sm text-muted-foreground"
          >
            No rules. All requests will follow the default priority order.
          </div>
          <div v-else class="divide-y">
            <div
              v-for="rule in rules"
              :key="rule.id"
              class="px-4 py-3 flex items-center gap-2 text-sm"
            >
              <code class="bg-muted px-1.5 py-0.5 rounded text-xs">{{
                rule.field
              }}</code>
              <span class="text-muted-foreground text-xs">{{
                rule.operator
              }}</span>
              <code class="bg-muted px-1.5 py-0.5 rounded text-xs">{{
                rule.value
              }}</code>
              <span v-if="rule.target_id" class="text-xs text-muted-foreground">
                &rarr; target #{{ rule.target_id }}
              </span>
              <div class="flex-1" />
              <button
                class="text-muted-foreground hover:text-destructive p-1"
                @click="handleDeleteRule(rule.id)"
              >
                <Trash2 class="h-3 w-3" />
              </button>
            </div>
          </div>
        </Card>

        <!-- Test panel -->
        <Card>
          <div class="p-4 border-b flex items-center justify-between">
            <div class="flex items-center gap-2">
              <TestTube class="h-4 w-4 text-muted-foreground" />
              <span class="text-sm font-medium">Test Routing</span>
              <span class="text-xs text-muted-foreground"
                >(dry run — no LLM calls)</span
              >
            </div>
            <Button
              size="sm"
              variant="outline"
              @click="showTestPanel = !showTestPanel"
            >
              {{ showTestPanel ? "Hide" : "Show" }}
            </Button>
          </div>

          <div v-if="showTestPanel" class="p-4 space-y-3">
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >Region</label
                >
                <Input v-model="testMetadata.region" placeholder="us, eu" />
              </div>
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >Customer ID</label
                >
                <Input
                  v-model="testMetadata.customer_id"
                  placeholder="acme_corp"
                />
              </div>
              <div>
                <label
                  class="text-xs font-medium text-muted-foreground mb-1 block"
                  >Feature Key</label
                >
                <Input
                  v-model="testMetadata.feature_key"
                  placeholder="chat_assistant"
                />
              </div>
            </div>
            <Button size="sm" @click="handleTest">Run Test</Button>

            <div
              v-if="testResult"
              class="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs"
            >
              <div
                v-if="testResult.matched_rule"
                class="text-primary font-medium"
              >
                Matched rule: {{ testResult.matched_rule.field }}
                {{ testResult.matched_rule.operator }}
                {{ testResult.matched_rule.value }}
              </div>
              <div v-else class="text-muted-foreground">
                No rules matched — using default priority order
              </div>
              <div class="font-medium mt-2">Target execution order:</div>
              <div
                v-for="(t, i) in testResult.target_order"
                :key="t.id"
                class="flex items-center gap-2 pl-2"
              >
                <span class="font-mono text-muted-foreground"
                  >{{ i + 1 }}.</span
                >
                <span
                  :class="[
                    'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                    providerClass(t.provider),
                  ]"
                  >{{ t.provider }}</span
                >
                <span class="font-mono">{{ t.model }}</span>
              </div>
            </div>
          </div>
        </Card>
      </template>
    </template>
  </div>
</template>
