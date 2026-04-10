<script setup lang="ts">
import { ref } from "vue";
import { Mail, Loader2, ArrowLeft } from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import { toast } from "vue-sonner";
import { useAuth } from "@/composables/useAuth";

const { forgotPassword } = useAuth();

const email = ref("");
const isLoading = ref(false);
const submitted = ref(false);

async function handleSubmit() {
  if (!email.value) return;
  isLoading.value = true;
  try {
    await forgotPassword(email.value);
    submitted.value = true;
    window.posthog?.capture("forgot_password_requested");
  } catch (err: any) {
    toast.error(err.message);
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background p-4">
    <Card class="w-full max-w-md">
      <CardContent class="pt-8 pb-8 px-8">
        <div class="text-center mb-6">
          <h1 class="text-2xl font-bold">Reset your password</h1>
          <p class="text-sm text-muted-foreground mt-2">
            {{
              submitted
                ? "Check your email for a reset link"
                : "Enter your email and we'll send you a reset link"
            }}
          </p>
        </div>

        <form
          v-if="!submitted"
          class="space-y-4"
          @submit.prevent="handleSubmit"
        >
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

          <Button type="submit" class="w-full" :disabled="isLoading">
            <Loader2 v-if="isLoading" class="h-4 w-4 mr-2 animate-spin" />
            Send reset link
          </Button>
        </form>

        <div v-else class="text-center">
          <p class="text-sm text-muted-foreground mb-4">
            If an account exists for {{ email }}, you'll receive an email
            shortly.
          </p>
        </div>

        <div class="text-center mt-6">
          <router-link
            to="/login"
            class="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeft class="h-3 w-3" />
            Back to sign in
          </router-link>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
