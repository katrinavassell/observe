<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import {
  LayoutDashboard,
  Mail,
  Lock,
  Loader2,
  User,
  BarChart3,
  DollarSign,
  FlaskConical,
  Layers,
  Check,
} from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import { toast } from "vue-sonner";
import { useAuth } from "@/composables/useAuth";

const router = useRouter();
const route = useRoute();
const { login, signup, isLoggedIn } = useAuth();

if (isLoggedIn.value) {
  router.replace("/");
}

const email = ref("");
const password = ref("");
const name = ref("");
const isLoading = ref(false);
const isRegisterMode = ref(route.path === "/signup");

onMounted(() => {
  window.posthog?.capture(
    isRegisterMode.value ? "signup_page_viewed" : "login_page_viewed",
  );
});

watch(isRegisterMode, (registering) => {
  window.posthog?.capture(
    registering ? "signup_page_viewed" : "login_page_viewed",
  );
});

function trackForgotPasswordClicked() {
  window.posthog?.capture("forgot_password_clicked");
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
  return emailRegex.test(email.trim());
}

async function handleSubmit() {
  const trimmedEmail = email.value.trim();

  if (!trimmedEmail) {
    toast.error("Please enter your email");
    return;
  }

  if (!isValidEmail(trimmedEmail)) {
    toast.error("Please enter a valid email address");
    return;
  }

  if (!password.value || password.value.length < 8) {
    toast.error("Password must be at least 8 characters");
    return;
  }

  isLoading.value = true;

  try {
    if (isRegisterMode.value) {
      await signup(
        trimmedEmail,
        password.value,
        name.value.trim() || undefined,
      );
      toast.success("Account created!", {
        description: "You are now signed in.",
      });
    } else {
      await login(trimmedEmail, password.value);
      toast.success("Welcome back!");
    }
    const rawRedirect = route.query.redirect as string;
    const redirectTo =
      rawRedirect && rawRedirect.startsWith("/") ? rawRedirect : "/";
    router.push(redirectTo);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Authentication failed";
    toast.error("Error", { description: message });
  } finally {
    isLoading.value = false;
  }
}

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
    title: "What-if simulations",
    description:
      "Model pricing changes before you ship them. See projected impact on margins and revenue instantly.",
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
            O
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

    <!-- Right panel — auth form -->
    <div class="flex-1 flex items-center justify-center p-4 sm:p-8">
      <Card class="w-full max-w-md">
        <CardContent class="p-8">
          <!-- Mobile-only brand (shown when left panel is hidden) -->
          <div class="flex items-center justify-center gap-3 mb-8">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:hidden"
            >
              <LayoutDashboard class="h-5 w-5" />
            </div>
            <span class="text-2xl font-semibold tracking-tight lg:hidden"
              >Observe</span
            >
          </div>

          <div class="text-center mb-6">
            <h1 class="text-xl font-semibold">
              {{ isRegisterMode ? "Create an account" : "Welcome back" }}
            </h1>
            <p class="text-sm text-muted-foreground mt-1">
              {{
                isRegisterMode
                  ? "Start analyzing your pricing and margins"
                  : "Sign in to your workspace"
              }}
            </p>
          </div>

          <form @submit.prevent="handleSubmit" class="space-y-4">
            <div v-if="isRegisterMode" class="space-y-2">
              <label class="text-sm font-medium" for="name"
                >Name (optional)</label
              >
              <div class="relative">
                <User
                  class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                />
                <input
                  id="name"
                  v-model="name"
                  type="text"
                  placeholder="Your name"
                  autocomplete="name"
                  class="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium" for="email">Email</label>
              <div class="relative">
                <Mail
                  class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                />
                <input
                  id="email"
                  v-model="email"
                  type="email"
                  placeholder="you@company.com"
                  autocomplete="email"
                  class="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  required
                />
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-sm font-medium" for="password">Password</label>
              <div class="relative">
                <Lock
                  class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                />
                <input
                  id="password"
                  v-model="password"
                  type="password"
                  placeholder="Min. 8 characters"
                  :autocomplete="
                    isRegisterMode ? 'new-password' : 'current-password'
                  "
                  class="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  required
                />
              </div>
            </div>

            <div v-if="!isRegisterMode" class="flex justify-end">
              <router-link
                to="/forgot-password"
                class="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                @click="trackForgotPasswordClicked"
              >
                Forgot password?
              </router-link>
            </div>

            <Button type="submit" class="w-full" :disabled="isLoading">
              <Loader2 v-if="isLoading" class="h-4 w-4 mr-2 animate-spin" />
              {{ isRegisterMode ? "Create account" : "Sign in" }}
            </Button>
          </form>

          <div class="text-center mt-6 space-y-3">
            <button
              type="button"
              class="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              @click="isRegisterMode = !isRegisterMode"
            >
              {{
                isRegisterMode
                  ? "Already have an account? Sign in"
                  : "Don't have an account? Sign up"
              }}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
