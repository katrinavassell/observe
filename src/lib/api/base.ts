const API_BASE = "/api";

const CURRENT_ACCOUNT_ID_KEY = "observe:current_account_id";
const IMPERSONATION_KEY = "observe:impersonating";

export function getImpersonation(): {
  accountId: number;
  label: string;
} | null {
  const raw = localStorage.getItem(IMPERSONATION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function startImpersonation(accountId: number, label: string): void {
  localStorage.setItem(IMPERSONATION_KEY, JSON.stringify({ accountId, label }));
  setCurrentAccountId(accountId);
}

export function stopImpersonation(ownAccountId?: number): void {
  localStorage.removeItem(IMPERSONATION_KEY);
  if (ownAccountId) {
    setCurrentAccountId(ownAccountId);
  } else {
    localStorage.removeItem(CURRENT_ACCOUNT_ID_KEY);
  }
  window.dispatchEvent(new CustomEvent("observe:account-changed"));
}

function getAnonVisitorId(): string {
  let id = localStorage.getItem("observe_visitor_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("observe_visitor_id", id);
  }
  return id;
}

export function getCurrentAccountId(): number | null {
  const raw = localStorage.getItem(CURRENT_ACCOUNT_ID_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function setCurrentAccountId(id: number): void {
  localStorage.setItem(CURRENT_ACCOUNT_ID_KEY, String(id));
  window.dispatchEvent(
    new CustomEvent("observe:account-changed", { detail: id }),
  );
}

export async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const { getAuthToken, isAuthenticated } = await import("@/lib/clerk");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (isAuthenticated()) {
    const token = await getAuthToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const accountId = getCurrentAccountId();
    if (accountId !== null && !("X-Account-Id" in headers)) {
      headers["X-Account-Id"] = String(accountId);
    }
  } else {
    headers["x-visitor-id"] = getAnonVisitorId();
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    let errorMessage = `API Error: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.error) {
        errorMessage = errorData.error;
      }
    } catch {
      // Ignore parse errors
    }
    throw new Error(errorMessage);
  }

  return response.json();
}
