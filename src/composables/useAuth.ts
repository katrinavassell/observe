import { ref, computed } from "vue";
import * as api from "@/lib/api";
import type { Account } from "@/lib/api";
import { logger } from "@/lib/logger";

const isInitialized = ref(false);
const isLoading = ref(true);
const visitorId = ref<string | null>(null);
const account = ref<Account | null>(null);

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let initPromise: Promise<void> | null = null;

export async function initialize(retries = 10, delay = 1000) {
  if (isInitialized.value && visitorId.value) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const result = await api.initSession();
        visitorId.value = result.visitorId;
        if (result.account) {
          account.value = result.account;
        }
        isInitialized.value = true;
        isLoading.value = false;
        return;
      } catch (error) {
        if (attempt < retries - 1) {
          await sleep(delay);
        } else {
          logger.error("Failed to initialize session after all retries", error);
        }
      }
    }
    isLoading.value = false;
    isInitialized.value = true;
  })();

  return initPromise;
}

export function useAuth() {
  const isLoggedIn = computed(() => !!account.value);

  async function login(email: string, password: string) {
    const result = await api.login(email, password);
    account.value = result.account;
    if (result.account && window.posthog) {
      window.posthog.identify(result.account.id, {
        email: result.account.email,
        name: result.account.name,
      });
      window.posthog.capture("user_logged_in", {
        email: result.account.email,
      });
    }
    return result;
  }

  async function signup(email: string, password: string, name?: string) {
    const result = await api.signup(email, password, name);
    account.value = result.account;
    if (result.account && window.posthog) {
      window.posthog.identify(result.account.id, {
        email: result.account.email,
        name: result.account.name,
      });
      window.posthog.capture("user_signed_up", {
        email: result.account.email,
      });
    }
    return result;
  }

  async function logout() {
    if (window.posthog) {
      window.posthog.capture("user_logged_out");
      window.posthog.reset();
    }
    await api.logout();
    account.value = null;
    visitorId.value = null;
    isInitialized.value = false;
    initPromise = null;
    window.location.href = "/login";
  }

  return {
    visitorId,
    isLoading,
    isInitialized,
    isLoggedIn,
    account,
    initialize,
    login,
    signup,
    logout,
  };
}
