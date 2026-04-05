<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
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
import type { BillingStatus } from "@/lib/api";

const router = useRouter();
const { isLoggedIn } = useAuth();

const activeTab = ref<"plans" | "usage">("plans");

const billing = ref<BillingStatus | null>(null);
const isLoading = ref(true);
const isUpgrading = ref(false);

onMounted(async () => {
  try {
    billing.value = await getBillingStatus();
  } catch {
    console.error("Failed to load billing status");
  } finally {
    isLoading.value = false;
  }
});

const { data: usageLimits } = useQuery({
  queryKey: ["usage-limits"],
  queryFn: getUsageLimits,
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
      label: "AI insights this month",
      used: ai.used,
      limit: ai.limit || null,
      pct: ai.limit ? Math.min(100, Math.round((ai.used / ai.limit) * 100)) : 0,
    });
  }

  return items;
});

async function handleUpgrade() {
  if (!isLoggedIn.value) {
    window.posthog?.capture("upgrade_clicked_logged_out");
    router.push("/signup");
    return;
  }
  window.posthog?.capture("upgrade_clicked");
  isUpgrading.value = true;
  try {
    const { url } = await createCheckout();
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
      "10,000 events per month",
      "5 AI insights per month",
      "1 team member",
      "30-day data retention",
      "1 cost alert",
      "SDK & Proxy tracking",
      "Stripe, OpenAI & Anthropic integrations",
      "Per-feature margin analysis",
    ],
  },
  {
    key: "growth",
    name: "Growth",
    price: "$29",
    interval: "/month",
    features: [
      "Unlimited events",
      "100 AI insights per month",
      "Unlimited team members",
      "1-year data retention",
      "Unlimited cost alerts",
      "Everything in Free",
      "Priority support",
    ],
  },
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
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
        <Card
          v-for="plan in plans"
          :key="plan.key"
          :class="[
            'relative',
            billing?.plan === plan.key ? 'border-primary' : '',
          ]"
        >
          <CardContent class="p-6 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">{{ plan.name }}</h3>
              <span
                v-if="billing?.plan === plan.key"
                class="text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full"
              >
                Current plan
              </span>
              <span
                v-else-if="plan.key === 'growth'"
                class="text-[10px] font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full"
              >
                Most popular
              </span>
            </div>

            <div>
              <span class="text-3xl font-bold">{{ plan.price }}</span>
              <span class="text-muted-foreground text-sm ml-1">{{
                plan.interval
              }}</span>
            </div>

            <ul class="space-y-2">
              <li
                v-for="feature in plan.features"
                :key="feature"
                class="flex items-start gap-2 text-sm"
              >
                <Check class="h-4 w-4 text-success mt-0.5 shrink-0" />
                <span>{{ feature }}</span>
              </li>
            </ul>

            <div class="pt-2">
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
                v-else-if="billing?.plan !== plan.key && plan.key === 'growth'"
                class="w-full"
                :disabled="isUpgrading"
                @click="handleUpgrade"
              >
                <Sparkles class="h-4 w-4 mr-2" />
                {{ isUpgrading ? "Redirecting..." : "Upgrade to Growth" }}
              </Button>
              <div
                v-else-if="billing?.plan === plan.key && plan.key === 'free'"
                class="text-center text-sm text-muted-foreground"
              >
                Your current plan
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div class="max-w-2xl text-sm text-muted-foreground">
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
              v-if="!usageItems.length"
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
