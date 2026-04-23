import { Router, Response } from "express";
import type { Pool } from "pg";
import crypto from "crypto";
import { type AuthRequest } from "./auth.js";
import {
  getUncachableStripeClient,
  createStripeClientFromKey,
  encryptApiKey,
  getStripeClientForUser,
} from "../stripe-client.js";
import { calculateCostFromTokens } from "../model-pricing.js";
import { runRevenueBackfill } from "./backfill.js";

async function resolveAccountIdForUser(
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
    console.error("integrations: account_id fallback lookup failed:", err);
  }
  console.warn("integrations: no account_id resolved for user", userId);
  return null;
}

type TrackBillingUsageFn = (
  visitorId: string,
  featureKey: string,
  eventName: string,
) => void;

// Clear sample/demo data when transitioning to real user data
async function clearSampleData(
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
    "DELETE FROM cost_records WHERE account_id = $1 AND cost_type = 'ai_inference' AND customer_id IS NULL",
    [resolved],
  );
  await db.query(
    "DELETE FROM subscriptions WHERE account_id = $1 AND subscription_id LIKE 'sub_%'",
    [resolved],
  );
  await db.query(
    "DELETE FROM customers WHERE account_id = $1 AND customer_id LIKE 'cus_%'",
    [resolved],
  );
  await db.query(
    "DELETE FROM plans WHERE account_id = $1 AND plan_id IN ('starter', 'pro', 'enterprise')",
    [resolved],
  );
}

/**
 * Sync Stripe data (customers, subscriptions, plans, revenue events) for a user.
 * If apiKey is provided, uses it directly. Otherwise retrieves the stored encrypted key.
 */
export async function syncStripeDataForUser(
  pool: Pool,
  userId: string,
  apiKey?: string,
  accountId?: number,
): Promise<{ customers: number; subscriptions: number; plans: number }> {
  const resolvedAccountId = await resolveAccountIdForUser(
    pool,
    userId,
    accountId,
  );
  if (resolvedAccountId == null) {
    throw new Error("Cannot sync Stripe: no account_id resolved for this user");
  }
  const stripe = apiKey
    ? createStripeClientFromKey(apiKey)
    : await getStripeClientForUser(pool, userId, resolvedAccountId);

  const [
    stripeCustomersList,
    stripeSubscriptionsList,
    stripeProductsList,
    pricesList,
  ] = await Promise.all([
    stripe.customers.list({ limit: 100 }).autoPagingToArray({ limit: 10000 }),
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

  // Clear existing Stripe-sourced data before re-syncing (except customers,
  // which are upserted to preserve SDK-created rows)
  await pool.query("DELETE FROM subscriptions WHERE account_id = $1", [
    resolvedAccountId,
  ]);
  await pool.query("DELETE FROM plans WHERE account_id = $1", [
    resolvedAccountId,
  ]);
  await pool.query(
    "DELETE FROM observe_events WHERE account_id = $1 AND source = 'stripe'",
    [resolvedAccountId],
  );

  const batchSize = 500;

  // Insert plans from Stripe products + prices
  const planIds = new Set<string>();
  const planRows: {
    planId: string;
    name: string;
    amount: number;
    intervalMonths: number;
  }[] = [];
  for (const price of pricesList) {
    const planId = price.id;
    if (planIds.has(planId)) continue;
    planIds.add(planId);
    const product = stripeProductsList.find(
      (p) =>
        p.id ===
        (typeof price.product === "string" ? price.product : price.product?.id),
    );
    const name = product?.name || planId;
    const amount = (price.unit_amount || 0) / 100;
    const intervalMonths = price.recurring?.interval === "year" ? 12 : 1;
    planRows.push({ planId, name, amount, intervalMonths });
  }
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
        userId,
        resolvedAccountId,
        p.planId,
        p.name,
        p.amount,
        p.intervalMonths,
        "recurring",
      );
    }
    await pool.query(
      `INSERT INTO plans (user_id, account_id, plan_id, name, price_amount, interval_months, billing_model) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
      values,
    );
  }

  // Insert customers — delete ALL for this account first, then fresh insert.
  // Never use ON CONFLICT on customers — dual unique constraints break it.
  // See bugs_customer_upsert.md and bugs_upsert_dual_unique.md.
  const validCustomers = stripeCustomersList.filter(
    (c) => typeof c !== "string",
  );
  if (resolvedAccountId != null) {
    await pool.query(`DELETE FROM customers WHERE account_id = $1`, [
      resolvedAccountId,
    ]);
  }
  for (let i = 0; i < validCustomers.length; i += batchSize) {
    const batch = validCustomers.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (const customer of batch) {
      placeholders.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
      );
      values.push(
        userId,
        resolvedAccountId,
        customer.id,
        customer.name || customer.email || customer.id,
        customer.email || null,
        customer.id,
      );
    }
    await pool.query(
      `INSERT INTO customers (user_id, account_id, customer_id, name, email, stripe_customer_id)
       VALUES ${placeholders.join(", ")}`,
      values,
    );
  }

  // Insert subscriptions + revenue events
  //
  // Pricing model detection per subscription, across all line items:
  //   flat    — every item is per_unit + licensed
  //   metered — every item is usage_type=metered
  //   tiered  — any item has billing_scheme=tiered
  //   hybrid  — mix of flat + metered (or tiered + metered)
  //
  // MRR = sum of non-metered line items (monthly-equivalent). Metered items
  // contribute $0 upfront — their revenue is exact per-event at ingest.
  //
  // For tiered prices we fetch `tiers` via a second API call (the list call
  // doesn't expand tiers). Cached per priceId so the same plan isn't re-fetched.
  let syncedSubs = 0;
  const tiersCache = new Map<string, unknown>();
  async function fetchTiersOnce(priceId: string): Promise<unknown | null> {
    if (tiersCache.has(priceId)) return tiersCache.get(priceId)!;
    try {
      const full = await stripe.prices.retrieve(priceId, {
        expand: ["tiers"],
      });
      const tiers = full.tiers ?? null;
      tiersCache.set(priceId, tiers);
      return tiers;
    } catch (err) {
      console.error(`Failed to fetch tiers for price ${priceId}:`, err);
      tiersCache.set(priceId, null);
      return null;
    }
  }

  const priceToProductName = new Map<string, string>();
  for (const price of pricesList) {
    const productId =
      typeof price.product === "string" ? price.product : price.product?.id;
    const product = stripeProductsList.find((p) => p.id === productId);
    if (product?.name) priceToProductName.set(price.id, product.name);
  }

  interface SubRow {
    id: string;
    customerId: string;
    priceId: string;
    productName: string;
    isActive: boolean;
    mrr: number;
    pricingModel: "flat" | "tiered" | "metered" | "hybrid";
    pricingTiers: unknown | null;
    unitPrice: number | null; // for metered items, dollars per unit
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
  }
  const subRows: SubRow[] = [];

  for (const sub of stripeSubscriptionsList) {
    const items = sub.items?.data ?? [];
    if (items.length === 0) continue;

    let hasFlat = false;
    let hasMetered = false;
    let hasTiered = false;
    let aggregatedMrr = 0;
    let meteredUnitPrice: number | null = null;
    let tieredPayload: unknown | null = null;

    for (const item of items) {
      const priceId =
        typeof item.price === "string" ? item.price : item.price?.id;
      const price = priceId
        ? (pricesList.find((p) => p.id === priceId) ?? item.price)
        : item.price;
      if (!price || typeof price === "string") continue;
      const isMetered = price.recurring?.usage_type === "metered";
      const isTiered = price.billing_scheme === "tiered";
      const yearly = price.recurring?.interval === "year";
      const unitAmountDollars = (price.unit_amount ?? 0) / 100;
      const quantity = item.quantity ?? 1;

      if (isTiered) {
        hasTiered = true;
        if (!tieredPayload) {
          tieredPayload = await fetchTiersOnce(price.id);
        }
        // Tiered base MRR is ambiguous without usage; leave at $0 and rely on
        // per-event tier lookup at ingest.
      } else if (isMetered) {
        hasMetered = true;
        // Capture per-unit price so ingest can multiply usage_units.
        if (meteredUnitPrice == null) meteredUnitPrice = unitAmountDollars;
      } else {
        hasFlat = true;
        const itemMrr = yearly
          ? (unitAmountDollars * quantity) / 12
          : unitAmountDollars * quantity;
        aggregatedMrr += itemMrr;
      }
    }

    let pricingModel: SubRow["pricingModel"];
    if (hasTiered && !hasMetered && !hasFlat) pricingModel = "tiered";
    else if (hasMetered && !hasTiered && !hasFlat) pricingModel = "metered";
    else if (hasFlat && !hasMetered && !hasTiered) pricingModel = "flat";
    else pricingModel = "hybrid";

    const firstPriceId = items[0].price?.id ?? "";
    subRows.push({
      id: sub.id,
      customerId: sub.customer as string,
      priceId: firstPriceId,
      productName: priceToProductName.get(firstPriceId) || "subscription",
      isActive:
        sub.status === "active" ||
        sub.status === "trialing" ||
        sub.status === "past_due",
      mrr: Math.round(aggregatedMrr * 100) / 100,
      pricingModel,
      pricingTiers: tieredPayload,
      unitPrice: meteredUnitPrice,
      currentPeriodStart: sub.current_period_start
        ? new Date(sub.current_period_start * 1000).toISOString()
        : null,
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
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
        `($${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++})`,
      );
      subValues.push(
        userId,
        resolvedAccountId,
        s.id,
        s.customerId,
        s.priceId,
        s.isActive,
        s.mrr,
        s.pricingModel,
        s.pricingTiers ? JSON.stringify(s.pricingTiers) : null,
        s.unitPrice,
        s.currentPeriodStart,
        s.currentPeriodEnd,
      );
    }
    await pool.query(
      `INSERT INTO subscriptions (user_id, account_id, subscription_id, customer_id, plan_id, is_active, mrr_override, pricing_model, pricing_tiers, unit_price, current_period_start, current_period_end) VALUES ${subPlaceholders.join(", ")} ON CONFLICT DO NOTHING`,
      subValues,
    );
  }

  // Update last_synced_at
  await pool.query(
    `UPDATE integrations SET last_synced_at = NOW() WHERE account_id = $1 AND provider = 'stripe'`,
    [resolvedAccountId],
  );

  // Re-enrich existing events with freshly synced subscription/customer data.
  // Awaited so the sync response reflects completed backfill — fire-and-forget
  // silently swallowed failures and left events un-enriched.
  let backfillSummary = null;
  if (resolvedAccountId != null) {
    try {
      backfillSummary = await runRevenueBackfill(
        pool,
        userId,
        resolvedAccountId,
      );
    } catch (err) {
      console.error("Post-sync revenue backfill failed:", err);
    }
  }

  return {
    customers: validCustomers.length,
    subscriptions: syncedSubs,
    plans: planIds.size,
    backfill: backfillSummary,
  };
}

export function createIntegrationsRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    trackBillingUsage: TrackBillingUsageFn;
    convertReferralIfPending: (visitorId: string) => Promise<void>;
  },
) {
  const router = Router();
  const { trackBillingUsage, convertReferralIfPending } = deps;

  // POST /integrations/openai/connect - Validate OpenAI API key and store connection
  router.post(
    "/integrations/openai/connect",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { api_key } = req.body;

        if (!api_key || typeof api_key !== "string") {
          return res.status(400).json({ error: "api_key is required" });
        }

        // Validate key by calling OpenAI models endpoint
        const validationResponse = await fetch(
          "https://api.openai.com/v1/models",
          {
            headers: { Authorization: `Bearer ${api_key}` },
          },
        );

        if (!validationResponse.ok) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid OpenAI API key. Please check your key and try again.",
          });
        }

        // Store the connection
        const keyPrefix = api_key.substring(0, 8) + "...";

        // Try to fetch and sync usage data
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

                    const cost = await calculateCostFromTokens(
                      pool,
                      modelName,
                      inputTokens,
                      outputTokens,
                    );

                    if (cost > 0) {
                      await pool.query(
                        `INSERT INTO observe_events (user_id, account_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, revenue_amount, usage_units, model, model_provider, source, granularity)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                        [
                          visitorId,
                          req.accountId ?? null,
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

            // Update has_usage_access and last_synced_at
            if (eventsSynced > 0) {
              await clearSampleData(pool, pool, visitorId, req.accountId);
              await pool.query(
                `INSERT INTO user_data_status (user_id, account_id, data_mode) VALUES ($1, $2, $3) ON CONFLICT (account_id) DO UPDATE SET data_mode = $3, updated_at = NOW()`,
                [visitorId, req.accountId ?? null, "user"],
              );
            }
          } else if (usageResponse.status === 403) {
            // No admin access - skip usage sync, still store the connection
            console.warn(
              `OpenAI usage API returned 403 for user ${visitorId} - no admin access`,
            );
          }
        } catch (syncErr) {
          console.error(
            "OpenAI usage sync error (connection will still succeed):",
            syncErr,
          );
        }

        // Persist the encrypted key so the historical-tokens backfill job
        // can call the usage API later without the user re-entering it.
        const encryptedOpenAIKey = encryptApiKey(api_key);
        await pool.query(
          `INSERT INTO integrations (user_id, account_id, provider, api_key_prefix, has_usage_access, connected_at, encrypted_api_key)
         VALUES ($1, $2, 'openai', $3, $4, NOW(), $5)
         ON CONFLICT (account_id, provider)
         DO UPDATE SET api_key_prefix = $3, has_usage_access = $4, connected_at = NOW(), encrypted_api_key = $5`,
          [
            visitorId,
            req.accountId ?? null,
            keyPrefix,
            hasUsageAccess,
            encryptedOpenAIKey,
          ],
        );

        // Track OpenAI sync usage in Tanso
        trackBillingUsage(visitorId, "openai_sync", "openai_connected");

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

  // GET /integrations/openai/status - Check OpenAI connection status
  router.get(
    "/integrations/openai/status",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT api_key_prefix, has_usage_access, connected_at, last_synced_at
         FROM integrations WHERE account_id = $1 AND provider = 'openai'`,
          [req.accountId ?? null],
        );

        if (result.rows.length === 0) {
          return res.json({ connected: false, has_usage_access: false });
        }

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

  // POST /integrations/openai/disconnect - Disconnect OpenAI
  router.post(
    "/integrations/openai/disconnect",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        await pool.query(
          "DELETE FROM integrations WHERE account_id = $1 AND provider = $2",
          [req.accountId ?? null, "openai"],
        );
        res.json({ success: true });
      } catch (err) {
        console.error("OpenAI disconnect error:", err);
        res.status(500).json({ error: "Failed to disconnect" });
      }
    },
  );

  // POST /integrations/anthropic/connect - Validate Anthropic API key and store connection
  router.post(
    "/integrations/anthropic/connect",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { api_key } = req.body;

        if (!api_key || typeof api_key !== "string") {
          return res.status(400).json({ error: "api_key is required" });
        }

        // Validate key by checking auth against the models endpoint (no token cost)
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
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid Anthropic API key. Please check your key and try again.",
          });
        }

        // Store the connection
        const keyPrefix = api_key.substring(0, 10) + "...";

        // Try to fetch and sync usage data
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

                const cost = await calculateCostFromTokens(
                  pool,
                  modelName,
                  inputTokens,
                  outputTokens,
                );

                if (cost > 0) {
                  await pool.query(
                    `INSERT INTO observe_events (user_id, account_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, revenue_amount, usage_units, model, model_provider, source, granularity)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                    [
                      visitorId,
                      req.accountId ?? null,
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

            // Update data_mode to 'user' if we synced any data
            if (eventsSynced > 0) {
              await clearSampleData(pool, pool, visitorId, req.accountId);
              await pool.query(
                `INSERT INTO user_data_status (user_id, account_id, data_mode) VALUES ($1, $2, $3) ON CONFLICT (account_id) DO UPDATE SET data_mode = $3, updated_at = NOW()`,
                [visitorId, req.accountId ?? null, "user"],
              );
            }
          } else if (usageResponse.status === 403) {
            // No admin access - skip usage sync, still store the connection
            console.warn(
              `Anthropic usage API returned 403 for user ${visitorId} - no admin access`,
            );
          }
        } catch (syncErr) {
          console.error(
            "Anthropic usage sync error (connection will still succeed):",
            syncErr,
          );
        }

        // Persist the encrypted key so the historical-tokens backfill job
        // can call the usage API later without the user re-entering it.
        const encryptedAnthropicKey = encryptApiKey(api_key);
        await pool.query(
          `INSERT INTO integrations (user_id, account_id, provider, api_key_prefix, has_usage_access, connected_at, encrypted_api_key)
         VALUES ($1, $2, 'anthropic', $3, $4, NOW(), $5)
         ON CONFLICT (account_id, provider)
         DO UPDATE SET api_key_prefix = $3, has_usage_access = $4, connected_at = NOW(), encrypted_api_key = $5`,
          [
            visitorId,
            req.accountId ?? null,
            keyPrefix,
            hasUsageAccess,
            encryptedAnthropicKey,
          ],
        );

        // Track Anthropic sync usage in Tanso
        trackBillingUsage(visitorId, "anthropic_sync", "anthropic_connected");

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

  // GET /integrations/anthropic/status - Check Anthropic connection status
  router.get(
    "/integrations/anthropic/status",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT api_key_prefix, has_usage_access, connected_at, last_synced_at
         FROM integrations WHERE account_id = $1 AND provider = 'anthropic'`,
          [req.accountId ?? null],
        );

        if (result.rows.length === 0) {
          return res.json({ connected: false, has_usage_access: false });
        }

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

  // POST /integrations/anthropic/disconnect - Disconnect Anthropic
  router.post(
    "/integrations/anthropic/disconnect",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        await pool.query(
          "DELETE FROM integrations WHERE account_id = $1 AND provider = $2",
          [req.accountId ?? null, "anthropic"],
        );
        res.json({ success: true });
      } catch (err) {
        console.error("Anthropic disconnect error:", err);
        res.status(500).json({ error: "Failed to disconnect" });
      }
    },
  );

  // =============================================================================
  // REFERRAL SYSTEM
  // =============================================================================

  // GET /referral/code - Get or create a referral code for the current user
  router.get(
    "/referral/code",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        // Check if user already has a code
        const existing = await pool.query(
          `SELECT code FROM referral_codes WHERE user_id = $1`,
          [visitorId],
        );
        if (existing.rows.length > 0) {
          return res.json({ code: existing.rows[0].code });
        }
        // Generate a unique code
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

  // POST /referral/record - Record that the current user was referred by a code
  router.post(
    "/referral/record",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { code } = req.body;
        if (!code || typeof code !== "string") {
          return res.status(400).json({ error: "Referral code is required" });
        }
        // Check if this user was already referred
        const existingReferral = await pool.query(
          `SELECT id FROM referrals WHERE referred_user_id = $1`,
          [visitorId],
        );
        if (existingReferral.rows.length > 0) {
          return res.json({ success: true, already_recorded: true });
        }
        // Look up the referral code
        const codeResult = await pool.query(
          `SELECT user_id FROM referral_codes WHERE code = $1`,
          [code],
        );
        if (codeResult.rows.length === 0) {
          return res.status(404).json({ error: "Invalid referral code" });
        }
        const referrerUserId = codeResult.rows[0].user_id;
        // Don't allow self-referral
        if (referrerUserId === visitorId) {
          return res
            .status(400)
            .json({ error: "Cannot use your own referral code" });
        }
        // Record the referral
        await pool.query(
          `INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code, status)
         VALUES ($1, $2, $3, 'pending')`,
          [referrerUserId, visitorId, code],
        );

        // Track referral usage in Tanso for both referrer and referred user
        trackBillingUsage(referrerUserId, "referrals", "referral_shared");

        res.json({ success: true });
      } catch (err) {
        console.error("Record referral error:", err);
        res.status(500).json({ error: "Failed to record referral" });
      }
    },
  );

  // GET /referral/stats - Get referral statistics for the current user
  router.get(
    "/referral/stats",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;

        // Get or create referral code
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

        // Count referrals by status
        const statsResult = await pool.query(
          `SELECT
           COUNT(*)::int AS total_referrals,
           COUNT(*) FILTER (WHERE status = 'converted')::int AS converted_referrals,
           COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_referrals
         FROM referrals WHERE referrer_user_id = $1`,
          [visitorId],
        );

        // Get promo codes earned from referrals
        const promosResult = await pool.query(
          `SELECT promo_code, used_at, created_at
         FROM referral_credits WHERE user_id = $1 ORDER BY created_at DESC`,
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

  // =============================================================================
  // STRIPE INTEGRATION
  // =============================================================================

  // POST /integrations/stripe/connect - Validate Stripe API key, store encrypted, trigger initial sync
  router.post(
    "/integrations/stripe/connect",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        if (!req.accountId) {
          return res.status(400).json({ error: "No account resolved" });
        }
        const { api_key } = req.body;

        if (!api_key || typeof api_key !== "string") {
          return res.status(400).json({ error: "api_key is required" });
        }

        // Validate key format
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

        // Validate key by calling Stripe
        let accountName = "";
        let accountId = "";
        const stripe = createStripeClientFromKey(api_key);
        try {
          const account = await stripe.accounts.retrieve();
          accountId = account.id;
          accountName =
            (account as any).business_profile?.name ||
            (account as any).display_name ||
            account.id;
        } catch {
          // Restricted keys can't call accounts.retrieve — fall back to
          // a lightweight customers.list to verify the key is valid.
          try {
            await stripe.customers.list({ limit: 1 });
            accountName = "Stripe Account";
          } catch {
            return res.status(400).json({
              success: false,
              message:
                "Invalid Stripe API key. Please check your key and try again.",
            });
          }
        }

        const keyPrefix = api_key.substring(0, 12) + "...";
        const encryptedKey = encryptApiKey(api_key);

        // Store the integration with encrypted key
        await pool.query(
          `INSERT INTO integrations (user_id, account_id, provider, api_key_prefix, has_usage_access, connected_at, encrypted_api_key, stripe_account_id, stripe_account_name)
         VALUES ($1, $2, 'stripe', $3, true, NOW(), $4, $5, $6)
         ON CONFLICT (account_id, provider)
         DO UPDATE SET api_key_prefix = $3, has_usage_access = true, connected_at = NOW(), encrypted_api_key = $4, stripe_account_id = $5, stripe_account_name = $6`,
          [
            visitorId,
            req.accountId ?? null,
            keyPrefix,
            encryptedKey,
            accountId,
            accountName,
          ],
        );

        // Trigger initial sync
        let syncResult = { customers: 0, subscriptions: 0, plans: 0 };
        try {
          syncResult = await syncStripeDataForUser(
            pool,
            visitorId,
            api_key,
            req.accountId,
          );
          await clearSampleData(pool, pool, visitorId, req.accountId);
          await pool.query(
            "INSERT INTO user_data_status (user_id, account_id, data_mode) VALUES ($1, $2, $3) ON CONFLICT (account_id) DO UPDATE SET data_mode = $3, updated_at = NOW()",
            [visitorId, req.accountId ?? null, "user"],
          );
          convertReferralIfPending(visitorId);
        } catch (syncErr) {
          console.error(
            "Initial Stripe sync error (connection succeeded):",
            syncErr,
          );
        }

        trackBillingUsage(visitorId, "stripe_sync", "stripe_connected");

        res.json({
          success: true,
          message: "Stripe connected successfully",
          account_name: accountName,
          account_id: accountId,
          synced: syncResult,
        });
      } catch (err) {
        console.error("Stripe connect error:", err);
        const detail = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: "Failed to connect Stripe", detail });
      }
    },
  );

  // GET /integrations/stripe/status - Check Stripe connection status
  router.get(
    "/integrations/stripe/status",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT api_key_prefix, has_usage_access, connected_at, last_synced_at, stripe_account_id, stripe_account_name
         FROM integrations WHERE account_id = $1 AND provider = 'stripe'`,
          [req.accountId ?? null],
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

  router.get(
    "/integrations/stripe/diagnostics",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const acct = req.accountId ?? null;
      if (!acct) {
        res.status(400).json({ error: "No account resolved" });
        return;
      }
      try {
        const [unresolved, missingRevenue, subsSummary, syncStatus, dupes] =
          await Promise.all([
            pool.query(
              `SELECT customer_id, name, email, created_at
               FROM customers
               WHERE account_id = $1 AND customer_id LIKE 'cus_%'
                 AND (name = customer_id OR name IS NULL)
               ORDER BY created_at DESC LIMIT 50`,
              [acct],
            ),
            pool.query(
              `SELECT COUNT(*)::int AS count, oe.customer_id, MAX(s.pricing_model) AS pricing_model
               FROM observe_events oe
               JOIN subscriptions s ON s.account_id = oe.account_id AND s.customer_id = oe.customer_id AND s.is_active = true
               WHERE oe.account_id = $1
                 AND oe.revenue_amount = 0
                 AND (oe.revenue_source = 'none' OR oe.revenue_source IS NULL)
                 AND oe.timestamp >= NOW() - INTERVAL '30 days'
               GROUP BY oe.customer_id
               ORDER BY count DESC LIMIT 20`,
              [acct],
            ),
            pool.query(
              `SELECT pricing_model, COUNT(*)::int AS count, COALESCE(SUM(mrr_override), 0) AS total_mrr
               FROM subscriptions
               WHERE account_id = $1 AND is_active = true
               GROUP BY pricing_model`,
              [acct],
            ),
            pool.query(
              `SELECT connected_at, last_synced_at,
                      EXTRACT(EPOCH FROM (NOW() - last_synced_at))::int AS seconds_since_sync
               FROM integrations
               WHERE account_id = $1 AND provider = 'stripe'`,
              [acct],
            ),
            pool.query(
              `SELECT customer_id, COUNT(*)::int AS row_count
               FROM customers
               WHERE account_id = $1
               GROUP BY customer_id
               HAVING COUNT(*) > 1
               LIMIT 20`,
              [acct],
            ),
          ]);
        res.json({
          unresolved_customers: unresolved.rows,
          events_missing_revenue: missingRevenue.rows,
          subscriptions_summary: subsSummary.rows,
          sync_status: syncStatus.rows[0] ?? null,
          customer_duplicates: dupes.rows,
        });
      } catch (err) {
        console.error("Stripe diagnostics error:", err);
        res.status(500).json({ error: "Failed to run diagnostics" });
      }
    },
  );

  // POST /integrations/stripe/sync - Re-sync Stripe data using stored key
  router.post(
    "/integrations/stripe/sync",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const syncResult = await syncStripeDataForUser(
          pool,
          visitorId,
          undefined,
          req.accountId,
        );

        // Update last_synced_at
        await pool.query(
          `UPDATE integrations SET last_synced_at = NOW() WHERE account_id = $1 AND provider = 'stripe'`,
          [req.accountId ?? null],
        );

        trackBillingUsage(visitorId, "stripe_sync", "stripe_data_synced");

        res.json({ success: true, synced: syncResult });
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes("No Stripe integration found")
        ) {
          res.status(400).json({
            error: "Stripe is not connected. Connect Stripe first.",
          });
          return;
        }
        console.error("Stripe sync error:", err);
        const detail = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: "Failed to sync Stripe data", detail });
      }
    },
  );

  // POST /integrations/stripe/disconnect - Disconnect Stripe
  router.post(
    "/integrations/stripe/disconnect",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { clear_data } = req.body;
        const acct = req.accountId ?? null;

        await pool.query(
          "DELETE FROM integrations WHERE account_id = $1 AND provider = $2",
          [acct, "stripe"],
        );

        if (clear_data) {
          await pool.query(
            "DELETE FROM observe_events WHERE account_id = $1 AND source = 'stripe'",
            [acct],
          );
          await pool.query("DELETE FROM subscriptions WHERE account_id = $1", [
            acct,
          ]);
          await pool.query("DELETE FROM customers WHERE account_id = $1", [
            acct,
          ]);
          await pool.query("DELETE FROM plans WHERE account_id = $1", [acct]);
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

  // Integration requests (notify me / request integration)
  router.post(
    "/integration-requests",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { integration_name, request_type } = req.body;
        if (!integration_name) {
          return res
            .status(400)
            .json({ error: "integration_name is required" });
        }
        await pool.query(
          `INSERT INTO integration_requests (user_id, integration_name, request_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id, integration_name) DO NOTHING`,
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

// Exported for use by data routes and other modules that call convertReferralIfPending
export function createConvertReferralIfPending(pool: Pool) {
  return async function convertReferralIfPending(
    visitorId: string,
  ): Promise<void> {
    try {
      // Find the pending referral where this user is the referred party
      const result = await pool.query(
        `UPDATE referrals SET status = 'converted', credited_at = NOW()
         WHERE referred_user_id = $1 AND status = 'pending'
         RETURNING id, referrer_user_id`,
        [visitorId],
      );
      if (result.rows.length === 0) return;

      const { id: referralId, referrer_user_id } = result.rows[0];

      // Create a Stripe promo code for 1 free month of Pro
      try {
        const stripe = await getUncachableStripeClient();

        // Create a one-time 100% off coupon for 1 month
        const coupon = await stripe.coupons.create({
          percent_off: 100,
          duration: "once",
          name: `Referral reward — 1 month free Pro`,
          metadata: { referral_id: String(referralId), referrer_user_id },
        });

        // Create a unique promo code from this coupon
        const promoCode = await stripe.promotionCodes.create({
          promotion: { coupon: coupon.id, type: "coupon" },
          max_redemptions: 1,
          metadata: { referral_id: String(referralId), referrer_user_id },
        });

        // Store the promo code for the referrer
        await pool.query(
          `INSERT INTO referral_credits (user_id, credit_type, amount, source_referral_id, promo_code, stripe_promo_id)
           VALUES ($1, 'promo_month', 1, $2, $3, $4)`,
          [referrer_user_id, referralId, promoCode.code, promoCode.id],
        );
      } catch (stripeErr) {
        console.error(
          "Failed to create Stripe promo code for referral:",
          stripeErr,
        );
        // Fallback: still record the credit without a promo code
        await pool.query(
          `INSERT INTO referral_credits (user_id, credit_type, amount, source_referral_id)
           VALUES ($1, 'promo_month', 1, $2)`,
          [referrer_user_id, referralId],
        );
      }
    } catch (err) {
      // Non-critical — don't fail the data load
      console.error("Referral conversion error:", err);
    }
  };
}
