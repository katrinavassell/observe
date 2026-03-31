<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import {
  Check,
  Zap,
  Loader2,
  AlertCircle,
  X,
  ArrowDown,
  RotateCcw,
  XCircle,
  Calendar,
  FileText,
  ExternalLink,
} from "lucide-vue-next";
import { tansoGetStatus } from "@/lib/api";
import { useAuth } from "@/composables/useAuth";
import { toast } from "vue-sonner";

const queryClient = useQueryClient();
const router = useRouter();
const { isLoggedIn } = useAuth();
const isPending = ref(false);

// Tanso is the source of truth for plan state (Stripe-driven mode syncs into Tanso)
const { data: statusData, isLoading } = useQuery({
  queryKey: ["tanso-status"],
  queryFn: tansoGetStatus,
  retry: 1,
  retryDelay: 2000,
});

async function apiPost(url: string, body: any) {
  const res = await fetch(`/api${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function refresh() {
  queryClient.invalidateQueries({ queryKey: ["tanso-status"] });
}

const isOpeningPortal = ref(false);
async function openStripePortal() {
  if (!requireAuth()) return;
  isOpeningPortal.value = true;
  try {
    const data = await apiPost("/billing/portal", {});
    if (data.url) {
      window.location.href = data.url;
    }
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : "Failed to open billing portal",
    );
  } finally {
    isOpeningPortal.value = false;
  }
}

const isConfigured = computed(() => statusData.value?.configured ?? false);
const entitlements = computed(() => statusData.value?.entitlements || []);
const customer = computed(() => statusData.value?.customer);

const currentSub = computed(() => {
  const subs = customer.value?.subscriptions || [];
  return subs.find((s: any) => s.isActive) || subs[0] || null;
});

const currentPlanKey = computed(() => currentSub.value?.plan?.key || null);
const currentPlanPrice = computed(
  () => currentSub.value?.plan?.priceAmount ?? 0,
);
const isOnPaidPlan = computed(() =>
  paidPlans.value.some((p: any) => p.key === currentPlanKey.value),
);

const hasScheduledCancellation = computed(
  () =>
    currentSub.value?.isActive &&
    currentSub.value?.cancelledAt &&
    currentSub.value?.cancelEffectiveAt &&
    new Date(currentSub.value.cancelEffectiveAt) > new Date(),
);

const billingPeriodEnd = computed(() => {
  const d = currentSub.value?.currentPeriodEnd;
  return d ? new Date(d).toLocaleDateString() : null;
});

const cancelEffectiveDate = computed(() => {
  const d = currentSub.value?.cancelEffectiveAt;
  return d ? new Date(d).toLocaleDateString() : null;
});

const meteredEntitlements = computed(() =>
  entitlements.value.filter(
    (e: any) => e.usageLimit || e.currentUsage != null || e.unlimited,
  ),
);

// Features to hide from plan cards (internal capabilities, not selling points)
const hiddenFeatures = new Set(["sample_data"]);

// Consistent feature ordering: usage-based first, then alphabetical
function sortFeatures(features: any[]) {
  return [...features]
    .filter((f) => !hiddenFeatures.has(f.key))
    .sort((a, b) => {
      if (a.pricingType === "usage_based" && b.pricingType !== "usage_based")
        return -1;
      if (a.pricingType !== "usage_based" && b.pricingType === "usage_based")
        return 1;
      return (a.name || "").localeCompare(b.name || "");
    });
}

// Plans from Tanso
const plans = computed(() => {
  const raw = statusData.value?.plans || [];
  return raw
    .map((p: any) => {
      const base = p.plan ? { ...p.plan, features: p.features } : p;
      return { ...base, features: sortFeatures(base.features || []) };
    })
    .sort(
      (a: any, b: any) =>
        Number(a.priceAmount ?? 0) - Number(b.priceAmount ?? 0),
    );
});

const freePlan = computed(() =>
  plans.value.find((p: any) => Number(p.priceAmount ?? 0) === 0),
);
const paidPlans = computed(() =>
  plans.value.filter((p: any) => Number(p.priceAmount ?? 0) > 0),
);

const featureLabelMap: Record<string, string> = {
  ai_insights: "AI Insights",
};
function featureLabel(key: string) {
  return (
    featureLabelMap[key] ||
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function getUsagePercent(e: any) {
  if (!e.usageLimit || e.usageLimit === 0) return 0;
  return Math.min(
    100,
    Math.round(((e.currentUsage || 0) / e.usageLimit) * 100),
  );
}

function requireAuth(): boolean {
  if (!isLoggedIn.value) {
    router.push({ name: "signup", query: { redirect: "/plans" } });
    return false;
  }
  return true;
}

async function handleSubscribe(planKey: string) {
  if (!requireAuth()) return;
  isPending.value = true;
  try {
    const plan = plans.value.find((p: any) => p.key === planKey);
    if (!plan?.id) {
      toast.error("Plan not found");
      isPending.value = false;
      return;
    }
    const data = await apiPost("/billing/subscribe", { planId: plan.id });

    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }

    if (data.changeType === "downgrade") {
      toast.success("Plan will change to Free at end of billing period");
    } else if (data.changeType === "upgrade") {
      toast.success("Plan upgraded!");
    } else if (data.changeType === "reactivated") {
      toast.success("Subscription reactivated!");
    }
    refresh();
  } catch (error: unknown) {
    toast.error(
      error instanceof Error ? error.message : "Failed to change plan",
    );
    refresh();
  } finally {
    isPending.value = false;
  }
}

async function handleCancel(
  mode: "IMMEDIATE" | "END_OF_PERIOD" = "END_OF_PERIOD",
) {
  if (!requireAuth() || !currentSub.value) return;
  isPending.value = true;
  try {
    await apiPost("/billing/cancel", {
      subscriptionId: currentSub.value.id,
      cancelMode: mode,
    });
    toast.success(
      mode === "END_OF_PERIOD"
        ? "Subscription will cancel at end of billing period"
        : "Subscription cancelled",
    );
    refresh();
  } catch (error: unknown) {
    toast.error(error instanceof Error ? error.message : "Failed to cancel");
  } finally {
    isPending.value = false;
  }
}

async function handleReactivate() {
  if (!requireAuth() || !currentSub.value) return;
  isPending.value = true;
  try {
    await apiPost("/billing/reactivate", {
      subscriptionId: currentSub.value.id,
    });
    toast.success("Subscription reactivated!");
    refresh();
  } catch (error: unknown) {
    toast.error(
      error instanceof Error ? error.message : "Failed to reactivate",
    );
  } finally {
    isPending.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Plans & Billing</h1>
        <p class="text-sm text-muted-foreground mt-1">
          Manage your subscription and track feature usage
        </p>
      </div>
      <button
        v-if="isOnPaidPlan && currentSub"
        class="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        :disabled="isOpeningPortal"
        @click="openStripePortal"
      >
        <Loader2 v-if="isOpeningPortal" class="h-4 w-4 animate-spin" />
        <ExternalLink v-else class="h-4 w-4" />
        Manage Billing
      </button>
    </div>

    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
    </div>

    <template v-else-if="!isConfigured">
      <div class="rounded-xl border bg-card p-8 text-center">
        <AlertCircle class="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h2 class="text-lg font-semibold">Billing Not Connected</h2>
        <p class="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Stripe is not configured. All features are currently available without
          limits.
        </p>
      </div>
    </template>

    <template v-else>
      <!-- Subscription status banner -->
      <div
        v-if="hasScheduledCancellation"
        class="rounded-xl border border-warning/30 bg-warning/10 p-4 flex items-center justify-between"
      >
        <div class="flex items-center gap-3">
          <Calendar class="h-5 w-5 text-warning" />
          <div>
            <p class="text-sm font-medium text-foreground">
              Your subscription is cancelling
            </p>
            <p class="text-xs text-muted-foreground">
              Access continues until {{ cancelEffectiveDate }}
            </p>
          </div>
        </div>
        <button
          class="rounded-lg bg-warning px-3 py-1.5 text-xs font-medium text-warning-foreground hover:bg-warning/90 transition-colors disabled:opacity-50"
          :disabled="isPending"
          @click="handleReactivate"
        >
          <RotateCcw class="h-3 w-3 inline mr-1" />
          Keep Subscription
        </button>
      </div>

      <!-- Usage tracking -->
      <div v-if="meteredEntitlements.length > 0" class="space-y-4">
        <div class="flex items-center gap-3">
          <h2 class="text-lg font-semibold">Your Usage</h2>
          <span
            v-if="currentPlanKey"
            class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
          >
            {{ currentSub?.plan?.name || currentPlanKey }} plan
          </span>
        </div>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="e in meteredEntitlements"
            :key="e.featureKey"
            class="rounded-xl border bg-card p-5"
          >
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-medium">{{
                e.featureName || featureLabel(e.featureKey)
              }}</span>
              <span
                :class="[
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  e.allowed
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive',
                ]"
              >
                {{ e.allowed ? "Active" : "Limit reached" }}
              </span>
            </div>
            <!-- Unlimited plan -->
            <div v-if="e.unlimited" class="space-y-2">
              <div class="flex justify-between text-xs text-muted-foreground">
                <span>{{ e.currentUsage || 0 }} used this month</span>
                <span class="text-success">Unlimited</span>
              </div>
              <div class="h-2 rounded-full bg-success/20 overflow-hidden">
                <div
                  class="h-full rounded-full bg-success"
                  style="width: 100%"
                />
              </div>
            </div>
            <!-- Limited plan -->
            <div v-else-if="e.usageLimit" class="space-y-2">
              <div class="flex justify-between text-xs text-muted-foreground">
                <span>{{ e.currentUsage || 0 }} / {{ e.usageLimit }} used</span>
                <span
                  >{{
                    e.remaining ?? e.usageLimit - (e.currentUsage || 0)
                  }}
                  remaining</span
                >
              </div>
              <div class="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="
                    getUsagePercent(e) >= 90
                      ? 'bg-destructive'
                      : getUsagePercent(e) >= 70
                        ? 'bg-warning'
                        : 'bg-success'
                  "
                  :style="{ width: getUsagePercent(e) + '%' }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Plan cards -->
      <div v-if="plans.length > 0" class="space-y-8">
        <div
          class="grid gap-6 max-w-5xl"
          :class="
            plans.length === 2
              ? 'sm:grid-cols-2 max-w-3xl'
              : `sm:grid-cols-2 lg:grid-cols-${Math.min(plans.length, 3)}`
          "
        >
          <div
            v-for="plan in plans"
            :key="plan.id"
            :class="[
              'rounded-xl p-6 flex flex-col relative',
              currentPlanKey === plan.key
                ? 'border-2 border-success/40 bg-success/5'
                : Number(plan.priceAmount ?? 0) > 0 && !isOnPaidPlan
                  ? 'border-2 border-primary bg-card shadow-md'
                  : 'border border-border bg-card',
            ]"
          >
            <div class="flex items-center justify-between mb-1">
              <h3 class="text-lg font-semibold">{{ plan.name }}</h3>
              <span
                v-if="currentPlanKey === plan.key"
                class="inline-flex items-center rounded-full bg-success/10 text-success px-2.5 py-0.5 text-xs font-medium"
              >
                Current
              </span>
            </div>
            <p class="text-sm text-muted-foreground">{{ plan.description }}</p>
            <div class="mt-4 mb-5">
              <span class="text-4xl font-bold tracking-tight"
                >${{ plan.priceAmount || 0 }}</span
              >
              <span class="text-sm text-muted-foreground ml-1">{{
                Number(plan.priceAmount ?? 0) === 0 ? "forever" : "/ month"
              }}</span>
            </div>

            <ul class="space-y-2.5 mb-6 flex-1">
              <li
                v-for="f in plan.features"
                :key="f.key"
                class="flex items-start gap-2 text-sm"
              >
                <Zap
                  v-if="f.pricingType === 'usage_based'"
                  class="h-4 w-4 text-primary mt-0.5 shrink-0"
                />
                <Check v-else class="h-4 w-4 text-success mt-0.5 shrink-0" />
                {{ f.name }}
                <span v-if="f.pricing?.maxUsage" class="text-muted-foreground"
                  >({{ f.pricing.maxUsage }}/mo)</span
                >
                <span
                  v-else-if="f.pricingType === 'usage_based'"
                  class="text-muted-foreground"
                  >(Unlimited)</span
                >
              </li>
            </ul>

            <!-- Current plan -->
            <template v-if="currentPlanKey === plan.key">
              <div
                class="w-full rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-sm font-medium text-success text-center"
              >
                <Check class="h-4 w-4 inline mr-1" />
                Your current plan
              </div>
              <div
                v-if="billingPeriodEnd && Number(plan.priceAmount ?? 0) > 0"
                class="mt-3 text-xs text-muted-foreground text-center"
              >
                Renews {{ billingPeriodEnd }}
              </div>
              <button
                v-if="
                  Number(plan.priceAmount ?? 0) > 0 && !hasScheduledCancellation
                "
                class="mt-3 w-full text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                :disabled="isPending"
                @click="handleCancel('END_OF_PERIOD')"
              >
                Cancel subscription
              </button>
            </template>

            <!-- Downgrade button (on free plan, shown when user is on a paid plan) -->
            <button
              v-else-if="
                Number(plan.priceAmount ?? 0) === 0 &&
                isOnPaidPlan &&
                !hasScheduledCancellation
              "
              class="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              :disabled="isPending"
              @click="handleSubscribe(plan.key)"
            >
              <ArrowDown class="h-4 w-4" />
              Downgrade to {{ plan.name }}
            </button>

            <!-- Upgrade button (on paid plans, shown when user is on a cheaper plan) -->
            <button
              v-else-if="
                Number(plan.priceAmount ?? 0) > Number(currentPlanPrice)
              "
              class="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              :disabled="isPending"
              @click="handleSubscribe(plan.key)"
            >
              <Zap class="h-4 w-4" />
              Upgrade to {{ plan.name }}
            </button>

            <!-- Downgrade to a cheaper paid plan -->
            <button
              v-else-if="
                Number(plan.priceAmount ?? 0) > 0 &&
                Number(plan.priceAmount ?? 0) < Number(currentPlanPrice)
              "
              class="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              :disabled="isPending"
              @click="handleSubscribe(plan.key)"
            >
              <ArrowDown class="h-4 w-4" />
              Switch to {{ plan.name }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-else-if="plans.length === 0"
        class="rounded-xl border bg-card p-8 text-center"
      >
        <AlertCircle class="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h2 class="text-lg font-semibold">No Plans Available</h2>
        <p class="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Plans haven't been configured yet. All features are currently
          available without limits.
        </p>
      </div>
    </template>
  </div>
</template>
