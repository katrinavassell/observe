import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";

export function createA2ARoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  // GET /a2a/agent-card — A2A Agent Card for discovery
  // Also accessible at /.well-known/agent.json via Vercel rewrite
  router.get("/a2a/agent-card", (_req, res: Response) => {
    res.json({
      name: "Observe Cost Tracker",
      description:
        "AI cost observability — query cost, usage, and margin data for LLM calls",
      url: process.env.APP_URL || "https://observemetrics.com",
      version: "1.0.0",
      capabilities: [
        "cost_query",
        "usage_summary",
        "margin_analysis",
        "model_breakdown",
        "agent_breakdown",
      ],
      authentication: {
        type: "bearer",
        header: "x-tanso-key",
        description: "SDK API key from the Data Sources page",
      },
      endpoints: {
        query: "/a2a/query",
        events: "/api/events",
        models: "/api/events/by-model",
        features: "/api/events/by-feature",
        agents: "/api/events/by-agent",
      },
    });
  });

  // POST /a2a/query — Respond to cost queries from other agents
  router.post(
    "/a2a/query",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { action, params } = req.body || {};

        if (!action || typeof action !== "string") {
          return res.status(400).json({
            error:
              "action is required (cost_query, usage_summary, margin_analysis)",
          });
        }

        const userId = req.visitorId!;
        const period = params?.period || "last_30d";
        const feature = params?.feature;
        const agent = params?.agent;
        const customer = params?.customer;

        // Build date filter
        let dateFilter = "AND timestamp >= NOW() - INTERVAL '30 days'";
        if (period === "last_7d")
          dateFilter = "AND timestamp >= NOW() - INTERVAL '7 days'";
        if (period === "last_90d")
          dateFilter = "AND timestamp >= NOW() - INTERVAL '90 days'";
        if (period === "today") dateFilter = "AND timestamp >= CURRENT_DATE";

        // Build optional filters
        const filters: string[] = [];
        const filterValues: unknown[] = [userId];
        let paramIdx = 2;

        if (feature) {
          filters.push(`AND feature_key = $${paramIdx++}`);
          filterValues.push(feature);
        }
        if (agent) {
          filters.push(`AND agent_id = $${paramIdx++}`);
          filterValues.push(agent);
        }
        if (customer) {
          filters.push(`AND customer_id = $${paramIdx++}`);
          filterValues.push(customer);
        }

        const whereClause = `WHERE user_id = $1 ${dateFilter} ${filters.join(" ")}`;

        if (action === "cost_query") {
          const result = await pool.query(
            `SELECT COUNT(*) as event_count,
             COALESCE(SUM(cost_amount), 0) as total_cost,
             COALESCE(SUM(revenue_amount), 0) as total_revenue,
             COALESCE(SUM(usage_units), 0) as total_usage
             FROM observe_events ${whereClause}`,
            filterValues,
          );
          const row = result.rows[0];
          res.json({
            action: "cost_query",
            period,
            filters: { feature, agent, customer },
            data: {
              event_count: parseInt(row.event_count),
              total_cost: parseFloat(row.total_cost),
              total_revenue: parseFloat(row.total_revenue),
              total_usage: parseFloat(row.total_usage),
              margin_pct:
                parseFloat(row.total_revenue) > 0
                  ? Math.round(
                      (1 -
                        parseFloat(row.total_cost) /
                          parseFloat(row.total_revenue)) *
                        1000,
                    ) / 10
                  : null,
            },
          });
        } else if (action === "usage_summary") {
          const result = await pool.query(
            `SELECT model, model_provider, COUNT(*) as event_count,
             COALESCE(SUM(cost_amount), 0) as total_cost,
             COALESCE(SUM(usage_units), 0) as total_usage
             FROM observe_events ${whereClause}
             GROUP BY model, model_provider ORDER BY total_cost DESC LIMIT 20`,
            filterValues,
          );
          res.json({
            action: "usage_summary",
            period,
            filters: { feature, agent, customer },
            data: result.rows.map((r) => ({
              model: r.model,
              provider: r.model_provider,
              event_count: parseInt(r.event_count),
              total_cost: parseFloat(r.total_cost),
              total_usage: parseFloat(r.total_usage),
            })),
          });
        } else if (action === "margin_analysis") {
          const result = await pool.query(
            `SELECT feature_key, COUNT(*) as event_count,
             COALESCE(SUM(cost_amount), 0) as total_cost,
             COALESCE(SUM(revenue_amount), 0) as total_revenue,
             CASE WHEN SUM(revenue_amount) > 0
               THEN ROUND((1 - SUM(cost_amount)/SUM(revenue_amount)) * 100, 1)
               ELSE NULL END as margin_pct
             FROM observe_events ${whereClause}
             GROUP BY feature_key ORDER BY total_cost DESC LIMIT 20`,
            filterValues,
          );
          res.json({
            action: "margin_analysis",
            period,
            filters: { feature, agent, customer },
            data: result.rows.map((r) => ({
              feature: r.feature_key,
              event_count: parseInt(r.event_count),
              total_cost: parseFloat(r.total_cost),
              total_revenue: parseFloat(r.total_revenue),
              margin_pct: r.margin_pct ? parseFloat(r.margin_pct) : null,
            })),
          });
        } else {
          res.status(400).json({
            error: `Unknown action: ${action}`,
            available_actions: [
              "cost_query",
              "usage_summary",
              "margin_analysis",
            ],
          });
        }
      } catch (error) {
        console.error("A2A query error:", error);
        res.status(500).json({ error: "Query failed" });
      }
    },
  );

  return router;
}
