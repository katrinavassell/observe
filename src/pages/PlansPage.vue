<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { toast } from "vue-sonner";
import { Check, Sparkles, ExternalLink } from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import {
  getBillingStatus,
  createCheckout,
  createPortalSession,
} from "@/lib/api";
import { useAuth } from "@/composables/useAuth";
import type { BillingStatus } from "@/lib/api";

const router = useRouter();
const { isLoggedIn } = useAuth();

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

async function handleUpgrade() {
  if (!isLoggedIn.value) {
    toast.error("Sign in to upgrade", {
      description: "You need an account to subscribe to a plan.",
    });
    router.push("/login");
    return;
  }
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

const currentPlan = ref<string>("free");

const plans = [
  {
    key: "free",
    name: "Free",
    price: "$0",
    interval: "forever",
    features: [
      "Unlimited CSV uploads",
      "Stripe revenue sync",
      "OpenAI & Anthropic cost import",
      "SDK & Proxy tracking",
      "Per-feature margin analysis",
      "5 AI insights per month",
    ],
  },
  {
    key: "growth",
    name: "Growth",
    price: "$29",
    interval: "/month",
    features: [
      "Everything in Free",
      "Unlimited AI insights",
      "Cost spike alerts",
      "Priority support",
    ],
  },
];
</script>

<template>
  <div class="space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Plans</h1>
      <p class="text-muted-foreground">Choose the plan that fits your needs</p>
    </div>

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
          <!-- Badge -->
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

          <!-- Price -->
          <div>
            <span class="text-3xl font-bold">{{ plan.price }}</span>
            <span class="text-muted-foreground text-sm">{{
              plan.interval
            }}</span>
          </div>

          <!-- Features -->
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

          <!-- Action -->
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
  </div>
</template>
