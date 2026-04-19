import { ref, computed } from "vue";
import { supabase, authReady } from "@/lib/supabase";
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
      // Wait for OAuth PKCE code exchange to complete before reading session
      await authReady;

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        visitorId.value = session.user.id;
        // Clear anonymous visitor ID — prevents stale data leaks
        localStorage.removeItem("observe_visitor_id");
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const me = await api.getMe();
            if (me.account) {
              account.value = me.account;
              break;
            } else {
              const result = await api.signupComplete(
                session.user.user_metadata?.full_name ||
                  session.user.user_metadata?.name,
                session.user.email,
              );
              account.value = result.account;
              if (result.sdkKey) {
                localStorage.setItem("observe:fresh_sdk_key", result.sdkKey);
              }
              break;
            }
          } catch (err) {
            logger.error(
              `Account setup failed on init (attempt ${attempt + 1}/3)`,
              err,
            );
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, 1000));
            }
          }
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
          localStorage.removeItem("observe_visitor_id");
          if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
            // Ensure local account row exists — retry up to 3 times
            if (!account.value) {
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  const me = await api.getMe();
                  if (me.account) {
                    account.value = me.account;
                    break;
                  } else {
                    const result = await api.signupComplete(
                      session.user.user_metadata?.full_name ||
                        session.user.user_metadata?.name,
                    );
                    account.value = result.account;
                    if (result.sdkKey) {
                      localStorage.setItem(
                        "observe:fresh_sdk_key",
                        result.sdkKey,
                      );
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
    } finally {
      // Clear initPromise whether init succeeded or failed so a subsequent
      // call can retry (previously only cleared on throw — a hung promise
      // never threw and stayed cached forever, silently blocking every
      // `await initialize()` caller).
      initPromise = null;
      isLoading.value = false;
    }
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

    // Block unconfirmed users from logging in. Supabase's project-level
    // "Confirm email" toggle may be off, so this is a defense-in-depth check.
    if (!data.user.email_confirmed_at) {
      await supabase.auth.signOut();
      throw new Error(
        "Please confirm your email before signing in. Check your inbox for the confirmation link.",
      );
    }

    visitorId.value = data.user.id;

    // Fetch local account
    const me = await api.getMe();
    account.value = me.account;

    if (account.value && window.posthog) {
      window.posthog.identify(account.value.email, {
        account_id: account.value.id,
        email: account.value.email,
        name: account.value.name,
      });
      window.posthog.capture("user_logged_in", {
        email: account.value.email,
      });
    }

    return { account: account.value };
  }

  async function signup(
    email: string,
    password: string,
    name?: string,
    redirectPath?: string,
  ) {
    const target =
      redirectPath && redirectPath.startsWith("/") ? redirectPath : "/";
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `https://observe.tansohq.com${target}`,
        data: name ? { full_name: name } : undefined,
      },
    });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error("Signup failed — no user returned");

    // If Supabase requires email confirmation, signUp returns user but no
    // session. Don't create a local account row yet — wait until they
    // click the confirm link and the auth-state-change listener fires.
    if (!data.session) {
      return {
        needsEmailConfirmation: true as const,
        email: data.user.email ?? email,
      };
    }

    visitorId.value = data.user.id;

    // Create local account row + SDK key
    const result = await api.signupComplete(name, email);
    account.value = result.account;
    if (result.sdkKey) {
      localStorage.setItem("observe:fresh_sdk_key", result.sdkKey);
    }

    if (account.value && window.posthog) {
      window.posthog.identify(account.value.email, {
        account_id: account.value.id,
        email: account.value.email,
        name: account.value.name,
      });
      window.posthog.capture("user_signed_up", {
        email: account.value.email,
      });
    }

    return { needsEmailConfirmation: false as const, ...result };
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `https://observe.tansohq.com/reset-password`,
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
      options: { redirectTo: `https://observe.tansohq.com/` },
    });
    if (error) throw new Error(error.message);
  }

  async function signInWithGithub() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `https://observe.tansohq.com/` },
    });
    if (error) throw new Error(error.message);
  }

  async function signInWithMagicLink(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `https://observe.tansohq.com/` },
    });
    if (error) throw new Error(error.message);
  }

  /** Resend the signup confirmation email for an unconfirmed user. */
  async function resendConfirmationEmail(email: string) {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `https://observe.tansohq.com/` },
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
    resendConfirmationEmail,
  };
}
