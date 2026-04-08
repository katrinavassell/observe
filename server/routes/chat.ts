import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";

export function createChatRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    checkBillingFeatureAccess: (
      visitorId: string,
      featureKey: string,
      email?: string,
    ) => Promise<{ allowed: boolean; reason?: string }>;
  },
) {
  const router = Router();

  // ── Gather context for the LLM ─────────────────────────────────────────

  async function gatherDataContext(userId: string): Promise<string> {
    const [features, customers, models, overall, routing, alerts, recs] =
      await Promise.all([
        pool.query(
          `SELECT feature_key, COUNT(*) as events,
         COALESCE(SUM(cost_amount),0) as cost, COALESCE(SUM(revenue_amount),0) as revenue
       FROM observe_events WHERE user_id = $1 AND feature_key IS NOT NULL
       GROUP BY feature_key ORDER BY cost DESC LIMIT 10`,
          [userId],
        ),
        pool.query(
          `SELECT oe.customer_id, c.name as customer_name,
         COUNT(*) as events, COALESCE(SUM(oe.cost_amount),0) as cost,
         COALESCE(SUM(oe.revenue_amount),0) as revenue
       FROM observe_events oe
       LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
       WHERE oe.user_id = $1 AND oe.customer_id IS NOT NULL
       GROUP BY oe.customer_id, c.name ORDER BY cost DESC LIMIT 10`,
          [userId],
        ),
        pool.query(
          `SELECT model, model_provider, COUNT(*) as events,
         COALESCE(SUM(cost_amount),0) as cost
       FROM observe_events WHERE user_id = $1 AND model IS NOT NULL
       GROUP BY model, model_provider ORDER BY cost DESC LIMIT 10`,
          [userId],
        ),
        pool.query(
          `SELECT COUNT(*) as total_events,
         COALESCE(SUM(cost_amount),0) as total_cost,
         COALESCE(SUM(revenue_amount),0) as total_revenue
       FROM observe_events WHERE user_id = $1`,
          [userId],
        ),
        pool.query(
          `SELECT rc.name, rc.is_active,
         (SELECT COUNT(*) FROM routing_targets rt WHERE rt.config_id = rc.id) as target_count,
         (SELECT COUNT(*) FROM routing_rules rr WHERE rr.config_id = rc.id) as rule_count
       FROM routing_configs rc WHERE rc.user_id = $1`,
          [userId],
        ),
        pool.query(
          `SELECT name, metric, operator, threshold, enabled
       FROM alert_rules WHERE user_id = $1 LIMIT 10`,
          [userId],
        ),
        pool.query(
          `SELECT type, title, severity, status FROM recommendations
       WHERE user_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 10`,
          [userId],
        ),
      ]);

    const o = overall.rows[0] || {};
    const totalCost = parseFloat(o.total_cost) || 0;
    const totalRevenue = parseFloat(o.total_revenue) || 0;
    const marginPct =
      totalRevenue > 0
        ? (((totalRevenue - totalCost) / totalRevenue) * 100).toFixed(1)
        : "N/A";

    let ctx = `## User's Data Summary\n`;
    ctx += `Total events: ${o.total_events || 0}, Total cost: $${totalCost.toFixed(2)}, Total revenue: $${totalRevenue.toFixed(2)}, Margin: ${marginPct}%\n\n`;

    if (features.rows.length > 0) {
      ctx += `## Features (by cost)\n`;
      for (const f of features.rows) {
        const cost = parseFloat(f.cost);
        const rev = parseFloat(f.revenue);
        const m = rev > 0 ? (((rev - cost) / rev) * 100).toFixed(0) : "N/A";
        ctx += `- ${f.feature_key}: ${f.events} events, $${cost.toFixed(2)} cost, $${rev.toFixed(2)} revenue, ${m}% margin\n`;
      }
      ctx += "\n";
    }

    if (customers.rows.length > 0) {
      ctx += `## Customers (by cost)\n`;
      for (const c of customers.rows) {
        const cost = parseFloat(c.cost);
        const rev = parseFloat(c.revenue);
        const m = rev > 0 ? (((rev - cost) / rev) * 100).toFixed(0) : "N/A";
        ctx += `- ${c.customer_name || c.customer_id}: ${c.events} events, $${cost.toFixed(2)} cost, $${rev.toFixed(2)} revenue, ${m}% margin\n`;
      }
      ctx += "\n";
    }

    if (models.rows.length > 0) {
      ctx += `## Models (by cost)\n`;
      for (const m of models.rows) {
        ctx += `- ${m.model} (${m.model_provider || "unknown"}): ${m.events} events, $${parseFloat(m.cost).toFixed(2)} cost\n`;
      }
      ctx += "\n";
    }

    if (routing.rows.length > 0) {
      ctx += `## Routing Configs\n`;
      for (const r of routing.rows) {
        ctx += `- ${r.name}: ${r.is_active ? "active" : "inactive"}, ${r.target_count} targets, ${r.rule_count} rules\n`;
      }
      ctx += "\n";
    }

    if (alerts.rows.length > 0) {
      ctx += `## Alert Rules\n`;
      for (const a of alerts.rows) {
        ctx += `- ${a.name}: ${a.metric} ${a.operator} ${a.threshold} (${a.enabled ? "enabled" : "disabled"})\n`;
      }
      ctx += "\n";
    }

    if (recs.rows.length > 0) {
      ctx += `## Pending Recommendations\n`;
      for (const r of recs.rows) {
        ctx += `- [${r.severity}] ${r.title} (${r.type})\n`;
      }
    }

    return ctx;
  }

  // ── System prompt ──────────────────────────────────────────────────────

  const SYSTEM_PROMPT = `You are the Observe AI assistant. You help users understand their AI costs, optimize margins, and take action.

You have access to the user's real-time data (provided below). When answering:
- Be specific with numbers from their data
- When suggesting actions, describe exactly what you'll do
- For routing changes, specify the provider, model, and customer
- For alerts, specify the metric, threshold, and condition
- Keep responses concise and actionable

Available actions you can suggest (the user can execute these with one click):
- Create a routing rule to route specific customers to cheaper models
- Create an alert for cost spikes or margin drops
- Switch a routing target to a different model
- Add a fallback provider for reliability
- Create a customer cohort to group customers for routing or analysis

When the user asks you to DO something (not just analyze), respond with a JSON action block that the system can execute:
\`\`\`action
{"type": "create_routing_rule", "config_name": "default", "field": "customer_id", "operator": "eq", "value": "acme", "target_provider": "openai", "target_model": "gpt-4o-mini"}
\`\`\`

For alerts:
\`\`\`action
{"type": "create_alert", "name": "Cost spike alert", "metric": "daily_cost", "operator": "gt", "threshold": 100}
\`\`\`

For static cohorts (specific customers):
\`\`\`action
{"type": "create_cohort", "name": "EU Enterprise", "description": "High-value EU customers", "customer_ids": ["acme", "siemens", "bmw"]}
\`\`\`

For dynamic/rule-based cohorts (auto-updating based on data):
\`\`\`action
{"type": "create_cohort", "name": "Unprofitable Customers", "description": "Customers with negative margin", "cohort_type": "dynamic", "rules": [{"field": "margin_pct", "operator": "lt", "value": 0}]}
\`\`\`

Available rule fields: margin_pct, total_cost, total_revenue, health_score, active_days_30d, cohort.
Available operators: gt, lt, gte, lte, eq, neq.
Prefer dynamic cohorts when the user describes a condition (e.g. "unprofitable customers", "high-cost customers") rather than naming specific customers.

Only include action blocks when the user explicitly asks you to do something. For analysis questions, just answer with text.`;

  // ── Chat endpoint ──────────────────────────────────────────────────────

  router.post(
    "/chat",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { messages } = req.body;
        if (!Array.isArray(messages) || messages.length === 0) {
          return res.status(400).json({ error: "messages array is required" });
        }

        // Check billing access
        const access = await deps.checkBillingFeatureAccess(
          req.visitorId!,
          "ai_insights",
          req.accountEmail,
        );
        if (!access.allowed) {
          return res.status(403).json({
            error: access.reason || "AI chat limit reached. Upgrade for more.",
          });
        }

        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
          return res.status(500).json({ error: "AI chat not configured" });
        }

        // Gather data context
        const dataContext = await gatherDataContext(req.visitorId!);

        const systemMessage = `${SYSTEM_PROMPT}\n\n${dataContext}`;

        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openaiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: systemMessage },
                ...messages.slice(-10), // last 10 messages for context window
              ],
              temperature: 0.3,
              max_tokens: 1000,
            }),
          },
        );

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          console.error("Chat LLM error:", err);
          return res.status(502).json({ error: "AI service unavailable" });
        }

        const data = (await response.json()) as Record<string, unknown>;
        const choice = (
          data.choices as Array<{
            message: { content: string };
          }>
        )?.[0];
        const content = choice?.message?.content || "";

        // Parse action blocks if present
        const actionMatch = content.match(/```action\n([\s\S]*?)\n```/);
        let action = null;
        if (actionMatch) {
          try {
            action = JSON.parse(actionMatch[1]);
          } catch {
            // Malformed action JSON, ignore
          }
        }

        // Log chat usage
        const usage = data.usage as
          | {
              prompt_tokens?: number;
              completion_tokens?: number;
            }
          | undefined;
        pool
          .query(
            `INSERT INTO observe_events (user_id, event_name, timestamp, cost_amount, cost_unit, usage_units, model, model_provider, source, granularity, is_inferred)
           VALUES ($1, 'chat', NOW(), $2, 'usd', $3, 'gpt-4o-mini', 'openai', 'internal', 'event', false)`,
            [
              req.visitorId,
              (
                (usage?.prompt_tokens || 0) * 0.00000015 +
                (usage?.completion_tokens || 0) * 0.0000006
              ).toFixed(6),
              (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0),
            ],
          )
          .catch((err) => console.error("Chat usage logging failed:", err));

        res.json({
          message: content,
          action,
          usage: {
            prompt_tokens: usage?.prompt_tokens || 0,
            completion_tokens: usage?.completion_tokens || 0,
          },
        });
      } catch (error) {
        console.error("POST /chat error:", error);
        res.status(500).json({ error: "Chat request failed" });
      }
    },
  );

  // ── Execute action from chat ───────────────────────────────────────────

  router.post(
    "/chat/execute",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { action } = req.body;
        if (!action || !action.type) {
          return res
            .status(400)
            .json({ error: "action with type is required" });
        }

        switch (action.type) {
          case "create_routing_rule": {
            const configResult = await pool.query(
              "SELECT id FROM routing_configs WHERE user_id = $1 AND name = $2 AND is_active = true",
              [req.visitorId, action.config_name || "default"],
            );
            if (configResult.rows.length === 0) {
              return res.json({
                success: false,
                message:
                  "No active routing config found. Create one at /routing first.",
              });
            }
            const configId = configResult.rows[0].id;

            // Find or suggest target
            let targetId = null;
            if (action.target_provider && action.target_model) {
              const targetResult = await pool.query(
                "SELECT id FROM routing_targets WHERE config_id = $1 AND provider = $2 AND model = $3",
                [configId, action.target_provider, action.target_model],
              );
              if (targetResult.rows.length > 0) {
                targetId = targetResult.rows[0].id;
              }
            }

            await pool.query(
              "INSERT INTO routing_rules (config_id, field, operator, value, target_id) VALUES ($1, $2, $3, $4, $5)",
              [
                configId,
                action.field || "customer_id",
                action.operator || "eq",
                action.value,
                targetId,
              ],
            );
            return res.json({
              success: true,
              message: `Routing rule created: ${action.field || "customer_id"} ${action.operator || "eq"} "${action.value}"`,
            });
          }

          case "create_alert": {
            await pool.query(
              `INSERT INTO alert_rules (user_id, name, metric, operator, threshold, email, cooldown_minutes)
             VALUES ($1, $2, $3, $4, $5, $6, 60)`,
              [
                req.visitorId,
                action.name || "Chat-created alert",
                action.metric || "daily_cost",
                action.operator || "gt",
                action.threshold || 100,
                req.accountEmail || "noreply@observemetrics.com",
              ],
            );
            return res.json({
              success: true,
              message: `Alert created: ${action.name || "Chat-created alert"}`,
            });
          }

          case "create_cohort": {
            const cohortType =
              action.cohort_type === "dynamic" ? "dynamic" : "static";
            const rules =
              cohortType === "dynamic" && Array.isArray(action.rules)
                ? JSON.stringify(action.rules)
                : null;

            const cohortResult = await pool.query(
              "INSERT INTO custom_cohorts (user_id, name, description, cohort_type, rules) VALUES ($1, $2, $3, $4, $5) RETURNING id",
              [
                req.visitorId,
                action.name || "Chat-created cohort",
                action.description || null,
                cohortType,
                rules,
              ],
            );
            const cohortId = cohortResult.rows[0].id;

            if (
              cohortType === "static" &&
              Array.isArray(action.customer_ids) &&
              action.customer_ids.length > 0
            ) {
              const values = (action.customer_ids as string[])
                .map((_: string, i: number) => `($1, $${i + 2})`)
                .join(", ");
              await pool.query(
                `INSERT INTO cohort_members (cohort_id, customer_id) VALUES ${values} ON CONFLICT DO NOTHING`,
                [cohortId, ...(action.customer_ids as string[])],
              );
            }

            const msg =
              cohortType === "dynamic"
                ? `Dynamic cohort "${action.name}" created with ${(action.rules as any[])?.length || 0} rule(s)`
                : `Cohort "${action.name}" created with ${(action.customer_ids as string[])?.length || 0} members`;
            return res.json({ success: true, message: msg });
          }

          default:
            return res.json({
              success: false,
              message: `Unknown action type: ${action.type}`,
            });
        }
      } catch (error) {
        console.error("POST /chat/execute error:", error);
        res.status(500).json({ error: "Failed to execute action" });
      }
    },
  );

  return router;
}
