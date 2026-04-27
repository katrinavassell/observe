<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useMutation } from "@tanstack/vue-query";
import { Check, ArrowRight, Loader2 } from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import {
  getUsageLimits,
  getBillingStatus,
  startCheckout,
  openPortal,
} from "@/lib/api";
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

const usageItems = computed(() => {
  if (!usageLimits.value) return [];
  const items: Array<{
    label: string;
    used: number;
    limit: number | null;
    pct: number;
  }> = [];

  const event = usageLimits.value.event_ingest?.usage;
  if (event) {
    items.push({
      label: "Events",
      used: event.used,
      limit: event.limit || null,
      pct: event.limit
        ? Math.min(100, Math.round((event.used / event.limit) * 100))
        : 0,
    });
  }

  return items;
});

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
      "10,000 AI insights/month",
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
      "Unlimited AI insights",
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
      <h1 class="text-2xl font-semibold tracking-tight">Plans</h1>
      <p class="text-muted-foreground">
        Start free. Upgrade when you need more capacity.
      </p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl items-stretch">
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
          v-if="currentPlan === plan.key"
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
                Manage subscription
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
            <template v-else-if="!isLoggedIn && plan.key !== 'free'">
              <Button class="w-full" @click="router.push('/signup')">
                Sign up to upgrade
                <ArrowRight class="h-4 w-4 ml-2" />
              </Button>
            </template>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Tanso Platform upsell -->
    <Card class="max-w-5xl">
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
    <div v-if="isLoggedIn" class="max-w-5xl space-y-4">
      <h2
        class="text-sm font-semibold text-muted-foreground uppercase tracking-wider"
      >
        Usage this month
      </h2>
      <Card>
        <CardContent class="p-6 space-y-4">
          <template v-if="usageItems.length > 0">
            <div
              v-for="item in usageItems"
              :key="item.label"
              class="space-y-1.5"
            >
              <div class="flex items-center justify-between text-sm">
                <span class="font-medium">{{ item.label }}</span>
                <span class="tabular-nums text-muted-foreground">
                  {{ item.used.toLocaleString() }}
                  <template v-if="item.limit">
                    / {{ item.limit.toLocaleString() }}
                  </template>
                  <template v-else> (unlimited) </template>
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
                        ? 'bg-warning'
                        : 'bg-primary'
                  "
                  :style="{ width: item.pct + '%' }"
                />
              </div>
              <div v-else class="h-2 bg-primary/20 rounded-full" />
            </div>
          </template>
          <p v-else class="text-sm text-muted-foreground text-center py-2">
            Usage data loading...
          </p>
          <p class="text-xs text-muted-foreground pt-1">
            Limits reset on the 1st of each month. Self-host for unlimited
            usage.
          </p>
        </CardContent>
      </Card>
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
