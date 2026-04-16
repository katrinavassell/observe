import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";
import { getAllPricing } from "../model-pricing.js";

const ADMIN_EMAILS = process.env.ADMIN_EMAILS
  ? process.env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase())
  : [];

function isAdminUser(req: AuthRequest): boolean {
  return (
    !!req.accountEmail && ADMIN_EMAILS.includes(req.accountEmail.toLowerCase())
  );
}

export function createModelsApiRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  // GET /admin/status — check if current user is admin
  router.get(
    "/admin/status",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      res.json({ isAdmin: isAdminUser(req) });
    },
  );

  // GET /pricing/models — public endpoint, returns all current model pricing
  router.get("/pricing/models", async (_req, res: Response) => {
    try {
      const pricing = await getAllPricing(pool);
      res.json({ models: pricing, updated_at: new Date().toISOString() });
    } catch (error) {
      console.error("GET /pricing/models error:", error);
      res.status(500).json({ error: "Failed to fetch model pricing" });
    }
  });

  // GET /models — aggregated stats per model
  router.get(
    "/models",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT model, model_provider, COUNT(*) as event_count,
           COUNT(DISTINCT customer_id) as customer_count, COUNT(DISTINCT feature_key) as feature_count,
           COALESCE(SUM(cost_amount), 0) as total_cost, COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage,
           SUM(input_tokens) as total_input_tokens, SUM(output_tokens) as total_output_tokens,
           COALESCE(AVG(cost_amount), 0) as avg_cost_per_event,
           MAX(timestamp) as last_seen
         FROM observe_events WHERE user_id = $1 AND model IS NOT NULL
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
              customer_count: parseInt(row.customer_count),
              feature_count: parseInt(row.feature_count),
              total_cost: cost,
              total_revenue: revenue,
              total_usage: parseFloat(row.total_usage) || 0,
              total_input_tokens:
                row.total_input_tokens == null
                  ? null
                  : parseFloat(row.total_input_tokens),
              total_output_tokens:
                row.total_output_tokens == null
                  ? null
                  : parseFloat(row.total_output_tokens),
              avg_cost_per_event: parseFloat(row.avg_cost_per_event) || 0,
              margin_pct:
                revenue > 0
                  ? Math.round(((revenue - cost) / revenue) * 100)
                  : null,
              last_seen: row.last_seen,
            };
          }),
        );
      } catch (error) {
        console.error("Get models error:", error);
        res.status(500).json({ error: "Failed to get models" });
      }
    },
  );

  return router;
}
