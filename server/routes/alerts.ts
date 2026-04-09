import { Router, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { type AuthRequest } from "./auth.js";

const alertRuleSchema = z.object({
  name: z.string().min(1).max(100),
  metric: z.enum([
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
  ]),
  operator: z.enum(["gt", "lt", "gte", "lte"]),
  threshold: z.coerce.number(),
  email: z.string().email(),
  cooldown_minutes: z.coerce.number().int().min(1).default(60),
});

const METRIC_QUERIES: Record<string, string> = {
  // Core cost metrics
  daily_cost: `SELECT COALESCE(SUM(cost_amount), 0) as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'`,
  margin_percent: `SELECT CASE WHEN COALESCE(SUM(revenue_amount), 0) = 0 THEN 0 ELSE ((SUM(revenue_amount) - SUM(cost_amount)) / SUM(revenue_amount) * 100) END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'`,
  cost_per_event: `SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE SUM(cost_amount) / COUNT(*) END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'`,
  // Margin signals
  customer_margin: `SELECT CASE WHEN COALESCE(SUM(revenue_amount), 0) = 0 THEN 0 ELSE MIN((revenue_amount - cost_amount) / NULLIF(revenue_amount, 0) * 100) END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND customer_id IS NOT NULL GROUP BY customer_id ORDER BY value ASC LIMIT 1`,
  feature_margin_trend: `SELECT COALESCE((SELECT AVG(margin) FROM (SELECT (SUM(revenue_amount) - SUM(cost_amount)) / NULLIF(SUM(revenue_amount), 0) * 100 as margin FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '7 days' GROUP BY feature_key) t) - (SELECT AVG(margin) FROM (SELECT (SUM(revenue_amount) - SUM(cost_amount)) / NULLIF(SUM(revenue_amount), 0) * 100 as margin FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '14 days' AND timestamp < NOW() - INTERVAL '7 days' GROUP BY feature_key) t), 0) as value`,
  customer_cost_vs_revenue: `SELECT CASE WHEN COUNT(DISTINCT customer_id) = 0 THEN 0 ELSE (SELECT COALESCE(SUM(cost_amount) / NULLIF(SUM(revenue_amount), 0) * 100, 0) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '7 days' GROUP BY customer_id ORDER BY SUM(cost_amount) / NULLIF(SUM(revenue_amount), 0) DESC LIMIT 1) END as value FROM observe_events WHERE user_id = $1`,
  model_cost_spike: `SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE (SELECT COALESCE(SUM(cost_amount) / COUNT(*), 0) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours' AND model IS NOT NULL GROUP BY model ORDER BY SUM(cost_amount) / COUNT(*) DESC LIMIT 1) END as value FROM observe_events WHERE user_id = $1`,
  // Abuse / runaway signals
  usage_velocity: `SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE (SELECT COUNT(*)::float / NULLIF((SELECT COUNT(*)::float / 7 FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND timestamp < NOW() - INTERVAL '1 day'), 0) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours' GROUP BY customer_id ORDER BY 1 DESC LIMIT 1) END as value FROM observe_events WHERE user_id = $1`,
  customer_cost_share: `SELECT CASE WHEN COALESCE(SUM(cost_amount), 0) = 0 THEN 0 ELSE (SELECT SUM(cost_amount) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' GROUP BY customer_id ORDER BY 1 DESC LIMIT 1) / SUM(cost_amount) * 100 END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'`,
  credit_burn_rate: `SELECT CASE WHEN COUNT(*) = 0 THEN 999 ELSE 24.0 END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'`,
  // Pricing signals
  top_customer_unprofitable: `SELECT COUNT(*) as value FROM (SELECT customer_id, SUM(revenue_amount) - SUM(cost_amount) as profit FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND customer_id IS NOT NULL GROUP BY customer_id ORDER BY SUM(cost_amount) DESC LIMIT 10) t WHERE profit < 0`,
  feature_cost_disparity: `SELECT CASE WHEN COUNT(DISTINCT feature_key) < 2 THEN 0 ELSE (SELECT MAX(avg_cost) / NULLIF(MIN(avg_cost), 0) FROM (SELECT feature_key, SUM(cost_amount) / COUNT(*) as avg_cost FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND feature_key IS NOT NULL GROUP BY feature_key) t) END as value FROM observe_events WHERE user_id = $1`,
  model_cost_increase: `SELECT COALESCE((SELECT AVG(cost_amount) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '7 days' AND model IS NOT NULL) / NULLIF((SELECT AVG(cost_amount) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '14 days' AND timestamp < NOW() - INTERVAL '7 days' AND model IS NOT NULL), 0) * 100 - 100, 0) as value`,
  margin_compression: `SELECT COALESCE((SELECT (SUM(revenue_amount) - SUM(cost_amount)) / NULLIF(SUM(revenue_amount), 0) * 100 FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days') - (SELECT (SUM(revenue_amount) - SUM(cost_amount)) / NULLIF(SUM(revenue_amount), 0) * 100 FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '60 days' AND timestamp < NOW() - INTERVAL '30 days'), 0) as value`,
  // Concentration risk
  customer_concentration: `SELECT CASE WHEN COALESCE(SUM(cost_amount), 0) = 0 THEN 0 ELSE (SELECT SUM(cost_amount) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' GROUP BY customer_id ORDER BY 1 DESC LIMIT 1) / SUM(cost_amount) * 100 END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'`,
  provider_concentration: `SELECT CASE WHEN COALESCE(SUM(cost_amount), 0) = 0 THEN 0 ELSE (SELECT SUM(cost_amount) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' GROUP BY model_provider ORDER BY 1 DESC LIMIT 1) / SUM(cost_amount) * 100 END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'`,
  model_concentration: `SELECT CASE WHEN COALESCE(SUM(cost_amount), 0) = 0 THEN 0 ELSE (SELECT SUM(cost_amount) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' GROUP BY model ORDER BY 1 DESC LIMIT 1) / SUM(cost_amount) * 100 END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'`,
};

const OPERATOR_FNS: Record<
  string,
  (val: number, threshold: number) => boolean
> = {
  gt: (v, t) => v > t,
  lt: (v, t) => v < t,
  gte: (v, t) => v >= t,
  lte: (v, t) => v <= t,
};

const OPERATOR_LABELS: Record<string, string> = {
  gt: "exceeded",
  lt: "dropped below",
  gte: "reached",
  lte: "dropped to",
};

const METRIC_LABELS: Record<string, string> = {
  daily_cost: "Daily cost",
  margin_percent: "Margin",
  cost_per_event: "Cost per event",
  customer_margin: "Lowest customer margin",
  feature_margin_trend: "Feature margin trend (WoW)",
  customer_cost_vs_revenue: "Worst customer cost/revenue ratio",
  model_cost_spike: "Highest model cost per request",
  usage_velocity: "Usage velocity vs. average",
  customer_cost_share: "Top customer cost share",
  credit_burn_rate: "Credit burn rate (hours remaining)",
  top_customer_unprofitable: "Unprofitable top-10 customers",
  feature_cost_disparity: "Feature cost disparity ratio",
  model_cost_increase: "Model cost increase (WoW %)",
  margin_compression: "Margin compression (30d trend)",
  customer_concentration: "Customer concentration risk",
  provider_concentration: "Provider concentration risk",
  model_concentration: "Model concentration risk",
};

const TANSO_UPSELLS: Record<string, string> = {
  customer_margin: "Want to cap unprofitable customers automatically?",
  feature_margin_trend: "Want to route to cheaper models or restrict usage?",
  customer_cost_vs_revenue: "Want to enforce spend limits per customer?",
  model_cost_spike: "Want to auto-route to cheaper models?",
  usage_velocity: "Want to set velocity limits?",
  customer_cost_share: "Want to set usage caps per customer?",
  credit_burn_rate: "Want to enforce a hard stop on credit exhaustion?",
  top_customer_unprofitable: "Want to reprice these customers automatically?",
  feature_cost_disparity: "Want to adjust pricing per feature?",
  model_cost_increase: "Want to auto-switch to cost-effective models?",
  margin_compression: "Want to auto-adjust pricing as costs change?",
  customer_concentration: "Want to set concentration risk limits?",
  provider_concentration: "Want to diversify provider routing?",
  model_concentration: "Want to balance model usage automatically?",
};

function formatValue(metric: string, value: number): string {
  if (metric === "margin_percent") return `${value.toFixed(1)}%`;
  return `$${value.toFixed(4)}`;
}

async function sendAlertEmail(
  to: string,
  rule: { name: string; metric: string; operator: string; threshold: number },
  currentValue: number,
) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set, skipping alert email");
    return;
  }

  const fromEmail = process.env.ALERT_FROM_EMAIL || "alerts@example.com";
  const metricLabel = METRIC_LABELS[rule.metric] || rule.metric;
  const operatorLabel = OPERATOR_LABELS[rule.operator] || rule.operator;
  const subject = `Alert: ${rule.name} — ${metricLabel} ${operatorLabel} ${formatValue(rule.metric, rule.threshold)}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="font-size: 18px; margin-bottom: 8px;">${rule.name}</h2>
      <p style="color: #666; margin-bottom: 16px;">
        <strong>${metricLabel}</strong> ${operatorLabel} your threshold of <strong>${formatValue(rule.metric, rule.threshold)}</strong>.
      </p>
      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <div style="font-size: 24px; font-weight: 700;">${formatValue(rule.metric, currentValue)}</div>
        <div style="color: #666; font-size: 13px;">Current ${metricLabel.toLowerCase()}</div>
      </div>
      ${
        TANSO_UPSELLS[rule.metric]
          ? `
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <p style="font-size: 14px; font-weight: 600; color: #166534; margin: 0 0 8px 0;">${TANSO_UPSELLS[rule.metric]}</p>
        <a href="https://tansohq.com?utm_source=observe&utm_medium=alert&utm_campaign=${rule.metric}" style="display: inline-block; background: #166534; color: #fff; padding: 8px 20px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600;">Automate with Tanso</a>
      </div>`
          : ""
      }
      <p style="color: #999; font-size: 12px;">
        Sent by Observe cost alerts. Manage your alerts in the dashboard.
      </p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from: fromEmail, to, subject, html }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("Resend email failed:", res.status, err);
    }
  } catch (err) {
    console.error("Failed to send alert email:", err);
  }
}

export async function checkAlerts(pool: Pool, userId: string) {
  try {
    const { rows: rules } = await pool.query(
      `SELECT * FROM alert_rules WHERE user_id = $1 AND enabled = true`,
      [userId],
    );

    for (const rule of rules) {
      // Check cooldown
      if (rule.last_triggered_at) {
        const cooldownMs = (rule.cooldown_minutes || 60) * 60 * 1000;
        if (
          Date.now() - new Date(rule.last_triggered_at).getTime() <
          cooldownMs
        )
          continue;
      }

      const query = METRIC_QUERIES[rule.metric];
      if (!query) continue;

      const { rows } = await pool.query(query, [userId]);
      const currentValue = parseFloat(rows[0]?.value) || 0;
      const operatorFn = OPERATOR_FNS[rule.operator];
      if (!operatorFn) continue;

      if (operatorFn(currentValue, parseFloat(rule.threshold))) {
        await sendAlertEmail(rule.email, rule, currentValue);
        await pool.query(
          "UPDATE alert_rules SET last_triggered_at = NOW() WHERE id = $1",
          [rule.id],
        );
      }
    }
  } catch (err) {
    console.error("checkAlerts error:", err);
  }
}

export function createAlertRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    checkTansoFeatureAccess: (
      visitorId: string,
      featureKey: string,
      email?: string,
    ) => Promise<{ allowed: boolean; reason?: string }>;
  },
) {
  const router = Router();
  const { checkTansoFeatureAccess } = deps;

  // List alert rules (+ entitlement status)
  router.get(
    "/alerts",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { rows } = await pool.query(
          "SELECT * FROM alert_rules WHERE user_id = $1 ORDER BY created_at DESC",
          [req.visitorId],
        );
        res.json({ rules: rows, gated: false });
      } catch (err) {
        console.error("GET /alerts error:", err);
        res.status(500).json({ error: "Failed to list alerts" });
      }
    },
  );

  // Create alert rule
  router.post(
    "/alerts",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const parsed = alertRuleSchema.parse(req.body);
        const { rows } = await pool.query(
          `INSERT INTO alert_rules (user_id, name, metric, operator, threshold, email, cooldown_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            req.visitorId,
            parsed.name,
            parsed.metric,
            parsed.operator,
            parsed.threshold,
            parsed.email,
            parsed.cooldown_minutes,
          ],
        );
        res.json(rows[0]);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res
            .status(400)
            .json({ error: err.issues[0]?.message || "Invalid input" });
        }
        console.error("POST /alerts error:", err);
        res.status(500).json({ error: "Failed to create alert" });
      }
    },
  );

  // Update alert rule
  const alertPatchSchema = alertRuleSchema.partial();

  router.patch(
    "/alerts/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const id = parseInt(req.params.id);

        const parsed = alertPatchSchema.parse(req.body);

        // Verify ownership
        const existing = await pool.query(
          "SELECT id FROM alert_rules WHERE id = $1 AND user_id = $2",
          [id, req.visitorId],
        );
        if (existing.rows.length === 0)
          return res.status(404).json({ error: "Alert not found" });

        const updates: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        for (const field of [
          "name",
          "metric",
          "operator",
          "threshold",
          "email",
          "enabled",
          "cooldown_minutes",
        ] as const) {
          const val = (parsed as Record<string, unknown>)[field];
          if (val !== undefined) {
            updates.push(`${field} = $${idx++}`);
            values.push(val);
          }
        }

        if (updates.length === 0)
          return res.status(400).json({ error: "No fields to update" });

        values.push(id);
        const { rows } = await pool.query(
          `UPDATE alert_rules SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
          values,
        );
        res.json(rows[0]);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res
            .status(400)
            .json({ error: err.issues[0]?.message || "Invalid input" });
        }
        console.error("PATCH /alerts/:id error:", err);
        res.status(500).json({ error: "Failed to update alert" });
      }
    },
  );

  // Delete alert rule
  router.delete(
    "/alerts/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const id = parseInt(req.params.id);
        const result = await pool.query(
          "DELETE FROM alert_rules WHERE id = $1 AND user_id = $2",
          [id, req.visitorId],
        );
        if (result.rowCount === 0)
          return res.status(404).json({ error: "Alert not found" });
        res.json({ success: true });
      } catch (err) {
        console.error("DELETE /alerts/:id error:", err);
        res.status(500).json({ error: "Failed to delete alert" });
      }
    },
  );

  return router;
}
