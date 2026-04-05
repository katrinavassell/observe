import { Router, Request, Response } from "express";
import type { Pool } from "pg";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { type AuthRequest } from "./auth.js";
import { encryptApiKey } from "../stripe-client.js";
import { calculateCostFromTokens as calcCostFromDb } from "../model-pricing.js";
import { checkAlerts } from "./alerts.js";
import { checkFeatureAccess } from "../billing.js";

type ComputeInferenceProfilesFn = (userId: string) => Promise<number>;

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
  };
}

const SOURCE_PRIORITY_CTE = `
  WITH ranked AS (
    SELECT oe.*,
      ROW_NUMBER() OVER (
        PARTITION BY oe.user_id, COALESCE(oe.model,''), COALESCE(oe.customer_id,''), COALESCE(oe.feature_key,''), date_trunc('day', oe.timestamp)
        ORDER BY CASE oe.source WHEN 'proxy' THEN 1 WHEN 'sdk' THEN 2 WHEN 'csv' THEN 3 WHEN 'sample' THEN 4 ELSE 5 END
      ) AS _src_rank
    FROM observe_events oe
    LEFT JOIN user_data_status uds ON uds.user_id = oe.user_id
    WHERE oe.user_id = $1
      AND (oe.source != 'sample' OR COALESCE(uds.data_mode, 'none') = 'sample')
  ),
  deduped AS (SELECT * FROM ranked WHERE _src_rank = 1)
`;

function inferModelProvider(model: string | undefined): string | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.startsWith("claude-")) return "anthropic";
  if (
    m.startsWith("gpt-") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4") ||
    m.startsWith("text-embedding-")
  )
    return "openai";
  if (m.startsWith("dall-e-")) return "openai";
  if (m.startsWith("gemini-")) return "google";
  if (m.startsWith("mistral-") || m.startsWith("codestral")) return "mistral";
  if (m.startsWith("llama-")) return "meta";
  return null;
}

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
    `SELECT email FROM accounts WHERE visitor_id = $1`,
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
      ? `<p>You've used ${used.toLocaleString()} of your ${limit.toLocaleString()} monthly events on Observe.</p><p>To keep tracking without interruption, upgrade to Growth for unlimited events.</p><p><a href="https://observemetrics.com/plans">Upgrade now</a></p>`
      : `<p>You've reached your ${limit.toLocaleString()} monthly event limit on Observe.</p><p>New events will be rejected until next month. Upgrade to Growth for unlimited events.</p><p><a href="https://observemetrics.com/plans">Upgrade now</a></p>`;

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

        let where = "WHERE oe.user_id = $1";
        const params: unknown[] = [req.visitorId];
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
          `SELECT oe.*, c.name as customer_name
         FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         ${where}
         ORDER BY ${sortBy} ${sortDir}
         LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
          [...params, limit, offset],
        );

        const countResult = await pool.query(
          `SELECT COUNT(*) FROM observe_events oe ${where}`,
          params,
        );

        res.json({
          events: eventsResult.rows.map(coerceEventRow),
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
          [req.visitorId],
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
           FROM observe_events WHERE user_id = $1 AND agent_id IS NOT NULL AND agent_id != ''
           GROUP BY agent_id ORDER BY total_cost DESC`,
          [req.visitorId],
        );
        res.json(result.rows);
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
         LEFT JOIN customers c ON d.user_id = c.user_id AND d.customer_id = c.customer_id
         GROUP BY d.customer_id, c.name ORDER BY total_cost DESC`,
          [req.visitorId],
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
          [req.visitorId],
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
  router.get("/events/traces", async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthRequest;
      const userId = authReq.session?.visitorId || authReq.visitorId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
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
           WHERE user_id = $1 AND trace_id IS NOT NULL
           GROUP BY trace_id
           ORDER BY start_time DESC
           LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
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
  });

  // GET /events/trace/:traceId — all events for a trace
  router.get("/events/trace/:traceId", async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthRequest;
      const userId = authReq.session?.visitorId || authReq.visitorId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const { traceId } = req.params;
      if (!traceId) {
        return res.status(400).json({ error: "traceId is required" });
      }
      const result = await pool.query(
        `SELECT id, customer_id, feature_key, event_name, timestamp,
           cost_amount, cost_unit, revenue_amount, usage_units,
           model, model_provider, source, properties, agent_id,
           trace_id, span_id, parent_span_id, duration_ms, cost_type
           FROM observe_events
           WHERE user_id = $1 AND trace_id = $2
           ORDER BY timestamp ASC`,
        [userId, traceId],
      );
      res.json({ trace_id: traceId, spans: result.rows });
    } catch (error) {
      console.error("GET /events/trace/:traceId error:", error);
      res.status(500).json({ error: "Failed to fetch trace" });
    }
  });

  // GET /events/by-cost-type — cost breakdown by type
  router.get("/events/by-cost-type", async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthRequest;
      const userId = authReq.session?.visitorId || authReq.visitorId;
      if (!userId) {
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
           WHERE user_id = $1 AND timestamp >= NOW() - make_interval(days => $2)
           GROUP BY COALESCE(cost_type, 'llm')
           ORDER BY total_cost DESC`,
        [userId, days],
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
  });

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
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.id = $1 AND oe.user_id = $2`,
          [eventId, req.visitorId],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ error: "Event not found" });
        res.json(coerceEventRow(result.rows[0]));
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
        const userId = req.visitorId!;
        const name =
          typeof req.body?.name === "string"
            ? req.body.name.trim().slice(0, 100)
            : null;

        const rawKey = "sk_live_" + crypto.randomBytes(16).toString("hex");
        const keyHash = crypto
          .createHash("sha256")
          .update(rawKey)
          .digest("hex");
        const keyPrefix = rawKey.slice(0, 12);
        const encryptedKey = encryptApiKey(rawKey);

        await pool.query(
          "INSERT INTO sdk_api_keys (user_id, key_hash, key_prefix, encrypted_key, name) VALUES ($1, $2, $3, $4, $5)",
          [userId, keyHash, keyPrefix, encryptedKey, name],
        );

        res.json({ key: rawKey, prefix: keyPrefix, name });
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
        const userId = req.visitorId!;
        const result = await pool.query(
          "SELECT id, key_prefix, name, created_at FROM sdk_api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC",
          [userId],
        );
        const keys = result.rows.map((row) => ({
          id: row.id,
          key_prefix: row.key_prefix,
          label: row.name,
          created_at: row.created_at,
        }));
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
        const old = await pool.query(
          "SELECT name FROM sdk_api_keys WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
          [keyId, userId],
        );
        if (old.rows.length === 0) {
          return res.status(404).json({ error: "Key not found" });
        }
        const name = old.rows[0].name;

        // Revoke old key
        await pool.query(
          "UPDATE sdk_api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2",
          [keyId, userId],
        );

        // Generate new key
        const rawKey = "sk_live_" + crypto.randomBytes(16).toString("hex");
        const keyHash = crypto
          .createHash("sha256")
          .update(rawKey)
          .digest("hex");
        const keyPrefix = rawKey.slice(0, 12);
        const encryptedKey = encryptApiKey(rawKey);

        const result = await pool.query(
          "INSERT INTO sdk_api_keys (user_id, key_hash, key_prefix, encrypted_key, name) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [userId, keyHash, keyPrefix, encryptedKey, name],
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
        const userId = req.visitorId!;
        const keyId = parseInt(req.params.id, 10);
        if (isNaN(keyId)) {
          return res.status(400).json({ error: "Invalid key ID" });
        }

        const result = await pool.query(
          "UPDATE sdk_api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
          [keyId, userId],
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
              "SELECT user_id FROM sdk_api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
              [keyHash],
            );
            if (keyResult.rows.length > 0) {
              userId = keyResult.rows[0].user_id;
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
            }
          }
        }

        // Fallback to session-based auth
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
        );
        if (!ingestAccess.allowed) {
          return res.status(429).json({
            error:
              "Monthly event limit reached. Upgrade to Growth for unlimited events.",
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
        try {
          const fpResult = await pool.query(
            `SELECT feature_key, revenue_per_unit FROM feature_pricing WHERE user_id = $1`,
            [userId],
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

        // Auto-enrich revenue from Stripe: look up MRR for customers in this batch
        const customerIds = [
          ...new Set(validEvents.map((e) => e.customerReferenceId)),
        ];
        const mrrByCustomer = new Map<string, number>();
        if (customerIds.length > 0) {
          try {
            const mrrResult = await pool.query(
              `SELECT s.customer_id, SUM(s.mrr_override) as mrr
             FROM subscriptions s
             WHERE s.user_id = $1 AND s.is_active = true AND s.customer_id = ANY($2)
             GROUP BY s.customer_id`,
              [userId, customerIds],
            );
            for (const row of mrrResult.rows) {
              // MRR / 30 = daily revenue share per event
              mrrByCustomer.set(row.customer_id, parseFloat(row.mrr) / 30);
            }
          } catch (err) {
            throw new Error(`MRR enrichment lookup failed: ${err}`);
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

          // Revenue enrichment priority: explicit > feature_pricing > MRR allocation > 0
          let revenue = 0;
          let revenueSource = "none";
          if (evt.revenueAmount != null) {
            revenue = evt.revenueAmount;
            revenueSource = "explicit";
          } else if (featurePricingMap.has(evt.featureKey)) {
            revenue = featurePricingMap.get(evt.featureKey)!;
            revenueSource = "feature_pricing";
          } else if (mrrByCustomer.has(evt.customerReferenceId)) {
            revenue = mrrByCustomer.get(evt.customerReferenceId)!;
            revenueSource = "mrr_allocation";
          }

          placeholders.push(
            `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, 'sdk', 'event', false, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`,
          );
          values.push(
            userId,
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
          );
        }

        const insertQuery = `
        INSERT INTO observe_events (
          user_id, customer_id, feature_key, event_name, timestamp,
          cost_amount, cost_unit, revenue_amount, usage_units,
          model, model_provider, source, granularity, is_inferred, idempotency_key, revenue_source,
          trace_id, span_id, parent_span_id, duration_ms, cost_type
        ) VALUES ${placeholders.join(", ")}
        ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      `;

        const result = await pool.query(insertQuery, values);
        const inserted = result.rowCount ?? 0;
        const deduped = validEvents.length - inserted;

        res.json({
          accepted: inserted,
          rejected: errors.length + deduped,
          errors,
        });

        // Auto-trigger inference profile learning in the background (fire-and-forget)
        if (inserted > 0) {
          deps
            .computeInferenceProfiles(userId)
            .catch((err) =>
              console.error("Auto inference profile update failed:", err),
            );
          // Check alert thresholds
          checkAlerts(pool, userId).catch((err) =>
            console.error("checkAlerts error (ingest):", err),
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

  return router;
}
