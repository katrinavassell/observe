import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables",
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    detectSessionInUrl: true,
    flowType: "pkce",
  },
  realtime: {
    autoConnect: false,
  },
});

// Handle auth callbacks — must complete before app reads session.
// Two formats:
//   (a) PKCE / OAuth:        ?code=...                  → exchangeCodeForSession
//   (b) Email magic link:    ?token_hash=...&type=...   → verifyOtp
// Both result in an active session being written to localStorage.
const params = new URLSearchParams(window.location.search);
const code = params.get("code");
const tokenHash = params.get("token_hash");
const otpType = params.get("type"); // signup | recovery | invite | magiclink | email_change

async function consumeAuthCallback(): Promise<void> {
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("Auth code exchange failed:", error.message);
    }
    window.history.replaceState({}, "", window.location.pathname);
    return;
  }
  if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType as
        | "signup"
        | "recovery"
        | "invite"
        | "magiclink"
        | "email_change",
    });
    if (error) {
      console.error("Email link verifyOtp failed:", error.message);
    }
    window.history.replaceState({}, "", window.location.pathname);
  }
}

export const authReady: Promise<void> =
  code || (tokenHash && otpType) ? consumeAuthCallback() : Promise.resolve();
