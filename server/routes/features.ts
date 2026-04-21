import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";

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

export function createFeaturesRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  // GET /features — aggregated stats per feature_key
  router.get(
    "/features",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT
           feature_key,
           COUNT(*) as event_count,
           COUNT(DISTINCT customer_id) as customer_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage,
           COALESCE(AVG(cost_amount), 0) as avg_cost_per_event,
           COALESCE(AVG(revenue_amount), 0) as avg_revenue_per_event,
           MAX(timestamp) as last_seen
         FROM observe_events
         WHERE account_id = $1 AND feature_key IS NOT NULL
           AND (source IS NULL OR source != 'stripe')
         GROUP BY feature_key
         ORDER BY total_cost DESC`,
          [req.accountId],
        );

        const features = result.rows.map((row) => {
          const cost = parseFloat(row.total_cost) || 0;
          const revenue = parseFloat(row.total_revenue) || 0;
          const margin =
            revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null;
          return {
            feature_key: row.feature_key,
            event_count: parseInt(row.event_count),
            customer_count: parseInt(row.customer_count),
            total_cost: cost,
            total_revenue: revenue,
            total_usage: parseFloat(row.total_usage) || 0,
            avg_cost_per_event: parseFloat(row.avg_cost_per_event) || 0,
            avg_revenue_per_event: parseFloat(row.avg_revenue_per_event) || 0,
            margin_pct: margin,
            last_seen: row.last_seen,
          };
        });

        res.json(features);
      } catch (error) {
        console.error("Get features error:", error);
        res.status(500).json({ error: "Failed to get features" });
      }
    },
  );

  // GET /features/:key — detail for a single feature
  router.get(
    "/features/:key",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { key } = req.params;

        const [summaryRes, eventsRes, customerRes, modelRes, timeseriesRes] =
          await Promise.all([
            pool.query(
              `SELECT feature_key, COUNT(*) as event_count, COUNT(DISTINCT customer_id) as customer_count,
             COALESCE(SUM(cost_amount), 0) as total_cost, COALESCE(SUM(revenue_amount), 0) as total_revenue,
             COALESCE(SUM(usage_units), 0) as total_usage, MAX(timestamp) as last_seen
           FROM observe_events WHERE account_id = $1 AND feature_key = $2
             AND (source IS NULL OR source != 'stripe')
           GROUP BY feature_key`,
              [req.accountId, key],
            ),
            pool.query(
              `SELECT oe.*, c.name as customer_name FROM observe_events oe
           LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
           WHERE oe.account_id = $1 AND oe.feature_key = $2
             AND (oe.source IS NULL OR oe.source != 'stripe')
           ORDER BY oe.timestamp DESC LIMIT 50`,
              [req.accountId, key],
            ),
            pool.query(
              `SELECT oe.customer_id, c.name as customer_name,
             COUNT(*) as event_count, COALESCE(SUM(oe.cost_amount), 0) as total_cost,
             COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
           FROM observe_events oe
           LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
           WHERE oe.account_id = $1 AND oe.feature_key = $2
             AND (oe.source IS NULL OR oe.source != 'stripe')
           GROUP BY oe.customer_id, c.name ORDER BY total_cost DESC`,
              [req.accountId, key],
            ),
            pool.query(
              `SELECT model, model_provider, COUNT(*) as event_count,
             COALESCE(SUM(cost_amount), 0) as total_cost, COALESCE(SUM(revenue_amount), 0) as total_revenue
           FROM observe_events WHERE account_id = $1 AND feature_key = $2 AND model IS NOT NULL
             AND (source IS NULL OR source != 'stripe')
           GROUP BY model, model_provider ORDER BY total_cost DESC`,
              [req.accountId, key],
            ),
            pool.query(
              `SELECT DATE_TRUNC('month', timestamp) as month,
             COUNT(*) as event_count,
             COALESCE(SUM(cost_amount), 0) as total_cost,
             COALESCE(SUM(revenue_amount), 0) as total_revenue,
             COALESCE(SUM(usage_units), 0) as total_usage
           FROM observe_events WHERE account_id = $1 AND feature_key = $2
             AND (source IS NULL OR source != 'stripe')
           GROUP BY month ORDER BY month ASC`,
              [req.accountId, key],
            ),
          ]);

        const s = summaryRes.rows[0];
        if (!s || !s.feature_key) {
          return res.status(404).json({ error: "Feature not found" });
        }

        const cost = parseFloat(s.total_cost) || 0;
        const revenue = parseFloat(s.total_revenue) || 0;
        const margin =
          revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null;

        res.json({
          feature_key: s.feature_key,
          event_count: parseInt(s.event_count),
          customer_count: parseInt(s.customer_count),
          total_cost: cost,
          total_revenue: revenue,
          total_usage: parseFloat(s.total_usage) || 0,
          margin_pct: margin,
          last_seen: s.last_seen,
          recent_events: eventsRes.rows.map(coerceEventRow),
          by_customer: customerRes.rows.map(
            (r: {
              customer_id: string;
              customer_name: string;
              event_count: string;
              total_cost: string;
              total_revenue: string;
            }) => ({
              customer_id: r.customer_id,
              customer_name: r.customer_name,
              event_count: parseInt(r.event_count),
              total_cost: parseFloat(r.total_cost) || 0,
              total_revenue: parseFloat(r.total_revenue) || 0,
            }),
          ),
          by_model: modelRes.rows.map(
            (r: {
              model: string;
              model_provider: string;
              event_count: string;
              total_cost: string;
              total_revenue: string;
            }) => ({
              model: r.model,
              model_provider: r.model_provider,
              event_count: parseInt(r.event_count),
              total_cost: parseFloat(r.total_cost) || 0,
              total_revenue: parseFloat(r.total_revenue) || 0,
            }),
          ),
          timeseries: timeseriesRes.rows.map(
            (r: {
              month: string;
              event_count: string;
              total_cost: string;
              total_revenue: string;
              total_usage: string;
            }) => ({
              month: r.month,
              event_count: parseInt(r.event_count),
              total_cost: parseFloat(r.total_cost) || 0,
              total_revenue: parseFloat(r.total_revenue) || 0,
              total_usage: parseFloat(r.total_usage) || 0,
            }),
          ),
        });
      } catch (error) {
        console.error("Get feature detail error:", error);
        res.status(500).json({ error: "Failed to get feature detail" });
      }
    },
  );

  return router;
}
