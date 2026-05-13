import { Router, Request, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest, ensureScoped } from "./auth.js";
import { SOURCE_PRIORITY_CTE } from "./events-helpers.js";

export function createEventsAggregationRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  // GET /events/by-feature — aggregate events grouped by feature_key
  router.get(
    "/events/by-feature",
    ensureVisitor,
    ensureScoped("events.read"),
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
    ensureScoped("events.read"),
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
    ensureScoped("events.read"),
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
    ensureScoped("events.read"),
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

  // GET /events/by-cost-type — cost breakdown by type
  router.get(
    "/events/by-cost-type",
    ensureVisitor,
    ensureScoped("events.read"),
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

  return router;
}
