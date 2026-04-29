<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useMutation } from "@tanstack/vue-query";
import { Check, ArrowRight, Loader2 } from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import {
  getUsageLimits,
  getBillingStatus,
  getEntitlements,
  startCheckout,
  openPortal,
} from "@/lib/api";
import { Zap, Bell, Building2 } from "lucide-vue-next";
import { useAuth } from "@/composables/useAuth";
import { toast } from "vue-sonner";

const router = useRouter();
const { isLoggedIn } = useAuth();

const { data: usageLimits } = useQuery({
  queryKey: ["usage-limits"],
  queryFn: getUsageLimits,
  enabled: isLoggedIn,
});

const { data: billing } = useQuery({
  queryKey: ["billing-status"],
  queryFn: getBillingStatus,
  enabled: isLoggedIn,
});

const currentPlan = computed(() => billing.value?.plan || "free");

const { data: entitlements } = useQuery({
  queryKey: ["entitlements"],
  queryFn: getEntitlements,
  enabled: isLoggedIn,
});

interface UsageItem {
  label: string;
  icon: typeof Zap;
  used: number;
  limit: number | null;
  pct: number;
  atLimit: boolean;
  upgradeTarget: string | null;
  type: "meter" | "card";
}

const usageItems = computed<UsageItem[]>(() => {
  if (!usageLimits.value && !entitlements.value) return [];
  const items: UsageItem[] = [];
  const plan = currentPlan.value;

  const event = usageLimits.value?.event_ingest?.usage;
  if (event) {
    const pct = event.limit
      ? Math.min(100, Math.round((event.used / event.limit) * 100))
      : 0;
    items.push({
      label: "Events this month",
      icon: Zap,
      used: event.used,
      limit: event.limit || null,
      pct,
      atLimit: pct >= 80,
      upgradeTarget: plan === "free" ? "pro" : plan === "pro" ? "team" : null,
      type: "meter",
    });
  }

  const alerts = entitlements.value?.cost_alerts;
  if (alerts) {
    const pct = alerts.limit
      ? Math.min(100, Math.round(((alerts.usage ?? 0) / alerts.limit) * 100))
      : 0;
    items.push({
      label: "Active cost alerts",
      icon: Bell,
      used: alerts.usage ?? 0,
      limit: alerts.limit ?? null,
      pct,
      atLimit: alerts.limit != null && (alerts.usage ?? 0) >= alerts.limit,
      upgradeTarget: plan === "free" ? "pro" : null,
      type: "card",
    });
  }

  const orgs = entitlements.value?.organizations;
  if (orgs) {
    const pct = orgs.limit
      ? Math.min(100, Math.round(((orgs.usage ?? 0) / orgs.limit) * 100))
      : 0;
    items.push({
      label: "Organizations",
      icon: Building2,
      used: orgs.usage ?? 0,
      limit: orgs.limit ?? null,
      pct,
      atLimit: orgs.limit != null && (orgs.usage ?? 0) >= orgs.limit,
      upgradeTarget: plan !== "team" ? "team" : null,
      type: "card",
    });
  }

  return items;
});

const activeTab = ref<"plans" | "usage">("plans");

const checkoutMutation = useMutation({
  mutationFn: (plan: string) => startCheckout(plan),
  onSuccess: (data) => {
    if (data.url) window.location.href = data.url;
  },
  onError: (err) => {
    toast.error("Checkout failed", {
      description: err instanceof Error ? err.message : "Please try again.",
    });
  },
});

const portalMutation = useMutation({
  mutationFn: () => openPortal(),
  onSuccess: (data) => {
    if (data.url) window.location.href = data.url;
  },
  onError: (err) => {
    toast.error("Portal failed", {
      description: err instanceof Error ? err.message : "Please try again.",
    });
  },
});

const plans = [
  {
    key: "free",
    name: "Free",
    price: "Free",
    priceSuffix: "forever",
    description: "AI cost observability",
    badge: null as string | null,
    features: [
      "10,000 events/month",
      "90-day data retention",
      "SDK & proxy cost tracking",
      "Stripe, OpenAI & Anthropic integrations",
      "Per-feature margin analysis",
      "3 active cost alerts",
      "Unlimited team members",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    price: "$29",
    priceSuffix: "/month",
    description: "For growing AI products",
    popular: true,
    badge: null as string | null,
    features: [
      "100,000 events/month",
      "365-day data retention",
      "Unlimited cost alerts",
      "Per-feature margin analysis",
      "All integrations included",
      "Unlimited team members",
    ],
  },
  {
    key: "team",
    name: "Team",
    price: "$99",
    priceSuffix: "/month",
    description: "For agencies & portfolios",
    badge: null as string | null,
    features: [
      "1,000,000 events/month",
      "Unlimited data retention",
      "Unlimited cost alerts",
      "Multi-org management (coming soon)",
      "Priority support",
      "Everything in Pro",
    ],
  },
];
</script>

<template>
  <div class="space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Plans & Usage</h1>
      <p class="text-muted-foreground">
        Start free. Upgrade when you need more capacity.
      </p>
    </div>

    <div class="flex gap-1 border-b max-w-5xl">
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
        :class="
          activeTab === 'plans'
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        @click="activeTab = 'plans'"
      >
        Plans
      </button>
      <button
        v-if="isLoggedIn"
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
        :class="
          activeTab === 'usage'
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        @click="activeTab = 'usage'"
      >
        Usage
      </button>
    </div>

    <div
      v-if="activeTab === 'plans'"
      class="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl items-stretch"
    >
      <Card
        v-for="plan in plans"
        :key="plan.key"
        class="relative flex flex-col"
        :class="
          plan.popular
            ? 'border-2 border-primary shadow-lg ring-1 ring-primary/20'
            : ''
        "
      >
        <div
          v-if="isLoggedIn && currentPlan === plan.key"
          class="bg-primary text-primary-foreground text-center text-xs font-medium py-1.5 rounded-t-lg -mx-px -mt-px"
        >
          Your current plan
        </div>
        <div
          v-else-if="plan.popular"
          class="bg-primary text-primary-foreground text-center text-xs font-medium py-1.5 rounded-t-lg -mx-0.5 -mt-0.5"
        >
          Most popular
        </div>
        <CardContent
          class="p-6 flex flex-col flex-1"
          :class="currentPlan !== plan.key && !plan.popular ? 'pt-8' : ''"
        >
          <div class="space-y-4 flex-1">
            <div>
              <h3 class="text-lg font-semibold">{{ plan.name }}</h3>
              <p class="text-xs text-muted-foreground mt-1">
                {{ plan.description }}
              </p>
            </div>

            <div class="pb-2">
              <span class="text-3xl font-bold tracking-tight">{{
                plan.price
              }}</span>
              <span class="text-muted-foreground text-sm ml-1">{{
                plan.priceSuffix
              }}</span>
            </div>

            <div class="border-t pt-4">
              <p
                class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3"
              >
                Includes
              </p>
              <ul class="space-y-2.5">
                <li
                  v-for="feature in plan.features"
                  :key="feature"
                  class="flex items-start gap-2 text-sm"
                >
                  <Check class="h-4 w-4 text-success mt-0.5 shrink-0" />
                  <span>{{ feature }}</span>
                </li>
              </ul>
            </div>
          </div>

          <div class="pt-6 mt-auto">
            <template v-if="currentPlan === plan.key">
              <Button
                v-if="plan.key !== 'free'"
                variant="outline"
                class="w-full"
                :disabled="portalMutation.isPending.value"
                @click="portalMutation.mutate()"
              >
                <Loader2
                  v-if="portalMutation.isPending.value"
                  class="h-4 w-4 mr-2 animate-spin"
                />
                Manage billing
              </Button>
              <Button v-else variant="outline" class="w-full" disabled>
                Current plan
              </Button>
            </template>
            <template v-else-if="isLoggedIn && plan.key !== 'free'">
              <Button
                class="w-full"
                :disabled="checkoutMutation.isPending.value"
                @click="checkoutMutation.mutate(plan.key)"
              >
                <Loader2
                  v-if="checkoutMutation.isPending.value"
                  class="h-4 w-4 mr-2 animate-spin"
                />
                Upgrade to {{ plan.name }}
                <ArrowRight class="h-4 w-4 ml-2" />
              </Button>
            </template>
            <template v-else-if="!isLoggedIn">
              <Button class="w-full" @click="router.push('/signup')">
                {{ plan.key === "free" ? "Start free" : "Get started" }}
                <ArrowRight class="h-4 w-4 ml-2" />
              </Button>
            </template>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Tanso Platform upsell -->
    <Card v-if="activeTab === 'plans'" class="max-w-5xl">
      <CardContent
        class="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6"
      >
        <div class="flex-1">
          <h3 class="font-semibold">Need more than observability?</h3>
          <p class="text-sm text-muted-foreground mt-1">
            Tanso is the full monetization platform — usage metering,
            entitlements, subscription management, pricing experimentation, and
            revenue recovery. Everything in Observe, plus everything you need to
            bill.
          </p>
        </div>
        <div class="flex gap-2 shrink-0 w-full md:w-auto">
          <a
            href="https://dashboard.tansohq.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button>
              Explore Tanso
              <ArrowRight class="h-4 w-4 ml-2" />
            </Button>
          </a>
          <a
            href="https://cal.com/katrina-laszlo/30-minute-meeting?duration=30"
            target="_blank"
            rel="noopener"
          >
            <Button variant="outline">Talk to us</Button>
          </a>
        </div>
      </CardContent>
    </Card>

    <!-- Usage section -->
    <div v-if="activeTab === 'usage' && isLoggedIn" class="max-w-5xl space-y-5">
      <!-- Metered usage (progress bars) -->
      <template
        v-for="item in usageItems.filter((i) => i.type === 'meter')"
        :key="item.label"
      >
        <Card>
          <CardContent class="p-5">
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2.5">
                <component
                  :is="item.icon"
                  class="h-4 w-4 text-muted-foreground"
                />
                <span class="text-sm font-medium">{{ item.label }}</span>
              </div>
              <span class="tabular-nums text-sm text-muted-foreground">
                {{ item.used.toLocaleString() }}
                <template v-if="item.limit">
                  / {{ item.limit.toLocaleString() }}</template
                >
                <template v-else> · Unlimited</template>
              </span>
            </div>
            <div
              v-if="item.limit"
              class="h-2 bg-muted rounded-full overflow-hidden"
            >
              <div
                class="h-full rounded-full transition-all"
                :class="
                  item.pct >= 90
                    ? 'bg-destructive'
                    : item.pct >= 80
                      ? 'bg-amber-500'
                      : 'bg-primary'
                "
                :style="{
                  width: item.pct > 0 ? Math.max(item.pct, 2) + '%' : '0%',
                }"
              />
            </div>
            <div
              v-if="item.atLimit && item.upgradeTarget"
              class="mt-3 flex items-center justify-between bg-muted/50 rounded-md px-3 py-2"
            >
              <p class="text-xs text-muted-foreground">
                {{ item.pct >= 100 ? "Limit reached" : "Approaching limit" }}
              </p>
              <button
                class="text-xs font-medium text-primary hover:underline"
                @click="activeTab = 'plans'"
              >
                Upgrade to {{ item.upgradeTarget === "pro" ? "Pro" : "Team" }} →
              </button>
            </div>
          </CardContent>
        </Card>
      </template>

      <!-- Feature limits (info cards, no progress bars) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card
          v-for="item in usageItems.filter((i) => i.type === 'card')"
          :key="item.label"
        >
          <CardContent class="p-5">
            <div class="flex items-center gap-2.5 mb-1">
              <component
                :is="item.icon"
                class="h-4 w-4 text-muted-foreground"
              />
              <span class="text-sm font-medium">{{ item.label }}</span>
            </div>
            <div class="flex items-baseline justify-between">
              <p class="text-2xl font-semibold tabular-nums">
                {{ item.used }}
                <span
                  v-if="item.limit"
                  class="text-sm font-normal text-muted-foreground"
                  >/ {{ item.limit }}</span
                >
                <span v-else class="text-sm font-normal text-muted-foreground"
                  >· Unlimited</span
                >
              </p>
            </div>
            <button
              v-if="item.atLimit && item.upgradeTarget"
              class="mt-2 text-xs font-medium text-primary hover:underline"
              @click="activeTab = 'plans'"
            >
              Upgrade to {{ item.upgradeTarget === "pro" ? "Pro" : "Team" }} for
              more →
            </button>
          </CardContent>
        </Card>
      </div>

      <p class="text-xs text-muted-foreground">
        Event limits reset on the 1st of each month. Self-host for unlimited
        usage.
      </p>
    </div>

    <!-- Not logged in -->
    <div v-if="!isLoggedIn" class="max-w-5xl">
      <Card class="border-primary/40 bg-primary/5">
        <CardContent class="p-5 text-center space-y-3">
          <p class="font-semibold text-sm">Sign in to track your usage</p>
          <div class="flex justify-center gap-2">
            <Button size="sm" @click="router.push('/signup')"
              >Sign up free</Button
            >
            <Button size="sm" variant="outline" @click="router.push('/login')"
              >Log in</Button
            >
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
