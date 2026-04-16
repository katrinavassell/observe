<script setup lang="ts">
import { ref, computed } from "vue";
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
  ChevronRight,
  Users,
  BarChart3,
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

const showForm = ref(false);
const isSubmitting = ref(false);
const selectedCategory = ref<string>("all");
const formStep = ref(1);

// Form state
const formName = ref("");
const formMetric = ref<AlertRule["metric"]>("daily_cost");
const formOperator = ref<AlertRule["operator"]>("gt");
const formThreshold = ref<number>(0);
const formEmail = ref("");
const formWebhookUrl = ref("");
const formCooldown = ref(60);
const newTriggerType = ref("");
const newSegmentType = ref<"all" | "cohort" | "specific">("all");
const newSegmentValue = ref("");

const METRIC_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "cost", label: "Cost" },
  { key: "margin", label: "Margin" },
  { key: "abuse", label: "Abuse" },
  { key: "pricing", label: "Pricing" },
  { key: "concentration", label: "Concentration" },
];

const METRICS = [
  {
    value: "daily_cost",
    label: "Daily cost ($)",
    category: "cost",
    unit: "$",
    defaultOp: "gt",
    defaultThreshold: 100,
    description: "Total cost in the last 24 hours",
  },
  {
    value: "margin_percent",
    label: "Overall margin (%)",
    category: "margin",
    unit: "%",
    defaultOp: "lt",
    defaultThreshold: 40,
    description: "Overall margin across all events (30 days)",
  },
  {
    value: "customer_margin",
    label: "Lowest customer margin (%)",
    category: "margin",
    unit: "%",
    defaultOp: "lt",
    defaultThreshold: 10,
    description: "Worst-performing customer's margin drops below threshold",
  },
  {
    value: "usage_velocity",
    label: "Usage velocity (x avg)",
    category: "abuse",
    unit: "x",
    defaultOp: "gt",
    defaultThreshold: 3,
    description: "Customer's daily usage vs their historical average",
  },
  {
    value: "customer_cost_share",
    label: "Customer cost share (%)",
    category: "abuse",
    unit: "%",
    defaultOp: "gt",
    defaultThreshold: 50,
    description: "Single customer's share of total infrastructure cost",
  },
  {
    value: "top_customer_unprofitable",
    label: "Unprofitable top-10 customers",
    category: "pricing",
    unit: "count",
    defaultOp: "gt",
    defaultThreshold: 0,
    description: "Number of top-10 customers (by cost) who are unprofitable",
  },
  {
    value: "model_cost_increase",
    label: "Model cost increase (WoW %)",
    category: "pricing",
    unit: "%",
    defaultOp: "gt",
    defaultThreshold: 20,
    description: "Week-over-week increase in average model cost",
  },
  {
    value: "customer_concentration",
    label: "Customer concentration (%)",
    category: "concentration",
    unit: "%",
    defaultOp: "gt",
    defaultThreshold: 40,
    description: "Top customer's share of total API cost",
  },
];

const CUSTOMER_TRIGGERS = [
  {
    id: "usage_decline",
    label: "Usage declining",
    description: "Event count dropped over 30 days",
    defaultOp: "lt" as const,
    defaultThreshold: -30,
    unit: "%",
    category: "churn",
  },
  {
    id: "usage_growth",
    label: "Usage growing",
    description: "Event count increased over 30 days",
    defaultOp: "gt" as const,
    defaultThreshold: 20,
    unit: "%",
    category: "expansion",
  },
  {
    id: "margin_negative",
    label: "Negative margin",
    description: "Customer cost exceeds revenue",
    defaultOp: "lt" as const,
    defaultThreshold: 0,
    unit: "%",
    category: "margin",
  },
  {
    id: "inactive",
    label: "Inactive",
    description: "No events for N days",
    defaultOp: "gt" as const,
    defaultThreshold: 14,
    unit: "days",
    category: "churn",
  },
  {
    id: "cost_spike",
    label: "Cost spike",
    description: "Week-over-week cost increase",
    defaultOp: "gt" as const,
    defaultThreshold: 50,
    unit: "%",
    category: "cost",
  },
];

const SEGMENT_OPTIONS = [
  { value: "all" as const, label: "All customers" },
  { value: "cohort" as const, label: "Cohort" },
  { value: "specific" as const, label: "Specific customer" },
];

const COHORT_LABELS = [
  "unprofitable",
  "at_risk",
  "rising_cost",
  "inactive",
  "champion",
  "healthy",
];

const COHORT_META: Record<string, { label: string; color: string }> = {
  unprofitable: { label: "Unprofitable", color: "bg-red-100 text-red-700" },
  at_risk: { label: "At Risk", color: "bg-yellow-100 text-yellow-700" },
  rising_cost: {
    label: "Rising Cost",
    color: "bg-orange-100 text-orange-700",
  },
  inactive: { label: "Inactive", color: "bg-gray-100 text-gray-600" },
  champion: { label: "Champion", color: "bg-green-100 text-green-700" },
  healthy: { label: "Healthy", color: "bg-blue-100 text-blue-700" },
};

const TRIGGER_CATEGORY_COLORS: Record<string, string> = {
  churn: "bg-red-100 text-red-700",
  expansion: "bg-green-100 text-green-700",
  margin: "bg-amber-100 text-amber-800",
  cost: "bg-gray-100 text-gray-800",
};

const TANSO_UPSELLS: Record<string, string> = {
  customer_margin: "Want to cap unprofitable customers automatically?",
  usage_velocity: "Want to set velocity limits?",
  customer_cost_share: "Want to set usage caps per customer?",
  top_customer_unprofitable: "Want to reprice these customers automatically?",
  model_cost_increase: "Want to auto-switch to cost-effective models?",
  customer_concentration: "Want to set concentration risk limits?",
};

const filteredMetrics = computed(() => {
  if (selectedCategory.value === "all") return METRICS;
  return METRICS.filter((m) => m.category === selectedCategory.value);
});

const isPerCustomer = computed(
  () => newTriggerType.value !== "" && newTriggerType.value !== "threshold",
);

const totalSteps = computed(() => (isPerCustomer.value ? 3 : 2));

const OPERATORS = [
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
];

function operatorLabel(op: string) {
  return OPERATORS.find((o) => o.value === op)?.label || op;
}

function metricLabel(m: string) {
  return METRICS.find((x) => x.value === m)?.label || m;
}

function metricCategory(m: string) {
  return METRICS.find((x) => x.value === m)?.category || "cost";
}

function categoryColor(cat: string) {
  switch (cat) {
    case "margin":
      return "bg-amber-100 text-amber-800";
    case "abuse":
      return "bg-red-100 text-red-800";
    case "pricing":
      return "bg-blue-100 text-blue-800";
    case "concentration":
      return "bg-purple-100 text-purple-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function triggerLabel(triggerType: string) {
  const t = CUSTOMER_TRIGGERS.find((x) => x.id === triggerType);
  return t?.label || triggerType;
}

function formatThreshold(metric: string, threshold: number) {
  const m = METRICS.find((x) => x.value === metric);
  if (!m) return String(threshold);
  if (m.unit === "$") return `$${threshold}`;
  if (m.unit === "%") return `${threshold}%`;
  if (m.unit === "pp") return `${threshold}pp`;
  if (m.unit === "x") return `${threshold}x`;
  if (m.unit === "hrs") return `${threshold}h`;
  return String(threshold);
}

function formatHistoryValue(value: number, triggerType: string) {
  const t = CUSTOMER_TRIGGERS.find((x) => x.id === triggerType);
  if (t) {
    if (t.unit === "%") return `${value.toFixed(1)}%`;
    if (t.unit === "days") return `${value}d`;
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

function selectCustomerTrigger(triggerId: string) {
  const t = CUSTOMER_TRIGGERS.find((x) => x.id === triggerId);
  if (!t) return;
  newTriggerType.value = triggerId;
  formOperator.value = t.defaultOp as AlertRule["operator"];
  formThreshold.value = t.defaultThreshold;
  formName.value = t.label;
  formMetric.value = "daily_cost";
  formStep.value = 2;
  showForm.value = true;
}

function selectMetric(metricValue: string) {
  const m = METRICS.find((x) => x.value === metricValue);
  if (!m) return;
  newTriggerType.value = "threshold";
  formMetric.value = metricValue as AlertRule["metric"];
  formOperator.value = (m.defaultOp || "gt") as AlertRule["operator"];
  formThreshold.value = m.defaultThreshold;
  formName.value = m.label;
  // Global thresholds skip segment step, go straight to action
  formStep.value = isPerCustomer.value ? 2 : 2;
  showForm.value = true;
}

function nextStep() {
  if (formStep.value === 1) {
    // If global threshold, skip segment step
    formStep.value = isPerCustomer.value ? 2 : totalSteps.value;
  } else if (formStep.value < totalSteps.value) {
    formStep.value++;
  }
}

function prevStep() {
  if (formStep.value > 1) {
    if (formStep.value === totalSteps.value && !isPerCustomer.value) {
      formStep.value = 1;
    } else {
      formStep.value--;
    }
  }
}

function resetForm() {
  formName.value = "";
  formMetric.value = "daily_cost";
  formOperator.value = "gt";
  formThreshold.value = 0;
  formEmail.value = "";
  formWebhookUrl.value = "";
  formCooldown.value = 60;
  newTriggerType.value = "";
  newSegmentType.value = "all";
  newSegmentValue.value = "";
  formStep.value = 1;
  selectedCategory.value = "all";
  showForm.value = false;
}

async function handleCreate() {
  if (!formName.value) {
    toast.error("Name is required");
    return;
  }
  if (!formEmail.value && !formWebhookUrl.value) {
    toast.error("Add at least one delivery channel (email or webhook URL)");
    return;
  }
  isSubmitting.value = true;
  try {
    await createAlertRule({
      name: formName.value,
      metric: formMetric.value,
      operator: formOperator.value,
      threshold: formThreshold.value,
      email: formEmail.value || undefined,
      webhook_url: formWebhookUrl.value || undefined,
      cooldown_minutes: formCooldown.value,
      trigger_type: newTriggerType.value || "threshold",
      segment_type: newSegmentType.value || "all",
      segment_value: newSegmentValue.value || undefined,
      evaluation:
        newTriggerType.value && newTriggerType.value !== "threshold"
          ? "per_customer"
          : "aggregate",
    });
    queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    queryClient.invalidateQueries({ queryKey: ["alert-history"] });
    toast.success("Alert created");
    window.posthog?.capture("alert_created", {
      metric: formMetric.value,
      trigger_type: newTriggerType.value,
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

async function handleDelete(id: number) {
  try {
    await deleteAlertRule(id);
    queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    toast.success("Alert deleted");
  } catch {
    toast.error("Failed to delete alert");
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
          Per-customer triggers and global thresholds with email and webhook
          delivery
        </p>
      </div>
      <Button v-if="!showForm" size="sm" @click="showForm = true">
        <Plus class="h-3.5 w-3.5 mr-1.5" />
        New Alert
      </Button>
    </div>

    <!-- Alert History Feed -->
    <Card v-if="history?.history.length">
      <CardContent class="p-6">
        <h2 class="font-semibold mb-4">Recent triggers</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b bg-muted/30 text-left">
                <th class="py-2 px-3 font-medium text-muted-foreground">
                  Time
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
                  Status
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
                  <button
                    v-if="entry.customer_id"
                    class="text-primary hover:underline text-left"
                    @click="router.push(`/customers/${entry.customer_id}`)"
                  >
                    {{ entry.customer_name || entry.customer_id }}
                  </button>
                  <span v-else class="text-muted-foreground">--</span>
                </td>
                <td class="py-2 px-3">
                  {{ triggerLabel(entry.trigger_type) }}
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
                    {{ channel }}: {{ status }}
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

    <!-- Create form (multi-step) -->
    <Card v-if="showForm">
      <CardHeader class="pb-3">
        <div class="flex items-center justify-between">
          <CardTitle class="text-base">
            New Alert Rule
            <span class="text-xs text-muted-foreground font-normal ml-2">
              Step {{ formStep }} of {{ totalSteps }}
            </span>
          </CardTitle>
          <Button variant="ghost" size="sm" class="h-7" @click="resetForm">
            Cancel
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- Step 1: Trigger selection -->
        <template v-if="formStep === 1">
          <!-- Per-customer triggers -->
          <div>
            <div class="flex items-center gap-2 mb-3">
              <Users class="h-4 w-4 text-muted-foreground" />
              <h3 class="text-sm font-medium">Per-customer triggers</h3>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              <button
                v-for="t in CUSTOMER_TRIGGERS"
                :key="t.id"
                class="text-left p-3 rounded-lg border transition-colors"
                :class="
                  newTriggerType === t.id
                    ? 'border-foreground bg-muted/50'
                    : 'hover:bg-muted/30'
                "
                @click="selectCustomerTrigger(t.id)"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    :class="
                      TRIGGER_CATEGORY_COLORS[t.category] ||
                      'bg-gray-100 text-gray-800'
                    "
                  >
                    {{ t.category }}
                  </span>
                  <span class="text-sm font-medium">{{ t.label }}</span>
                </div>
                <p class="text-xs text-muted-foreground mt-1">
                  {{ t.description }}
                </p>
                <p class="text-[11px] text-muted-foreground mt-1">
                  Default: {{ t.defaultOp === "gt" ? ">" : "<" }}
                  {{ t.defaultThreshold }}{{ t.unit }}
                </p>
              </button>
            </div>
          </div>

          <!-- Global thresholds -->
          <div class="pt-2">
            <div class="flex items-center gap-2 mb-3">
              <BarChart3 class="h-4 w-4 text-muted-foreground" />
              <h3 class="text-sm font-medium">Global thresholds</h3>
            </div>

            <div class="flex gap-1.5 flex-wrap mb-3">
              <button
                v-for="cat in METRIC_CATEGORIES"
                :key="cat.key"
                class="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors"
                :class="
                  selectedCategory === cat.key
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                "
                @click="selectedCategory = cat.key"
              >
                {{ cat.label }}
              </button>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                v-for="m in filteredMetrics"
                :key="m.value"
                class="text-left p-3 rounded-lg border transition-colors"
                :class="
                  newTriggerType === 'threshold' && formMetric === m.value
                    ? 'border-foreground bg-muted/50'
                    : 'hover:bg-muted/30'
                "
                @click="selectMetric(m.value)"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    :class="categoryColor(m.category)"
                  >
                    {{ m.category }}
                  </span>
                  <span class="text-sm font-medium">{{ m.label }}</span>
                </div>
                <p class="text-xs text-muted-foreground mt-1">
                  {{ m.description }}
                </p>
              </button>
            </div>
          </div>
        </template>

        <!-- Step 2: Segment (per-customer only) or Action (global) -->
        <template v-if="formStep === 2 && isPerCustomer">
          <h3 class="text-sm font-medium mb-3">
            Which customers should this apply to?
          </h3>

          <div class="space-y-3">
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
          <div v-if="newSegmentType === 'cohort'" class="pt-2">
            <p class="text-xs text-muted-foreground mb-2">Select cohort</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="c in COHORT_LABELS"
                :key="c"
                class="text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
                :class="
                  newSegmentValue === c
                    ? COHORT_META[c]?.color || 'bg-gray-100 text-gray-800'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                "
                @click="newSegmentValue = c"
              >
                {{ COHORT_META[c]?.label || c }}
              </button>
            </div>
          </div>

          <!-- Specific customer -->
          <div v-if="newSegmentType === 'specific'" class="pt-2">
            <label
              for="segment-customer-id"
              class="text-xs font-medium text-muted-foreground block mb-1"
            >
              Customer ID
            </label>
            <input
              id="segment-customer-id"
              v-model="newSegmentValue"
              type="text"
              placeholder="e.g. cust_abc123"
              class="w-full h-9 rounded-md border bg-background px-3 text-sm"
            />
          </div>

          <!-- Threshold override -->
          <div class="pt-2">
            <p class="text-xs font-medium text-muted-foreground mb-2">
              Threshold
            </p>
            <div class="grid grid-cols-3 gap-3">
              <div>
                <label
                  for="step2-operator"
                  class="text-[11px] text-muted-foreground block mb-1"
                >
                  Condition
                </label>
                <select
                  id="step2-operator"
                  v-model="formOperator"
                  class="w-full h-9 rounded-md border bg-background px-3 pr-8 text-sm appearance-none"
                >
                  <option
                    v-for="op in OPERATORS"
                    :key="op.value"
                    :value="op.value"
                  >
                    {{ op.label }}
                  </option>
                </select>
              </div>
              <div>
                <label
                  for="step2-threshold"
                  class="text-[11px] text-muted-foreground block mb-1"
                >
                  Value
                </label>
                <input
                  id="step2-threshold"
                  v-model.number="formThreshold"
                  type="number"
                  step="any"
                  class="w-full h-9 rounded-md border bg-background px-3 text-sm"
                />
              </div>
              <div class="flex items-end pb-1">
                <span class="text-xs text-muted-foreground">
                  {{
                    CUSTOMER_TRIGGERS.find((t) => t.id === newTriggerType)
                      ?.unit || ""
                  }}
                </span>
              </div>
            </div>
          </div>
        </template>

        <!-- Action step (last step for both flows) -->
        <template v-if="formStep === totalSteps">
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
              placeholder="e.g. Daily cost spike"
              class="w-full h-9 rounded-md border bg-background px-3 text-sm"
            />
          </div>

          <!-- Metric/operator/threshold for global alerts -->
          <div
            v-if="!isPerCustomer"
            class="grid grid-cols-1 sm:grid-cols-3 gap-3"
          >
            <div>
              <label
                for="alert-metric"
                class="text-xs font-medium text-muted-foreground block mb-1"
              >
                Metric
              </label>
              <select
                id="alert-metric"
                v-model="formMetric"
                class="w-full h-9 rounded-md border bg-background px-3 pr-8 text-sm appearance-none"
              >
                <option v-for="m in METRICS" :key="m.value" :value="m.value">
                  {{ m.label }}
                </option>
              </select>
            </div>
            <div>
              <label
                for="alert-operator"
                class="text-xs font-medium text-muted-foreground block mb-1"
              >
                Condition
              </label>
              <select
                id="alert-operator"
                v-model="formOperator"
                class="w-full h-9 rounded-md border bg-background px-3 pr-8 text-sm appearance-none"
              >
                <option
                  v-for="op in OPERATORS"
                  :key="op.value"
                  :value="op.value"
                >
                  {{ op.label }}
                </option>
              </select>
            </div>
            <div>
              <label
                for="alert-threshold"
                class="text-xs font-medium text-muted-foreground block mb-1"
              >
                Threshold
              </label>
              <input
                id="alert-threshold"
                v-model.number="formThreshold"
                type="number"
                step="any"
                class="w-full h-9 rounded-md border bg-background px-3 text-sm"
              />
            </div>
          </div>

          <div>
            <p class="text-xs font-medium text-muted-foreground mb-2">
              Deliver to (add at least one)
            </p>
            <div class="space-y-2">
              <div>
                <label
                  for="alert-email"
                  class="text-[11px] text-muted-foreground block mb-1"
                >
                  Email
                </label>
                <input
                  id="alert-email"
                  v-model="formEmail"
                  type="email"
                  placeholder="you@company.com"
                  class="w-full h-9 rounded-md border bg-background px-3 text-sm"
                />
              </div>
              <div>
                <label
                  for="alert-webhook"
                  class="text-[11px] text-muted-foreground block mb-1"
                >
                  Webhook URL (Slack-compatible)
                </label>
                <input
                  id="alert-webhook"
                  v-model="formWebhookUrl"
                  type="url"
                  placeholder="https://hooks.slack.com/services/..."
                  class="w-full h-9 rounded-md border bg-background px-3 text-sm font-mono text-xs"
                />
                <p class="text-[11px] text-muted-foreground mt-1">
                  Slack incoming webhook or any endpoint that accepts JSON POST.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label
              for="alert-cooldown"
              class="text-xs font-medium text-muted-foreground block mb-1"
            >
              Don't re-alert for
            </label>
            <div class="flex items-center gap-2">
              <input
                id="alert-cooldown"
                v-model.number="formCooldown"
                type="number"
                min="1"
                class="w-32 h-9 rounded-md border bg-background px-3 text-sm"
              />
              <span class="text-xs text-muted-foreground">minutes</span>
            </div>
          </div>

          <!-- Tanso upsell in form -->
          <div
            v-if="TANSO_UPSELLS[formMetric]"
            class="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"
          >
            <div>
              <p class="text-sm font-medium text-emerald-900">
                {{ TANSO_UPSELLS[formMetric] }}
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
        </template>

        <!-- Navigation buttons -->
        <div class="flex items-center justify-between pt-2">
          <Button
            v-if="formStep > 1"
            variant="ghost"
            size="sm"
            @click="prevStep"
          >
            <ChevronLeft class="h-3.5 w-3.5 mr-1" />
            Back
          </Button>
          <div v-else />

          <div class="flex gap-2">
            <Button v-if="formStep < totalSteps" size="sm" @click="nextStep">
              Next
              <ChevronRight class="h-3.5 w-3.5 ml-1" />
            </Button>
            <Button
              v-if="formStep === totalSteps"
              :disabled="isSubmitting"
              @click="handleCreate"
            >
              {{ isSubmitting ? "Creating..." : "Create Alert" }}
            </Button>
          </div>
        </div>
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
                  v-else
                  class="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                  :class="categoryColor(metricCategory(rule.metric))"
                >
                  {{ metricCategory(rule.metric) }}
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
                <template v-if="rule.evaluation === 'per_customer'">
                  {{ triggerLabel(rule.trigger_type) }}
                </template>
                <template v-else>
                  {{ metricLabel(rule.metric) }}
                </template>
                {{ operatorLabel(rule.operator) }}
                {{ formatThreshold(rule.metric, rule.threshold) }}
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
                v-if="TANSO_UPSELLS[rule.metric]"
                :href="`https://cal.com/katrina-laszlo/30-minute-meeting`"
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
                class="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                aria-label="Delete alert"
                @click="handleDelete(rule.id)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
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
        Set up per-customer triggers or global thresholds for margin drops,
        usage spikes, and concentration risks.
      </p>
      <Button size="sm" variant="outline" @click="showForm = true">
        <Plus class="h-3.5 w-3.5 mr-1.5" />
        New Alert
      </Button>
    </div>
  </div>
</template>
