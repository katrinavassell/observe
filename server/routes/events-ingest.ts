import { Router, Request, Response } from "express";
import type { Pool } from "pg";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { type AuthRequest } from "./auth.js";
import { encryptApiKey, decryptApiKey } from "../stripe-client.js";
import { calculateCostFromTokens } from "../model-pricing.js";
import { checkAlerts, checkCustomerAlerts } from "./alerts.js";
import { checkFeatureAccess } from "../billing.js";
import { inferModelProvider } from "../lib/models.js";
import { type SubMeta, enrichRevenueFromSub } from "../lib/enrich-revenue.js";
import {
  resolveStripeCustomerNames,
  coerceEventRow,
  sendUsageLimitEmail,
} from "./events-helpers.js";

type ComputeInferenceProfilesFn = (userId: string) => Promise<number>;

export function createEventsIngestRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    computeInferenceProfiles: ComputeInferenceProfilesFn;
    apiLimiter: ReturnType<typeof rateLimit>;
  },
) {
  const router = Router();

  // POST /sdk-keys — Generate a new SDK API key
  router.post(
    "/sdk-keys",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.accountEmail) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const userId = req.visitorId!;
        const rawName =
          typeof req.body?.name === "string" ? req.body.name.trim() : "";
        const name = rawName.length > 0 ? rawName.slice(0, 100) : "default";

        const rawKey = "obs_" + crypto.randomBytes(24).toString("hex");
        const keyHash = crypto
          .createHash("sha256")
          .update(rawKey)
          .digest("hex");
        const keyPrefix = rawKey.slice(0, 11);
        const encryptedKey = encryptApiKey(rawKey);

        // Auto-disambiguate the name if (user_id, name) already exists —
        // avoids leaking DB error messages back to the caller.
        if (!req.accountId) {
          return res.status(400).json({ error: "No account resolved" });
        }

        let finalName = name;
        for (let attempt = 0; attempt < 10; attempt++) {
          const candidate = attempt === 0 ? name : `${name}-${attempt + 1}`;
          const conflict = await pool.query(
            "SELECT 1 FROM sdk_api_keys WHERE account_id = $1 AND name = $2 AND revoked_at IS NULL",
            [req.accountId, candidate],
          );
          if (conflict.rows.length === 0) {
            finalName = candidate;
            break;
          }
        }

        await pool.query(
          "INSERT INTO sdk_api_keys (user_id, account_id, key_hash, key_prefix, encrypted_key, name) VALUES ($1, $2, $3, $4, $5, $6)",
          [
            userId,
            req.accountId ?? null,
            keyHash,
            keyPrefix,
            encryptedKey,
            finalName,
          ],
        );

        res.json({ key: rawKey, prefix: keyPrefix, name: finalName });
      } catch (error) {
        console.error("POST /sdk-keys error:", error);
        res.status(500).json({ error: "Failed to create API key" });
      }
    },
  );

  // GET /sdk-keys — List all active SDK API keys (never returns full key)
  router.get(
    "/sdk-keys",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.accountId) {
          return res.status(400).json({ error: "No account resolved" });
        }
        const result = await pool.query(
          "SELECT id, key_prefix, encrypted_key, name, created_at, last_used_at FROM sdk_api_keys WHERE account_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC",
          [req.accountId],
        );
        const keys = result.rows.map((row) => {
          let fullKey: string | null = null;
          if (row.encrypted_key) {
            try {
              fullKey = decryptApiKey(row.encrypted_key);
            } catch (err) {
              console.error(
                `Failed to decrypt sdk_api_keys.encrypted_key for id=${row.id}:`,
                err,
              );
            }
          }
          return {
            id: row.id,
            key_prefix: row.key_prefix,
            full_key: fullKey,
            name: row.name,
            created_at: row.created_at,
            last_used_at: row.last_used_at,
          };
        });
        res.json(keys);
      } catch (error) {
        console.error("GET /sdk-keys error:", error);
        res.status(500).json({ error: "Failed to list API keys" });
      }
    },
  );

  // POST /sdk-keys/:id/reset — Revoke old key and generate a new one with the same name
  router.post(
    "/sdk-keys/:id/reset",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.visitorId!;
        const keyId = parseInt(req.params.id, 10);
        if (isNaN(keyId)) {
          return res.status(400).json({ error: "Invalid key ID" });
        }

        // Get the old key's name
        if (!req.accountId) {
          return res.status(400).json({ error: "No account resolved" });
        }
        const old = await pool.query(
          "SELECT name FROM sdk_api_keys WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL",
          [keyId, req.accountId],
        );
        if (old.rows.length === 0) {
          return res.status(404).json({ error: "Key not found" });
        }
        const name = old.rows[0].name;

        // Revoke old key
        await pool.query(
          "UPDATE sdk_api_keys SET revoked_at = NOW() WHERE id = $1",
          [keyId],
        );

        // Generate new key (same name, unique constraint is partial on
        // revoked_at IS NULL so the just-soft-deleted row doesn't block).
        const rawKey = "obs_" + crypto.randomBytes(24).toString("hex");
        const keyHash = crypto
          .createHash("sha256")
          .update(rawKey)
          .digest("hex");
        const keyPrefix = rawKey.slice(0, 11);
        const encryptedKey = encryptApiKey(rawKey);

        const result = await pool.query(
          "INSERT INTO sdk_api_keys (user_id, account_id, key_hash, key_prefix, encrypted_key, name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
          [
            userId,
            req.accountId ?? null,
            keyHash,
            keyPrefix,
            encryptedKey,
            name,
          ],
        );

        res.json({
          id: result.rows[0].id,
          key: rawKey,
          prefix: keyPrefix,
          name,
        });
      } catch (error) {
        console.error("POST /sdk-keys/:id/reset error:", error);
        res.status(500).json({ error: "Failed to reset API key" });
      }
    },
  );

  // DELETE /sdk-keys/:id — Revoke an SDK API key (soft delete)
  router.delete(
    "/sdk-keys/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const keyId = parseInt(req.params.id, 10);
        if (isNaN(keyId)) {
          return res.status(400).json({ error: "Invalid key ID" });
        }

        if (!req.accountId) {
          return res.status(400).json({ error: "No account resolved" });
        }

        const activeCount = await pool.query(
          "SELECT COUNT(*)::int AS cnt FROM sdk_api_keys WHERE account_id = $1 AND revoked_at IS NULL",
          [req.accountId],
        );

        if (activeCount.rows[0].cnt <= 1) {
          return res.status(400).json({
            error: "Cannot delete your only API key — rotate it instead",
          });
        }

        const result = await pool.query(
          "UPDATE sdk_api_keys SET revoked_at = NOW() WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL",
          [keyId, req.accountId],
        );

        if (result.rowCount === 0) {
          return res.status(404).json({ error: "Key not found" });
        }

        res.json({ success: true });
      } catch (error) {
        console.error("DELETE /sdk-keys/:id error:", error);
        res.status(500).json({ error: "Failed to revoke API key" });
      }
    },
  );

  // POST /events/ingest — SDK batch event ingestion
  router.post(
    "/events/ingest",
    deps.apiLimiter,
    async (req: Request, res: Response) => {
      try {
        let userId: string | null = null;

        // Auth: Bearer token first, then session fallback
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          const token = authHeader.slice(7).trim();
          if (token) {
            const keyHash = crypto
              .createHash("sha256")
              .update(token)
              .digest("hex");
            const keyResult = await pool.query(
              "SELECT user_id, account_id FROM sdk_api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
              [keyHash],
            );
            if (keyResult.rows.length > 0) {
              userId = keyResult.rows[0].user_id;
              if (keyResult.rows[0].account_id != null) {
                (req as AuthRequest).accountId = keyResult.rows[0].account_id;
              }
              // Update last_used_at
              pool
                .query(
                  "UPDATE sdk_api_keys SET last_used_at = NOW() WHERE key_hash = $1",
                  [keyHash],
                )
                .catch((err) =>
                  console.error(
                    "Failed to update sdk_api_keys last_used_at:",
                    err,
                  ),
                );
            } else {
              // Bearer token provided but invalid — don't fall through to session
              return res.status(401).json({
                error: "Invalid API key. Check your Bearer token.",
              });
            }
          }
        }

        // Fallback to session-based auth (only when no Bearer token provided)
        if (!userId) {
          const authReq = req as AuthRequest;
          if (authReq.session?.visitorId) {
            userId = authReq.session.visitorId;
          }
        }

        if (!userId) {
          return res.status(401).json({
            error:
              "Authentication required. Provide a Bearer token or use a session.",
          });
        }

        // Resolve account_id for this ingest request. Bearer auth doesn't run
        // ensureVisitor so req.accountId isn't set; look up the owner account
        // for this visitor. Used for all data-table SELECTs below.
        let accountId: number | null = (req as AuthRequest).accountId ?? null;
        if (accountId == null) {
          const acctResult = await pool.query(
            `SELECT account_id FROM user_accounts
             WHERE user_id = (SELECT id FROM users WHERE visitor_id = $1)
               AND role = 'owner'
             LIMIT 1`,
            [userId],
          );
          if (acctResult.rows.length > 0) {
            accountId = acctResult.rows[0].account_id;
          }
        }

        if (accountId == null) {
          return res.status(500).json({
            error:
              "Could not resolve account for this API key. Regenerate the key from Data Sources.",
          });
        }

        const { events } = req.body;
        if (!Array.isArray(events) || events.length === 0) {
          return res.status(400).json({
            error: 'Request body must contain a non-empty "events" array.',
          });
        }
        if (events.length > 1000) {
          return res
            .status(400)
            .json({ error: "Batch size exceeds maximum of 1000 events." });
        }

        // Check event ingest limit for free plans
        const ingestAccess = await checkFeatureAccess(
          pool,
          userId,
          "event_ingest",
          undefined,
          (req as AuthRequest).accountId,
        );
        if (!ingestAccess.allowed) {
          return res.status(429).json({
            error:
              ingestAccess.reason ||
              "Monthly event limit reached. Upgrade your plan to continue.",
            usage: ingestAccess.usage,
            limit: ingestAccess.limit,
            upgrade_url: "/plans",
          });
        }

        const errors: Array<{ index: number; error: string }> = [];
        const validEvents: Array<{
          eventName: string;
          customerReferenceId: string;
          featureKey: string;
          timestamp?: string;
          costAmount?: number;
          costUnit?: string;
          revenueAmount?: number;
          usageUnits?: number;
          model?: string;
          modelProvider?: string;
          inputTokens?: number;
          outputTokens?: number;
          properties?: Record<string, unknown>;
          meta?: Record<string, string>;
          requestBody?: unknown;
          responseBody?: unknown;
          idempotencyKey?: string;
          traceId?: string;
          spanId?: string;
          parentSpanId?: string;
          durationMs?: number;
          costType?: string;
        }> = [];

        const stripNulls = (s: unknown) =>
          typeof s === "string" ? s.replace(/\0/g, "") : s;

        for (let i = 0; i < events.length; i++) {
          const evt = events[i];
          // Strip null bytes from string fields to prevent PostgreSQL errors
          if (typeof evt.eventName === "string")
            evt.eventName = stripNulls(evt.eventName) as string;
          if (typeof evt.customerReferenceId === "string")
            evt.customerReferenceId = stripNulls(
              evt.customerReferenceId,
            ) as string;
          if (typeof evt.featureKey === "string")
            evt.featureKey = stripNulls(evt.featureKey) as string;
          if (typeof evt.model === "string")
            evt.model = stripNulls(evt.model) as string;

          const missing: string[] = [];
          if (!evt.eventName) missing.push("eventName");
          if (!evt.customerReferenceId) missing.push("customerReferenceId");
          if (!evt.featureKey) missing.push("featureKey");
          if (missing.length > 0) {
            errors.push({
              index: i,
              error: `Missing required fields: ${missing.join(", ")}`,
            });
            continue;
          }
          validEvents.push(evt);
        }

        if (validEvents.length === 0) {
          return res.json({ accepted: 0, rejected: errors.length, errors });
        }

        // Load feature pricing rules for this user
        const featurePricingMap = new Map<string, number>();
        if (accountId != null) {
          try {
            const fpResult = await pool.query(
              `SELECT feature_key, revenue_per_unit FROM feature_pricing WHERE account_id = $1`,
              [accountId],
            );
            for (const row of fpResult.rows) {
              featurePricingMap.set(
                row.feature_key,
                parseFloat(row.revenue_per_unit),
              );
            }
          } catch (err) {
            console.error("Feature pricing lookup failed:", err);
          }
        }

        // Auto-enrich revenue from Stripe subscriptions.
        // Build bridge: app_customer_id -> stripe_customer_id
        // Sources: stripe_customers table (authoritative), event meta (inline), cus_* prefix (direct)
        const appToStripe = new Map<string, string>();
        if (accountId != null) {
          try {
            const bridgeResult = await pool.query(
              `SELECT stripe_customer_id, customer_id FROM stripe_customers
               WHERE account_id = $1 AND customer_id IS NOT NULL`,
              [accountId],
            );
            for (const row of bridgeResult.rows) {
              appToStripe.set(row.customer_id, row.stripe_customer_id);
            }
          } catch (err: any) {
            if (err?.code !== "42P01") {
              console.error("stripe_customers lookup failed:", err);
            }
          }
        }
        for (const evt of validEvents) {
          const cid = evt.customerReferenceId;
          if (!appToStripe.has(cid)) {
            if (cid.startsWith("cus_")) {
              appToStripe.set(cid, cid);
            } else if (evt.meta?.stripe_customer_id) {
              appToStripe.set(cid, evt.meta.stripe_customer_id);
            }
          }
        }

        const stripeIdsToLookup = [...new Set(appToStripe.values())];
        const subByStripeId = new Map<string, SubMeta>();
        if (stripeIdsToLookup.length > 0 && accountId != null) {
          try {
            const subResult = await pool.query(
              `SELECT s.customer_id,
                      SUM(COALESCE(s.mrr_override, 0)) AS mrr,
                      MAX(s.pricing_model) AS pricing_model,
                      MAX(CASE WHEN s.pricing_model = 'tiered' OR s.pricing_model = 'hybrid'
                               THEN s.pricing_tiers::text END) AS pricing_tiers,
                      MAX(s.unit_price) AS unit_price
               FROM subscriptions s
               WHERE s.account_id = $1 AND s.is_active = true AND s.customer_id = ANY($2)
               GROUP BY s.customer_id`,
              [accountId, stripeIdsToLookup],
            );
            for (const row of subResult.rows) {
              subByStripeId.set(row.customer_id, {
                mrr: parseFloat(row.mrr) || 0,
                pricingModel: row.pricing_model,
                pricingTiers: row.pricing_tiers
                  ? JSON.parse(row.pricing_tiers)
                  : null,
                unitPrice:
                  row.unit_price != null ? parseFloat(row.unit_price) : null,
              });
            }
          } catch (err) {
            throw new Error(`Subscription enrichment lookup failed: ${err}`);
          }
        }

        // Tiered-pricing: month-to-date usage per customer. Events use app IDs
        // so query by app IDs, then map results to Stripe IDs for tier lookup.
        const tieredAppIds: string[] = [];
        for (const [appId, stripeId] of appToStripe) {
          const sub = subByStripeId.get(stripeId);
          if (
            sub &&
            (sub.pricingModel === "tiered" || sub.pricingModel === "hybrid")
          ) {
            tieredAppIds.push(appId);
          }
        }
        const mtdUsageByStripeId = new Map<string, number>();
        if (tieredAppIds.length > 0 && accountId != null) {
          try {
            const usageResult = await pool.query(
              `SELECT customer_id, COALESCE(SUM(usage_units), 0) AS usage
               FROM observe_events
               WHERE account_id = $1
                 AND customer_id = ANY($2)
                 AND timestamp >= date_trunc('month', NOW())
               GROUP BY customer_id`,
              [accountId, tieredAppIds],
            );
            for (const row of usageResult.rows) {
              const stripeId = appToStripe.get(row.customer_id);
              if (stripeId) {
                mtdUsageByStripeId.set(
                  stripeId,
                  (mtdUsageByStripeId.get(stripeId) ?? 0) +
                    parseFloat(row.usage),
                );
              }
            }
          } catch (err) {
            console.error("Tiered MTD usage lookup failed:", err);
          }
        }

        // Build batch insert
        const values: unknown[] = [];
        const placeholders: string[] = [];
        let paramIdx = 1;

        for (const evt of validEvents) {
          const provider = evt.modelProvider || inferModelProvider(evt.model);
          const ts = evt.timestamp || new Date().toISOString();

          // Auto-calculate cost from model + tokens if costAmount not provided
          const cost =
            evt.costAmount ??
            (await calculateCostFromTokens(
              pool,
              evt.model,
              evt.inputTokens,
              evt.outputTokens,
            ));

          const isInternal = evt.customerReferenceId.startsWith("_internal");

          let revenue = 0;
          let revenueSource = "none";
          if (isInternal) {
            // Internal spend has no customer revenue
          } else if (evt.revenueAmount != null) {
            revenue = evt.revenueAmount;
            revenueSource = "explicit";
          } else if (featurePricingMap.has(evt.featureKey)) {
            revenue = featurePricingMap.get(evt.featureKey)!;
            revenueSource = "feature_pricing";
          } else {
            const stripeId = appToStripe.get(evt.customerReferenceId);
            const subMeta = stripeId ? subByStripeId.get(stripeId) : null;
            if (subMeta) {
              const evtUsage =
                evt.usageUnits ??
                (evt.inputTokens || 0) + (evt.outputTokens || 0);
              const mtd = mtdUsageByStripeId.get(stripeId!) ?? 0;
              const enriched = enrichRevenueFromSub(subMeta, evtUsage, mtd);
              revenue = enriched.revenue;
              revenueSource = enriched.revenueSource;
            }
          }

          // Only mark tokens_source='direct' when the SDK actually provided
          // the split — otherwise leave NULL so the backfill job can fill it.
          const tokensSource =
            evt.inputTokens != null || evt.outputTokens != null
              ? "direct"
              : null;

          placeholders.push(
            `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, 'sdk', 'event', false, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}::jsonb)`,
          );
          values.push(
            userId,
            req.accountId ?? null,
            evt.customerReferenceId,
            evt.featureKey,
            evt.eventName,
            ts,
            cost,
            evt.costUnit ?? "usd",
            revenue,
            evt.usageUnits ?? (evt.inputTokens || 0) + (evt.outputTokens || 0),
            evt.model ?? null,
            provider,
            evt.idempotencyKey ?? null,
            revenueSource,
            evt.traceId ?? null,
            evt.spanId ?? null,
            evt.parentSpanId ?? null,
            evt.durationMs ?? null,
            evt.costType ?? (evt.model ? "llm" : "generic"),
            evt.inputTokens ?? null,
            evt.outputTokens ?? null,
            tokensSource,
            evt.requestBody != null
              ? typeof evt.requestBody === "string"
                ? evt.requestBody
                : JSON.stringify(evt.requestBody)
              : null,
            evt.responseBody != null
              ? typeof evt.responseBody === "string"
                ? evt.responseBody
                : JSON.stringify(evt.responseBody)
              : null,
            evt.meta ? JSON.stringify(evt.meta) : null,
          );
        }

        const insertQuery = `
        INSERT INTO observe_events (
          user_id, account_id, customer_id, feature_key, event_name, timestamp,
          cost_amount, cost_unit, revenue_amount, usage_units,
          model, model_provider, source, granularity, is_inferred, idempotency_key, revenue_source,
          trace_id, span_id, parent_span_id, duration_ms, cost_type,
          input_tokens, output_tokens, tokens_source,
          request_body, response_body, meta
        ) VALUES ${placeholders.join(", ")}
        ON CONFLICT (account_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      `;

        // Activation-funnel instrumentation: note whether the user had any
        // non-sample SDK events BEFORE this batch. If they didn't, and this
        // batch lands a row, we'll fire the first_event_ingested milestone.
        // Checked pre-insert so the "first ever" flag is race-free. If we
        // couldn't resolve an account_id, default to false rather than firing
        // an activation event we can't verify.
        let wasPreviouslyEmpty = false;
        if (accountId != null) {
          const priorEventCheck = await pool.query(
            `SELECT 1 FROM observe_events
             WHERE account_id = $1 AND source = 'sdk'
             LIMIT 1`,
            [accountId],
          );
          wasPreviouslyEmpty = priorEventCheck.rows.length === 0;
        }

        const result = await pool.query(insertQuery, values);
        const inserted = result.rowCount ?? 0;
        const deduped = validEvents.length - inserted;

        res.json({
          accepted: inserted,
          rejected: errors.length + deduped,
          errors,
        });

        // Auto-create feature_definitions for any new featureKeys in this
        // batch. Users can rename later — kind defaults to 'outcome' because
        // the DB column is NOT NULL and we've removed it from the UI.
        if (inserted > 0) {
          const uniqueFeatureKeys = [
            ...new Set(
              validEvents
                .map((e) => e.featureKey)
                .filter((fk): fk is string => typeof fk === "string" && !!fk),
            ),
          ];
          if (uniqueFeatureKeys.length > 0) {
            const fdPlaceholders: string[] = [];
            const fdValues: unknown[] = [];
            let fdIdx = 1;
            const acctId = accountId;
            for (const fk of uniqueFeatureKeys) {
              fdPlaceholders.push(
                `($${fdIdx}, $${fdIdx + 1}, $${fdIdx + 2}, $${fdIdx + 3}, 'outcome')`,
              );
              fdValues.push(userId, acctId, fk, fk);
              fdIdx += 4;
            }
            pool
              .query(
                `INSERT INTO feature_definitions (user_id, account_id, feature_key, name, kind)
                 VALUES ${fdPlaceholders.join(", ")}
                 ON CONFLICT (account_id, feature_key) DO NOTHING`,
                fdValues,
              )
              .catch((err) =>
                console.error("Auto-create feature_definitions failed:", err),
              );
          }
        }

        // Auto-create customer records for new customers in this batch
        if (inserted > 0 && accountId != null) {
          const customerMetaMap = new Map<string, string | null>();
          for (const evt of validEvents) {
            const cid = (evt as { customerReferenceId?: string })
              .customerReferenceId;
            if (!cid) continue;
            const stripeId = (evt as { meta?: { stripe_customer_id?: string } })
              .meta?.stripe_customer_id;
            if (stripeId && !customerMetaMap.get(cid)) {
              customerMetaMap.set(cid, stripeId);
            } else if (!customerMetaMap.has(cid)) {
              customerMetaMap.set(cid, null);
            }
          }
          if (customerMetaMap.size > 0) {
            const custPlaceholders: string[] = [];
            const custValues: unknown[] = [];
            let custIdx = 1;
            for (const [cid] of customerMetaMap) {
              const internal = cid.startsWith("_internal");
              custPlaceholders.push(
                `($${custIdx}, $${custIdx + 1}, $${custIdx + 2}, $${custIdx + 3})`,
              );
              custValues.push(accountId, cid, cid, internal);
              custIdx += 4;
            }
            pool
              .query(
                `INSERT INTO customers (account_id, customer_id, name, is_internal)
                 VALUES ${custPlaceholders.join(", ")}
                 ON CONFLICT (account_id, customer_id) DO UPDATE SET is_internal = EXCLUDED.is_internal OR customers.is_internal`,
                custValues,
              )
              .catch((err) =>
                console.error("Auto-create customers failed:", err),
              );

            // Link to stripe_customers where meta.stripe_customer_id was provided
            for (const [cid, stripeId] of customerMetaMap) {
              if (!stripeId) continue;
              pool
                .query(
                  `INSERT INTO stripe_customers (account_id, stripe_customer_id, customer_id)
                   VALUES ($1, $2, $3)
                   ON CONFLICT (account_id, stripe_customer_id)
                   DO UPDATE SET customer_id = COALESCE(stripe_customers.customer_id, $3)`,
                  [accountId, stripeId, cid],
                )
                .catch((err) =>
                  console.error("Auto-link stripe_customers failed:", err),
                );
            }
          }
        }

        // Auto-trigger inference profile learning in the background (fire-and-forget)
        if (inserted > 0) {
          // First-ever SDK event for this user — fire the activation milestone.
          // Stamp the DB column AND fire a PostHog capture so the funnel is
          // visible in both SQL and the PostHog funnel UI.
          if (wasPreviouslyEmpty) {
            const updateResult = await pool
              .query(
                `UPDATE users
                 SET first_sdk_event_at = NOW()
                 WHERE visitor_id = $1 AND first_sdk_event_at IS NULL
                 RETURNING id, email`,
                [userId],
              )
              .catch((err) => {
                console.error("Failed to stamp first_sdk_event_at:", err);
                return null;
              });
            if (
              updateResult &&
              updateResult.rowCount &&
              updateResult.rowCount > 0
            ) {
              const accountEmail = updateResult.rows[0]?.email;
              // Fire-and-forget — don't let telemetry block the ingest response.
              fetch("https://us.i.posthog.com/capture/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  api_key: "phc_o2WbwFatBrXLtocKFKLRHUWkqbuiCmTnVDTiTbKPT7rS",
                  event: "first_event_ingested",
                  distinct_id: accountEmail || userId,
                  properties: {
                    $process_person_profile: true,
                    source: "sdk",
                    batch_size: inserted,
                  },
                  timestamp: new Date().toISOString(),
                }),
              }).catch((err) =>
                console.error(
                  "PostHog first_event_ingested capture failed:",
                  err,
                ),
              );
            }
          }

          deps
            .computeInferenceProfiles(userId)
            .catch((err) =>
              console.error("Auto inference profile update failed:", err),
            );
          // Check alert thresholds
          checkAlerts(pool, userId, accountId).catch((err) =>
            console.error("checkAlerts error (ingest):", err),
          );
          // Check per-customer alerts for each unique customer in this batch
          const alertCustomerIds = [
            ...new Set(
              validEvents
                .filter(
                  (e: { customerReferenceId?: string }) =>
                    e.customerReferenceId,
                )
                .map(
                  (e: { customerReferenceId: string }) => e.customerReferenceId,
                ),
            ),
          ];
          for (const cid of alertCustomerIds) {
            checkCustomerAlerts(pool, userId, cid, accountId).catch((err) =>
              console.error("checkCustomerAlerts error (ingest):", err),
            );
          }
          // Resolve Stripe customer names — map each customer_id to
          // the Stripe ID to look up (either the ID itself if cus_*, or
          // meta.stripe_customer_id if provided)
          const customerStripeMap = new Map<string, string>();
          for (const evt of validEvents) {
            const cid = (evt as { customerReferenceId?: string })
              .customerReferenceId;
            if (!cid) continue;
            if (cid.startsWith("cus_")) {
              customerStripeMap.set(cid, cid);
            }
            const metaStripeId = (
              evt as { meta?: { stripe_customer_id?: string } }
            ).meta?.stripe_customer_id;
            if (metaStripeId) {
              customerStripeMap.set(cid, metaStripeId);
            }
          }
          resolveStripeCustomerNames(
            pool,
            userId!,
            accountId,
            customerStripeMap,
          ).catch((err) =>
            console.error("resolveStripeCustomerNames error (ingest):", err),
          );
          // Check usage limit and send warning emails
          if (ingestAccess.limit != null && ingestAccess.usage != null) {
            const newUsage = ingestAccess.usage + inserted;
            const pct = newUsage / ingestAccess.limit;
            if (pct >= 1) {
              sendUsageLimitEmail(
                pool,
                userId,
                100,
                newUsage,
                ingestAccess.limit,
              ).catch((err) => console.error("Usage limit email error:", err));
            } else if (pct >= 0.8) {
              sendUsageLimitEmail(
                pool,
                userId,
                80,
                newUsage,
                ingestAccess.limit,
              ).catch((err) => console.error("Usage limit email error:", err));
            }
          }
        }
      } catch (error) {
        console.error("POST /events/ingest error:", error);
        res.status(500).json({ error: "Failed to ingest events" });
      }
    },
  );

  // POST /events/test — internal "Send test event" button from the dashboard.
  // Uses the Supabase session (ensureVisitor) — no SDK key needed. Writes a
  // single event with hardcoded test values for the requested feature_key.
  router.post(
    "/events/test",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.visitorId!;
        const featureKey =
          typeof req.body?.featureKey === "string"
            ? req.body.featureKey.trim()
            : "";
        if (!featureKey) {
          return res.status(400).json({ error: "featureKey is required" });
        }

        const model = "gpt-4o";
        const inputTokens = 1000;
        const outputTokens = 500;
        const cost = await calculateCostFromTokens(
          pool,
          model,
          inputTokens,
          outputTokens,
          userId,
        );

        const requestBody = JSON.stringify({
          messages: [
            {
              role: "system",
              content: `You are a helpful assistant for the "${featureKey}" feature.`,
            },
            {
              role: "user",
              content:
                "Summarize the key metrics from last week's usage report.",
            },
          ],
        });
        const responseBody = JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content:
                  "Last week's usage highlights:\n\n1. **Total requests**: 12,847 (+18% WoW)\n2. **Avg latency**: 340ms (down from 380ms)\n3. **Top model**: gpt-4o (62% of calls)\n4. **Cost**: $47.20 (within budget)\n\nNotable: Cache hit rate improved to 34%, saving ~$16 in redundant calls.",
              },
            },
          ],
        });

        const insertResult = await pool.query(
          `INSERT INTO observe_events (
             user_id, account_id, customer_id, feature_key, event_name, timestamp,
             cost_amount, cost_unit, revenue_amount, usage_units,
             model, model_provider, source, granularity, is_inferred,
             idempotency_key, revenue_source, duration_ms, cost_type,
             input_tokens, output_tokens, tokens_source,
             request_body, response_body
           ) VALUES (
             $1, $2, 'test_customer', $3, 'test_event', NOW(),
             $4, 'usd', 0, $5,
             $6, 'openai', 'sdk', 'event', false,
             $7, 'none', 500, 'llm',
             $8, $9, 'direct',
             $10::jsonb, $11::jsonb
           )
           ON CONFLICT (account_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
           RETURNING *`,
          [
            userId,
            req.accountId ?? null,
            featureKey,
            cost,
            inputTokens + outputTokens,
            model,
            `test-${Date.now()}`,
            inputTokens,
            outputTokens,
            requestBody,
            responseBody,
          ],
        );

        if (insertResult.rowCount === 0) {
          return res
            .status(409)
            .json({ error: "Duplicate test event — try again" });
        }

        res.json(coerceEventRow(insertResult.rows[0]));
      } catch (error) {
        console.error("POST /events/test error:", error);
        res.status(500).json({ error: "Failed to send test event" });
      }
    },
  );

  return router;
}
