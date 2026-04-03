<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Users, CheckCircle, AlertCircle } from "lucide-vue-next";
import * as api from "@/lib/api";

const route = useRoute();
const router = useRouter();

const token = route.params.token as string;
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

async function acceptInvite() {
  isJoining.value = true;
  error.value = null;
  try {
    await api.acceptInvite(token);
    joined.value = true;
    window.posthog?.capture("team_invite_accepted");
    setTimeout(() => {
      router.push("/");
    }, 2000);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to join team";
  } finally {
    isJoining.value = false;
  }
}
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-background">
    <div class="max-w-md w-full mx-auto p-8">
      <!-- Logo / Brand -->
      <div class="text-center mb-8">
        <div
          class="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground mb-4"
        >
          <Users class="h-6 w-6" />
        </div>
        <h1 class="text-2xl font-bold">Join your team on Observe</h1>
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="text-center py-8">
        <div
          class="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3"
        />
        <p class="text-muted-foreground text-sm">Loading invite...</p>
      </div>

      <!-- Error -->
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

      <!-- Success -->
      <div v-else-if="joined" class="text-center py-8">
        <CheckCircle class="h-10 w-10 text-emerald-500 mx-auto mb-3" />
        <p class="font-semibold mb-1">You've joined the team!</p>
        <p class="text-muted-foreground text-sm">Redirecting to dashboard...</p>
      </div>

      <!-- Invite info -->
      <div v-else-if="inviteInfo" class="space-y-6">
        <div class="border rounded-lg p-5 space-y-3">
          <div>
            <p
              class="text-xs text-muted-foreground uppercase font-semibold tracking-wider"
            >
              Workspace
            </p>
            <p class="text-lg font-semibold">{{ inviteInfo.org_name }}</p>
          </div>
          <div>
            <p
              class="text-xs text-muted-foreground uppercase font-semibold tracking-wider"
            >
              Your role
            </p>
            <p class="capitalize font-medium">{{ inviteInfo.role }}</p>
          </div>
          <div v-if="inviteInfo.invited_email">
            <p
              class="text-xs text-muted-foreground uppercase font-semibold tracking-wider"
            >
              Invited for
            </p>
            <p>{{ inviteInfo.invited_email }}</p>
          </div>
        </div>

        <div class="text-sm text-muted-foreground text-center">
          <template v-if="inviteInfo.role === 'viewer'">
            As a <strong>Viewer</strong>, you'll be able to see all the
            workspace data: dashboards, customers, pricing, and analytics — but
            cannot modify data or manage the team.
          </template>
          <template v-else>
            As an <strong>Admin</strong>, you'll have full access to manage
            data, invite teammates, and configure integrations.
          </template>
        </div>

        <button
          class="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          :disabled="isJoining"
          @click="acceptInvite"
        >
          <div
            v-if="isJoining"
            class="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full"
          />
          {{ isJoining ? "Joining..." : `Join ${inviteInfo.org_name}` }}
        </button>

        <p class="text-center text-xs text-muted-foreground">
          Clicking "Join" will give you access to this team's shared workspace.
        </p>
      </div>
    </div>
  </div>
</template>
