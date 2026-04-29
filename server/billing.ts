import type { Pool } from "pg";
import { getUncachableStripeClient } from "./stripe-client.js";
import { resolveAccountIdForUser } from "./routes/data-helpers.js";

// =============================================================================
// Plan definitions — single source of truth for feature limits
// =============================================================================

interface FeatureConfig {
  limit: number | null; // null = unlimited
  reset?: "monthly";
}

interface PlanConfig {
  name: string;
  stripePriceId?: string;
  features: Record<string, FeatureConfig>;
}

export const OBSERVE_PLANS: Record<string, PlanConfig> = {
  free: {
    name: "Free",
    features: {
      ai_insights: { limit: 1000, reset: "monthly" },
      event_ingest: { limit: 10000, reset: "monthly" },
      cost_alerts: { limit: 3 },
      organizations: { limit: 1 },
      csv_upload: { limit: null },
      stripe_connection: { limit: null },
      ai_provider_connection: { limit: null },
      team_members: { limit: null },
      data_retention_days: { limit: 90 },
    },
  },
  pro: {
    name: "Pro",
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID || "",
    features: {
      ai_insights: { limit: 10000, reset: "monthly" },
      event_ingest: { limit: 100000, reset: "monthly" },
      cost_alerts: { limit: null },
      organizations: { limit: 1 },
      csv_upload: { limit: null },
      stripe_connection: { limit: null },
      ai_provider_connection: { limit: null },
      team_members: { limit: null },
      data_retention_days: { limit: 365 },
    },
  },
  team: {
    name: "Team",
    stripePriceId: process.env.STRIPE_TEAM_PRICE_ID || "",
    features: {
      ai_insights: { limit: null },
      event_ingest: { limit: 1000000, reset: "monthly" },
      cost_alerts: { limit: null },
      organizations: { limit: null },
      csv_upload: { limit: null },
      stripe_connection: { limit: null },
      ai_provider_connection: { limit: null },
      team_members: { limit: null },
      data_retention_days: { limit: null },
    },
  },
};

const SOFT_CAP_GRACE = 0.1;

// =============================================================================
// Feature access check
// =============================================================================

export async function checkFeatureAccess(
  pool: Pool,
  visitorId: string,
  featureKey: string,
  _email?: string,
  accountId?: number,
): Promise<{
  allowed: boolean;
  reason?: string;
  usage?: number;
  limit?: number;
  remaining?: number;
}> {
  // Look up user's plan
  const result = await pool.query(
    `SELECT a.stripe_plan FROM accounts a
     JOIN user_accounts ua ON ua.account_id = a.id
     JOIN users u ON u.id = ua.user_id
     WHERE u.visitor_id = $1 AND ua.role = 'owner' LIMIT 1`,
    [visitorId],
  );
  const plan = result.rows[0]?.stripe_plan || "free";
  const planConfig = OBSERVE_PLANS[plan] || OBSERVE_PLANS.free;
  const featureConfig = planConfig.features[featureKey];

  // Feature not defined on this plan = not allowed
  if (!featureConfig) {
    return {
      allowed: false,
      reason: `${featureKey} is not available on the ${planConfig.name} plan. Need more capacity? Check out Tanso at tansohq.com`,
    };
  }

  // Unlimited
  if (featureConfig.limit === null) {
    return { allowed: true };
  }

  // Metered — count usage this month
  const resolvedAccountId = await resolveAccountIdForUser(
    pool,
    visitorId,
    accountId,
  );
  let used = 0;
  if (featureKey === "ai_insights") {
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM ai_insights
       WHERE account_id = $1 AND created_at >= date_trunc('month', NOW())`,
      [resolvedAccountId],
    );
    used = parseInt(countResult.rows[0]?.count || "0", 10);
  } else if (featureKey === "event_ingest") {
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM observe_events
       WHERE account_id = $1 AND timestamp >= date_trunc('month', NOW()) AND source != 'sample' AND event_name != 'revenue'`,
      [resolvedAccountId],
    );
    used = parseInt(countResult.rows[0]?.count || "0", 10);
  } else if (featureKey === "cost_alerts") {
    // Count active alert_rules per account. Previous code queried a
    // non-existent `alerts` table — counter was effectively dead.
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM alert_rules WHERE account_id = $1 AND enabled = true`,
      [resolvedAccountId],
    );
    used = parseInt(countResult.rows[0]?.count || "0", 10);
  } else if (featureKey === "organizations") {
    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT ua2.account_id) as count FROM user_accounts ua2
       WHERE ua2.user_id = (SELECT id FROM users WHERE visitor_id = $1)
         AND ua2.role = 'owner'`,
      [visitorId],
    );
    used = parseInt(countResult.rows[0]?.count || "0", 10);
  } else if (featureKey === "team_members") {
    const orgResult = await pool.query(
      `SELECT org_id FROM visitor_org_map WHERE visitor_id = $1`,
      [visitorId],
    );
    if (orgResult.rows.length > 0) {
      const orgId = orgResult.rows[0].org_id;
      const countResult = await pool.query(
        `SELECT COUNT(*) as count FROM organization_members WHERE org_id = $1 AND status IN ('active', 'pending')`,
        [orgId],
      );
      used = parseInt(countResult.rows[0]?.count || "0", 10);
    }
  }

  // Add bonus credits to AI insights limit only
  let effectiveLimit = featureConfig.limit;
  if (featureKey === "ai_insights") {
    const bonusResult = await pool.query(
      `SELECT a.bonus_credits FROM accounts a
       JOIN user_accounts ua ON ua.account_id = a.id
       JOIN users u ON u.id = ua.user_id
       WHERE u.visitor_id = $1 AND ua.role = 'owner' LIMIT 1`,
      [visitorId],
    );
    const bonusCredits = bonusResult.rows[0]?.bonus_credits ?? 0;
    effectiveLimit += bonusCredits;
  }

  const hardLimit = Math.ceil(effectiveLimit * (1 + SOFT_CAP_GRACE));
  const remaining = Math.max(0, effectiveLimit - used);
  const overSoftCap = used >= effectiveLimit;
  const overHardCap = used >= hardLimit;
  return {
    allowed: !overHardCap,
    reason: overHardCap
      ? `You've exceeded your ${featureKey} limit (${used}/${effectiveLimit}). Upgrade your plan to continue.`
      : overSoftCap
        ? `You're over your ${featureKey} limit (${used}/${effectiveLimit}). Upgrade soon to avoid disruption.`
        : undefined,
    usage: used,
    limit: effectiveLimit,
    remaining,
  };
}

// =============================================================================
// Bonus credits
// =============================================================================

export const CREDIT_REWARDS = {
  feedback: 1000,
  invite_accepted: 1000,
} as const;

export type CreditRewardType = keyof typeof CREDIT_REWARDS;

export async function grantBonusCredits(
  pool: Pool,
  visitorId: string,
  rewardType: CreditRewardType,
): Promise<{ bonus_credits: number; granted: number }> {
  const amount = CREDIT_REWARDS[rewardType];
  const result = await pool.query(
    `UPDATE accounts
     SET bonus_credits = COALESCE(bonus_credits, 0) + $1
     WHERE id = (
       SELECT account_id FROM user_accounts
        WHERE user_id = (SELECT id FROM users WHERE visitor_id = $2)
          AND role = 'owner' LIMIT 1
     )
     RETURNING bonus_credits`,
    [amount, visitorId],
  );
  return {
    bonus_credits: result.rows[0]?.bonus_credits ?? 0,
    granted: amount,
  };
}

export async function getBonusCredits(
  pool: Pool,
  visitorId: string,
): Promise<number> {
  const result = await pool.query(
    `SELECT a.bonus_credits FROM accounts a
     JOIN user_accounts ua ON ua.account_id = a.id
     JOIN users u ON u.id = ua.user_id
     WHERE u.visitor_id = $1 AND ua.role = 'owner' LIMIT 1`,
    [visitorId],
  );
  return result.rows[0]?.bonus_credits ?? 0;
}

// =============================================================================
// Usage tracking — no-op for now (usage counted on read from ai_insights table)
// =============================================================================

export async function trackUsage(
  _pool: Pool,
  _visitorId: string,
  _featureKey: string,
  _eventName: string,
): Promise<void> {
  // No-op: metered features are counted by querying the source table directly
}

// =============================================================================
// Stripe Checkout
// =============================================================================

export async function createCheckoutSession(
  pool: Pool,
  visitorId: string,
  plan: string = "pro",
): Promise<{ url: string }> {
  const stripe = await getUncachableStripeClient();
  const planConfig = OBSERVE_PLANS[plan];
  if (!planConfig) {
    throw new Error(`Unknown plan: ${plan}`);
  }
  const priceId = planConfig.stripePriceId;
  if (!priceId) {
    throw new Error(`Stripe price not configured for ${plan} plan`);
  }

  // Get or create Stripe customer
  const accountResult = await pool.query(
    `SELECT u.email, a.stripe_customer_id
       FROM users u
       JOIN user_accounts ua ON ua.user_id = u.id
       JOIN accounts a ON a.id = ua.account_id
      WHERE u.visitor_id = $1 AND ua.role = 'owner' LIMIT 1`,
    [visitorId],
  );
  const account = accountResult.rows[0];
  if (!account) throw new Error("Account not found");

  let customerId = account.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: account.email,
      metadata: { visitor_id: visitorId },
    });
    customerId = customer.id;
    await pool.query(
      `UPDATE accounts SET stripe_customer_id = $1
        WHERE id = (
          SELECT account_id FROM user_accounts
           WHERE user_id = (SELECT id FROM users WHERE visitor_id = $2)
             AND role = 'owner' LIMIT 1
        )`,
      [customerId, visitorId],
    );
  }

  const baseUrl =
    process.env.APP_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5001");

  const existingSubs = await stripe.subscriptions.list({
    customer: customerId,
    status: "active",
    limit: 1,
  });

  if (existingSubs.data.length > 0) {
    const sub = existingSubs.data[0];
    const itemId = sub.items.data[0]?.id;
    if (itemId) {
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: "create_prorations",
      });
      return { url: `${baseUrl}/plans` };
    }
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/plans`,
    metadata: { visitor_id: visitorId },
  });

  return { url: session.url! };
}

// =============================================================================
// Stripe Customer Portal
// =============================================================================

export async function createPortalSession(
  pool: Pool,
  visitorId: string,
): Promise<{ url: string }> {
  const stripe = await getUncachableStripeClient();

  const accountResult = await pool.query(
    `SELECT a.stripe_customer_id FROM accounts a
     JOIN user_accounts ua ON ua.account_id = a.id
     JOIN users u ON u.id = ua.user_id
     WHERE u.visitor_id = $1 AND ua.role = 'owner' LIMIT 1`,
    [visitorId],
  );
  const customerId = accountResult.rows[0]?.stripe_customer_id;
  if (!customerId) {
    throw new Error("No Stripe customer found. Subscribe to a plan first.");
  }

  const baseUrl =
    process.env.APP_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5001");

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/plans`,
  });

  return { url: session.url };
}

// =============================================================================
// Stripe Webhook handler
// =============================================================================

function resolvePlanFromPriceId(priceId: string): string | null {
  if (!priceId) {
    console.error("resolvePlanFromPriceId: empty priceId");
    return null;
  }
  for (const [key, plan] of Object.entries(OBSERVE_PLANS)) {
    if (plan.stripePriceId && plan.stripePriceId === priceId) return key;
  }
  console.error(`resolvePlanFromPriceId: no plan matches priceId=${priceId}`);
  return null;
}

export async function handleWebhook(
  pool: Pool,
  event: { type: string; data: { object: Record<string, unknown> } },
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const customerId = session.customer as string;
      const visitorId = session.metadata
        ? (session.metadata as Record<string, string>).visitor_id
        : null;

      const stripe = await getUncachableStripeClient();
      const retrieved = await stripe.checkout.sessions.retrieve(
        session.id as string,
        { expand: ["line_items"] },
      );
      const priceId = retrieved.line_items?.data?.[0]?.price?.id ?? "";
      const plan = resolvePlanFromPriceId(priceId);

      if (!plan) {
        console.error(
          `checkout.session.completed: could not resolve plan from priceId=${priceId}, skipping plan update`,
        );
        break;
      }

      if (visitorId) {
        const result = await pool.query(
          `UPDATE accounts SET stripe_plan = $1, stripe_customer_id = $2
            WHERE id = (
              SELECT account_id FROM user_accounts
               WHERE user_id = (SELECT id FROM users WHERE visitor_id = $3)
                 AND role = 'owner' LIMIT 1
            )
            RETURNING id`,
          [plan, customerId, visitorId],
        );
        if (result.rowCount === 0) {
          console.error(
            `checkout.session.completed: no account found for visitor_id=${visitorId}, stripe_customer=${customerId}`,
          );
        }
      } else if (customerId) {
        const result = await pool.query(
          `UPDATE accounts SET stripe_plan = $1 WHERE stripe_customer_id = $2 RETURNING id`,
          [plan, customerId],
        );
        if (result.rowCount === 0) {
          console.error(
            `checkout.session.completed: no account found for stripe_customer=${customerId}, no visitor_id in metadata`,
          );
        }
      } else {
        console.error(
          "checkout.session.completed: no visitor_id or customer_id in session",
        );
      }
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object;
      const customerId = sub.customer as string;
      const status = sub.status as string;
      const items = (sub as Record<string, unknown>).items as
        | { data?: Array<{ price?: { id?: string } }> }
        | undefined;
      const priceId = items?.data?.[0]?.price?.id ?? "";
      const plan = resolvePlanFromPriceId(priceId);

      if (status === "active" || status === "trialing") {
        if (!plan) {
          console.error(
            `subscription.updated: could not resolve plan from priceId=${priceId}, skipping`,
          );
          break;
        }
        await pool.query(
          `UPDATE accounts SET stripe_plan = $1 WHERE stripe_customer_id = $2`,
          [plan, customerId],
        );
      } else if (
        status === "canceled" ||
        status === "unpaid" ||
        status === "past_due"
      ) {
        await pool.query(
          `UPDATE accounts SET stripe_plan = 'free' WHERE stripe_customer_id = $1`,
          [customerId],
        );
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const customerId = sub.customer as string;
      await pool.query(
        `UPDATE accounts SET stripe_plan = 'free' WHERE stripe_customer_id = $1`,
        [customerId],
      );
      break;
    }
  }
}
