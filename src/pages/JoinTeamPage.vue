<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Users, CheckCircle, AlertCircle } from "lucide-vue-next";
import { toast } from "vue-sonner";
import * as api from "@/lib/api";
import { useAuth } from "@/composables/useAuth";

const route = useRoute();
const router = useRouter();
const { isLoggedIn } = useAuth();

const token = route.params.token as string;
const redirectPath = `/join/${token}`;

const inviteInfo = ref<api.InviteInfo | null>(null);
const isLoading = ref(true);
const isJoining = ref(false);
const error = ref<string | null>(null);
const joined = ref(false);

onMounted(async () => {
  try {
    inviteInfo.value = await api.getInviteInfo(token);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Invalid invite link";
  } finally {
    isLoading.value = false;
  }
});

watch(
  [isLoggedIn, inviteInfo],
  ([loggedIn, info]) => {
    if (loggedIn && info && !joined.value && !isJoining.value) {
      acceptInvite();
    }
  },
  { immediate: true },
);

async function acceptInvite() {
  if (!isLoggedIn.value) return;
  isJoining.value = true;
  error.value = null;
  try {
    await api.acceptInvite(token);
    joined.value = true;
    toast.success("Joined!");
    window.posthog?.capture("team_invite_accepted");
    setTimeout(() => router.push("/"), 1500);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to join team";
  } finally {
    isJoining.value = false;
  }
}

function goSignup() {
  router.push(`/signup?redirect=${encodeURIComponent(redirectPath)}`);
}

function goLogin() {
  router.push(`/login?redirect=${encodeURIComponent(redirectPath)}`);
}
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-background">
    <div class="max-w-md w-full mx-auto p-8">
      <div class="text-center mb-8">
        <div
          class="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground mb-4"
        >
          <Users class="h-6 w-6" />
        </div>
        <h1 class="text-2xl font-bold">Join your team on Observe</h1>
      </div>

      <div v-if="isLoading" class="text-center py-8">
        <div
          class="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3"
        />
        <p class="text-muted-foreground text-sm">Loading invite…</p>
      </div>

      <div v-else-if="error && !joined" class="text-center py-8">
        <AlertCircle class="h-10 w-10 text-destructive mx-auto mb-3" />
        <p class="font-semibold mb-1">Invalid invite</p>
        <p class="text-muted-foreground text-sm">{{ error }}</p>
        <button
          class="mt-4 px-4 py-2 border rounded text-sm hover:bg-accent"
          @click="router.push('/')"
        >
          Go to Dashboard
        </button>
      </div>

      <div v-else-if="joined" class="text-center py-8">
        <CheckCircle class="h-10 w-10 text-emerald-500 mx-auto mb-3" />
        <p class="font-semibold mb-1">You've joined the team!</p>
        <p class="text-muted-foreground text-sm">Redirecting…</p>
      </div>

      <div v-else-if="inviteInfo" class="space-y-6">
        <div class="border rounded-lg p-5">
          <p
            class="text-xs text-muted-foreground uppercase font-semibold tracking-wider"
          >
            Workspace
          </p>
          <p class="text-lg font-semibold">{{ inviteInfo.org_name }}</p>
        </div>

        <div class="text-sm text-muted-foreground text-center">
          You'll get full access to this workspace: data, integrations, and team
          management.
        </div>

        <!-- Signed in: one-click join -->
        <template v-if="isLoggedIn">
          <button
            class="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            :disabled="isJoining"
            @click="acceptInvite"
          >
            <div
              v-if="isJoining"
              class="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full"
            />
            {{ isJoining ? "Joining…" : `Join ${inviteInfo.org_name}` }}
          </button>
        </template>

        <!-- Signed out: signup or login -->
        <template v-else>
          <div class="space-y-2">
            <button
              class="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90"
              @click="goSignup"
            >
              Sign up & join
            </button>
            <button
              class="w-full py-2.5 rounded-lg border hover:bg-accent font-medium"
              @click="goLogin"
            >
              I already have an account
            </button>
          </div>
          <p class="text-center text-xs text-muted-foreground">
            After signup or login you'll be brought back here and added to
            {{ inviteInfo.org_name }}.
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
