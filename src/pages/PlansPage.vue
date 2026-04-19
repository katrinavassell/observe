<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { Check, ExternalLink, ArrowRight } from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import { getUsageLimits } from "@/lib/api";
import { useAuth } from "@/composables/useAuth";

const router = useRouter();
const { isLoggedIn } = useAuth();

const { data: usageLimits } = useQuery({
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
      label: "Events",
      used: event.used,
      limit: event.limit || null,
      pct: event.limit
        ? Math.min(100, Math.round((event.used / event.limit) * 100))
        : 0,
    });
  }

  const insights = usageLimits.value.ai_insights?.usage;
  if (insights) {
    items.push({
      label: "AI Insights",
      used: insights.used,
      limit: insights.limit || null,
      pct: insights.limit
        ? Math.min(100, Math.round((insights.used / insights.limit) * 100))
        : 0,
    });
  }

  return items;
});

const observeFeatures = [
  "10,000 events/month (hosted)",
  "Unlimited events (self-hosted)",
  "90-day data retention",
  "SDK & Proxy cost tracking",
  "Stripe, OpenAI & Anthropic integrations",
  "Per-feature margin analysis",
  "Unlimited team members",
  "Unlimited cost alerts",
  "CSV upload",
];

const tansoFeatures = [
  "Everything in Observe",
  "Unlimited hosted events",
  "Usage metering & entitlements",
  "Subscription & invoice management",
  "Plan & credit management",
  "Pricing experimentation",
  "Revenue recovery & dunning",
  "Priority support",
];

const repoUrl = "https://github.com/katrinalaszlo/observe";
</script>

<template>
  <div class="space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Plans</h1>
      <p class="text-muted-foreground">
        Observe is free. When you need more, Tanso is the full platform.
      </p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl items-stretch">
      <!-- Observe Free -->
      <Card class="relative flex flex-col border-primary">
        <div
          class="bg-primary text-primary-foreground text-center text-xs font-medium py-1.5 rounded-t-lg -mx-px -mt-px"
        >
          Your current plan
        </div>
        <CardContent class="p-6 flex flex-col flex-1">
          <div class="space-y-4 flex-1">
            <div>
              <h3 class="text-lg font-semibold">Observe</h3>
              <p class="text-xs text-muted-foreground mt-1">
                AI cost observability, open source
              </p>
            </div>

            <div class="pb-2">
              <span class="text-3xl font-bold tracking-tight">Free</span>
              <span class="text-muted-foreground text-sm ml-1">forever</span>
            </div>

            <!-- Usage meter -->
            <div
              v-if="isLoggedIn && usageItems.length > 0"
              class="rounded-lg border bg-muted/30 p-3 space-y-2"
            >
              <div
                v-for="item in usageItems"
                :key="item.label"
                class="space-y-1"
              >
                <div
                  class="flex items-center justify-between text-xs text-muted-foreground"
                >
                  <span>{{ item.label }}</span>
                  <span class="tabular-nums">
                    {{ item.used.toLocaleString() }}
                    <template v-if="item.limit">
                      / {{ item.limit.toLocaleString() }}
                    </template>
                  </span>
                </div>
                <div
                  v-if="item.limit"
                  class="h-1.5 bg-muted rounded-full overflow-hidden"
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
              </div>
            </div>

            <div class="border-t pt-4">
              <p
                class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3"
              >
                Includes
              </p>
              <ul class="space-y-2.5">
                <li
                  v-for="feature in observeFeatures"
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
            <a
              :href="repoUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="block"
            >
              <Button variant="outline" class="w-full">
                <ExternalLink class="h-4 w-4 mr-2" />
                View on GitHub
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>

      <!-- Tanso Platform -->
      <Card class="relative flex flex-col">
        <div
          class="bg-muted text-muted-foreground text-center text-xs font-medium py-1.5 rounded-t-lg -mx-px -mt-px"
        >
          Full platform
        </div>
        <CardContent class="p-6 flex flex-col flex-1">
          <div class="space-y-4 flex-1">
            <div>
              <h3 class="text-lg font-semibold">Tanso</h3>
              <p class="text-xs text-muted-foreground mt-1">
                Monetization infrastructure for AI-native companies
              </p>
            </div>

            <div class="pb-2">
              <span class="text-3xl font-bold tracking-tight">Custom</span>
              <span class="text-muted-foreground text-sm ml-1">pricing</span>
            </div>

            <div class="border-t pt-4">
              <p
                class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3"
              >
                Everything you need to monetize
              </p>
              <ul class="space-y-2.5">
                <li
                  v-for="feature in tansoFeatures"
                  :key="feature"
                  class="flex items-start gap-2 text-sm"
                >
                  <Check class="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                  <span>{{ feature }}</span>
                </li>
              </ul>
            </div>
          </div>

          <div class="pt-6 mt-auto space-y-2">
            <a
              href="https://dashboard.tansohq.com/"
              target="_blank"
              rel="noopener noreferrer"
              class="block"
            >
              <Button class="w-full">
                Get started
                <ArrowRight class="h-4 w-4 ml-2" />
              </Button>
            </a>
            <a
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
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Usage section -->
    <div v-if="isLoggedIn" class="max-w-4xl space-y-4">
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
    <div v-if="!isLoggedIn" class="max-w-4xl">
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
