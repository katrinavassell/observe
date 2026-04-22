import { Router, Request, Response } from "express";
import type { Pool } from "pg";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { type AuthRequest } from "./auth.js";
import {
  encryptApiKey,
  decryptApiKey,
  getStripeClientForUser,
} from "../stripe-client.js";
import {
  calculateCostFromTokens as calcCostFromDb,
  resolveModelPricing,
  type ModelPrice,
} from "../model-pricing.js";
import { checkAlerts, checkCustomerAlerts } from "./alerts.js";
import { checkFeatureAccess } from "../billing.js";
import { inferModelProvider } from "../lib/models.js";
import {
  type SubMeta,
  tierUnitPrice,
  enrichRevenueFromSub,
} from "../lib/enrich-revenue.js";

type ComputeInferenceProfilesFn = (userId: string) => Promise<number>;

async function resolveStripeCustomerNames(
  pool: Pool,
  userId: string,
  accountId: number | null,
  customerIds: string[],
): Promise<void> {
  if (customerIds.length === 0 || accountId == null) return;
  const unresolved = await pool.query(
    `SELECT customer_id FROM customers
     WHERE account_id = $1 AND customer_id = ANY($2)
       AND (name = customer_id OR name IS NULL)`,
    [accountId, customerIds],
  );
  if (unresolved.rows.length === 0) return;
  let stripe;
  try {
    stripe = await getStripeClientForUser(pool, userId, accountId);
  } catch {
    return;
  }
  for (const row of unresolved.rows) {
    try {
      const cust = await stripe.customers.retrieve(row.customer_id);
      if (cust.deleted) continue;
      const name = cust.name || cust.email || row.customer_id;
      const email = cust.email || null;
      await pool.query(
        `UPDATE customers SET name = $1, email = COALESCE(customers.email, $2), updated_at = NOW()
         WHERE account_id = $3 AND customer_id = $4 AND (name = customer_id OR name IS NULL)`,
        [name, email, accountId, row.customer_id],
      );
    } catch {
      continue;
    }
  }
}

/**
 * Annotate a list of already-coerced event rows with derived `input_cost` +
 * `output_cost`. Tokens × resolved rate — matches the ingest-time pricing
 * chain (tier > user override > global). Cached per-request so N rows with M
 * unique models do M pricing lookups, not N.
 */
async function attachSplitCosts(
  pool: Pool,
  userId: string,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const cache = new Map<string, ModelPrice | null>();
  async function lookup(model: string): Promise<ModelPrice | null> {
    if (cache.has(model)) return cache.get(model)!;
    const p = await resolveModelPricing(pool, model, userId);
    cache.set(model, p);
    return p;
  }
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const model = typeof row.model === "string" ? row.model : null;
    const inputTokens =
      typeof row.input_tokens === "number" ? row.input_tokens : null;
    const outputTokens =
      typeof row.output_tokens === "number" ? row.output_tokens : null;
    let inputCost: number | null = null;
    let outputCost: number | null = null;
    if (model && (inputTokens != null || outputTokens != null)) {
      const pricing = await lookup(model);
      if (pricing) {
        if (inputTokens != null) {
          inputCost =
            Math.round(
              ((inputTokens * pricing.input_cost_per_million) / 1_000_000) *
                1_000_000,
            ) / 1_000_000;
        }
        if (outputTokens != null) {
          outputCost =
            Math.round(
              ((outputTokens * pricing.output_cost_per_million) / 1_000_000) *
                1_000_000,
            ) / 1_000_000;
        }
      }
    }
    out.push({ ...row, input_cost: inputCost, output_cost: outputCost });
  }
  return out;
}

function coerceEventRow(row: Record<string, unknown>) {
  return {
    ...row,
    cost_amount:
      row.cost_amount != null ? parseFloat(row.cost_amount as string) : null,
    revenue_amount:
      row.revenue_amount != null
        ? parseFloat(row.revenue_amount as string)
        : null,
    usage_units:
      row.usage_units != null ? parseFloat(row.usage_units as string) : null,
    input_tokens:
      row.input_tokens != null
        ? parseInt(row.input_tokens as string, 10)
        : null,
    output_tokens:
      row.output_tokens != null
        ? parseInt(row.output_tokens as string, 10)
        : null,
    tokens_source: (row.tokens_source as string | null) ?? null,
  };
}

// Dedup partition: only collapse rows that share a user_id + idempotency_key
// (the same event arriving from multiple sources — e.g. proxy mirrored from
// SDK). Rows without an idempotency_key fall back to their primary key, so
// every call ends up in its own partition and nothing is silently dropped.
// Earlier partition was (user_id, model, customer_id, feature_key, day) which
// undercounted aggregates by collapsing every gpt-4o blog_post call for a
// given day into one row.
const SOURCE_PRIORITY_CTE = `
  WITH ranked AS (
    SELECT oe.*,
      ROW_NUMBER() OVER (
        PARTITION BY oe.user_id, COALESCE(oe.idempotency_key, oe.id::text)
        ORDER BY CASE oe.source WHEN 'proxy' THEN 1 WHEN 'sdk' THEN 2 WHEN 'csv' THEN 3 WHEN 'sample' THEN 4 ELSE 5 END
      ) AS _src_rank
    FROM observe_events oe
    LEFT JOIN user_data_status uds ON uds.account_id = oe.account_id
    WHERE oe.account_id = $1
      AND oe.timestamp >= NOW() - INTERVAL '90 days'
      AND (oe.source != 'sample' OR COALESCE(uds.data_mode, 'none') = 'sample')
      AND oe.event_name != 'revenue'
  ),
  deduped AS (SELECT * FROM ranked WHERE _src_rank = 1)
`;

// In-memory dedup: tracks which usage alerts have already been sent this month
const usageAlertsSent = new Set<string>();

async function sendUsageLimitEmail(
  pool: Pool,
  userId: string,
  threshold: 80 | 100,
  used: number,
  limit: number,
): Promise<void> {
  const month = new Date().toISOString().slice(0, 7); // "2026-04"
  const key = `${userId}-${month}-${threshold}`;
  if (usageAlertsSent.has(key)) return;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const accountResult = await pool.query(
    `SELECT email FROM users WHERE visitor_id = $1`,
    [userId],
  );
  const email = accountResult.rows[0]?.email;
  if (!email) return;

  const subject =
    threshold === 80
      ? "You're approaching your monthly event limit"
      : "Monthly event limit reached";

  const body =
    threshold === 80
      ? `<p>You've used ${used.toLocaleString()} of your ${limit.toLocaleString()} monthly events on Observe.</p><p>Need more capacity? Check out <a href="https://tansohq.com">Tanso</a> for unlimited events and full monetization tools.</p>`
      : `<p>You've reached your ${limit.toLocaleString()} monthly event limit on Observe.</p><p>New events will be rejected until next month. Need more? Check out <a href="https://tansohq.com">Tanso</a> for unlimited events.</p>`;

  usageAlertsSent.add(key);

  fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: "Observe <kat@tansohq.com>",
      to: email,
      subject,
      html: body,
    }),
  })
    .then(() =>
      console.warn("Usage alert sent:", { email, threshold, used, limit }),
    )
    .catch((err) => {
      console.error("Failed to send usage alert email:", err);
      usageAlertsSent.delete(key);
    });
}

export function createEventsRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    computeInferenceProfiles: ComputeInferenceProfilesFn;
    apiLimiter: ReturnType<typeof rateLimit>;
  },
) {
  const router = Router();

  // GET /events — paginated list of observe_events
  router.get(
    "/events",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
        const featureKey = req.query.feature_key as string | undefined;
        const customerId = req.query.customer_id as string | undefined;
        const model = req.query.model as string | undefined;
        const source = req.query.source as string | undefined;
        const dateFrom = req.query.date_from as string | undefined;
        const dateTo = req.query.date_to as string | undefined;

        const SORTABLE_COLUMNS: Record<string, string> = {
          timestamp: "oe.timestamp",
          event_name: "oe.event_name",
          feature_key: "oe.feature_key",
          customer_id: "oe.customer_id",
          model: "oe.model",
          source: "oe.source",
          usage_units: "oe.usage_units",
          cost_amount: "oe.cost_amount",
          revenue_amount: "oe.revenue_amount",
          duration_ms: "oe.duration_ms",
        };
        const sortBy =
          SORTABLE_COLUMNS[req.query.sort_by as string] || "oe.timestamp";
        const sortDir =
          (req.query.sort_dir as string)?.toUpperCase() === "ASC"
            ? "ASC"
            : "DESC";

        let where = "WHERE oe.account_id = $1 AND oe.event_name != 'revenue'";
        const params: unknown[] = [req.accountId!];
        let paramIdx = 2;

        if (featureKey) {
          where += ` AND oe.feature_key = $${paramIdx++}`;
          params.push(featureKey);
        }
        if (customerId) {
          where += ` AND oe.customer_id = $${paramIdx++}`;
          params.push(customerId);
        }
        if (model) {
          where += ` AND oe.model = $${paramIdx++}`;
          params.push(model);
        }
        if (source) {
          where += ` AND oe.source = $${paramIdx++}`;
          params.push(source);
        }
        if (dateFrom) {
          where += ` AND oe.timestamp >= $${paramIdx++}`;
          params.push(dateFrom);
        }
        if (dateTo) {
          where += ` AND oe.timestamp <= $${paramIdx++}`;
          params.push(dateTo);
        }

        const eventsResult = await pool.query(
          `SELECT
           oe.id, oe.user_id, oe.account_id, oe.customer_id, oe.feature_key,
           oe.event_name, oe.timestamp, oe.cost_amount, oe.cost_unit,
           oe.revenue_amount, oe.usage_units, oe.model, oe.model_provider,
           oe.source, oe.granularity, oe.is_inferred, oe.properties, oe.created_at,
           oe.input_tokens, oe.output_tokens, oe.tokens_source, oe.revenue_source,
           oe.trace_id, oe.span_id, oe.parent_span_id, oe.duration_ms, oe.cost_type,
           c.name as customer_name
         FROM observe_events oe
         LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
         ${where}
         ORDER BY ${sortBy} ${sortDir}
         LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
          [...params, limit, offset],
        );

        const countResult = await pool.query(
          `SELECT COUNT(*) FROM observe_events oe ${where}`,
          params,
        );

        const coerced = eventsResult.rows.map(coerceEventRow);
        const withSplit = await attachSplitCosts(pool, req.visitorId!, coerced);

        res.json({
          events: withSplit,
          total: parseInt(countResult.rows[0].count),
          limit,
          offset,
        });
      } catch (error) {
        console.error("Get events error:", error);
        res.status(500).json({ error: "Failed to get events" });
      }
    },
  );

  // GET /events/by-feature — aggregate events grouped by feature_key
  router.get(
    "/events/by-feature",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `${SOURCE_PRIORITY_CTE}
         SELECT feature_key, COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage,
           MAX(timestamp) as last_seen
         FROM deduped WHERE feature_key IS NOT NULL
         GROUP BY feature_key ORDER BY total_cost DESC`,
          [req.accountId!],
        );
        res.json(
          result.rows.map((row) => {
            const cost = parseFloat(row.total_cost) || 0;
            const revenue = parseFloat(row.total_revenue) || 0;
            return {
              feature_key: row.feature_key,
              event_count: parseInt(row.event_count),
              total_cost: cost,
              total_revenue: revenue,
              total_usage: parseFloat(row.total_usage) || 0,
              margin_pct:
                revenue > 0
                  ? Math.round(((revenue - cost) / revenue) * 100)
                  : null,
              last_seen: row.last_seen,
            };
          }),
        );
      } catch (error) {
        console.error("Get events/by-feature error:", error);
        res.status(500).json({ error: "Failed to get feature aggregations" });
      }
    },
  );

  // GET /events/by-agent — aggregate events grouped by agent_id
  router.get(
    "/events/by-agent",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT agent_id, COUNT(*) as event_count,
           SUM(cost_amount) as total_cost, SUM(revenue_amount) as total_revenue,
           SUM(usage_units) as total_usage,
           CASE WHEN SUM(revenue_amount) > 0
             THEN ROUND((1 - SUM(cost_amount)/SUM(revenue_amount)) * 100, 1)
             ELSE NULL END as margin_pct,
           MAX(timestamp) as last_seen
           FROM observe_events WHERE account_id = $1 AND agent_id IS NOT NULL AND agent_id != ''
           GROUP BY agent_id ORDER BY total_cost DESC`,
          [req.accountId!],
        );
        res.json(
          result.rows.map((r) => ({
            agent_id: r.agent_id,
            event_count: parseInt(r.event_count) || 0,
            total_cost: parseFloat(r.total_cost) || 0,
            total_revenue: parseFloat(r.total_revenue) || 0,
            total_usage: parseFloat(r.total_usage) || 0,
            margin_pct: r.margin_pct !== null ? parseFloat(r.margin_pct) : null,
            last_seen: r.last_seen,
          })),
        );
      } catch (error) {
        console.error("Get events/by-agent error:", error);
        res.status(500).json({ error: "Failed to get agent aggregations" });
      }
    },
  );

  // GET /events/by-customer — aggregate events grouped by customer_id
  router.get(
    "/events/by-customer",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `${SOURCE_PRIORITY_CTE}
         SELECT d.customer_id, c.name as customer_name, COUNT(*) as event_count,
           COALESCE(SUM(d.cost_amount), 0) as total_cost,
           COALESCE(SUM(d.revenue_amount), 0) as total_revenue,
           MAX(d.timestamp) as last_seen
         FROM deduped d
         LEFT JOIN customers c ON d.account_id = c.account_id AND d.customer_id = c.customer_id
         GROUP BY d.customer_id, c.name ORDER BY total_cost DESC`,
          [req.accountId!],
        );
        res.json(
          result.rows.map((row) => {
            const cost = parseFloat(row.total_cost) || 0;
            const revenue = parseFloat(row.total_revenue) || 0;
            return {
              customer_id: row.customer_id,
              customer_name: row.customer_name || row.customer_id,
              event_count: parseInt(row.event_count),
              total_cost: cost,
              total_revenue: revenue,
              margin_pct:
                revenue > 0
                  ? Math.round(((revenue - cost) / revenue) * 100)
                  : null,
              last_seen: row.last_seen,
            };
          }),
        );
      } catch (error) {
        console.error("Get events/by-customer error:", error);
        res.status(500).json({ error: "Failed to get customer aggregations" });
      }
    },
  );

  // GET /events/by-model — aggregate events grouped by model
  router.get(
    "/events/by-model",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `${SOURCE_PRIORITY_CTE}
         SELECT model, model_provider, COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage,
           MAX(timestamp) as last_seen
         FROM deduped WHERE model IS NOT NULL
         GROUP BY model, model_provider ORDER BY total_cost DESC`,
          [req.accountId!],
        );
        res.json(
          result.rows.map((row) => {
            const cost = parseFloat(row.total_cost) || 0;
            const revenue = parseFloat(row.total_revenue) || 0;
            return {
              model: row.model,
              model_provider: row.model_provider,
              event_count: parseInt(row.event_count),
              total_cost: cost,
              total_revenue: revenue,
              total_usage: parseFloat(row.total_usage) || 0,
              margin_pct:
                revenue > 0
                  ? Math.round(((revenue - cost) / revenue) * 100)
                  : null,
              last_seen: row.last_seen,
            };
          }),
        );
      } catch (error) {
        console.error("Get events/by-model error:", error);
        res.status(500).json({ error: "Failed to get model aggregations" });
      }
    },
  );

  // GET /events/traces — paginated list of traces (must be before /events/:id)
  router.get(
    "/events/traces",
    ensureVisitor,
    async (req: Request, res: Response) => {
      try {
        const authReq = req as AuthRequest;
        const accountId = authReq.accountId;
        if (!accountId) {
          return res.json({ traces: [] });
        }
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const offset = parseInt(req.query.offset as string) || 0;
        const result = await pool.query(
          `SELECT trace_id,
           MIN(timestamp) as start_time,
           COUNT(*) as span_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           MAX(duration_ms) as total_duration_ms,
           (array_agg(event_name ORDER BY timestamp ASC))[1] as root_event,
           (array_agg(DISTINCT cost_type))[1:5] as cost_types
           FROM observe_events
           WHERE account_id = $1 AND trace_id IS NOT NULL AND source IS DISTINCT FROM 'sample'
           GROUP BY trace_id
           ORDER BY start_time DESC
           LIMIT $2 OFFSET $3`,
          [accountId, limit, offset],
        );
        res.json({
          traces: result.rows.map((r) => ({
            trace_id: r.trace_id,
            start_time: r.start_time,
            span_count: parseInt(r.span_count),
            total_cost: parseFloat(r.total_cost),
            total_revenue: parseFloat(r.total_revenue),
            total_duration_ms: r.total_duration_ms
              ? parseInt(r.total_duration_ms)
              : null,
            root_event: r.root_event,
            cost_types: r.cost_types,
          })),
        });
      } catch (error) {
        console.error("GET /events/traces error:", error);
        res.status(500).json({ error: "Failed to fetch traces" });
      }
    },
  );

  // GET /events/trace/:traceId — all events for a trace
  router.get(
    "/events/trace/:traceId",
    ensureVisitor,
    async (req: Request, res: Response) => {
      try {
        const authReq = req as AuthRequest;
        const accountId = authReq.accountId;
        if (!accountId) {
          return res.status(404).json({ error: "Trace not found" });
        }
        const { traceId } = req.params;
        if (!traceId) {
          return res.status(400).json({ error: "traceId is required" });
        }
        // Explicitly refuse sample trace IDs — defense in depth.
        if (traceId.startsWith("sample-trace")) {
          return res.status(404).json({ error: "Trace not found" });
        }
        const result = await pool.query(
          `SELECT id, customer_id, feature_key, event_name, timestamp,
           cost_amount, cost_unit, revenue_amount, usage_units,
           model, model_provider, source, properties, agent_id,
           trace_id, span_id, parent_span_id, duration_ms, cost_type
           FROM observe_events
           WHERE account_id = $1 AND trace_id = $2 AND source IS DISTINCT FROM 'sample'
           ORDER BY timestamp ASC`,
          [accountId, traceId],
        );
        res.json({ trace_id: traceId, spans: result.rows });
      } catch (error) {
        console.error("GET /events/trace/:traceId error:", error);
        res.status(500).json({ error: "Failed to fetch trace" });
      }
    },
  );

  // GET /events/by-cost-type — cost breakdown by type
  router.get(
    "/events/by-cost-type",
    ensureVisitor,
    async (req: Request, res: Response) => {
      try {
        const authReq = req as AuthRequest;
        const accountId = authReq.accountId;
        if (!accountId) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const days = parseInt(req.query.days as string) || 30;
        const result = await pool.query(
          `SELECT COALESCE(cost_type, 'llm') as cost_type,
           COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage
           FROM observe_events
           WHERE account_id = $1 AND timestamp >= NOW() - make_interval(days => $2)
           GROUP BY COALESCE(cost_type, 'llm')
           ORDER BY total_cost DESC`,
          [accountId, days],
        );
        res.json({
          breakdown: result.rows.map((r) => ({
            cost_type: r.cost_type,
            event_count: parseInt(r.event_count),
            total_cost: parseFloat(r.total_cost),
            total_revenue: parseFloat(r.total_revenue),
            total_usage: parseFloat(r.total_usage),
          })),
        });
      } catch (error) {
        console.error("GET /events/by-cost-type error:", error);
        res.status(500).json({ error: "Failed to fetch cost type breakdown" });
      }
    },
  );

  // GET /events/:id — single event detail with request/response bodies
  router.get(
    "/events/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const eventId = parseInt(req.params.id);
        if (isNaN(eventId))
          return res.status(400).json({ error: "Invalid event ID" });
        const result = await pool.query(
          `SELECT oe.*, c.name as customer_name
         FROM observe_events oe
         LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
         WHERE oe.id = $1 AND oe.account_id = $2`,
          [eventId, req.accountId!],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ error: "Event not found" });
        const [withSplit] = await attachSplitCosts(pool, req.visitorId!, [
          coerceEventRow(result.rows[0]),
        ]);
        res.json(withSplit);
      } catch (error) {
        console.error("GET /events/:id error:", error);
        res.status(500).json({ error: "Failed to get event detail" });
      }
    },
  );

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
              "Monthly event limit reached. Need more? Check out Tanso at tansohq.com",
            usage: ingestAccess.usage,
            limit: ingestAccess.limit,
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

        // Auto-enrich revenue from Stripe: look up subscriptions for customers
        // in this batch, carrying the pricing model so we pick the right
        // revenue derivation per event.
        const customerIds = [
          ...new Set([
            ...validEvents.map((e) => e.customerReferenceId),
            ...validEvents
              .map((e) => e.meta?.stripe_customer_id)
              .filter(Boolean),
          ]),
        ] as string[];
        const subByCustomer = new Map<string, SubMeta>();
        if (customerIds.length > 0 && accountId != null) {
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
              [accountId, customerIds],
            );
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
          } catch (err) {
            throw new Error(`Subscription enrichment lookup failed: ${err}`);
          }
        }

        // Tiered-pricing: month-to-date usage per customer so we can resolve
        // which tier each event lands in. One query covers all customers in
        // the batch who have tiered/hybrid subs.
        const tieredCustomers = [...subByCustomer.entries()]
          .filter(
            ([, meta]) =>
              meta.pricingModel === "tiered" || meta.pricingModel === "hybrid",
          )
          .map(([cid]) => cid);
        const mtdUsageByCustomer = new Map<string, number>();
        if (tieredCustomers.length > 0 && accountId != null) {
          try {
            const usageResult = await pool.query(
              `SELECT customer_id, COALESCE(SUM(usage_units), 0) AS usage
               FROM observe_events
               WHERE account_id = $1
                 AND customer_id = ANY($2)
                 AND timestamp >= date_trunc('month', NOW())
               GROUP BY customer_id`,
              [accountId, tieredCustomers],
            );
            for (const row of usageResult.rows) {
              mtdUsageByCustomer.set(row.customer_id, parseFloat(row.usage));
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
            (await calcCostFromDb(
              pool,
              evt.model,
              evt.inputTokens,
              evt.outputTokens,
            ));

          // Revenue enrichment priority: explicit > feature_pricing > Stripe subscription > 0
          // Within "Stripe subscription" we pick the derivation based on the
          // sub's pricing_model so the revenue_source label tells the UI how
          // precise the number is.
          let revenue = 0;
          let revenueSource = "none";
          if (evt.revenueAmount != null) {
            revenue = evt.revenueAmount;
            revenueSource = "explicit";
          } else if (featurePricingMap.has(evt.featureKey)) {
            revenue = featurePricingMap.get(evt.featureKey)!;
            revenueSource = "feature_pricing";
          } else {
            const subKey =
              (evt.meta?.stripe_customer_id &&
                subByCustomer.has(evt.meta.stripe_customer_id) &&
                evt.meta.stripe_customer_id) ||
              (subByCustomer.has(evt.customerReferenceId) &&
                evt.customerReferenceId) ||
              null;
            if (subKey) {
              const subMeta = subByCustomer.get(subKey)!;
              const evtUsage =
                evt.usageUnits ??
                (evt.inputTokens || 0) + (evt.outputTokens || 0);
              const mtd = mtdUsageByCustomer.get(subKey) ?? 0;
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
          // Resolve Stripe customer names for any cus_* IDs missing a real name
          resolveStripeCustomerNames(
            pool,
            userId!,
            accountId,
            alertCustomerIds.filter((id) => id.startsWith("cus_")),
          ).catch(() => {});
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

        const model = "gpt-4o-mini";
        const inputTokens = 100;
        const outputTokens = 50;
        const cost = await calcCostFromDb(
          pool,
          model,
          inputTokens,
          outputTokens,
          userId,
        );

        const insertResult = await pool.query(
          `INSERT INTO observe_events (
             user_id, account_id, customer_id, feature_key, event_name, timestamp,
             cost_amount, cost_unit, revenue_amount, usage_units,
             model, model_provider, source, granularity, is_inferred,
             idempotency_key, revenue_source, duration_ms, cost_type,
             input_tokens, output_tokens, tokens_source
           ) VALUES (
             $1, $2, 'test_customer', $3, 'test_event', NOW(),
             $4, 'usd', 0, $5,
             $6, 'openai', 'sdk', 'event', false,
             $7, 'none', 500, 'llm',
             $8, $9, 'direct'
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
