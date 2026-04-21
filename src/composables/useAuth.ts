import { ref, computed, watch } from "vue";
import { useAuth as useClerkAuth, useUser, useClerk } from "@clerk/vue";
import * as api from "@/lib/api";
import type { Account } from "@/lib/api";
import { logger } from "@/lib/logger";

const account = ref<Account | null>(null);
const isInitialized = ref(false);
let setupInFlight = false;

export function useAuth() {
  const { isSignedIn, isLoaded, getToken } = useClerkAuth();
  const { user } = useUser();
  const clerk = useClerk();

  const isLoading = computed(() => !isLoaded.value);
  const isLoggedIn = computed(() => !!isSignedIn.value && !!account.value);
  const visitorId = computed(() => user.value?.id ?? null);

  watch(
    isSignedIn,
    async (signedIn, wasSignedIn) => {
      if (signedIn && !account.value) {
        if (setupInFlight) return;
        setupInFlight = true;
        isInitialized.value = false;
        try {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const me = await api.getMe();
              if (me.account) {
                account.value = me.account;
                break;
              } else {
                const result = await api.signupComplete(
                  user.value?.fullName ?? undefined,
                  user.value?.primaryEmailAddress?.emailAddress,
                );
                account.value = result.account;
                if (result.sdkKey) {
                  localStorage.setItem("observe:fresh_sdk_key", result.sdkKey);
                }
                break;
              }
            } catch (err) {
              logger.error(
                `Account setup failed (attempt ${attempt + 1}/3)`,
                err,
              );
              if (attempt < 2) {
                await new Promise((r) => setTimeout(r, 1000));
              }
            }
          }
        } finally {
          setupInFlight = false;
        }
        isInitialized.value = true;

        if (account.value && window.posthog) {
          window.posthog.identify(account.value.email, {
            account_id: account.value.id,
            email: account.value.email,
            name: account.value.name,
          });
        }
      } else if (!signedIn && wasSignedIn) {
        setupInFlight = false;
        account.value = null;
        isInitialized.value = false;
      } else if (!signedIn) {
        isInitialized.value = true;
      }
    },
    { immediate: true },
  );

  async function logout() {
    if (window.posthog) {
      window.posthog.capture("user_logged_out");
      window.posthog.reset();
    }
    await clerk.value?.signOut();
    setupInFlight = false;
    account.value = null;
    isInitialized.value = false;
    window.location.href = "/login";
  }

  return {
    visitorId,
    isLoading,
    isInitialized: computed(() => isInitialized.value),
    isLoggedIn,
    account,
    logout,
    getToken,
  };
}
