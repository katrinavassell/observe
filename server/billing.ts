import type { Pool } from "pg";
import { getUncachableStripeClient } from "./stripe-client.js";

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
      cost_alerts: { limit: null },
      csv_upload: { limit: null },
      stripe_connection: { limit: null },
      ai_provider_connection: { limit: null },
      team_members: { limit: null },
      data_retention_days: { limit: 90 },
    },
  },
  growth: {
    name: "Growth",
    stripePriceId: process.env.STRIPE_GROWTH_PRICE_ID || "",
    features: {
      ai_insights: { limit: 10000, reset: "monthly" },
      event_ingest: { limit: 500000, reset: "monthly" },
      cost_alerts: { limit: null },
      csv_upload: { limit: null },
      stripe_connection: { limit: null },
      ai_provider_connection: { limit: null },
      team_members: { limit: null },
      data_retention_days: { limit: 365 },
    },
  },
  pro: {
    name: "Pro",
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID || "",
    features: {
      ai_insights: { limit: null },
      event_ingest: { limit: null },
      cost_alerts: { limit: null },
      csv_upload: { limit: null },
      stripe_connection: { limit: null },
      ai_provider_connection: { limit: null },
      team_members: { limit: null },
      data_retention_days: { limit: null },
    },
  },
};

// =============================================================================
// Feature access check
// =============================================================================

export async function checkFeatureAccess(
  pool: Pool,
  visitorId: string,
  featureKey: string,
  _email?: string,
): Promise<{
  allowed: boolean;
  reason?: string;
  usage?: number;
  limit?: number;
  remaining?: number;
}> {
  // Look up user's plan
  const result = await pool.query(
    `SELECT stripe_plan FROM accounts WHERE visitor_id = $1`,
    [visitorId],
  );
  const plan = result.rows[0]?.stripe_plan || "free";
  const planConfig = OBSERVE_PLANS[plan] || OBSERVE_PLANS.free;
  const featureConfig = planConfig.features[featureKey];

  // Feature not defined on this plan = not allowed
  if (!featureConfig) {
    return {
      allowed: false,
      reason: `${featureKey} is not available on the ${planConfig.name} plan. Upgrade to Growth for access.`,
    };
  }

  // Unlimited
  if (featureConfig.limit === null) {
    return { allowed: true };
  }

  // Metered — count usage this month
  let used = 0;
  if (featureKey === "ai_insights") {
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM ai_insights
       WHERE user_id = $1 AND created_at >= date_trunc('month', NOW())`,
      [visitorId],
    );
    used = parseInt(countResult.rows[0]?.count || "0", 10);
  } else if (featureKey === "event_ingest") {
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM observe_events
       WHERE user_id = $1 AND timestamp >= date_trunc('month', NOW()) AND source != 'sample'`,
      [visitorId],
    );
    used = parseInt(countResult.rows[0]?.count || "0", 10);
  } else if (featureKey === "cost_alerts") {
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM alerts WHERE user_id = $1`,
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
      `SELECT bonus_credits FROM accounts WHERE visitor_id = $1`,
      [visitorId],
    );
    const bonusCredits = bonusResult.rows[0]?.bonus_credits ?? 0;
    effectiveLimit += bonusCredits;
  }

  const remaining = Math.max(0, effectiveLimit - used);
  return {
    allowed: used < effectiveLimit,
    reason:
      used >= effectiveLimit
        ? `You've used ${used}/${effectiveLimit} ${featureKey} this month. Upgrade to Growth for more.`
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
  feedback: 5,
  invite_accepted: 10,
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
     WHERE visitor_id = $2
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
    `SELECT bonus_credits FROM accounts WHERE visitor_id = $1`,
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
  plan: string = "growth",
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
    `SELECT email, stripe_customer_id FROM accounts WHERE visitor_id = $1`,
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
      `UPDATE accounts SET stripe_customer_id = $1 WHERE visitor_id = $2`,
      [customerId, visitorId],
    );
  }

  const baseUrl =
    process.env.APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5004";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
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
    `SELECT stripe_customer_id FROM accounts WHERE visitor_id = $1`,
    [visitorId],
  );
  const customerId = accountResult.rows[0]?.stripe_customer_id;
  if (!customerId) {
    throw new Error("No Stripe customer found. Subscribe to a plan first.");
  }

  const baseUrl =
    process.env.APP_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5004";

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/plans`,
  });

  return { url: session.url };
}

// =============================================================================
// Stripe Webhook handler
// =============================================================================

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

      if (visitorId) {
        const result = await pool.query(
          `UPDATE accounts SET stripe_plan = 'growth', stripe_customer_id = $1 WHERE visitor_id = $2 RETURNING id`,
          [customerId, visitorId],
        );
        if (result.rowCount === 0) {
          console.error(
            `checkout.session.completed: no account found for visitor_id=${visitorId}, stripe_customer=${customerId}`,
          );
        }
      } else if (customerId) {
        const result = await pool.query(
          `UPDATE accounts SET stripe_plan = 'growth' WHERE stripe_customer_id = $1 RETURNING id`,
          [customerId],
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

      if (status === "active" || status === "trialing") {
        await pool.query(
          `UPDATE accounts SET stripe_plan = 'growth' WHERE stripe_customer_id = $1`,
          [customerId],
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
