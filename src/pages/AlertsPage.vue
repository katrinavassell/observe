<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { Bell, Plus, Trash2, Loader2, ExternalLink } from "lucide-vue-next";
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
} from "@/lib/api";
import type { AlertRule } from "@/lib/api";

const queryClient = useQueryClient();
const { isLoggedIn } = useAuth();

const { data, isLoading, isError } = useQuery({
  queryKey: ["alert-rules"],
  queryFn: listAlertRules,
  enabled: isLoggedIn,
});

const showForm = ref(false);
const isSubmitting = ref(false);
const selectedCategory = ref<string>("all");

// Form state
const formName = ref("");
const formMetric = ref<AlertRule["metric"]>("daily_cost");
const formOperator = ref<AlertRule["operator"]>("gt");
const formThreshold = ref<number>(0);
const formEmail = ref("");
const formCooldown = ref(60);

const METRIC_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "cost", label: "Cost" },
  { key: "margin", label: "Margin" },
  { key: "abuse", label: "Abuse" },
  { key: "pricing", label: "Pricing" },
  { key: "concentration", label: "Concentration" },
];

const METRICS = [
  // Cost
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
    value: "cost_per_event",
    label: "Avg cost per event ($)",
    category: "cost",
    unit: "$",
    defaultOp: "gt",
    defaultThreshold: 0.5,
    description: "Average cost per event in the last 24 hours",
  },
  // Margin
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
    value: "feature_margin_trend",
    label: "Feature margin trend (WoW pp)",
    category: "margin",
    unit: "pp",
    defaultOp: "lt",
    defaultThreshold: -5,
    description: "Week-over-week change in average feature margin",
  },
  {
    value: "customer_cost_vs_revenue",
    label: "Customer cost/revenue (%)",
    category: "margin",
    unit: "%",
    defaultOp: "gt",
    defaultThreshold: 100,
    description: "Worst customer's cost as percentage of their revenue",
  },
  {
    value: "model_cost_spike",
    label: "Model cost per request ($)",
    category: "margin",
    unit: "$",
    defaultOp: "gt",
    defaultThreshold: 1,
    description: "Highest cost-per-request across all models",
  },
  {
    value: "margin_compression",
    label: "Margin compression (30d pp)",
    category: "margin",
    unit: "pp",
    defaultOp: "lt",
    defaultThreshold: -3,
    description: "Margin change over the last 30 days vs prior 30 days",
  },
  // Abuse / runaway
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
    value: "credit_burn_rate",
    label: "Credit burn rate (hrs left)",
    category: "abuse",
    unit: "hrs",
    defaultOp: "lt",
    defaultThreshold: 24,
    description: "Hours until a customer exhausts their credit balance",
  },
  // Pricing
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
    value: "feature_cost_disparity",
    label: "Feature cost disparity (ratio)",
    category: "pricing",
    unit: "x",
    defaultOp: "gt",
    defaultThreshold: 5,
    description: "Ratio between most and least expensive features",
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
  // Concentration
  {
    value: "customer_concentration",
    label: "Customer concentration (%)",
    category: "concentration",
    unit: "%",
    defaultOp: "gt",
    defaultThreshold: 40,
    description: "Top customer's share of total API cost",
  },
  {
    value: "provider_concentration",
    label: "Provider concentration (%)",
    category: "concentration",
    unit: "%",
    defaultOp: "gt",
    defaultThreshold: 80,
    description: "Top provider's share of total COGS",
  },
  {
    value: "model_concentration",
    label: "Model concentration (%)",
    category: "concentration",
    unit: "%",
    defaultOp: "gt",
    defaultThreshold: 70,
    description: "Top model's share of total spend",
  },
];

const TANSO_UPSELLS: Record<string, string> = {
  customer_margin: "Want to cap unprofitable customers automatically?",
  feature_margin_trend: "Want to route to cheaper models or restrict usage?",
  customer_cost_vs_revenue: "Want to enforce spend limits per customer?",
  model_cost_spike: "Want to auto-route to cheaper models?",
  usage_velocity: "Want to set velocity limits?",
  customer_cost_share: "Want to set usage caps per customer?",
  credit_burn_rate: "Want to enforce a hard stop on credit exhaustion?",
  top_customer_unprofitable: "Want to reprice these customers automatically?",
  feature_cost_disparity: "Want to adjust pricing per feature?",
  model_cost_increase: "Want to auto-switch to cost-effective models?",
  margin_compression: "Want to auto-adjust pricing as costs change?",
  customer_concentration: "Want to set concentration risk limits?",
  provider_concentration: "Want to diversify provider routing?",
  model_concentration: "Want to balance model usage automatically?",
};

const filteredMetrics = computed(() => {
  if (selectedCategory.value === "all") return METRICS;
  return METRICS.filter((m) => m.category === selectedCategory.value);
});

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

function selectMetric(metricValue: string) {
  const m = METRICS.find((x) => x.value === metricValue);
  if (!m) return;
  formMetric.value = metricValue as AlertRule["metric"];
  formOperator.value = (m.defaultOp || "gt") as AlertRule["operator"];
  formThreshold.value = m.defaultThreshold;
  formName.value = m.label;
  showForm.value = true;
}

function resetForm() {
  formName.value = "";
  formMetric.value = "daily_cost";
  formOperator.value = "gt";
  formThreshold.value = 0;
  formEmail.value = "";
  formCooldown.value = 60;
  showForm.value = false;
}

async function handleCreate() {
  if (!formName.value || !formEmail.value) {
    toast.error("Name and email are required");
    return;
  }
  isSubmitting.value = true;
  try {
    await createAlertRule({
      name: formName.value,
      metric: formMetric.value,
      operator: formOperator.value,
      threshold: formThreshold.value,
      email: formEmail.value,
      cooldown_minutes: formCooldown.value,
    });
    queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    toast.success("Alert created");
    window.posthog?.capture("alert_created", { metric: formMetric.value });
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
</script>

<template>
  <div class="space-y-6 pb-12">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Cost Alerts</h1>
        <p class="text-muted-foreground text-sm">
          Get emailed when costs spike, margins drop, or usage patterns change
        </p>
      </div>
      <Button v-if="!showForm" @click="showForm = true">
        <Plus class="h-4 w-4 mr-2" />
        New Alert
      </Button>
    </div>

    <!-- Create form -->
    <Card v-if="showForm">
      <CardHeader class="pb-3">
        <CardTitle class="text-base">New Alert Rule</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- Category filter -->
        <div class="flex gap-1.5 flex-wrap">
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

        <!-- Metric picker -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            v-for="m in filteredMetrics"
            :key="m.value"
            class="text-left p-3 rounded-lg border transition-colors"
            :class="
              formMetric === m.value
                ? 'border-foreground bg-muted/50'
                : 'hover:bg-muted/30'
            "
            @click="selectMetric(m.value)"
          >
            <div class="flex items-center gap-2">
              <span
                class="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                :class="categoryColor(m.category)"
                >{{ m.category }}</span
              >
              <span class="text-sm font-medium">{{ m.label }}</span>
            </div>
            <p class="text-xs text-muted-foreground mt-1">
              {{ m.description }}
            </p>
          </button>
        </div>

        <div>
          <label
            for="alert-name"
            class="text-xs font-medium text-muted-foreground block mb-1"
            >Name</label
          >
          <input
            id="alert-name"
            v-model="formName"
            type="text"
            placeholder="e.g. Daily cost spike"
            class="w-full h-9 rounded-md border bg-background px-3 text-sm"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label
              for="alert-metric"
              class="text-xs font-medium text-muted-foreground block mb-1"
              >Metric</label
            >
            <select
              id="alert-metric"
              v-model="formMetric"
              class="w-full h-9 rounded-md border bg-background px-3 text-sm"
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
              >Condition</label
            >
            <select
              id="alert-operator"
              v-model="formOperator"
              class="w-full h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option v-for="op in OPERATORS" :key="op.value" :value="op.value">
                {{ op.label }}
              </option>
            </select>
          </div>
          <div>
            <label
              for="alert-threshold"
              class="text-xs font-medium text-muted-foreground block mb-1"
              >Threshold</label
            >
            <input
              id="alert-threshold"
              v-model.number="formThreshold"
              type="number"
              step="any"
              class="w-full h-9 rounded-md border bg-background px-3 text-sm"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              for="alert-email"
              class="text-xs font-medium text-muted-foreground block mb-1"
              >Send to</label
            >
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
              for="alert-cooldown"
              class="text-xs font-medium text-muted-foreground block mb-1"
              >Don't re-alert for</label
            >
            <div class="flex items-center gap-2">
              <input
                id="alert-cooldown"
                v-model.number="formCooldown"
                type="number"
                min="1"
                class="w-full h-9 rounded-md border bg-background px-3 text-sm"
              />
              <span class="text-xs text-muted-foreground shrink-0"
                >minutes</span
              >
            </div>
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
            :href="`https://tansohq.com?utm_source=observe&utm_medium=alert_form&utm_campaign=${formMetric}`"
            target="_blank"
            class="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-200 hover:bg-emerald-300 px-3 py-1.5 rounded-md transition-colors"
          >
            Learn more
            <ExternalLink class="h-3 w-3" />
          </a>
        </div>

        <div class="flex gap-2 pt-2">
          <Button :disabled="isSubmitting" @click="handleCreate">
            {{ isSubmitting ? "Creating..." : "Create Alert" }}
          </Button>
          <Button variant="ghost" @click="resetForm">Cancel</Button>
        </div>
      </CardContent>
    </Card>

    <!-- Loading -->
    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>

    <!-- Rules list -->
    <div v-else-if="data?.rules?.length" class="space-y-3">
      <Card v-for="rule in data.rules" :key="rule.id">
        <CardContent class="p-4">
          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium">{{ rule.name }}</span>
                <span
                  class="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                  :class="categoryColor(metricCategory(rule.metric))"
                  >{{ metricCategory(rule.metric) }}</span
                >
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
                {{ metricLabel(rule.metric) }}
                {{ operatorLabel(rule.operator) }}
                {{ formatThreshold(rule.metric, rule.threshold) }} &middot;
                {{ rule.email }}
                <template v-if="rule.last_triggered_at">
                  &middot; Last fired
                  {{ new Date(rule.last_triggered_at).toLocaleDateString() }}
                </template>
              </p>
            </div>
            <div class="flex items-center gap-2">
              <a
                v-if="TANSO_UPSELLS[rule.metric]"
                :href="`https://tansohq.com?utm_source=observe&utm_medium=alert_rule&utm_campaign=${rule.metric}`"
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
    <Card v-else>
      <CardContent class="p-8 text-center">
        <Bell class="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h2 class="text-lg font-semibold">No alerts configured</h2>
        <p class="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Set up alerts for margin drops, usage spikes, pricing gaps, and
          concentration risks. Every alert comes with a suggested fix.
        </p>
        <Button class="mt-4" @click="showForm = true">
          <Plus class="h-4 w-4 mr-2" />
          Create your first alert
        </Button>
      </CardContent>
    </Card>
  </div>
</template>
