import { clerkPlugin } from "@clerk/vue";
import type { App } from "vue";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY environment variable");
}

export function setupClerk(app: App) {
  app.use(clerkPlugin, { publishableKey });
}

type TokenGetter = () => Promise<string | null>;

let _getToken: TokenGetter | null = null;
let _isSignedIn: () => boolean = () => false;

export function registerTokenGetter(
  getToken: TokenGetter,
  isSignedIn: () => boolean,
) {
  _getToken = getToken;
  _isSignedIn = isSignedIn;
}

export async function getAuthToken(): Promise<string | null> {
  if (!_isSignedIn()) return null;
  if (!_getToken) return null;
  return _getToken();
}

export function isAuthenticated(): boolean {
  return _isSignedIn();
}
