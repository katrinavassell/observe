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
});

// Handle OAuth PKCE callback — must complete before app reads session
const params = new URLSearchParams(window.location.search);
const code = params.get("code");
export const authReady: Promise<void> = code
  ? supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) {
        console.error("OAuth code exchange failed:", error.message);
      } else {
        window.history.replaceState({}, "", window.location.pathname);
      }
    })
  : Promise.resolve();
