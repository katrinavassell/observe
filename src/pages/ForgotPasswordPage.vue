<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import { Loader2 } from "lucide-vue-next";
import { Button } from "@/components/ui";
import { forgotPassword } from "@/lib/api";

const email = ref("");
const isLoading = ref(false);
const submitted = ref(false);
const error = ref<string | null>(null);

async function handleSubmit() {
  if (!email.value) return;
  isLoading.value = true;
  error.value = null;
  try {
    await forgotPassword(email.value);
    submitted.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to send reset email";
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background px-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p class="text-sm text-muted-foreground">
          Enter your email and we'll send you a reset link.
        </p>
      </div>

      <div v-if="submitted" class="rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-center">
        Check your email for a password reset link. It expires in 1 hour.
      </div>

      <form v-else class="space-y-4" @submit.prevent="handleSubmit">
        <div class="space-y-1">
          <label for="email" class="text-sm font-medium">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            placeholder="you@example.com"
            class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

        <Button type="submit" class="w-full" :disabled="isLoading">
          <Loader2 v-if="isLoading" class="h-4 w-4 mr-2 animate-spin" />
          Send reset link
        </Button>
      </form>

      <div class="text-center text-sm text-muted-foreground">
        <RouterLink to="/login" class="hover:text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </RouterLink>
      </div>
    </div>
  </div>
</template>
