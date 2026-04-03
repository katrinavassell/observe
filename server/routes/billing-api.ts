import express, { Router, Request, Response } from "express";
import type { Pool } from "pg";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { type AuthRequest } from "./auth.js";
import { getUncachableStripeClient } from "../stripe-client.js";
import { createStripeClientFromKey, encryptApiKey } from "../stripe-client.js";
import {
  checkFeatureAccess,
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  grantBonusCredits,
  getBonusCredits,
  CREDIT_REWARDS,
} from "../billing.js";
import type { CreditRewardType } from "../billing.js";
import { calculateCostFromTokens as calcCostFromDb } from "../model-pricing.js";
import { syncStripeDataForUser } from "./integrations.js";

type TrackBillingUsageFn = (
  visitorId: string,
  featureKey: string,
  eventName: string,
) => void;
type ConvertReferralFn = (visitorId: string) => Promise<void>;

async function clearSampleData(
  db: { query: (text: string, params: unknown[]) => Promise<unknown> },
  userId: string,
): Promise<void> {
  await db.query(
    "DELETE FROM observe_events WHERE user_id = $1 AND source = 'sample'",
    [userId],
  );
  await db.query(
    "DELETE FROM cost_records WHERE user_id = $1 AND cost_type = 'ai_inference' AND customer_id IS NULL AND period_start IS NOT NULL",
    [userId],
  );
  await db.query(
    "DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id IN ('sub_001','sub_002','sub_003','sub_004','sub_005')",
    [userId],
  );
  await db.query(
    "DELETE FROM customers WHERE user_id = $1 AND customer_id IN ('cus_001','cus_002','cus_003','cus_004','cus_005')",
    [userId],
  );
  await db.query(
    "DELETE FROM plans WHERE user_id = $1 AND plan_id IN ('starter', 'pro', 'enterprise')",
    [userId],
  );
}

export function createBillingApiRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    trackBillingUsage: TrackBillingUsageFn;
    convertReferralIfPending: ConvertReferralFn;
  },
) {
  const router = Router();

  const expensiveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again in a minute" },
  });

  // GET /api/feature-pricing — list all feature pricing rules
  router.get(
    "/api/feature-pricing",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT feature_key, revenue_per_unit, unit_label, effective_from, created_at
           FROM feature_pricing WHERE user_id = $1 ORDER BY feature_key`,
          [req.visitorId],
        );
        res.json({
          rules: result.rows.map((r: Record<string, unknown>) => ({
            ...r,
            revenue_per_unit: parseFloat(r.revenue_per_unit as string),
          })),
        });
      } catch (error) {
        console.error("GET /api/feature-pricing error:", error);
        res.status(500).json({ error: "Failed to fetch feature pricing" });
      }
    },
  );

  // POST /api/feature-pricing — upsert a feature pricing rule
  router.post(
    "/api/feature-pricing",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const { feature_key, revenue_per_unit, unit_label } = req.body;
      if (!feature_key || revenue_per_unit == null) {
        res
          .status(400)
          .json({ error: "feature_key and revenue_per_unit are required" });
        return;
      }
      try {
        await pool.query(
          `INSERT INTO feature_pricing (user_id, feature_key, revenue_per_unit, unit_label)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, feature_key)
           DO UPDATE SET revenue_per_unit = $3, unit_label = $4`,
          [req.visitorId, feature_key, revenue_per_unit, unit_label || "call"],
        );
        res.json({ ok: true });
      } catch (error) {
        console.error("POST /api/feature-pricing error:", error);
        res.status(500).json({ error: "Failed to save feature pricing" });
      }
    },
  );

  // DELETE /api/feature-pricing/:featureKey — remove a feature pricing rule
  router.delete(
    "/api/feature-pricing/:featureKey",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        await pool.query(
          `DELETE FROM feature_pricing WHERE user_id = $1 AND feature_key = $2`,
          [req.visitorId, req.params.featureKey],
        );
        res.json({ ok: true });
      } catch (error) {
        console.error("DELETE /api/feature-pricing error:", error);
        res.status(500).json({ error: "Failed to delete feature pricing" });
      }
    },
  );

  // GET /api/feature-pricing/features — list distinct feature keys from events
  router.get(
    "/api/feature-pricing/features",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT DISTINCT feature_key FROM observe_events
           WHERE user_id = $1 AND feature_key != 'unknown'
           ORDER BY feature_key LIMIT 100`,
          [req.visitorId],
        );
        res.json({
          features: result.rows.map(
            (r: { feature_key: string }) => r.feature_key,
          ),
        });
      } catch (error) {
        console.error("GET /api/feature-pricing/features error:", error);
        res.status(500).json({ error: "Failed to fetch features" });
      }
    },
  );

  // GET /billing/status — current plan info
  router.get(
    "/billing/status",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT stripe_plan, stripe_customer_id FROM accounts WHERE visitor_id = $1`,
          [req.visitorId],
        );
        const plan = result.rows[0]?.stripe_plan || "free";
        const hasStripeCustomer = !!result.rows[0]?.stripe_customer_id;
        res.json({ plan, hasStripeCustomer });
      } catch (error) {
        console.error("GET /api/billing/status error:", error);
        res.status(500).json({ error: "Failed to fetch billing status" });
      }
    },
  );

  // GET /credits — current bonus credits and reward info
  router.get(
    "/credits",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const bonus = await getBonusCredits(pool, req.visitorId!);
        const feedbackCheck = await pool.query(
          `SELECT 1 FROM feedback WHERE user_id = $1 AND created_at >= date_trunc('month', NOW()) LIMIT 1`,
          [req.visitorId],
        );
        const inviteResult = await pool.query(
          `SELECT invite_credits_granted FROM accounts WHERE visitor_id = $1`,
          [req.visitorId],
        );
        res.json({
          bonus_credits: bonus,
          rewards: CREDIT_REWARDS,
          earned: {
            feedback: feedbackCheck.rows.length > 0,
            invite_accepted: inviteResult.rows[0]?.invite_credits_granted ?? 0,
          },
        });
      } catch (error) {
        console.error("GET /credits error:", error);
        res.status(500).json({ error: "Failed to fetch credits" });
      }
    },
  );

  // POST /credits/feedback — grant credits for submitting feedback
  router.post(
    "/credits/feedback",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { message } = req.body || {};
        if (
          !message ||
          typeof message !== "string" ||
          message.trim().length < 10
        ) {
          return res
            .status(400)
            .json({ error: "Feedback must be at least 10 characters" });
        }

        // Check if already submitted feedback this month
        const check = await pool.query(
          `SELECT created_at FROM feedback
           WHERE user_id = $1 AND created_at >= date_trunc('month', NOW())
           LIMIT 1`,
          [req.visitorId],
        );
        if (check.rows.length > 0) {
          return res
            .status(409)
            .json({ error: "Feedback credits already claimed this month" });
        }

        // Store feedback
        await pool.query(
          `INSERT INTO feedback (user_id, message) VALUES ($1, $2)`,
          [req.visitorId, message.trim()],
        );

        // Grant credits and mark as submitted
        const result = await grantBonusCredits(
          pool,
          req.visitorId!,
          "feedback",
        );
        await pool.query(
          `UPDATE accounts SET feedback_submitted = true WHERE visitor_id = $1`,
          [req.visitorId],
        );

        // Email feedback to Kat
        const resendKey = process.env.RESEND_API_KEY;
        if (resendKey) {
          const acct = await pool.query(
            `SELECT email, name FROM accounts WHERE visitor_id = $1`,
            [req.visitorId],
          );
          const sender = acct.rows[0]?.email || "unknown";
          const senderName = acct.rows[0]?.name || sender;
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resendKey}`,
            },
            body: JSON.stringify({
              from: "Observe <notifications@updates.tanso.io>",
              to: "kat@tansohq.com",
              subject: `Feedback from ${senderName}`,
              html: `<p><strong>From:</strong> ${senderName} (${sender})</p><p>${message.trim()}</p>`,
            }),
          }).catch((err: unknown) =>
            console.error("Failed to email feedback:", err),
          );
        }

        res.json({
          success: true,
          granted: result.granted,
          bonus_credits: result.bonus_credits,
        });
      } catch (error) {
        console.error("POST /credits/feedback error:", error);
        res.status(500).json({ error: "Failed to submit feedback" });
      }
    },
  );

  // POST /billing/create-checkout — create Stripe Checkout session
  router.post(
    "/billing/create-checkout",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { url } = await createCheckoutSession(pool, req.visitorId!);
        res.json({ url });
      } catch (error) {
        console.error("POST /api/billing/create-checkout error:", error);
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to create checkout",
        });
      }
    },
  );

  // POST /billing/portal — create Stripe Customer Portal session
  router.post(
    "/billing/portal",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { url } = await createPortalSession(pool, req.visitorId!);
        res.json({ url });
      } catch (error) {
        console.error("POST /api/billing/portal error:", error);
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to create portal session",
        });
      }
    },
  );

  // POST /billing/webhook — Stripe webhook handler
  router.post(
    "/billing/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        console.error("STRIPE_WEBHOOK_SECRET not configured");
        res.status(500).json({ error: "Webhook not configured" });
        return;
      }

      try {
        const stripe = await getUncachableStripeClient();
        const sig = req.headers["stripe-signature"] as string;
        const event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          webhookSecret,
        );
        await handleWebhook(
          pool,
          event as unknown as {
            type: string;
            data: { object: Record<string, unknown> };
          },
        );
        res.json({ received: true });
      } catch (error) {
        console.error("Webhook error:", error);
        res
          .status(400)
          .json({ error: "Webhook signature verification failed" });
      }
    },
  );

  // GET /stripe/status
  router.get(
    "/stripe/status",
    ensureVisitor,
    async (_req: AuthRequest, res: Response) => {
      try {
        const stripe = await getUncachableStripeClient();
        const account = await stripe.accounts.retrieve();
        res.json({
          connected: true,
          account_id: account.id,
          account_name:
            (
              account as {
                business_profile?: { name?: string };
                display_name?: string;
              }
            ).business_profile?.name ||
            (account as { display_name?: string }).display_name ||
            account.id,
        });
      } catch (error) {
        console.error("Stripe status check error:", error);
        res.json({ connected: false, error: "Not connected" });
      }
    },
  );

  // POST /integrations/stripe/connect
  router.post(
    "/integrations/stripe/connect",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { api_key } = req.body;

        if (!api_key || typeof api_key !== "string") {
          return res.status(400).json({ error: "api_key is required" });
        }

        if (
          !api_key.startsWith("rk_live_") &&
          !api_key.startsWith("rk_test_") &&
          !api_key.startsWith("sk_live_") &&
          !api_key.startsWith("sk_test_")
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid Stripe API key format. Use a restricted key (rk_live_... or rk_test_...) or secret key (sk_live_... or sk_test_...).",
          });
        }

        let accountName = "";
        let accountId = "";
        try {
          const stripe = createStripeClientFromKey(api_key);
          const account = await stripe.accounts.retrieve();
          accountId = account.id;
          accountName =
            (account as any).business_profile?.name ||
            (account as any).display_name ||
            account.id;
        } catch {
          return res.status(400).json({
            success: false,
            message:
              "Invalid Stripe API key. Please check your key and try again.",
          });
        }

        const keyPrefix = api_key.substring(0, 12) + "...";
        const encryptedKey = encryptApiKey(api_key);

        await pool.query(
          `INSERT INTO integrations (user_id, provider, api_key_prefix, has_usage_access, connected_at, encrypted_api_key, stripe_account_id, stripe_account_name)
         VALUES ($1, 'stripe', $2, true, NOW(), $3, $4, $5)
         ON CONFLICT (user_id, provider)
         DO UPDATE SET api_key_prefix = $2, has_usage_access = true, connected_at = NOW(), encrypted_api_key = $3, stripe_account_id = $4, stripe_account_name = $5`,
          [visitorId, keyPrefix, encryptedKey, accountId, accountName],
        );

        let syncResult = { customers: 0, subscriptions: 0, plans: 0 };
        try {
          syncResult = await syncStripeDataForUser(pool, visitorId, api_key);
          await clearSampleData(pool, visitorId);
          await pool.query(
            "INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()",
            [visitorId, "user"],
          );
          deps.convertReferralIfPending(visitorId);
        } catch (syncErr) {
          console.error(
            "Initial Stripe sync error (connection succeeded):",
            syncErr,
          );
        }

        deps.trackBillingUsage(visitorId, "stripe_sync", "stripe_connected");

        res.json({
          success: true,
          message: "Stripe connected successfully",
          account_name: accountName,
          account_id: accountId,
          synced: syncResult,
        });
      } catch (err) {
        console.error("Stripe connect error:", err);
        res.status(500).json({ error: "Failed to connect Stripe" });
      }
    },
  );

  router.get(
    "/integrations/stripe/status",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT api_key_prefix, has_usage_access, connected_at, last_synced_at, stripe_account_id, stripe_account_name
         FROM integrations WHERE user_id = $1 AND provider = 'stripe'`,
          [req.visitorId],
        );

        if (result.rows.length === 0) {
          return res.json({ connected: false });
        }

        const row = result.rows[0];
        res.json({
          connected: true,
          api_key_prefix: row.api_key_prefix,
          account_id: row.stripe_account_id,
          account_name: row.stripe_account_name,
          connected_at: row.connected_at,
          last_synced_at: row.last_synced_at,
        });
      } catch (err) {
        console.error("Stripe status error:", err);
        res.status(500).json({ error: "Failed to check Stripe status" });
      }
    },
  );

  router.post(
    "/integrations/stripe/sync",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const syncResult = await syncStripeDataForUser(pool, visitorId);

        await pool.query(
          `UPDATE integrations SET last_synced_at = NOW() WHERE user_id = $1 AND provider = 'stripe'`,
          [visitorId],
        );

        deps.trackBillingUsage(visitorId, "stripe_sync", "stripe_data_synced");

        res.json({ success: true, synced: syncResult });
      } catch (err) {
        console.error("Stripe sync error:", err);
        res.status(500).json({ error: "Failed to sync Stripe data" });
      }
    },
  );

  router.post(
    "/integrations/stripe/disconnect",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { clear_data } = req.body;

        await pool.query(
          "DELETE FROM integrations WHERE user_id = $1 AND provider = $2",
          [visitorId, "stripe"],
        );

        if (clear_data) {
          await pool.query(
            "DELETE FROM observe_events WHERE user_id = $1 AND source = 'stripe'",
            [visitorId],
          );
          await pool.query("DELETE FROM subscriptions WHERE user_id = $1", [
            visitorId,
          ]);
          await pool.query("DELETE FROM customers WHERE user_id = $1", [
            visitorId,
          ]);
          await pool.query("DELETE FROM plans WHERE user_id = $1", [visitorId]);
        }

        res.json({
          success: true,
          message: clear_data
            ? "Stripe disconnected and data cleared"
            : "Stripe disconnected",
        });
      } catch (err) {
        console.error("Stripe disconnect error:", err);
        res.status(500).json({ error: "Failed to disconnect Stripe" });
      }
    },
  );

  // POST /stripe/sync — native Stripe sync
  router.post(
    "/stripe/sync",
    ensureVisitor,
    expensiveLimiter,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        const stripe = await getUncachableStripeClient();

        const [
          stripeCustomersList,
          stripeSubscriptionsList,
          stripeProductsList,
          pricesList,
        ] = await Promise.all([
          stripe.customers
            .list({ limit: 100 })
            .autoPagingToArray({ limit: 10000 }),
          stripe.subscriptions
            .list({ limit: 100, status: "all" })
            .autoPagingToArray({ limit: 10000 }),
          stripe.products
            .list({ limit: 100, active: true })
            .autoPagingToArray({ limit: 10000 }),
          stripe.prices
            .list({ limit: 100, active: true })
            .autoPagingToArray({ limit: 10000 }),
        ]);
        const stripeCustomers = { data: stripeCustomersList };
        const stripeSubscriptions = { data: stripeSubscriptionsList };
        const stripeProducts = { data: stripeProductsList };
        const prices = pricesList;

        await client.query("BEGIN");

        await client.query("DELETE FROM subscriptions WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM customers WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM plans WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query(
          "DELETE FROM observe_events WHERE user_id = $1 AND source = 'stripe'",
          [req.visitorId],
        );

        const planIds = new Set<string>();
        const planRows: {
          planId: string;
          name: string;
          amount: number;
          intervalMonths: number;
        }[] = [];
        for (const price of prices) {
          const planId = price.id;
          if (planIds.has(planId)) continue;
          planIds.add(planId);
          const product = stripeProducts.data.find(
            (p) =>
              p.id ===
              (typeof price.product === "string"
                ? price.product
                : price.product?.id),
          );
          const name = product?.name || planId;
          const amount = (price.unit_amount || 0) / 100;
          const intervalMonths = price.recurring?.interval === "year" ? 12 : 1;
          planRows.push({ planId, name, amount, intervalMonths });
        }
        const batchSize = 500;
        for (let i = 0; i < planRows.length; i += batchSize) {
          const batch = planRows.slice(i, i + batchSize);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;
          for (const p of batch) {
            placeholders.push(
              `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
            );
            values.push(
              req.visitorId,
              p.planId,
              p.name,
              p.amount,
              p.intervalMonths,
              "recurring",
            );
          }
          await client.query(
            `INSERT INTO plans (user_id, plan_id, name, price_amount, interval_months, billing_model) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
            values,
          );
        }

        const validCustomers = stripeCustomers.data.filter(
          (c) => typeof c !== "string",
        );
        for (let i = 0; i < validCustomers.length; i += batchSize) {
          const batch = validCustomers.slice(i, i + batchSize);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;
          for (const customer of batch) {
            placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
            values.push(
              req.visitorId,
              customer.id,
              customer.email || customer.id,
              customer.email || null,
            );
          }
          await client.query(
            `INSERT INTO customers (user_id, customer_id, name, email) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
            values,
          );
        }

        let syncedSubs = 0;
        const subRows: {
          id: string;
          customerId: string;
          priceId: string;
          isActive: boolean;
          mrr: number;
        }[] = [];
        for (const sub of stripeSubscriptions.data) {
          const priceId = sub.items?.data?.[0]?.price?.id;
          if (!priceId) continue;
          const unitAmount = sub.items.data[0].price.unit_amount || 0;
          const mrr =
            sub.items.data[0].price.recurring?.interval === "year"
              ? Math.round(unitAmount / 12 / 100)
              : Math.round(unitAmount / 100);
          subRows.push({
            id: sub.id,
            customerId: sub.customer as string,
            priceId,
            isActive: sub.status === "active",
            mrr,
          });
          syncedSubs++;
        }
        for (let i = 0; i < subRows.length; i += batchSize) {
          const batch = subRows.slice(i, i + batchSize);
          const subValues: unknown[] = [];
          const subPlaceholders: string[] = [];
          const eventValues: unknown[] = [];
          const eventPlaceholders: string[] = [];
          let subIdx = 1;
          let eventIdx = 1;
          for (const s of batch) {
            subPlaceholders.push(
              `($${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++})`,
            );
            subValues.push(
              req.visitorId,
              s.id,
              s.customerId,
              s.priceId,
              s.isActive,
              s.mrr,
            );
            eventPlaceholders.push(
              `($${eventIdx++}, $${eventIdx++}, 'subscription', 'revenue', NOW(), $${eventIdx++}, 'stripe', 'monthly_aggregate')`,
            );
            eventValues.push(req.visitorId, s.customerId, s.mrr);
          }
          await client.query(
            `INSERT INTO subscriptions (user_id, subscription_id, customer_id, plan_id, is_active, mrr_override) VALUES ${subPlaceholders.join(", ")} ON CONFLICT DO NOTHING`,
            subValues,
          );
          await client.query(
            `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity) VALUES ${eventPlaceholders.join(", ")}`,
            eventValues,
          );
        }

        await client.query(
          "INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()",
          [req.visitorId, "user"],
        );
        await client.query("COMMIT");
        deps.convertReferralIfPending(req.visitorId!);
        deps.trackBillingUsage(
          req.visitorId!,
          "stripe_sync",
          "stripe_data_synced",
        );

        res.json({
          success: true,
          synced: {
            customers: stripeCustomers.data.length,
            subscriptions: syncedSubs,
            plans: planIds.size,
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Stripe sync error:", error);
        res.status(500).json({ error: "Stripe sync failed" });
      } finally {
        client.release();
      }
    },
  );

  // OpenAI integration routes
  router.post(
    "/integrations/openai/connect",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { api_key } = req.body;
        if (!api_key || typeof api_key !== "string")
          return res.status(400).json({ error: "api_key is required" });

        const validationResponse = await fetch(
          "https://api.openai.com/v1/models",
          { headers: { Authorization: `Bearer ${api_key}` } },
        );
        if (!validationResponse.ok)
          return res.status(400).json({
            success: false,
            message:
              "Invalid OpenAI API key. Please check your key and try again.",
          });

        const keyPrefix = api_key.substring(0, 8) + "...";
        let hasUsageAccess = false;
        let totalCostSynced = 0;
        let eventsSynced = 0;

        try {
          const now = Math.floor(Date.now() / 1000);
          const thirtyDaysAgo = now - 30 * 24 * 60 * 60;
          const usageResponse = await fetch(
            `https://api.openai.com/v1/organization/usage/completions?start_time=${thirtyDaysAgo}&end_time=${now}&bucket_width=1d`,
            { headers: { Authorization: `Bearer ${api_key}` } },
          );

          if (usageResponse.ok) {
            hasUsageAccess = true;
            const usageData = (await usageResponse.json()) as {
              data?: Array<{
                results?: Array<{
                  snapshot_id?: string;
                  input_tokens?: number;
                  output_tokens?: number;
                }>;
                start_time?: number;
              }>;
            };
            if (usageData.data && Array.isArray(usageData.data)) {
              for (const bucket of usageData.data) {
                const bucketTime = bucket.start_time
                  ? new Date(bucket.start_time * 1000).toISOString()
                  : new Date().toISOString();
                if (bucket.results && Array.isArray(bucket.results)) {
                  for (const result of bucket.results) {
                    const modelName = result.snapshot_id || "unknown";
                    const inputTokens = result.input_tokens || 0;
                    const outputTokens = result.output_tokens || 0;
                    const cost = await calcCostFromDb(
                      pool,
                      modelName,
                      inputTokens,
                      outputTokens,
                    );
                    if (cost > 0) {
                      await pool.query(
                        `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, revenue_amount, usage_units, model, model_provider, source, granularity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                        [
                          visitorId,
                          "system",
                          "openai_usage",
                          "cost",
                          bucketTime,
                          cost,
                          "usd",
                          0,
                          inputTokens + outputTokens,
                          modelName,
                          "openai",
                          "openai",
                          "daily",
                        ],
                      );
                      totalCostSynced += cost;
                      eventsSynced++;
                    }
                  }
                }
              }
            }
            if (eventsSynced > 0) {
              const txClient = await pool.connect();
              try {
                await txClient.query("BEGIN");
                await clearSampleData(txClient, visitorId);
                await txClient.query(
                  `INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()`,
                  [visitorId, "user"],
                );
                await txClient.query("COMMIT");
              } catch (err) {
                await txClient
                  .query("ROLLBACK")
                  .catch((e) => console.error("ROLLBACK failed:", e));
                console.error(
                  "clearSampleData failed during OpenAI sync:",
                  err,
                );
              } finally {
                txClient.release();
              }
            }
          } else if (usageResponse.status === 403) {
            console.log(
              `OpenAI usage API returned 403 for user ${visitorId} - no admin access`,
            );
          }
        } catch (syncErr) {
          console.error(
            "OpenAI usage sync error (connection will still succeed):",
            syncErr,
          );
        }

        await pool.query(
          `INSERT INTO integrations (user_id, provider, api_key_prefix, has_usage_access, connected_at) VALUES ($1, 'openai', $2, $3, NOW()) ON CONFLICT (user_id, provider) DO UPDATE SET api_key_prefix = $2, has_usage_access = $3, connected_at = NOW()`,
          [visitorId, keyPrefix, hasUsageAccess],
        );
        deps.trackBillingUsage(visitorId, "openai_sync", "openai_connected");
        res.json({
          success: true,
          message: "OpenAI connected successfully",
          has_usage_access: hasUsageAccess,
          cost_synced: Math.round(totalCostSynced * 100) / 100,
          months_synced: eventsSynced > 0 ? 1 : 0,
        });
      } catch (err) {
        console.error("OpenAI connect error:", err);
        res.status(500).json({ error: "Failed to connect OpenAI" });
      }
    },
  );

  router.get(
    "/integrations/openai/status",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT api_key_prefix, has_usage_access, connected_at, last_synced_at FROM integrations WHERE user_id = $1 AND provider = 'openai'`,
          [req.visitorId],
        );
        if (result.rows.length === 0)
          return res.json({ connected: false, has_usage_access: false });
        const row = result.rows[0];
        res.json({
          connected: true,
          has_usage_access: row.has_usage_access,
          api_key_prefix: row.api_key_prefix,
          connected_at: row.connected_at,
          last_synced_at: row.last_synced_at,
        });
      } catch (err) {
        console.error("OpenAI status error:", err);
        res.status(500).json({ error: "Failed to check OpenAI status" });
      }
    },
  );

  router.post(
    "/integrations/openai/disconnect",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        await pool.query(
          "DELETE FROM integrations WHERE user_id = $1 AND provider = $2",
          [req.visitorId, "openai"],
        );
        res.json({ success: true });
      } catch (err) {
        console.error("OpenAI disconnect error:", err);
        res.status(500).json({ error: "Failed to disconnect" });
      }
    },
  );

  // Anthropic integration routes
  router.post(
    "/integrations/anthropic/connect",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { api_key } = req.body;
        if (!api_key || typeof api_key !== "string")
          return res.status(400).json({ error: "api_key is required" });

        const validationResponse = await fetch(
          "https://api.anthropic.com/v1/models",
          {
            headers: {
              "x-api-key": api_key,
              "anthropic-version": "2023-06-01",
            },
          },
        );
        if (
          validationResponse.status === 401 ||
          validationResponse.status === 403
        )
          return res.status(400).json({
            success: false,
            message:
              "Invalid Anthropic API key. Please check your key and try again.",
          });

        const keyPrefix = api_key.substring(0, 10) + "...";
        let hasUsageAccess = false;
        let totalCostSynced = 0;
        let eventsSynced = 0;

        try {
          const today = new Date();
          const thirtyDaysAgo = new Date(
            today.getTime() - 30 * 24 * 60 * 60 * 1000,
          );
          const todayISO = today.toISOString().split("T")[0];
          const thirtyDaysAgoISO = thirtyDaysAgo.toISOString().split("T")[0];

          const usageResponse = await fetch(
            `https://api.anthropic.com/v1/organizations/usage?start_date=${thirtyDaysAgoISO}&end_date=${todayISO}`,
            {
              headers: {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
              },
            },
          );

          if (usageResponse.ok) {
            hasUsageAccess = true;
            const usageData = (await usageResponse.json()) as {
              data?: Array<{
                model?: string;
                input_tokens?: number;
                output_tokens?: number;
                date?: string;
              }>;
            };
            if (usageData.data && Array.isArray(usageData.data)) {
              for (const entry of usageData.data) {
                const modelName = entry.model || "unknown";
                const inputTokens = entry.input_tokens || 0;
                const outputTokens = entry.output_tokens || 0;
                const entryDate = entry.date
                  ? new Date(entry.date).toISOString()
                  : new Date().toISOString();
                const cost = await calcCostFromDb(
                  pool,
                  modelName,
                  inputTokens,
                  outputTokens,
                );
                if (cost > 0) {
                  await pool.query(
                    `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, revenue_amount, usage_units, model, model_provider, source, granularity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                    [
                      visitorId,
                      "system",
                      "anthropic_usage",
                      "cost",
                      entryDate,
                      cost,
                      "usd",
                      0,
                      inputTokens + outputTokens,
                      modelName,
                      "anthropic",
                      "anthropic",
                      "daily",
                    ],
                  );
                  totalCostSynced += cost;
                  eventsSynced++;
                }
              }
            }
            if (eventsSynced > 0) {
              const txClient = await pool.connect();
              try {
                await txClient.query("BEGIN");
                await clearSampleData(txClient, visitorId);
                await txClient.query(
                  `INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()`,
                  [visitorId, "user"],
                );
                await txClient.query("COMMIT");
              } catch (err) {
                await txClient
                  .query("ROLLBACK")
                  .catch((e) => console.error("ROLLBACK failed:", e));
                console.error(
                  "clearSampleData failed during Anthropic sync:",
                  err,
                );
              } finally {
                txClient.release();
              }
            }
          } else if (usageResponse.status === 403) {
            console.log(
              `Anthropic usage API returned 403 for user ${visitorId} - no admin access`,
            );
          }
        } catch (syncErr) {
          console.error(
            "Anthropic usage sync error (connection will still succeed):",
            syncErr,
          );
        }

        await pool.query(
          `INSERT INTO integrations (user_id, provider, api_key_prefix, has_usage_access, connected_at) VALUES ($1, 'anthropic', $2, $3, NOW()) ON CONFLICT (user_id, provider) DO UPDATE SET api_key_prefix = $2, has_usage_access = $3, connected_at = NOW()`,
          [visitorId, keyPrefix, hasUsageAccess],
        );
        deps.trackBillingUsage(
          visitorId,
          "anthropic_sync",
          "anthropic_connected",
        );
        res.json({
          success: true,
          message: "Anthropic connected successfully",
          has_usage_access: hasUsageAccess,
          cost_synced: Math.round(totalCostSynced * 100) / 100,
          months_synced: eventsSynced > 0 ? 1 : 0,
        });
      } catch (err) {
        console.error("Anthropic connect error:", err);
        res.status(500).json({ error: "Failed to connect Anthropic" });
      }
    },
  );

  router.get(
    "/integrations/anthropic/status",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT api_key_prefix, has_usage_access, connected_at, last_synced_at FROM integrations WHERE user_id = $1 AND provider = 'anthropic'`,
          [req.visitorId],
        );
        if (result.rows.length === 0)
          return res.json({ connected: false, has_usage_access: false });
        const row = result.rows[0];
        res.json({
          connected: true,
          has_usage_access: row.has_usage_access,
          api_key_prefix: row.api_key_prefix,
          connected_at: row.connected_at,
          last_synced_at: row.last_synced_at,
        });
      } catch (err) {
        console.error("Anthropic status error:", err);
        res.status(500).json({ error: "Failed to check Anthropic status" });
      }
    },
  );

  router.post(
    "/integrations/anthropic/disconnect",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        await pool.query(
          "DELETE FROM integrations WHERE user_id = $1 AND provider = $2",
          [req.visitorId, "anthropic"],
        );
        res.json({ success: true });
      } catch (err) {
        console.error("Anthropic disconnect error:", err);
        res.status(500).json({ error: "Failed to disconnect" });
      }
    },
  );

  // Referral system
  router.get(
    "/referral/code",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const existing = await pool.query(
          `SELECT code FROM referral_codes WHERE user_id = $1`,
          [visitorId],
        );
        if (existing.rows.length > 0)
          return res.json({ code: existing.rows[0].code });
        const code = crypto.randomUUID().replace(/-/g, "").substring(0, 8);
        await pool.query(
          `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)`,
          [visitorId, code],
        );
        res.json({ code });
      } catch (err) {
        console.error("Referral code error:", err);
        res.status(500).json({ error: "Failed to get referral code" });
      }
    },
  );

  router.post(
    "/referral/record",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { code } = req.body;
        if (!code || typeof code !== "string")
          return res.status(400).json({ error: "Referral code is required" });
        const existingReferral = await pool.query(
          `SELECT id FROM referrals WHERE referred_user_id = $1`,
          [visitorId],
        );
        if (existingReferral.rows.length > 0)
          return res.json({ success: true, already_recorded: true });
        const codeResult = await pool.query(
          `SELECT user_id FROM referral_codes WHERE code = $1`,
          [code],
        );
        if (codeResult.rows.length === 0)
          return res.status(404).json({ error: "Invalid referral code" });
        const referrerUserId = codeResult.rows[0].user_id;
        if (referrerUserId === visitorId)
          return res
            .status(400)
            .json({ error: "Cannot use your own referral code" });
        await pool.query(
          `INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code, status) VALUES ($1, $2, $3, 'pending')`,
          [referrerUserId, visitorId, code],
        );
        deps.trackBillingUsage(referrerUserId, "referrals", "referral_shared");
        res.json({ success: true });
      } catch (err) {
        console.error("Record referral error:", err);
        res.status(500).json({ error: "Failed to record referral" });
      }
    },
  );

  router.get(
    "/referral/stats",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        let codeResult = await pool.query(
          `SELECT code FROM referral_codes WHERE user_id = $1`,
          [visitorId],
        );
        if (codeResult.rows.length === 0) {
          const code = crypto.randomUUID().replace(/-/g, "").substring(0, 8);
          await pool.query(
            `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)`,
            [visitorId, code],
          );
          codeResult = { rows: [{ code }] } as any;
        }
        const code = codeResult.rows[0].code;
        const statsResult = await pool.query(
          `SELECT COUNT(*)::int AS total_referrals, COUNT(*) FILTER (WHERE status = 'converted')::int AS converted_referrals, COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_referrals FROM referrals WHERE referrer_user_id = $1`,
          [visitorId],
        );
        const promosResult = await pool.query(
          `SELECT promo_code, used_at, created_at FROM referral_credits WHERE user_id = $1 ORDER BY created_at DESC`,
          [visitorId],
        );
        const stats = statsResult.rows[0];
        res.json({
          code,
          total_referrals: stats.total_referrals,
          converted_referrals: stats.converted_referrals,
          pending_referrals: stats.pending_referrals,
          promos: promosResult.rows.map((r: any) => ({
            code: r.promo_code,
            used: !!r.used_at,
            created_at: r.created_at,
          })),
        });
      } catch (err) {
        console.error("Referral stats error:", err);
        res.status(500).json({ error: "Failed to get referral stats" });
      }
    },
  );

  // Integration requests
  router.post(
    "/integration-requests",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { integration_name, request_type } = req.body;
        if (!integration_name)
          return res
            .status(400)
            .json({ error: "integration_name is required" });
        await pool.query(
          `INSERT INTO integration_requests (user_id, integration_name, request_type) VALUES ($1, $2, $3) ON CONFLICT (user_id, integration_name) DO NOTHING`,
          [req.visitorId, integration_name, request_type || "notify"],
        );
        res.json({ success: true });
      } catch (error) {
        console.error("Integration request error:", error);
        res.status(500).json({ error: "Failed to save request" });
      }
    },
  );

  return router;
}
