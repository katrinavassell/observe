import { ref, computed } from "vue";
import { supabase } from "@/lib/supabase";
import * as api from "@/lib/api";
import type { Account } from "@/lib/api";
import { logger } from "@/lib/logger";

const isInitialized = ref(false);
const isLoading = ref(true);
const visitorId = ref<string | null>(null);
const account = ref<Account | null>(null);

let initPromise: Promise<void> | null = null;

export async function initialize() {
  if (isInitialized.value && visitorId.value) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        visitorId.value = session.user.id;
        try {
          const me = await api.getMe();
          if (me.account) {
            account.value = me.account;
          } else {
            // First login (OAuth) — create local account row
            const result = await api.signupComplete(
              session.user.user_metadata?.full_name ||
                session.user.user_metadata?.name,
            );
            account.value = result.account;
          }
        } catch {
          // Account row may not exist yet (first login)
        }
      } else {
        // Anonymous visitor — use localStorage-backed ID
        let anonId = localStorage.getItem("observe_visitor_id");
        if (!anonId) {
          anonId = crypto.randomUUID();
          localStorage.setItem("observe_visitor_id", anonId);
        }
        visitorId.value = anonId;
      }

      // Listen for auth state changes (login, logout, token refresh)
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
          visitorId.value = session.user.id;
          if (event === "SIGNED_IN") {
            // Try to fetch existing account, create if missing (OAuth users)
            try {
              const me = await api.getMe();
              if (me.account) {
                account.value = me.account;
              } else {
                const result = await api.signupComplete(
                  session.user.user_metadata?.full_name ||
                    session.user.user_metadata?.name,
                );
                account.value = result.account;
              }
            } catch {
              // Will be created on next request
            }
          }
        } else {
          visitorId.value = null;
          account.value = null;
        }
      });

      isInitialized.value = true;
    } catch (error) {
      logger.error("Failed to initialize auth session", error);
      initPromise = null;
    }
    isLoading.value = false;
  })();

  return initPromise;
}

export function useAuth() {
  const isLoggedIn = computed(() => !!account.value);

  async function login(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new Error(error.message);

    visitorId.value = data.user.id;

    // Fetch local account
    const me = await api.getMe();
    account.value = me.account;

    if (account.value && window.posthog) {
      window.posthog.identify(account.value.id, {
        email: account.value.email,
        name: account.value.name,
      });
      window.posthog.capture("user_logged_in", {
        email: account.value.email,
      });
    }

    return { account: account.value };
  }

  async function signup(email: string, password: string, name?: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error("Signup failed — no user returned");

    visitorId.value = data.user.id;

    // Create local account row + SDK key
    const result = await api.signupComplete(name);
    account.value = result.account;

    if (account.value && window.posthog) {
      window.posthog.identify(account.value.id, {
        email: account.value.email,
        name: account.value.name,
      });
      window.posthog.capture("user_signed_up", {
        email: account.value.email,
      });
    }

    return result;
  }

  async function logout() {
    if (window.posthog) {
      window.posthog.capture("user_logged_out");
      window.posthog.reset();
    }
    await supabase.auth.signOut();
    account.value = null;
    visitorId.value = null;
    isInitialized.value = false;
    initPromise = null;
    window.location.href = "/login";
  }

  async function forgotPassword(email: string) {
    const appUrl = window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/reset-password`,
    });
    if (error) throw new Error(error.message);
  }

  async function resetPassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) throw new Error(error.message);
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) throw new Error(error.message);
  }

  async function signInWithGithub() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) throw new Error(error.message);
  }

  async function signInWithMagicLink(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    if (error) throw new Error(error.message);
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
    forgotPassword,
    resetPassword,
    signInWithGoogle,
    signInWithGithub,
    signInWithMagicLink,
  };
}
