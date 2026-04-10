<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { Lock, Loader2 } from "lucide-vue-next";
import { Card, CardContent, Button } from "@/components/ui";
import { toast } from "vue-sonner";
import { useAuth } from "@/composables/useAuth";
import { supabase } from "@/lib/supabase";

const router = useRouter();
const { resetPassword } = useAuth();

const password = ref("");
const confirmPassword = ref("");
const isLoading = ref(false);
const success = ref(false);
const ready = ref(false);

onMounted(async () => {
  // Supabase redirects here with tokens in the URL hash
  // The client library picks them up automatically via onAuthStateChange
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    toast.error("Invalid or expired reset link");
    router.replace("/login");
    return;
  }
  ready.value = true;
});

async function handleSubmit() {
  if (password.value.length < 8) {
    toast.error("Password must be at least 8 characters");
    return;
  }
  if (password.value !== confirmPassword.value) {
    toast.error("Passwords do not match");
    return;
  }

  isLoading.value = true;
  try {
    await resetPassword(password.value);
    success.value = true;
    window.posthog?.capture("password_reset_completed");
    toast.success("Password reset successfully");
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
          <h1 class="text-2xl font-bold">Set new password</h1>
          <p class="text-sm text-muted-foreground mt-2">
            {{
              success
                ? "Your password has been reset"
                : "Enter your new password"
            }}
          </p>
        </div>

        <form
          v-if="!success && ready"
          class="space-y-4"
          @submit.prevent="handleSubmit"
        >
          <div class="space-y-2">
            <label class="text-sm font-medium" for="password"
              >New password</label
            >
            <div class="relative">
              <Lock
                class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              />
              <input
                id="password"
                v-model="password"
                type="password"
                placeholder="Min. 8 characters"
                autocomplete="new-password"
                class="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              />
            </div>
          </div>

          <div class="space-y-2">
            <label class="text-sm font-medium" for="confirm"
              >Confirm password</label
            >
            <div class="relative">
              <Lock
                class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              />
              <input
                id="confirm"
                v-model="confirmPassword"
                type="password"
                placeholder="Repeat password"
                autocomplete="new-password"
                class="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              />
            </div>
          </div>

          <Button type="submit" class="w-full" :disabled="isLoading">
            <Loader2 v-if="isLoading" class="h-4 w-4 mr-2 animate-spin" />
            Reset password
          </Button>
        </form>

        <div v-else-if="success" class="text-center">
          <router-link to="/login">
            <Button class="w-full">Sign in with new password</Button>
          </router-link>
        </div>

        <div v-else class="flex items-center justify-center py-4">
          <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  </div>
</template>
