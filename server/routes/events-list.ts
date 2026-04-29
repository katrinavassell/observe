import { Router, Request, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";
import { coerceEventRow, attachSplitCosts } from "./events-helpers.js";

export function createEventsListRoutes(pool: Pool, ensureVisitor: any) {
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

  return router;
}
