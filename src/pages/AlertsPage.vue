<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import {
  Bell,
  Plus,
  Trash2,
  Loader2,
  ExternalLink,
  ChevronLeft,
} from "lucide-vue-next";
import { useAuth } from "@/composables/useAuth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
} from "@/components/ui";
import {
  listAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  listAlertHistory,
} from "@/lib/api";
import type { AlertRule } from "@/lib/api";

const queryClient = useQueryClient();
const router = useRouter();
const { isLoggedIn } = useAuth();

const { data, isLoading, isError } = useQuery({
  queryKey: ["alert-rules"],
  queryFn: listAlertRules,
  enabled: isLoggedIn,
});

const { data: history, isLoading: historyLoading } = useQuery({
  queryKey: ["alert-history"],
  queryFn: () => listAlertHistory({ limit: 20 }),
  enabled: isLoggedIn,
});

// ── Trigger definitions ─────────────────────────────────────────────────────

interface Trigger {
  id: string;
  label: string;
  description: string;
  defaultThreshold: number;
  unit: string;
  direction: "above" | "below";
  evaluation: "aggregate" | "per_customer";
  /** Which DB field stores the trigger: metric (for aggregate) or trigger_type (for per_customer) */
  metric?: AlertRule["metric"];
}

const TRIGGERS: Trigger[] = [
  {
    id: "daily_cost",
    label: "Daily cost budget",
    description: "Total API cost exceeds your daily budget",
    defaultThreshold: 100,
    unit: "$",
    direction: "above",
    evaluation: "aggregate",
    metric: "daily_cost",
  },
  {
    id: "inactive",
    label: "Customer gone quiet",
    description: "No events from a customer for more than N days",
    defaultThreshold: 14,
    unit: "days",
    direction: "above",
    evaluation: "per_customer",
  },
  {
    id: "customer_cost_budget",
    label: "Customer cost budget",
    description: "A single customer's monthly cost exceeds your limit",
    defaultThreshold: 500,
    unit: "$",
    direction: "above",
    evaluation: "per_customer",
    metric: "customer_concentration",
  },
];

const SEGMENT_OPTIONS = [
  { value: "all" as const, label: "All customers" },
  { value: "cohort" as const, label: "Cohort" },
  { value: "specific" as const, label: "Specific customer" },
];

const COHORT_META: Record<
  string,
  { label: string; description: string; color: string }
> = {
  unprofitable: {
    label: "Unprofitable",
    description: "Cost exceeds revenue",
    color: "bg-red-100 text-red-700",
  },
  at_risk: {
    label: "At Risk",
    description: "Usage declining or inactive",
    color: "bg-yellow-100 text-yellow-700",
  },
  rising_cost: {
    label: "Rising Cost",
    description: "Costs growing faster than revenue",
    color: "bg-orange-100 text-orange-700",
  },
  inactive: {
    label: "Inactive",
    description: "No recent events",
    color: "bg-gray-100 text-gray-600",
  },
  champion: {
    label: "Champion",
    description: "High usage, healthy margin",
    color: "bg-green-100 text-green-700",
  },
  healthy: {
    label: "Healthy",
    description: "Profitable and active",
    color: "bg-blue-100 text-blue-700",
  },
};

const COOLDOWN_OPTIONS = [
  { value: 60, label: "1 hour" },
  { value: 240, label: "4 hours" },
  { value: 1440, label: "1 day" },
];

const TANSO_UPSELLS: Record<string, string> = {
  customer_margin: "Want to cap unprofitable customers automatically?",
  customer_concentration: "Want to set concentration risk limits?",
};

// ── Form state ──────────────────────────────────────────────────────────────

const showForm = ref(false);
const isSubmitting = ref(false);
const formStep = ref<1 | 2>(1);

const selectedTrigger = ref<Trigger | null>(null);
const formName = ref("");
const formThreshold = ref<number>(0);
const formEmail = ref("");
const formWebhookUrl = ref("");
const formCooldown = ref(60);
const newSegmentType = ref<"all" | "cohort" | "specific">("all");
const newSegmentValue = ref("");

// Auto-generate name from trigger + threshold
watch(
  [selectedTrigger, formThreshold],
  ([trigger, threshold]) => {
    if (!trigger) return;
    const dir = trigger.direction === "above" ? ">" : "<";
    const unit = trigger.unit === "$" ? "$" : "";
    const suffix = trigger.unit !== "$" ? trigger.unit : "";
    formName.value = `${trigger.label} ${dir} ${unit}${Math.abs(threshold)}${suffix}`;
  },
  { immediate: false },
);

function selectTrigger(trigger: Trigger) {
  selectedTrigger.value = trigger;
  formThreshold.value = trigger.defaultThreshold;
  formName.value = trigger.label;
  formStep.value = 2;
}

function resetForm() {
  selectedTrigger.value = null;
  formName.value = "";
  formThreshold.value = 0;
  formEmail.value = "";
  formWebhookUrl.value = "";
  formCooldown.value = 60;
  newSegmentType.value = "all";
  newSegmentValue.value = "";
  formStep.value = 1;
  showForm.value = false;
}

async function handleCreate() {
  if (!selectedTrigger.value) return;
  if (!formEmail.value && !formWebhookUrl.value) {
    toast.error("Add at least one delivery channel (email or webhook)");
    return;
  }

  const trigger = selectedTrigger.value;
  const operator = trigger.direction === "above" ? "gt" : "lt";
  // For usage_decline, the actual DB threshold is negative
  const threshold =
    trigger.id === "usage_decline"
      ? -Math.abs(formThreshold.value)
      : formThreshold.value;

  isSubmitting.value = true;
  try {
    await createAlertRule({
      name: formName.value || trigger.label,
      metric: trigger.metric || ("daily_cost" as AlertRule["metric"]),
      operator: operator as AlertRule["operator"],
      threshold,
      email: formEmail.value || undefined,
      webhook_url: formWebhookUrl.value || undefined,
      cooldown_minutes: formCooldown.value,
      trigger_type:
        trigger.evaluation === "per_customer" ? trigger.id : "threshold",
      segment_type: newSegmentType.value || "all",
      segment_value: newSegmentValue.value || undefined,
      evaluation: trigger.evaluation,
    });
    queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    queryClient.invalidateQueries({ queryKey: ["alert-history"] });
    toast.success("Alert created");
    window.posthog?.capture("alert_created", {
      trigger: trigger.id,
      evaluation: trigger.evaluation,
    });
    resetForm();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to create alert");
  } finally {
    isSubmitting.value = false;
  }
}

async function handleToggle(rule: AlertRule) {
  try {
    await updateAlertRule(rule.id, { enabled: !rule.enabled });
    queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
  } catch {
    toast.error("Failed to update alert");
  }
}

async function handleDelete(rule: AlertRule) {
  const label = rule.name || triggerById(rule.trigger_type)?.label || "alert";
  if (!window.confirm(`Delete "${label}"? This can't be undone.`)) return;
  try {
    await deleteAlertRule(rule.id);
    queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    toast.success("Alert deleted");
  } catch {
    toast.error("Failed to delete alert");
  }
}

// ── Display helpers ─────────────────────────────────────────────────────────

function triggerById(id: string) {
  return TRIGGERS.find((t) => t.id === id);
}

function ruleTriggerLabel(rule: AlertRule) {
  if (rule.evaluation === "per_customer") {
    return triggerById(rule.trigger_type)?.label || rule.trigger_type;
  }
  return triggerById(rule.metric)?.label || rule.metric;
}

function ruleThresholdLabel(rule: AlertRule) {
  const trigger =
    rule.evaluation === "per_customer"
      ? triggerById(rule.trigger_type)
      : triggerById(rule.metric);
  if (!trigger) return String(rule.threshold);
  const dir = trigger.direction === "above" ? ">" : "<";
  const val = Math.abs(rule.threshold);
  if (trigger.unit === "$") return `${dir} $${val}`;
  return `${dir} ${val}${trigger.unit}`;
}

function formatHistoryValue(value: number, triggerType: string) {
  const trigger = triggerById(triggerType);
  if (trigger) {
    if (trigger.unit === "%") return `${value.toFixed(1)}%`;
    if (trigger.unit === "days") return `${Math.round(value)}d`;
    if (trigger.unit === "$") return `$${value.toFixed(2)}`;
  }
  if (Math.abs(value) >= 1) return `$${value.toFixed(2)}`;
  return String(value);
}

function deliveryStatusClass(status: string) {
  switch (status) {
    case "sent":
    case "delivered":
      return "bg-green-100 text-green-700";
    case "failed":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

function relativeTime(dateStr: string) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
</script>

<template>
  <div class="space-y-6 pb-12">
    <!-- Header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p class="text-sm text-muted-foreground mt-1">
          Get notified when costs spike, margins drop, or customers go quiet
        </p>
      </div>
      <Button
        v-if="!showForm"
        size="sm"
        @click="isLoggedIn ? (showForm = true) : router.push('/signup')"
      >
        <Plus class="h-3.5 w-3.5 mr-1.5" />
        New Alert
      </Button>
    </div>

    <!-- Guest CTA — page is viewable but creating alerts needs an account -->
    <Card v-if="!isLoggedIn" class="border-primary/40 bg-primary/5">
      <CardContent class="p-6 text-center space-y-3">
        <h2 class="font-semibold text-lg">Sign in to set up alerts</h2>
        <p class="text-sm text-muted-foreground max-w-md mx-auto">
          Get email or webhook notifications when daily cost overruns your
          budget, a customer goes quiet, or a single customer's monthly cost
          spikes. Free to start.
        </p>
        <div class="flex justify-center gap-2 pt-1">
          <Button @click="router.push('/signup')">Sign up free</Button>
          <Button variant="outline" @click="router.push('/login')">
            Log in
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Create form -->
    <Card v-if="showForm">
      <CardHeader class="pb-3">
        <div class="flex items-center justify-between">
          <CardTitle class="text-base">
            New Alert
            <span class="text-xs text-muted-foreground font-normal ml-2">
              Step {{ formStep }} of 2
            </span>
          </CardTitle>
          <Button variant="ghost" size="sm" class="h-7" @click="resetForm">
            Cancel
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- Step 1: Pick trigger -->
        <template v-if="formStep === 1">
          <p class="text-sm text-muted-foreground">
            What do you want to watch?
          </p>

          <!-- Triggers (flat list — 3 items don't need sections) -->
          <div class="space-y-2">
            <button
              v-for="t in TRIGGERS"
              :key="t.id"
              class="w-full text-left p-3 rounded-lg border transition-colors hover:bg-muted/30"
              @click="selectTrigger(t)"
            >
              <span class="text-sm font-medium">{{ t.label }}</span>
              <p class="text-xs text-muted-foreground mt-1">
                {{ t.description }}
              </p>
            </button>
          </div>
        </template>

        <!-- Step 2: Configure -->
        <template v-if="formStep === 2 && selectedTrigger">
          <!-- Threshold -->
          <div>
            <label
              for="alert-threshold"
              class="text-xs font-medium text-muted-foreground block mb-1"
            >
              Alert when {{ selectedTrigger.direction }}
            </label>
            <div class="flex items-center gap-2">
              <span
                v-if="selectedTrigger.unit === '$'"
                class="text-sm text-muted-foreground"
              >
                $
              </span>
              <input
                id="alert-threshold"
                v-model.number="formThreshold"
                type="number"
                step="any"
                min="0"
                class="w-40 h-9 rounded-md border bg-background px-3 text-sm"
              />
              <span
                v-if="selectedTrigger.unit !== '$'"
                class="text-sm text-muted-foreground"
              >
                {{ selectedTrigger.unit }}
              </span>
            </div>
          </div>

          <!-- Segment (per-customer only) -->
          <div v-if="selectedTrigger.evaluation === 'per_customer'">
            <p class="text-xs font-medium text-muted-foreground mb-2">
              Which customers?
            </p>
            <div class="space-y-2">
              <label
                v-for="opt in SEGMENT_OPTIONS"
                :key="opt.value"
                class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                :class="
                  newSegmentType === opt.value
                    ? 'border-foreground bg-muted/50'
                    : 'hover:bg-muted/30'
                "
              >
                <input
                  v-model="newSegmentType"
                  type="radio"
                  :value="opt.value"
                  class="accent-foreground"
                />
                <span class="text-sm">{{ opt.label }}</span>
              </label>
            </div>

            <!-- Cohort picker -->
            <div v-if="newSegmentType === 'cohort'" class="pt-3">
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="(meta, key) in COHORT_META"
                  :key="key"
                  class="text-left px-3 py-2 rounded-lg border transition-colors"
                  :class="
                    newSegmentValue === key
                      ? meta.color + ' border-current'
                      : 'hover:bg-muted/30'
                  "
                  @click="newSegmentValue = key as string"
                >
                  <span class="text-xs font-medium">{{ meta.label }}</span>
                  <p class="text-[11px] text-muted-foreground">
                    {{ meta.description }}
                  </p>
                </button>
              </div>
            </div>

            <!-- Specific customer -->
            <div v-if="newSegmentType === 'specific'" class="pt-3">
              <input
                v-model="newSegmentValue"
                type="text"
                placeholder="Customer ID, e.g. cust_abc123"
                class="w-full h-9 rounded-md border bg-background px-3 text-sm"
              />
            </div>
          </div>

          <!-- Delivery -->
          <div>
            <p class="text-xs font-medium text-muted-foreground mb-2">
              Deliver to
            </p>
            <div class="space-y-2">
              <input
                v-model="formEmail"
                type="email"
                placeholder="Email address"
                class="w-full h-9 rounded-md border bg-background px-3 text-sm"
              />
              <div>
                <input
                  v-model="formWebhookUrl"
                  type="url"
                  placeholder="Webhook URL (Slack-compatible)"
                  class="w-full h-9 rounded-md border bg-background px-3 text-sm font-mono text-xs"
                />
                <p class="text-[11px] text-muted-foreground mt-1">
                  Slack incoming webhook or any endpoint accepting JSON POST
                </p>
              </div>
            </div>
          </div>

          <!-- Cooldown -->
          <div>
            <p class="text-xs font-medium text-muted-foreground mb-2">
              Don't re-alert for
            </p>
            <div class="flex gap-2">
              <button
                v-for="opt in COOLDOWN_OPTIONS"
                :key="opt.value"
                class="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors"
                :class="
                  formCooldown === opt.value
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                "
                @click="formCooldown = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Name (pre-filled) -->
          <div>
            <label
              for="alert-name"
              class="text-xs font-medium text-muted-foreground block mb-1"
            >
              Name
            </label>
            <input
              id="alert-name"
              v-model="formName"
              type="text"
              class="w-full h-9 rounded-md border bg-background px-3 text-sm"
            />
          </div>

          <!-- Tanso upsell -->
          <div
            v-if="
              selectedTrigger.metric && TANSO_UPSELLS[selectedTrigger.metric]
            "
            class="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"
          >
            <div>
              <p class="text-sm font-medium text-emerald-900">
                {{ TANSO_UPSELLS[selectedTrigger.metric] }}
              </p>
              <p class="text-xs text-emerald-700 mt-0.5">
                Tanso can automate the fix when this alert fires.
              </p>
            </div>
            <a
              href="https://cal.com/katrina-laszlo/30-minute-meeting?duration=30"
              target="_blank"
              rel="noopener noreferrer"
              class="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-200 hover:bg-emerald-300 px-3 py-1.5 rounded-md transition-colors"
            >
              Learn more
              <ExternalLink class="h-3 w-3" />
            </a>
          </div>

          <!-- Navigation -->
          <div class="flex items-center justify-between pt-2">
            <Button variant="ghost" size="sm" @click="formStep = 1">
              <ChevronLeft class="h-3.5 w-3.5 mr-1" />
              Back
            </Button>
            <Button :disabled="isSubmitting" @click="handleCreate">
              {{ isSubmitting ? "Creating..." : "Create Alert" }}
            </Button>
          </div>
        </template>
      </CardContent>
    </Card>

    <!-- Loading -->
    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>

    <!-- Rules list -->
    <div v-else-if="data?.rules?.length" class="space-y-3">
      <h2
        class="text-sm font-semibold text-muted-foreground uppercase tracking-wider"
      >
        Active rules
      </h2>
      <Card v-for="rule in data.rules" :key="rule.id">
        <CardContent class="p-4">
          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium">{{ rule.name }}</span>
                <span
                  v-if="rule.evaluation === 'per_customer'"
                  class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700"
                >
                  per customer
                </span>
                <span
                  v-if="
                    rule.evaluation === 'per_customer' &&
                    rule.segment_type !== 'all'
                  "
                  class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                >
                  {{ rule.segment_type
                  }}{{ rule.segment_value ? `: ${rule.segment_value}` : "" }}
                </span>
                <span
                  :class="[
                    'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                    rule.enabled
                      ? 'bg-success/10 text-success'
                      : 'bg-muted text-muted-foreground',
                  ]"
                >
                  {{ rule.enabled ? "Active" : "Paused" }}
                </span>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ ruleTriggerLabel(rule) }}
                {{ ruleThresholdLabel(rule) }}
                <template v-if="rule.email">
                  &middot; {{ rule.email }}
                </template>
                <template v-if="rule.last_triggered_at">
                  &middot; Last fired
                  {{ new Date(rule.last_triggered_at).toLocaleDateString() }}
                </template>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <a
                v-if="rule.metric && TANSO_UPSELLS[rule.metric]"
                href="https://cal.com/katrina-laszlo/30-minute-meeting"
                target="_blank"
                class="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:text-emerald-900 transition-colors"
              >
                Automate
                <ExternalLink class="h-3 w-3" />
              </a>
              <Button
                variant="outline"
                size="sm"
                class="h-7 text-xs"
                @click="handleToggle(rule)"
              >
                {{ rule.enabled ? "Pause" : "Enable" }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 text-xs text-muted-foreground hover:text-destructive"
                aria-label="Delete alert"
                title="Delete this alert rule"
                @click="handleDelete(rule)"
              >
                <Trash2 class="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Delivery history -->
    <Card v-if="history?.history.length">
      <CardContent class="p-6">
        <h2
          class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4"
        >
          Delivery history
        </h2>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b bg-muted/30 text-left">
                <th class="py-2 px-3 font-medium text-muted-foreground">
                  Time
                </th>
                <th class="py-2 px-3 font-medium text-muted-foreground">
                  Alert
                </th>
                <th class="py-2 px-3 font-medium text-muted-foreground">
                  Customer
                </th>
                <th class="py-2 px-3 font-medium text-muted-foreground">
                  Trigger
                </th>
                <th class="py-2 px-3 font-medium text-muted-foreground">
                  Value
                </th>
                <th class="py-2 px-3 font-medium text-muted-foreground">
                  Delivery
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in history.history"
                :key="entry.id"
                class="border-b last:border-0 hover:bg-muted/20"
              >
                <td class="py-2 px-3 text-muted-foreground whitespace-nowrap">
                  {{ relativeTime(entry.fired_at) }}
                </td>
                <td class="py-2 px-3">
                  {{ entry.rule_name || "—" }}
                </td>
                <td class="py-2 px-3">
                  <button
                    v-if="entry.customer_id"
                    class="text-primary hover:underline text-left"
                    @click="router.push(`/customers/${entry.customer_id}`)"
                  >
                    {{ entry.customer_name || entry.customer_id }}
                  </button>
                  <span v-else class="text-muted-foreground">—</span>
                </td>
                <td class="py-2 px-3">
                  {{
                    triggerById(entry.trigger_type)?.label || entry.trigger_type
                  }}
                </td>
                <td class="py-2 px-3 font-mono text-xs">
                  {{
                    formatHistoryValue(entry.current_value, entry.trigger_type)
                  }}
                </td>
                <td class="py-2 px-3">
                  <span
                    v-for="(status, channel) in entry.delivery_status"
                    :key="channel"
                    class="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full mr-1"
                    :class="deliveryStatusClass(status)"
                  >
                    {{ channel }} {{ status }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
    <div
      v-else-if="historyLoading"
      class="flex items-center justify-center py-6"
    >
      <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
    </div>

    <!-- Error state -->
    <Card v-else-if="isError">
      <CardContent class="p-8 text-center">
        <p class="text-sm text-destructive">Failed to load alerts</p>
      </CardContent>
    </Card>

    <!-- Empty state -->
    <div
      v-else-if="!isLoading"
      class="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto"
    >
      <Bell class="h-10 w-10 text-muted-foreground/40 mb-3" />
      <p class="text-sm font-medium mb-1">No alerts configured</p>
      <p class="text-xs text-muted-foreground mb-4">
        Get notified when costs spike, margins drop, or customers go quiet.
      </p>
      <Button size="sm" variant="outline" @click="showForm = true">
        <Plus class="h-3.5 w-3.5 mr-1.5" />
        New Alert
      </Button>
    </div>
  </div>
</template>
