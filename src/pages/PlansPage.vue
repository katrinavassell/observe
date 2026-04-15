<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { toast } from "vue-sonner";
import { Check, Sparkles, ExternalLink } from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import {
  getBillingStatus,
  createCheckout,
  createPortalSession,
  getUsageLimits,
} from "@/lib/api";
import { useAuth } from "@/composables/useAuth";

const router = useRouter();
const { isLoggedIn } = useAuth();

const activeTab = ref<"plans" | "usage">("plans");
const isUpgrading = ref(false);

const { data: billing, isError: billingError } = useQuery({
  queryKey: ["billing-status"],
  queryFn: getBillingStatus,
  enabled: isLoggedIn,
});

const { data: usageLimits, isError: usageLimitsError } = useQuery({
  queryKey: ["usage-limits"],
  queryFn: getUsageLimits,
  enabled: isLoggedIn,
});

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
      label: "Events this month",
      used: event.used,
      limit: event.limit || null,
      pct: event.limit
        ? Math.min(100, Math.round((event.used / event.limit) * 100))
        : 0,
    });
  }

  const ai = usageLimits.value.ai_insights?.usage;
  if (ai) {
    items.push({
      label: "Messages this month",
      used: ai.used,
      limit: ai.limit || null,
      pct: ai.limit ? Math.min(100, Math.round((ai.used / ai.limit) * 100)) : 0,
    });
  }

  return items;
});

async function handleUpgrade(plan: string = "growth") {
  if (!isLoggedIn.value) {
    window.posthog?.capture("upgrade_clicked_logged_out", { plan });
    router.push("/signup");
    return;
  }
  window.posthog?.capture("upgrade_clicked", { plan });
  isUpgrading.value = true;
  try {
    const { url } = await createCheckout(plan);
    window.location.href = url;
  } catch (error) {
    toast.error("Failed to start checkout", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
    isUpgrading.value = false;
  }
}

async function handleManage() {
  try {
    const { url } = await createPortalSession();
    window.location.href = url;
  } catch (error) {
    toast.error("Failed to open billing portal", {
      description: error instanceof Error ? error.message : "Please try again.",
    });
  }
}

const plans = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    interval: "forever",
    features: [
      "10,000 events/month",
      "1,000 AI messages/month",
      "90-day data retention",
    ],
  },
  {
    key: "growth",
    name: "Growth",
    price: "$29",
    interval: "/month",
    features: [
      "500,000 events/month",
      "10,000 AI messages/month",
      "1-year data retention",
      "1 Pricing Strategy session / quarter",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: "Custom",
    interval: "",
    features: [
      "Unlimited events",
      "Unlimited AI messages",
      "Unlimited data retention",
      "Monthly Pricing Strategy session",
      "Priority support",
      "Custom contract & SLA",
    ],
  },
];

// Features included in ALL plans (shown below the plan cards)
const sharedFeatures = [
  "Unlimited team members",
  "Unlimited cost alerts",
  "SDK & Proxy tracking",
  "Stripe, OpenAI & Anthropic integrations",
  "Per-feature margin analysis",
  "CSV upload",
];

const repoUrl = "https://github.com/katrinalaszlo/observe";
</script>

<template>
  <div class="space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Plans & Usage</h1>
      <p class="text-muted-foreground">Manage your plan and track usage</p>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 border-b">
      <button
        v-for="tab in [
          { key: 'plans', label: 'Plans' },
          { key: 'usage', label: 'Usage' },
        ]"
        :key="tab.key"
        class="px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px"
        :class="
          activeTab === tab.key
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        @click="activeTab = tab.key as 'plans' | 'usage'"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Plans tab -->
    <template v-if="activeTab === 'plans'">
      <div
        class="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl items-stretch"
      >
        <Card
          v-for="plan in plans"
          :key="plan.key"
          :class="[
            'relative flex flex-col',
            plan.key === 'growth'
              ? 'border-primary shadow-md ring-1 ring-primary/20'
              : '',
            billing?.plan === plan.key && plan.key !== 'growth'
              ? 'border-primary'
              : '',
          ]"
        >
          <!-- Recommended banner -->
          <div
            v-if="plan.key === 'growth'"
            class="bg-primary text-primary-foreground text-center text-xs font-medium py-1.5 rounded-t-lg -mx-px -mt-px"
          >
            Recommended
          </div>

          <CardContent class="p-6 flex flex-col flex-1">
            <div class="space-y-4 flex-1">
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-lg font-semibold">{{ plan.name }}</h3>
                  <span
                    v-if="billing?.plan === plan.key"
                    class="text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full"
                  >
                    Current
                  </span>
                </div>
                <p class="text-xs text-muted-foreground mt-1">
                  {{
                    plan.key === "free"
                      ? "Get started with core analytics"
                      : plan.key === "growth"
                        ? "For teams scaling AI features"
                        : "Tailored to your organization"
                  }}
                </p>
              </div>

              <div class="pb-2">
                <span class="text-3xl font-bold tracking-tight">{{
                  plan.price
                }}</span>
                <span class="text-muted-foreground text-sm ml-1">{{
                  plan.interval
                }}</span>
              </div>

              <div class="border-t pt-4">
                <p
                  class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3"
                >
                  {{
                    plan.key === "free"
                      ? "Includes"
                      : plan.key === "growth"
                        ? "Everything in Free, plus"
                        : "Everything in Growth, plus"
                  }}
                </p>
                <ul class="space-y-2.5">
                  <li
                    v-for="feature in plan.features"
                    :key="feature"
                    class="flex items-start gap-2 text-sm"
                  >
                    <Check class="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                    <span>{{ feature }}</span>
                  </li>
                </ul>
              </div>
            </div>

            <div class="pt-6 mt-auto">
              <Button
                v-if="billing?.plan === plan.key && plan.key === 'growth'"
                variant="outline"
                class="w-full"
                @click="handleManage"
              >
                <ExternalLink class="h-4 w-4 mr-2" />
                Manage subscription
              </Button>
              <Button
                v-else-if="
                  plan.key === 'growth' && (!billing || billing.plan === 'free')
                "
                class="w-full"
                :disabled="isUpgrading"
                @click="handleUpgrade('growth')"
              >
                {{ isUpgrading ? "Redirecting..." : "Get Growth" }}
              </Button>
              <a
                v-else-if="plan.key === 'enterprise'"
                href="https://cal.com/katrina-laszlo/30-minute-meeting?duration=30"
                target="_blank"
                rel="noopener"
                class="block"
              >
                <Button variant="outline" class="w-full">
                  <ExternalLink class="h-4 w-4 mr-2" />
                  Talk to us
                </Button>
              </a>
              <div
                v-else-if="
                  plan.key === 'free' && (!billing || billing.plan === 'free')
                "
                class="text-center"
              >
                <Button variant="ghost" class="w-full" disabled>
                  Current plan
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Shared features -->
      <div class="max-w-4xl">
        <p
          class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3"
        >
          Included in every plan
        </p>
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          <span
            v-for="feature in sharedFeatures"
            :key="feature"
            class="flex items-center gap-1.5 text-sm text-muted-foreground"
          >
            <Check class="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            {{ feature }}
          </span>
        </div>
      </div>

      <!-- Platform teaser -->
      <div class="max-w-4xl">
        <div
          class="rounded-lg border border-dashed border-muted-foreground/25 p-6"
        >
          <div class="flex items-start justify-between">
            <div class="space-y-2">
              <p
                class="text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Also by Tanso
              </p>
              <h3 class="text-base font-semibold">Tanso Platform</h3>
              <p class="text-sm text-muted-foreground max-w-md">
                Enforce entitlements, meter usage, and bill customers directly
                from your request path. Plans, credits, subscriptions, and
                invoices — all in one place.
              </p>
            </div>
            <a
              href="https://cal.com/katrina-laszlo/30-minute-meeting?duration=30"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center h-8 px-3 text-xs rounded-md border bg-background hover:bg-muted transition-colors"
            >
              Learn more
              <ExternalLink class="h-3 w-3 ml-1.5" />
            </a>
          </div>
        </div>
      </div>

      <div class="max-w-4xl text-sm text-muted-foreground">
        <p>
          Observe is free and open source. Self-host for free with no limits, or
          use our hosted version above.
          <a
            :href="repoUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-foreground hover:underline font-medium"
          >
            View on GitHub
            <ExternalLink class="h-3 w-3" />
          </a>
        </p>
      </div>
    </template>

    <!-- Usage tab -->
    <template v-if="activeTab === 'usage'">
      <div class="max-w-lg space-y-6">
        <Card>
          <CardContent class="p-6 space-y-5">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-semibold">Current Period</h3>
              <span class="text-xs text-muted-foreground">
                {{ billing?.plan === "growth" ? "Growth" : "Free" }} plan
              </span>
            </div>

            <div
              v-for="item in usageItems"
              :key="item.label"
              class="space-y-1.5"
            >
              <div class="flex items-center justify-between text-sm">
                <span>{{ item.label }}</span>
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

            <div
              v-if="!isLoggedIn"
              class="text-sm text-muted-foreground text-center py-4"
            >
              Sign up to track your usage.
            </div>
            <div
              v-else-if="usageLimitsError || billingError"
              class="text-sm text-muted-foreground text-center py-4"
            >
              Unable to load usage data. Please try again later.
            </div>
            <div
              v-else-if="!usageItems.length"
              class="text-sm text-muted-foreground text-center py-4"
            >
              Usage data loading...
            </div>
          </CardContent>
        </Card>

        <Button
          v-if="billing?.plan !== 'growth'"
          class="w-full"
          :disabled="isUpgrading"
          @click="handleUpgrade"
        >
          <Sparkles class="h-4 w-4 mr-2" />
          Upgrade for unlimited events
        </Button>
      </div>
    </template>
  </div>
</template>
