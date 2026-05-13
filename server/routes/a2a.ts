import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";

export function createA2ARoutes(pool: Pool, ensureAuth: any) {
  const router = Router();

  // GET /a2a/agent-card — A2A Agent Card for discovery
  // Also accessible at /.well-known/agent.json via Vercel rewrite
  router.get("/a2a/agent-card", (_req, res: Response) => {
    res.json({
      name: "Observe Cost Tracker",
      description:
        "AI cost observability — query cost, usage, and margin data for LLM calls",
      url: process.env.APP_URL || "http://localhost:3000",
      version: "1.0.0",
      capabilities: [
        "cost_query",
        "usage_summary",
        "margin_analysis",
        "model_breakdown",
        "agent_breakdown",
        "trace_query",
        "cost_type_filter",
        "alert_management",
        "customer_analytics",
        "feature_analytics",
        "recommendation_engine",
      ],
      authentication: {
        type: "bearer",
        header: "Observe-Key",
        description:
          "SDK API key (obs_*) from Data Sources. Pass as Authorization: Bearer obs_... or Observe-Key header. Legacy: x-tanso-key.",
      },
      endpoints: {
        query: "/a2a/query",
        ingest: "/api/events/ingest",
        events: "/api/events",
        events_by_model: "/api/events/by-model",
        events_by_feature: "/api/events/by-feature",
        events_by_agent: "/api/events/by-agent",
        events_by_customer: "/api/events/by-customer",
        traces: "/api/events/traces",
        features: "/api/features",
        models: "/api/models",
        customers: "/api/customers",
        alerts: "/api/alerts",
        analytics_overview: "/api/analytics/overview",
        analytics_trends: "/api/analytics/trends",
        recommendations: "/api/recommendations",
        cohorts: "/api/cohorts",
        feature_definitions: "/api/feature-definitions",
        feature_pricing: "/api/feature-pricing",
      },
    });
  });

  // POST /a2a/query — Respond to cost queries from other agents
  router.post(
    "/a2a/query",
    ensureAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const { action, params } = req.body || {};

        if (!action || typeof action !== "string") {
          return res.status(400).json({
            error:
              "action is required (cost_query, usage_summary, margin_analysis)",
          });
        }

        const accountId = req.accountId ?? null;
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
        const filterValues: unknown[] = [accountId];
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
        if (params?.cost_type) {
          filters.push(`AND COALESCE(cost_type, 'llm') = $${paramIdx++}`);
          filterValues.push(params.cost_type);
        }

        const whereClause = `WHERE account_id = $1 ${dateFilter} ${filters.join(" ")}`;

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
        } else if (action === "trace_query") {
          const traceId = params?.trace_id;
          if (!traceId) {
            return res
              .status(400)
              .json({ error: "params.trace_id is required for trace_query" });
          }
          const result = await pool.query(
            `SELECT id, customer_id, feature_key, event_name, timestamp,
             cost_amount, revenue_amount, usage_units, model, model_provider,
             agent_id, trace_id, span_id, parent_span_id, duration_ms, cost_type
             FROM observe_events
             WHERE account_id = $1 AND trace_id = $2
             ORDER BY timestamp ASC`,
            [accountId, traceId],
          );
          res.json({
            action: "trace_query",
            trace_id: traceId,
            data: {
              span_count: result.rows.length,
              total_cost: result.rows.reduce(
                (s, r) => s + parseFloat(r.cost_amount || 0),
                0,
              ),
              spans: result.rows,
            },
          });
        } else {
          res.status(400).json({
            error: `Unknown action: ${action}`,
            available_actions: [
              "cost_query",
              "usage_summary",
              "margin_analysis",
              "trace_query",
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
