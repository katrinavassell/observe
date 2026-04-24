import type { Pool } from "pg";

// Clear sample/demo data when transitioning to real user data
// Uses exact sample IDs to avoid deleting real Stripe data (sub_*, cus_* prefixes match real Stripe IDs)
export const SAMPLE_SUBSCRIPTION_IDS = [
  "sub_001",
  "sub_002",
  "sub_003",
  "sub_004",
  "sub_005",
  // Legacy IDs from older sample data
  "sub_acme",
  "sub_acme_addon",
  "sub_tidewater",
  "sub_neon",
  "sub_neon_addon",
  "sub_circle",
  "sub_blaze",
  "sub_quantum",
];
export const SAMPLE_CUSTOMER_IDS = [
  "cus_001",
  "cus_002",
  "cus_003",
  "cus_004",
  "cus_005",
  // Legacy IDs from older sample data
  "acme_saas",
  "tidewater_ai",
  "neondata",
  "circleops",
  "blazeml",
  "quantumhr",
];
export const SAMPLE_PLAN_IDS = ["starter", "pro", "enterprise"];

export async function resolveAccountIdForUser(
  pool: Pool,
  userId: string,
  accountId?: number,
): Promise<number | null> {
  if (accountId !== undefined) return accountId;
  try {
    const result = await pool.query(
      `SELECT account_id FROM user_accounts
        WHERE user_id = (SELECT id FROM users WHERE visitor_id = $1)
          AND role = 'owner' LIMIT 1`,
      [userId],
    );
    if (result.rows[0]) return result.rows[0].account_id;
  } catch (err) {
    console.error("data: account_id fallback lookup failed:", err);
  }
  console.warn("data: no account_id resolved for user", userId);
  return null;
}

export async function clearSampleData(
  db: { query: (text: string, params: unknown[]) => Promise<unknown> },
  pool: Pool,
  userId: string,
  accountId?: number,
): Promise<void> {
  const resolved = await resolveAccountIdForUser(pool, userId, accountId);
  await db.query(
    "DELETE FROM observe_events WHERE account_id = $1 AND source = 'sample'",
    [resolved],
  );
  await db.query(
    "DELETE FROM cost_records WHERE account_id = $1 AND cost_type = 'ai_inference' AND customer_id IS NULL AND period_start IS NOT NULL",
    [resolved],
  );
  await db.query(
    `DELETE FROM subscriptions WHERE account_id = $1 AND subscription_id = ANY($2)`,
    [resolved, SAMPLE_SUBSCRIPTION_IDS],
  );
  await db.query(
    `DELETE FROM customers WHERE account_id = $1 AND customer_id = ANY($2)`,
    [resolved, SAMPLE_CUSTOMER_IDS],
  );
  await db.query(
    `DELETE FROM plans WHERE account_id = $1 AND plan_id = ANY($2)`,
    [resolved, SAMPLE_PLAN_IDS],
  );
}

export type CheckBillingFeatureAccessFn = (
  visitorId: string,
  featureKey: string,
  email?: string,
  accountId?: number,
) => Promise<{
  allowed: boolean;
  reason?: string;
  usage?: number;
  limit?: number;
  remaining?: number;
}>;
export type TrackBillingUsageFn = (
  visitorId: string,
  featureKey: string,
  eventName: string,
) => void;
export type ConvertReferralFn = (visitorId: string) => Promise<void>;
