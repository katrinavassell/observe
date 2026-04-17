import { Router, Response } from "express";
import type { Pool } from "pg";
import { readFileSync } from "fs";
import { join } from "path";
import { type AuthRequest } from "./auth.js";

async function resolveAccountIdForUser(
  pool: Pool,
  userId: string,
  accountId?: number,
): Promise<number | null> {
  if (accountId !== undefined) return accountId;
  try {
    const result = await pool.query(
      `SELECT account_id FROM user_accounts
        WHERE user_id = (SELECT id FROM users WHERE visitor_id = $1)
          AND role = 'owner' LIMIT 1`,
      [userId],
    );
    if (result.rows[0]) return result.rows[0].account_id;
  } catch (err) {
    console.error("chat: account_id fallback lookup failed:", err);
  }
  console.warn("chat: no account_id resolved for user", userId);
  return null;
}

// ── Agent loader ─────────────────────────────────────────────────────────
// Agent personas live in `files/agents/*.md` which is gitignored — the
// OSS repo ships with sensible defaults and private deployments can drop
// in their own prompts without leaking IP into the public repo.

type AgentKey = "default" | "pricing" | "optimization" | "setup-qa";

function loadAgentPrompt(key: AgentKey): string | null {
  const candidates = [
    join(process.cwd(), "files", "agents", `${key}.md`),
    join(process.cwd(), "..", "files", "agents", `${key}.md`),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf-8");
    } catch {
      // File missing on this machine — try next candidate.
    }
  }
  return null;
}

// Cached at module load. Null means "file missing — fall back to built-in".
const AGENT_PROMPTS: Record<AgentKey, string | null> = {
  default: loadAgentPrompt("default"),
  pricing: loadAgentPrompt("pricing"),
  optimization: loadAgentPrompt("optimization"),
  "setup-qa": loadAgentPrompt("setup-qa"),
};

function pickAgentKey(route: string | undefined): AgentKey {
  if (!route) return "default";
  if (route.startsWith("/plans") || route.startsWith("/pricing"))
    return "pricing";
  if (route.startsWith("/data-sources") || route.startsWith("/onboarding"))
    return "setup-qa";
  if (
    route.startsWith("/analytics") ||
    route.startsWith("/models") ||
    route.startsWith("/cohorts") ||
    route.startsWith("/routing") ||
    route.startsWith("/customers")
  )
    return "optimization";
  return "default";
}

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

  async function gatherDataContext(
    userId: string,
    accountId: number | null,
  ): Promise<string> {
    const [features, customers, models, overall, routing, alerts, recs] =
      await Promise.all([
        pool.query(
          `SELECT feature_key, COUNT(*) as events,
         COALESCE(SUM(cost_amount),0) as cost, COALESCE(SUM(revenue_amount),0) as revenue
       FROM observe_events WHERE account_id = $1 AND feature_key IS NOT NULL
       GROUP BY feature_key ORDER BY cost DESC LIMIT 10`,
          [accountId],
        ),
        pool.query(
          `SELECT oe.customer_id, c.name as customer_name,
         COUNT(*) as events, COALESCE(SUM(oe.cost_amount),0) as cost,
         COALESCE(SUM(oe.revenue_amount),0) as revenue
       FROM observe_events oe
       LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
       WHERE oe.account_id = $1 AND oe.customer_id IS NOT NULL
       GROUP BY oe.customer_id, c.name ORDER BY cost DESC LIMIT 10`,
          [accountId],
        ),
        pool.query(
          `SELECT model, model_provider, COUNT(*) as events,
         COALESCE(SUM(cost_amount),0) as cost
       FROM observe_events WHERE account_id = $1 AND model IS NOT NULL
       GROUP BY model, model_provider ORDER BY cost DESC LIMIT 10`,
          [accountId],
        ),
        pool.query(
          `SELECT COUNT(*) as total_events,
         COALESCE(SUM(cost_amount),0) as total_cost,
         COALESCE(SUM(revenue_amount),0) as total_revenue
       FROM observe_events WHERE account_id = $1`,
          [accountId],
        ),
        pool.query(
          `SELECT rc.name, rc.is_active,
         (SELECT COUNT(*) FROM routing_targets rt WHERE rt.config_id = rc.id) as target_count,
         (SELECT COUNT(*) FROM routing_rules rr WHERE rr.config_id = rc.id) as rule_count
       FROM routing_configs rc WHERE rc.account_id = $1`,
          [accountId],
        ),
        pool.query(
          `SELECT name, metric, operator, threshold, enabled
       FROM alert_rules WHERE account_id = $1 LIMIT 10`,
          [accountId],
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
  // Built-in fallback used when files/agents/default.md is missing (OSS users
  // who don't have the private agent files). Keeps the chat functional out of
  // the box.

  const BUILTIN_DEFAULT_PROMPT = `You are the Observe AI assistant. You help users understand their AI costs, optimize margins, and take action.

You have access to the user's real-time data (provided below). When answering:
- Be specific with numbers from their data
- When suggesting actions, describe exactly what you'll do
- Keep responses concise and actionable`;

  // Action contract is always appended to whichever persona is selected, so
  // every agent can emit one-click actions without restating the schema.
  const ACTION_CONTRACT = `

## Action contract

Available actions the user can execute with one click:
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

  function buildSystemPrompt(agentKey: AgentKey): string {
    const persona =
      AGENT_PROMPTS[agentKey] ||
      AGENT_PROMPTS.default ||
      BUILTIN_DEFAULT_PROMPT;
    return `${persona}${ACTION_CONTRACT}`;
  }

  // ── Chat endpoint ──────────────────────────────────────────────────────

  router.post(
    "/chat",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { messages, route } = req.body as {
          messages: Array<{ role: string; content: string }>;
          route?: string;
        };
        if (!Array.isArray(messages) || messages.length === 0) {
          return res.status(400).json({ error: "messages array is required" });
        }

        // Route may come in the body directly, or embedded in a system
        // prefix message ("The user is currently on the /analytics page.")
        // sent by the drawer. Prefer the explicit body param when present.
        let effectiveRoute = route;
        if (!effectiveRoute) {
          const prefix = messages.find(
            (m) =>
              m.role === "system" &&
              /user is currently on the \S+ page/i.test(m.content || ""),
          );
          const match = prefix?.content.match(
            /user is currently on the (\S+) page/i,
          );
          if (match) effectiveRoute = match[1];
        }
        const agentKey = pickAgentKey(effectiveRoute);

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
        const dataContext = await gatherDataContext(
          req.visitorId!,
          await resolveAccountIdForUser(pool, req.visitorId!, req.accountId),
        );

        const systemMessage = `${buildSystemPrompt(agentKey)}\n\n${dataContext}`;

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
          } catch (parseErr) {
            console.error(
              "Malformed action JSON from LLM:",
              actionMatch[1],
              parseErr,
            );
          }
        }

        // Log chat usage
        const usage = data.usage as
          | {
              prompt_tokens?: number;
              completion_tokens?: number;
            }
          | undefined;
        const requestBodyForLog = {
          model: "gpt-4o-mini",
          messages: messages.slice(-10),
        };
        const responseBodyForLog = {
          content,
          usage,
        };
        pool
          .query(
            `INSERT INTO observe_events (user_id, account_id, feature_key, event_name, timestamp, cost_amount, cost_unit, usage_units, model, model_provider, source, granularity, is_inferred, request_body, response_body)
           VALUES ($1, $2, 'ai_chat', 'chat', NOW(), $3, 'usd', $4, 'gpt-4o-mini', 'openai', 'internal', 'event', false, $5, $6)`,
            [
              req.visitorId,
              req.accountId ?? null,
              (
                (usage?.prompt_tokens || 0) * 0.00000015 +
                (usage?.completion_tokens || 0) * 0.0000006
              ).toFixed(6),
              (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0),
              JSON.stringify(requestBodyForLog),
              JSON.stringify(responseBodyForLog),
            ],
          )
          .catch((err) => console.error("Chat usage logging failed:", err));

        // Count against AI message quota (ai_insights table is what billing checks)
        pool
          .query(
            `INSERT INTO ai_insights (user_id, account_id, insight_type, title, description, tokens_used, cost_usd)
           VALUES ($1, $2, 'chat', 'Chat message', $3, $4, $5)`,
            [
              req.visitorId,
              req.accountId ?? null,
              content.slice(0, 200),
              (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0),
              (
                (usage?.prompt_tokens || 0) * 0.00000015 +
                (usage?.completion_tokens || 0) * 0.0000006
              ).toFixed(6),
            ],
          )
          .catch((err) => console.error("Chat insight logging failed:", err));

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
              "SELECT id FROM routing_configs WHERE account_id = $1 AND name = $2 AND is_active = true",
              [req.accountId ?? null, action.config_name || "default"],
            );
            if (configResult.rows.length === 0) {
              return res.json({
                success: false,
                message:
                  "No active routing config found. Create one at /routing first.",
              });
            }
            const configId = configResult.rows[0].id;

            // Find target — require a valid target_id
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

            if (!targetId) {
              return res.json({
                success: false,
                message: `No matching target found for ${action.target_provider || "unknown"}/${action.target_model || "unknown"}. Add a target in /routing first.`,
              });
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
            const VALID_METRICS = [
              "daily_cost",
              "margin_percent",
              "cost_per_event",
              "customer_margin",
              "feature_margin_trend",
              "customer_cost_vs_revenue",
              "model_cost_spike",
              "usage_velocity",
              "customer_cost_share",
              "credit_burn_rate",
              "top_customer_unprofitable",
              "feature_cost_disparity",
              "model_cost_increase",
              "margin_compression",
              "customer_concentration",
              "provider_concentration",
              "model_concentration",
            ];
            const VALID_OPERATORS = ["gt", "lt", "gte", "lte"];
            const metric = action.metric || "daily_cost";
            const operator = action.operator || "gt";
            if (!VALID_METRICS.includes(metric)) {
              return res
                .status(400)
                .json({ error: `Invalid metric: ${metric}` });
            }
            if (!VALID_OPERATORS.includes(operator)) {
              return res
                .status(400)
                .json({ error: `Invalid operator: ${operator}` });
            }
            await pool.query(
              `INSERT INTO alert_rules (user_id, account_id, name, metric, operator, threshold, email, cooldown_minutes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 60)`,
              [
                req.visitorId,
                req.accountId ?? null,
                action.name || "Chat-created alert",
                metric,
                operator,
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
