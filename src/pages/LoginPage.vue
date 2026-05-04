<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { SignIn, SignUp, AuthenticateWithRedirectCallback } from "@clerk/vue";
import {
  BarChart3,
  DollarSign,
  FlaskConical,
  Layers,
  Check,
} from "lucide-vue-next";

const route = useRoute();

const isRegisterMode = computed(() => route.path.startsWith("/signup"));
const isSsoCallback = computed(
  () =>
    route.path.includes("/sso-callback") || route.path.includes("/sso-verify"),
);

onMounted(() => {
  window.posthog?.capture(
    isRegisterMode.value ? "signup_page_viewed" : "login_page_viewed",
  );
});

const highlights = [
  {
    icon: DollarSign,
    title: "Margin & pricing analysis",
    description:
      "See exactly how much each plan, feature, and customer costs you — and where you're leaving money on the table.",
  },
  {
    icon: BarChart3,
    title: "Revenue & cost analytics",
    description:
      "Track revenue, AI model costs, and unit economics across your entire product in one view.",
  },
  {
    icon: FlaskConical,
    title: "AI-powered insights",
    description:
      "Get actionable recommendations on margin compression, pricing gaps, and cost optimization — automatically.",
  },
  {
    icon: Layers,
    title: "Feature-level cost tracking",
    description:
      "Break down costs per feature so you know which capabilities to invest in — and which to rethink.",
  },
];
</script>

<template>
  <div class="min-h-screen flex bg-background">
    <!-- Left panel — product info (hidden on mobile) -->
    <div
      class="hidden lg:flex lg:w-1/2 bg-sidebar text-sidebar-foreground relative overflow-hidden"
    >
      <div
        class="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10"
      />

      <div
        class="relative z-10 flex flex-col justify-center px-12 xl:px-16 py-12 w-full max-w-xl mx-auto"
      >
        <!-- Brand -->
        <div class="flex items-center gap-3 mb-10">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
          >
            T
          </div>
          <span class="text-2xl font-semibold tracking-tight">Observe</span>
        </div>

        <!-- Headline -->
        <h2 class="text-3xl font-bold tracking-tight leading-tight mb-3">
          Know the true cost of every feature you ship
        </h2>
        <p class="text-sidebar-foreground/70 text-base leading-relaxed mb-10">
          Observe gives SaaS teams real-time visibility into margins, usage
          costs, and pricing health — so you can price with confidence, not
          guesswork.
        </p>

        <!-- Feature highlights -->
        <div class="space-y-5">
          <div v-for="(item, i) in highlights" :key="i" class="flex gap-3.5">
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent/60"
            >
              <component
                :is="item.icon"
                class="h-4 w-4 text-sidebar-accent-foreground"
              />
            </div>
            <div>
              <p class="text-sm font-semibold mb-0.5">{{ item.title }}</p>
              <p class="text-sm text-sidebar-foreground/60 leading-relaxed">
                {{ item.description }}
              </p>
            </div>
          </div>
        </div>

        <!-- Social proof -->
        <div class="mt-12 pt-8 border-t border-sidebar-border">
          <div class="flex items-start gap-3">
            <div class="flex gap-0.5 mt-0.5">
              <Check class="h-4 w-4 text-emerald-400" />
            </div>
            <p class="text-sm text-sidebar-foreground/60 leading-relaxed">
              <span class="text-sidebar-foreground font-medium"
                >Free to start.</span
              >
              Connect your Stripe or upload a CSV — see your first margin report
              in under 2 minutes.
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Right panel — Clerk auth -->
    <div class="flex-1 flex items-center justify-center p-4 sm:p-8">
      <AuthenticateWithRedirectCallback
        v-if="isSsoCallback"
        :sign-in-fallback-redirect-url="'/'"
        :sign-up-fallback-redirect-url="'/'"
      />
      <SignUp
        v-else-if="isRegisterMode"
        :routing="'path'"
        :path="'/signup'"
        :sign-in-url="'/login'"
        :fallback-redirect-url="'/'"
      />
      <SignIn
        v-else
        :routing="'path'"
        :path="'/login'"
        :sign-up-url="'/signup'"
        :fallback-redirect-url="'/'"
      />
    </div>
  </div>
</template>
