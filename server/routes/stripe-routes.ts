import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";
import rateLimit from "express-rate-limit";
import { getUncachableStripeClient } from "../stripe-client.js";
import {
  clearSampleData,
  type TrackBillingUsageFn,
  type ConvertReferralFn,
} from "./data-helpers.js";

export function createStripeRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    trackBillingUsage: TrackBillingUsageFn;
    convertReferralIfPending: ConvertReferralFn;
  },
) {
  const router = Router();
  const { trackBillingUsage, convertReferralIfPending } = deps;

  const expensiveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again in a minute" },
  });

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

  // POST /stripe/sync
  router.post(
    "/stripe/sync",
    ensureVisitor,
    expensiveLimiter,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        const stripe = await getUncachableStripeClient();

        // Fetch all data from Stripe using auto-pagination
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
            .list({
              limit: 100,
              status: "all",
              expand: ["data.items.data.price"],
            })
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

        // Clear existing revenue data
        const acctStripe = req.accountId ?? null;
        await client.query("DELETE FROM subscriptions WHERE account_id = $1", [
          acctStripe,
        ]);
        await client.query("DELETE FROM customers WHERE account_id = $1", [
          acctStripe,
        ]);
        await client.query("DELETE FROM plans WHERE account_id = $1", [
          acctStripe,
        ]);
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND source = 'stripe'",
          [acctStripe],
        );

        // Insert plans (from Stripe products + prices) — batched
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
              `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
            );
            values.push(
              req.visitorId,
              req.accountId ?? null,
              p.planId,
              p.name,
              p.amount,
              p.intervalMonths,
              "recurring",
            );
          }
          await client.query(
            `INSERT INTO plans (user_id, account_id, plan_id, name, price_amount, interval_months, billing_model) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
            values,
          );
        }

        // Insert customers — batched
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
              req.accountId ?? null,
              customer.id,
              customer.email || customer.id,
              customer.email || null,
            );
          }
          await client.query(
            `INSERT INTO customers (account_id, customer_id, name, email) VALUES ${placeholders.join(", ")} ON CONFLICT (account_id, customer_id) DO UPDATE SET name = EXCLUDED.name, email = COALESCE(EXCLUDED.email, customers.email)`,
            values,
          );
        }

        // Insert subscriptions — batched
        const priceToProduct = new Map<string, string>();
        for (const price of prices) {
          const pid =
            typeof price.product === "string"
              ? price.product
              : price.product?.id;
          const prod = stripeProducts.data.find((p) => p.id === pid);
          if (prod?.name) priceToProduct.set(price.id, prod.name);
        }

        let syncedSubs = 0;
        const subRows: {
          id: string;
          customerId: string;
          priceId: string;
          productName: string;
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
            productName: priceToProduct.get(priceId) || "subscription",
            isActive: ["active", "trialing", "past_due"].includes(sub.status),
            mrr,
          });
          syncedSubs++;
        }
        for (let i = 0; i < subRows.length; i += batchSize) {
          const batch = subRows.slice(i, i + batchSize);
          const subValues: unknown[] = [];
          const subPlaceholders: string[] = [];
          let subIdx = 1;
          for (const s of batch) {
            subPlaceholders.push(
              `($${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++})`,
            );
            subValues.push(
              req.visitorId,
              req.accountId ?? null,
              s.id,
              s.customerId,
              s.priceId,
              s.isActive,
              s.mrr,
            );
          }
          await client.query(
            `INSERT INTO subscriptions (user_id, account_id, subscription_id, customer_id, plan_id, is_active, mrr_override) VALUES ${subPlaceholders.join(", ")} ON CONFLICT DO NOTHING`,
            subValues,
          );
        }

        await clearSampleData(client, pool, req.visitorId!, req.accountId);
        await client.query(
          "INSERT INTO user_data_status (user_id, account_id, data_mode) VALUES ($1, $2, $3) ON CONFLICT (account_id) DO UPDATE SET data_mode = $3, updated_at = NOW()",
          [req.visitorId, req.accountId ?? null, "user"],
        );

        await client.query("COMMIT");
        convertReferralIfPending(req.visitorId!);

        // Track Stripe sync usage in billing
        trackBillingUsage(req.visitorId!, "stripe_sync", "stripe_data_synced");

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

  // POST /stripe/sync-invoices — import Stripe invoice line items for granular per-customer revenue
  router.post(
    "/stripe/sync-invoices",
    ensureVisitor,
    expensiveLimiter,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        const stripe = await getUncachableStripeClient();

        const [invoices, products] = await Promise.all([
          stripe.invoices
            .list({
              limit: 100,
              created: { gte: Math.floor(Date.now() / 1000) - 90 * 86400 },
            })
            .autoPagingToArray({ limit: 10000 }),
          stripe.products
            .list({ limit: 100 })
            .autoPagingToArray({ limit: 10000 }),
        ]);

        const productNameMap = new Map<string, string>();
        for (const product of products) {
          productNameMap.set(product.id, product.name);
        }

        await client.query("BEGIN");
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND source = 'stripe' AND granularity = 'invoice'",
          [req.accountId ?? null],
        );

        const lineItemRows: {
          customerId: string;
          featureKey: string;
          timestamp: Date;
          revenueAmount: number;
        }[] = [];
        let invoiceCount = 0;
        for (const invoice of invoices) {
          if (invoice.status !== "paid") continue;
          invoiceCount++;
          for (const line of invoice.lines.data) {
            const productId =
              typeof line.price?.product === "string"
                ? line.price.product
                : (line.price?.product as { id: string } | null)?.id;
            const featureKey =
              (productId && productNameMap.get(productId)) || "subscription";
            lineItemRows.push({
              customerId: invoice.customer as string,
              featureKey,
              timestamp: new Date((line.period?.start || 0) * 1000),
              revenueAmount: (line.amount || 0) / 100,
            });
          }
        }

        const batchSize = 500;
        for (let i = 0; i < lineItemRows.length; i += batchSize) {
          const batch = lineItemRows.slice(i, i + batchSize);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;
          for (const item of batch) {
            placeholders.push(
              `($${idx++}, $${idx++}, $${idx++}, $${idx++}, 'invoice_line_item', $${idx++}, $${idx++}, 'stripe', 'invoice', 'explicit')`,
            );
            values.push(
              req.visitorId,
              req.accountId ?? null,
              item.customerId,
              item.featureKey,
              item.timestamp,
              item.revenueAmount,
            );
          }
          await client.query(
            `INSERT INTO observe_events (user_id, account_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity, revenue_source)
           VALUES ${placeholders.join(", ")}`,
            values,
          );
        }

        await client.query("COMMIT");
        res.json({
          success: true,
          invoices: invoiceCount,
          line_items: lineItemRows.length,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Stripe invoice sync error:", error);
        res.status(500).json({ error: "Stripe invoice sync failed" });
      } finally {
        client.release();
      }
    },
  );

  return router;
}
