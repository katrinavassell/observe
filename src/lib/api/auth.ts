import { request } from "./base";

export interface Account {
  id: number;
  email: string;
  name: string | null;
}

export interface AccountMembership {
  id: number;
  name: string;
  role: "owner" | "admin" | "viewer";
  status: "active" | "pending";
  joined_at: string | null;
  is_current: boolean;
}

export async function signupComplete(
  name?: string,
  email?: string,
): Promise<{ account: Account; sdkKey?: string }> {
  return request("/auth/signup-complete", {
    method: "POST",
    body: JSON.stringify({ name, email }),
  });
}

export async function getMe(): Promise<{ account: Account | null }> {
  return request("/auth/me");
}

export async function listMyAccounts(): Promise<{
  accounts: AccountMembership[];
  current_account_id: number | null;
}> {
  return request("/me/accounts");
}
