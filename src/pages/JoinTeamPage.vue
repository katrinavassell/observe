<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Users, CheckCircle, AlertCircle } from "lucide-vue-next";
import { toast } from "vue-sonner";
import * as api from "@/lib/api";
import { useAuth } from "@/composables/useAuth";

const route = useRoute();
const router = useRouter();
const { isLoggedIn, account, signup, login } = useAuth();

const token = route.params.token as string;
const redirectPath = `/join/${token}`;

const inviteInfo = ref<api.InviteInfo | null>(null);
const isLoading = ref(true);
const isJoining = ref(false);
const error = ref<string | null>(null);
const joined = ref(false);

// Inline credential form (shown when invitee is logged out)
const mode = ref<"signup" | "login">("signup");
const name = ref("");
const password = ref("");
const isSubmitting = ref(false);
const needsEmailConfirmation = ref(false);

onMounted(async () => {
  try {
    inviteInfo.value = await api.getInviteInfo(token);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Invalid invite link";
  } finally {
    isLoading.value = false;
  }
});

// If the invitee returns already logged in (e.g. after email confirmation
// roundtrip back to /join/:token), accept the invite automatically.
watch(
  isLoggedIn,
  (loggedIn) => {
    if (loggedIn && inviteInfo.value && !joined.value && !isJoining.value) {
      acceptInvite();
    }
  },
  { immediate: true },
);

async function submitCredentials() {
  if (!inviteInfo.value?.invited_email) {
    error.value = "This invite link is missing an email address.";
    return;
  }
  if (!password.value || password.value.length < 8) {
    toast.error("Password must be at least 8 characters");
    return;
  }
  isSubmitting.value = true;
  error.value = null;
  try {
    if (mode.value === "signup") {
      const result = await signup(
        inviteInfo.value.invited_email,
        password.value,
        name.value.trim() || undefined,
        redirectPath,
      );
      if (result.needsEmailConfirmation) {
        needsEmailConfirmation.value = true;
        return;
      }
      // Instant signup (no email confirmation required) — watcher will
      // pick up isLoggedIn flipping and call acceptInvite.
    } else {
      await login(inviteInfo.value.invited_email, password.value);
      // Watcher will accept the invite once isLoggedIn flips.
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Authentication failed";
  } finally {
    isSubmitting.value = false;
  }
}

async function acceptInvite() {
  if (!isLoggedIn.value) return;
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

        <!-- Email-confirmation pending state -->
        <div v-if="needsEmailConfirmation" class="space-y-3">
          <div
            class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm"
          >
            We sent a confirmation link to
            <strong>{{ inviteInfo.invited_email }}</strong
            >. Click it to finish creating your account — you'll come back here
            and join the workspace automatically.
          </div>
        </div>

        <!-- Logged out: inline credential form, email locked to invitee -->
        <form
          v-else-if="!isLoggedIn"
          class="space-y-3"
          @submit.prevent="submitCredentials"
        >
          <div>
            <label
              class="text-xs text-muted-foreground uppercase font-semibold tracking-wider"
              >Email</label
            >
            <input
              :value="inviteInfo.invited_email"
              type="email"
              disabled
              class="w-full mt-1 px-3 py-2 border rounded-lg bg-muted text-muted-foreground cursor-not-allowed"
            />
          </div>
          <div v-if="mode === 'signup'">
            <label
              class="text-xs text-muted-foreground uppercase font-semibold tracking-wider"
              >Your name</label
            >
            <input
              v-model="name"
              type="text"
              placeholder="Jane Doe"
              class="w-full mt-1 px-3 py-2 border rounded-lg bg-background"
            />
          </div>
          <div>
            <label
              class="text-xs text-muted-foreground uppercase font-semibold tracking-wider"
              >Password</label
            >
            <input
              v-model="password"
              type="password"
              :placeholder="
                mode === 'signup' ? 'At least 8 characters' : 'Your password'
              "
              required
              minlength="8"
              class="w-full mt-1 px-3 py-2 border rounded-lg bg-background"
            />
          </div>

          <div v-if="error" class="text-sm text-destructive">{{ error }}</div>

          <button
            type="submit"
            class="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            :disabled="isSubmitting"
          >
            <div
              v-if="isSubmitting"
              class="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full"
            />
            {{
              isSubmitting
                ? "Working..."
                : mode === "signup"
                  ? `Create account & join ${inviteInfo.org_name}`
                  : `Sign in & join ${inviteInfo.org_name}`
            }}
          </button>

          <p class="text-center text-xs text-muted-foreground">
            <template v-if="mode === 'signup'">
              Already have an account?
              <button
                type="button"
                class="underline hover:text-foreground"
                @click="
                  mode = 'login';
                  error = null;
                "
              >
                Sign in
              </button>
            </template>
            <template v-else>
              Need an account?
              <button
                type="button"
                class="underline hover:text-foreground"
                @click="
                  mode = 'signup';
                  error = null;
                "
              >
                Create one
              </button>
            </template>
          </p>
        </form>

        <!-- Logged in but signed in with the wrong email -->
        <div
          v-else-if="
            inviteInfo.invited_email &&
            account &&
            account.email.toLowerCase() !==
              inviteInfo.invited_email.toLowerCase()
          "
          class="space-y-3"
        >
          <div
            class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            This invite is for <strong>{{ inviteInfo.invited_email }}</strong
            >, but you're signed in as <strong>{{ account.email }}</strong
            >. Sign out and sign in with the invited email to accept.
          </div>
        </div>

        <!-- Logged in with matching (or unrestricted) invite -->
        <template v-else>
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
            Clicking "Join" will give you access to this team's shared
            workspace.
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
