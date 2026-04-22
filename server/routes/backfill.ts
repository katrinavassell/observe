import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";
import { decryptApiKey } from "../stripe-client.js";
import { getStripeClientForUser } from "../stripe-client.js";
import { enrichRevenueFromSub, type SubMeta } from "../lib/enrich-revenue.js";

// Retention windows: OpenAI exposes ~30d of usage, Anthropic ~90d.
// Rows older than this get counted under rows_out_of_retention.
const RETENTION_DAYS: Record<"openai" | "anthropic", number> = {
  openai: 30,
  anthropic: 90,
};

// ±5% tolerance — if our summed usage_units diverges from the provider's
// reported (input + output) total by more than this, we assume the bucket
// doesn't correspond to the same set of events and skip it.
const TOLERANCE = 0.05;

// UPDATE batch size — keeps each transaction short.
const BATCH_SIZE = 50;

interface BackfillSummary {
  buckets_processed: number;
  rows_updated: number;
  rows_skipped_no_data: number;
  rows_out_of_retention: number;
}

// OpenAI: snapshot_id can be a dated snapshot ("gpt-4o-2024-08-06") while
// observe_events.model sometimes holds the base name ("gpt-4o"). Normalize
// so we match both shapes.
function modelMatches(providerModel: string, eventModel: string): boolean {
  if (providerModel === eventModel) return true;
  if (providerModel.startsWith(eventModel + "-")) return true;
  if (eventModel.startsWith(providerModel + "-")) return true;
  return false;
}

interface ProviderBucket {
  date: string; // YYYY-MM-DD (UTC)
  model: string;
  inputTokens: number;
  outputTokens: number;
}

async function fetchOpenAIUsage(apiKey: string): Promise<ProviderBucket[]> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - RETENTION_DAYS.openai * 24 * 60 * 60;
  const resp = await fetch(
    `https://api.openai.com/v1/organization/usage/completions?start_time=${windowStart}&end_time=${now}&bucket_width=1d`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!resp.ok) {
    throw new Error(
      `OpenAI usage API returned ${resp.status}: ${await resp.text()}`,
    );
  }
  const data = (await resp.json()) as {
    data?: Array<{
      start_time?: number;
      results?: Array<{
        snapshot_id?: string;
        input_tokens?: number;
        output_tokens?: number;
      }>;
    }>;
  };
  const buckets: ProviderBucket[] = [];
  for (const bucket of data.data ?? []) {
    if (!bucket.start_time || !bucket.results) continue;
    const date = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
    for (const r of bucket.results) {
      if (!r.snapshot_id) continue;
      buckets.push({
        date,
        model: r.snapshot_id,
        inputTokens: r.input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
      });
    }
  }
  return buckets;
}

async function fetchAnthropicUsage(apiKey: string): Promise<ProviderBucket[]> {
  const today = new Date();
  const startWindow = new Date(
    today.getTime() - RETENTION_DAYS.anthropic * 24 * 60 * 60 * 1000,
  );
  const todayISO = today.toISOString().slice(0, 10);
  const startISO = startWindow.toISOString().slice(0, 10);
  const resp = await fetch(
    `https://api.anthropic.com/v1/organizations/usage?start_date=${startISO}&end_date=${todayISO}`,
    {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    },
  );
  if (!resp.ok) {
    throw new Error(
      `Anthropic usage API returned ${resp.status}: ${await resp.text()}`,
    );
  }
  const data = (await resp.json()) as {
    data?: Array<{
      model?: string;
      input_tokens?: number;
      output_tokens?: number;
      date?: string;
    }>;
  };
  const buckets: ProviderBucket[] = [];
  for (const entry of data.data ?? []) {
    if (!entry.model || !entry.date) continue;
    buckets.push({
      date: entry.date.slice(0, 10),
      model: entry.model,
      inputTokens: entry.input_tokens ?? 0,
      outputTokens: entry.output_tokens ?? 0,
    });
  }
  return buckets;
}

export function createBackfillRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  router.post(
    "/backfill/tokens",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const provider = req.body?.provider as "openai" | "anthropic" | undefined;

      if (provider !== "openai" && provider !== "anthropic") {
        return res
          .status(400)
          .json({ error: "provider must be 'openai' or 'anthropic'" });
      }

      // Look up the encrypted key from the user's integration row.
      const acct = req.accountId ?? null;
      const integResult = await pool.query(
        `SELECT encrypted_api_key FROM integrations
         WHERE account_id = $1 AND provider = $2`,
        [acct, provider],
      );
      if (integResult.rows.length === 0) {
        return res
          .status(400)
          .json({ error: `${provider} is not connected for this account` });
      }
      const encrypted = integResult.rows[0].encrypted_api_key;
      if (!encrypted) {
        return res.status(400).json({
          error: `Please reconnect your ${provider} integration to enable backfill (the stored key predates this feature).`,
        });
      }
      const apiKey = decryptApiKey(encrypted);

      // Count rows that fall outside the provider's retention window up-front —
      // these will never be backfillable so we report them separately.
      const retentionDays = RETENTION_DAYS[provider];
      const oorResult = await pool.query(
        `SELECT COUNT(*)::int AS n FROM observe_events
         WHERE account_id = $1
           AND model_provider = $2
           AND tokens_source IS NULL
           AND timestamp < NOW() - ($3 || ' days')::interval`,
        [acct, provider, retentionDays],
      );
      const rowsOutOfRetention: number = oorResult.rows[0]?.n ?? 0;

      // Fetch provider aggregates for the retention window.
      let providerBuckets: ProviderBucket[];
      try {
        providerBuckets =
          provider === "openai"
            ? await fetchOpenAIUsage(apiKey)
            : await fetchAnthropicUsage(apiKey);
      } catch (err) {
        console.error(`Backfill: ${provider} usage fetch failed:`, err);
        return res.status(502).json({
          error: `Failed to fetch ${provider} usage. Check that your API key has org-admin access.`,
        });
      }

      // Pull all candidate rows (NULL tokens_source, matching provider, inside
      // retention). Grouped into (date UTC, model) buckets in JS so we can
      // allocate proportionally by usage_units share.
      const rowsResult = await pool.query(
        `SELECT id,
                model,
                usage_units,
                (timestamp AT TIME ZONE 'UTC')::date::text AS day
         FROM observe_events
         WHERE account_id = $1
           AND model_provider = $2
           AND tokens_source IS NULL
           AND model IS NOT NULL
           AND timestamp >= NOW() - ($3 || ' days')::interval`,
        [acct, provider, retentionDays],
      );

      interface CandidateRow {
        id: number;
        model: string;
        usageUnits: number;
      }
      const rowsByBucket = new Map<string, CandidateRow[]>();
      for (const row of rowsResult.rows) {
        const key = `${row.day}::${row.model}`;
        const usageUnits =
          row.usage_units != null ? parseFloat(row.usage_units) : 0;
        const list = rowsByBucket.get(key) ?? [];
        list.push({ id: row.id, model: row.model, usageUnits });
        rowsByBucket.set(key, list);
      }

      let bucketsProcessed = 0;
      let rowsUpdated = 0;
      let rowsSkippedNoData = 0;

      // Walk each (date, model) bucket. Find the matching provider entry,
      // then allocate tokens proportional to each row's usage_units share.
      for (const [bucketKey, rows] of rowsByBucket) {
        bucketsProcessed++;
        const [day, eventModel] = bucketKey.split("::");

        // Find the provider bucket matching this day + model (with normalization).
        const providerEntry = providerBuckets.find(
          (b) => b.date === day && modelMatches(b.model, eventModel),
        );

        if (!providerEntry) {
          rowsSkippedNoData += rows.length;
          continue;
        }

        const providerTotal =
          providerEntry.inputTokens + providerEntry.outputTokens;
        if (providerTotal === 0) {
          rowsSkippedNoData += rows.length;
          continue;
        }

        const ourUsageSum = rows.reduce((s, r) => s + r.usageUnits, 0);
        if (ourUsageSum === 0) {
          rowsSkippedNoData += rows.length;
          continue;
        }

        // Tolerance check — our summed usage_units should be within ±5% of
        // the provider's (input + output) total. Otherwise the bucket
        // probably doesn't line up (missing events, double-counted, etc.).
        const drift = Math.abs(ourUsageSum - providerTotal) / providerTotal;
        if (drift > TOLERANCE) {
          console.warn(
            `Backfill: ${provider} bucket ${day}/${eventModel} skipped — ` +
              `ours=${ourUsageSum} provider=${providerTotal} drift=${(
                drift * 100
              ).toFixed(1)}%`,
          );
          rowsSkippedNoData += rows.length;
          continue;
        }

        // Allocate input/output tokens to each row proportionally.
        const assignments: Array<{ id: number; inp: number; out: number }> = [];
        for (const row of rows) {
          const share = row.usageUnits / ourUsageSum;
          const inp = Math.round(providerEntry.inputTokens * share);
          const out = Math.round(providerEntry.outputTokens * share);
          assignments.push({ id: row.id, inp, out });
        }

        // Batch the UPDATEs (50 rows per statement). The
        // `tokens_source IS NULL` guard keeps this idempotent even under
        // concurrent re-runs — previously-filled rows are never touched.
        for (let i = 0; i < assignments.length; i += BATCH_SIZE) {
          const chunk = assignments.slice(i, i + BATCH_SIZE);
          const valueTuples: string[] = [];
          const params: (number | string)[] = [];
          let p = 1;
          for (const a of chunk) {
            valueTuples.push(`($${p++}::int, $${p++}::int, $${p++}::int)`);
            params.push(a.id, a.inp, a.out);
          }
          const sql = `
            UPDATE observe_events AS e
               SET input_tokens = v.inp,
                   output_tokens = v.out,
                   tokens_source = 'estimated'
              FROM (VALUES ${valueTuples.join(", ")}) AS v(id, inp, out)
             WHERE e.id = v.id
               AND e.tokens_source IS NULL
          `;
          const updateResult = await pool.query(sql, params);
          rowsUpdated += updateResult.rowCount ?? 0;
        }
      }

      const summary: BackfillSummary = {
        buckets_processed: bucketsProcessed,
        rows_updated: rowsUpdated,
        rows_skipped_no_data: rowsSkippedNoData,
        rows_out_of_retention: rowsOutOfRetention,
      };

      console.warn(
        `Backfill complete for ${userId} (${provider}):`,
        JSON.stringify(summary),
      );
      res.json(summary);
    },
  );

  // ── POST /backfill/revenue ─────────────────────────────────────────────────
  // Re-enrich revenue_amount + revenue_source on existing events using current
  // subscription data and feature pricing. Also backfills customer names from
  // Stripe for any customers where name = customer_id.
  router.post(
    "/backfill/revenue",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const userId = req.visitorId!;
      const accountId = req.accountId ?? null;
      if (accountId == null) {
        return res.status(400).json({ error: "No account found" });
      }

      let eventsUpdated = 0;
      let eventsSkipped = 0;
      let customersResolved = 0;

      try {
        // ── 1. Backfill customer names from Stripe ────────────────────────
        const unresolvedCustomers = await pool.query(
          `SELECT customer_id FROM customers
           WHERE account_id = $1 AND (name = customer_id OR name IS NULL)`,
          [accountId],
        );

        if (unresolvedCustomers.rows.length > 0) {
          let stripe;
          try {
            stripe = await getStripeClientForUser(pool, userId, accountId);
          } catch {
            // No Stripe connection — skip name resolution
          }

          if (stripe) {
            for (const row of unresolvedCustomers.rows) {
              const cid = row.customer_id as string;
              // Try direct Stripe lookup for cus_* IDs
              const lookupId = cid.startsWith("cus_") ? cid : null;
              // Also check if observe_events has a meta.stripe_customer_id for this customer
              if (!lookupId) {
                const metaResult = await pool.query(
                  `SELECT DISTINCT (meta->>'stripe_customer_id') AS stripe_id
                   FROM observe_events
                   WHERE account_id = $1 AND customer_id = $2
                     AND meta->>'stripe_customer_id' IS NOT NULL
                   LIMIT 1`,
                  [accountId, cid],
                );
                if (metaResult.rows.length === 0) continue;
                const stripeId = metaResult.rows[0].stripe_id;
                if (!stripeId) continue;
                try {
                  const cust = await stripe.customers.retrieve(stripeId);
                  if (cust.deleted) continue;
                  const name = cust.name || cust.email || cid;
                  await pool.query(
                    `UPDATE customers SET name = $1, email = COALESCE(customers.email, $2), updated_at = NOW()
                     WHERE account_id = $3 AND customer_id = $4`,
                    [name, cust.email || null, accountId, cid],
                  );
                  customersResolved++;
                } catch (err) {
                  console.error(
                    "Backfill: failed to resolve customer",
                    cid,
                    "via",
                    stripeId,
                    err,
                  );
                }
                continue;
              }
              try {
                const cust = await stripe.customers.retrieve(lookupId);
                if (cust.deleted) continue;
                const name = cust.name || cust.email || cid;
                await pool.query(
                  `UPDATE customers SET name = $1, email = COALESCE(customers.email, $2), updated_at = NOW()
                   WHERE account_id = $3 AND customer_id = $4`,
                  [name, cust.email || null, accountId, cid],
                );
                customersResolved++;
              } catch (err) {
                console.error("Backfill: failed to resolve customer", cid, err);
              }
            }
          }
        }

        // ── 2. Backfill revenue on events ─────────────────────────────────
        // Load feature pricing
        const fpResult = await pool.query(
          `SELECT feature_key, revenue_per_unit FROM feature_pricing WHERE account_id = $1`,
          [accountId],
        );
        const featurePricingMap = new Map<string, number>();
        for (const row of fpResult.rows) {
          featurePricingMap.set(
            row.feature_key,
            parseFloat(row.revenue_per_unit),
          );
        }

        // Load all active subscriptions keyed by customer_id
        const subResult = await pool.query(
          `SELECT s.customer_id,
                  SUM(COALESCE(s.mrr_override, 0)) AS mrr,
                  MAX(s.pricing_model) AS pricing_model,
                  MAX(CASE WHEN s.pricing_model = 'tiered' OR s.pricing_model = 'hybrid'
                           THEN s.pricing_tiers::text END) AS pricing_tiers,
                  MAX(s.unit_price) AS unit_price
           FROM subscriptions s
           WHERE s.account_id = $1 AND s.is_active = true
           GROUP BY s.customer_id`,
          [accountId],
        );
        const subByCustomer = new Map<string, SubMeta>();
        for (const row of subResult.rows) {
          subByCustomer.set(row.customer_id, {
            mrr: parseFloat(row.mrr) || 0,
            pricingModel: row.pricing_model,
            pricingTiers: row.pricing_tiers
              ? JSON.parse(row.pricing_tiers)
              : null,
            unitPrice:
              row.unit_price != null ? parseFloat(row.unit_price) : null,
          });
        }

        // Fetch events that need revenue enrichment (none or subscription-only with active sub)
        const events = await pool.query(
          `SELECT id, customer_id, feature_key, usage_units, input_tokens,
                  output_tokens, revenue_source, revenue_amount,
                  meta->>'stripe_customer_id' AS meta_stripe_id
           FROM observe_events
           WHERE account_id = $1
             AND (revenue_source = 'none' OR revenue_source IS NULL)
             AND source != 'stripe'
           ORDER BY timestamp DESC
           LIMIT 50000`,
          [accountId],
        );

        // MTD usage cache per customer (for tiered/hybrid)
        const mtdCache = new Map<string, number>();
        async function getMtdUsage(customerId: string): Promise<number> {
          if (mtdCache.has(customerId)) return mtdCache.get(customerId)!;
          const result = await pool.query(
            `SELECT COALESCE(SUM(usage_units), 0) AS usage
             FROM observe_events
             WHERE account_id = $1 AND customer_id = $2
               AND timestamp >= date_trunc('month', NOW())`,
            [accountId, customerId],
          );
          const usage = parseFloat(result.rows[0]?.usage) || 0;
          mtdCache.set(customerId, usage);
          return usage;
        }

        // Process in batches of 50
        const updates: { id: number; revenue: number; source: string }[] = [];
        for (const evt of events.rows) {
          let revenue = 0;
          let revenueSource = "none";

          // Priority 1: feature pricing
          if (featurePricingMap.has(evt.feature_key)) {
            revenue = featurePricingMap.get(evt.feature_key)!;
            revenueSource = "feature_pricing";
          } else {
            // Priority 2: subscription match
            const subKey =
              (evt.meta_stripe_id && subByCustomer.has(evt.meta_stripe_id)
                ? evt.meta_stripe_id
                : null) ||
              (subByCustomer.has(evt.customer_id) ? evt.customer_id : null);

            if (subKey) {
              const subMeta = subByCustomer.get(subKey)!;
              const evtUsage =
                parseFloat(evt.usage_units) ||
                (parseFloat(evt.input_tokens) || 0) +
                  (parseFloat(evt.output_tokens) || 0);
              const mtd = await getMtdUsage(subKey);
              const enriched = enrichRevenueFromSub(subMeta, evtUsage, mtd);
              revenue = enriched.revenue;
              revenueSource = enriched.revenueSource;
            }
          }

          if (revenueSource === "none") {
            eventsSkipped++;
            continue;
          }

          updates.push({ id: evt.id, revenue, source: revenueSource });
        }

        // Batch UPDATE
        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
          const chunk = updates.slice(i, i + BATCH_SIZE);
          const valueTuples: string[] = [];
          const params: (number | string)[] = [];
          let p = 1;
          for (const u of chunk) {
            valueTuples.push(`($${p++}::int, $${p++}::numeric, $${p++}::text)`);
            params.push(u.id, u.revenue, u.source);
          }
          const sql = `
            UPDATE observe_events AS e
               SET revenue_amount = v.rev,
                   revenue_source = v.src
              FROM (VALUES ${valueTuples.join(", ")}) AS v(id, rev, src)
             WHERE e.id = v.id
          `;
          const result = await pool.query(sql, params);
          eventsUpdated += result.rowCount ?? 0;
        }

        const summary = {
          events_updated: eventsUpdated,
          events_skipped: eventsSkipped,
          events_checked: events.rows.length,
          customers_resolved: customersResolved,
          customers_checked: unresolvedCustomers.rows.length,
        };
        console.warn(
          `Revenue backfill complete for account ${accountId}:`,
          JSON.stringify(summary),
        );
        res.json(summary);
      } catch (error) {
        console.error("Revenue backfill error:", error);
        res.status(500).json({ error: "Revenue backfill failed" });
      }
    },
  );

  return router;
}
