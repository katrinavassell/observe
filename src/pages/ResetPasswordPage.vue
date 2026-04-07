<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter, useRoute, RouterLink } from "vue-router";
import { Loader2 } from "lucide-vue-next";
import { Button } from "@/components/ui";
import { resetPassword } from "@/lib/api";

const router = useRouter();
const route = useRoute();

const token = ref<string | null>(null);
const password = ref("");
const confirmPassword = ref("");
const isLoading = ref(false);
const error = ref<string | null>(null);

onMounted(() => {
  const t = route.query.token;
  token.value = typeof t === "string" ? t : null;
});

async function handleSubmit() {
  if (!token.value) {
    error.value = "Invalid or missing reset token.";
    return;
  }
  if (password.value.length < 8) {
    error.value = "Password must be at least 8 characters.";
    return;
  }
  if (password.value !== confirmPassword.value) {
    error.value = "Passwords do not match.";
    return;
  }
  isLoading.value = true;
  error.value = null;
  try {
    await resetPassword(token.value, password.value);
    router.push("/login?reset=success");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to reset password. The link may have expired.";
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background px-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">Set new password</h1>
        <p class="text-sm text-muted-foreground">Choose a strong password for your account.</p>
      </div>

      <div v-if="!token" class="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive text-center">
        Invalid or missing reset token. Please request a new
        <RouterLink to="/forgot-password" class="underline">password reset link</RouterLink>.
      </div>

      <form v-else class="space-y-4" @submit.prevent="handleSubmit">
        <div class="space-y-1">
          <label for="password" class="text-sm font-medium">New password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            required
            minlength="8"
            placeholder="At least 8 characters"
            class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div class="space-y-1">
          <label for="confirm-password" class="text-sm font-medium">Confirm password</label>
          <input
            id="confirm-password"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
            placeholder="Repeat your password"
            class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

        <Button type="submit" class="w-full" :disabled="isLoading">
          <Loader2 v-if="isLoading" class="h-4 w-4 mr-2 animate-spin" />
          Reset password
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
