import { Router, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { type AuthRequest } from "./auth.js";

// Server metric set must match the 8 shown in src/pages/AlertsPage.vue.
// Dropped in a previous commit (frontend-only) but server still accepted
// them — creating a state where an API client could create alert rules
// using metrics the UI couldn't display. Now aligned.
const alertRuleSchema = z.object({
  name: z.string().min(1).max(100),
  metric: z.enum([
    "daily_cost",
    "margin_percent",
    "customer_margin",
    "usage_velocity",
    "customer_cost_share",
    "top_customer_unprofitable",
    "model_cost_increase",
    "customer_concentration",
  ]),
  operator: z.enum(["gt", "lt", "gte", "lte"]),
  threshold: z.coerce.number(),
  email: z.string().email().optional().or(z.literal("")),
  webhook_url: z.string().url().optional().or(z.literal("")),
  cooldown_minutes: z.coerce.number().int().min(1).default(60),
});

const METRIC_QUERIES: Record<string, string> = {
  daily_cost: `SELECT COALESCE(SUM(cost_amount), 0) as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'`,
  margin_percent: `SELECT CASE WHEN COALESCE(SUM(revenue_amount), 0) = 0 THEN 0 ELSE ((SUM(revenue_amount) - SUM(cost_amount)) / SUM(revenue_amount) * 100) END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'`,
  customer_margin: `SELECT CASE WHEN COALESCE(SUM(revenue_amount), 0) = 0 THEN 0 ELSE MIN((revenue_amount - cost_amount) / NULLIF(revenue_amount, 0) * 100) END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND customer_id IS NOT NULL GROUP BY customer_id ORDER BY value ASC LIMIT 1`,
  usage_velocity: `SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE (SELECT COUNT(*)::float / NULLIF((SELECT COUNT(*)::float / 7 FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND timestamp < NOW() - INTERVAL '1 day'), 0) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours' GROUP BY customer_id ORDER BY 1 DESC LIMIT 1) END as value FROM observe_events WHERE user_id = $1`,
  customer_cost_share: `SELECT CASE WHEN COALESCE(SUM(cost_amount), 0) = 0 THEN 0 ELSE (SELECT SUM(cost_amount) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' GROUP BY customer_id ORDER BY 1 DESC LIMIT 1) / SUM(cost_amount) * 100 END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'`,
  top_customer_unprofitable: `SELECT COUNT(*) as value FROM (SELECT customer_id, SUM(revenue_amount) - SUM(cost_amount) as profit FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND customer_id IS NOT NULL GROUP BY customer_id ORDER BY SUM(cost_amount) DESC LIMIT 10) t WHERE profit < 0`,
  model_cost_increase: `SELECT COALESCE((SELECT AVG(cost_amount) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '7 days' AND model IS NOT NULL) / NULLIF((SELECT AVG(cost_amount) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '14 days' AND timestamp < NOW() - INTERVAL '7 days' AND model IS NOT NULL), 0) * 100 - 100, 0) as value`,
  customer_concentration: `SELECT CASE WHEN COALESCE(SUM(cost_amount), 0) = 0 THEN 0 ELSE (SELECT SUM(cost_amount) FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' GROUP BY customer_id ORDER BY 1 DESC LIMIT 1) / SUM(cost_amount) * 100 END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'`,
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
  customer_margin: "Lowest customer margin",
  usage_velocity: "Usage velocity vs. average",
  customer_cost_share: "Top customer cost share",
  top_customer_unprofitable: "Unprofitable top-10 customers",
  model_cost_increase: "Model cost increase (WoW %)",
  customer_concentration: "Customer concentration risk",
};

const TANSO_UPSELLS: Record<string, string> = {
  customer_margin: "Want to cap unprofitable customers automatically?",
  usage_velocity: "Want to set velocity limits?",
  customer_cost_share: "Want to set usage caps per customer?",
  top_customer_unprofitable: "Want to reprice these customers automatically?",
  model_cost_increase: "Want to auto-switch to cost-effective models?",
  customer_concentration: "Want to set concentration risk limits?",
};

function formatValue(metric: string, value: number): string {
  if (metric === "margin_percent") return `${value.toFixed(1)}%`;
  return `$${value.toFixed(4)}`;
}

async function sendAlertEmail(
  to: string,
  rule: { name: string; metric: string; operator: string; threshold: number },
  currentValue: number,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set, skipping alert email");
    return false;
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
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to send alert email:", err);
    return false;
  }
}

async function sendAlertWebhook(
  url: string,
  rule: { name: string; metric: string; operator: string; threshold: number },
  currentValue: number,
): Promise<boolean> {
  const metricLabel = METRIC_LABELS[rule.metric] || rule.metric;
  const operatorLabel = OPERATOR_LABELS[rule.operator] || rule.operator;
  const summary = `*${rule.name}*: ${metricLabel} ${operatorLabel} ${formatValue(rule.metric, rule.threshold)} — now ${formatValue(rule.metric, currentValue)}`;

  // Slack-compatible payload (text + blocks). Generic webhooks that
  // accept arbitrary JSON will still get the full structured payload.
  const payload = {
    text: summary,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: summary },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Observe cost alert · \`${rule.metric}\``,
          },
        ],
      },
    ],
    // Raw fields for non-Slack webhook consumers:
    alert_name: rule.name,
    metric: rule.metric,
    operator: rule.operator,
    threshold: rule.threshold,
    current_value: currentValue,
    triggered_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(
        "Alert webhook failed:",
        res.status,
        await res.text().catch(() => ""),
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to send alert webhook:", err);
    return false;
  }
}

export async function checkAlerts(pool: Pool, userId: string) {
  try {
    const { rows: rules } = await pool.query(
      `SELECT * FROM alert_rules WHERE user_id = $1 AND enabled = true`,
      [userId],
    );

    for (const rule of rules) {
      try {
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
          let delivered = false;

          // Email channel
          if (rule.email) {
            const ok = await sendAlertEmail(rule.email, rule, currentValue);
            delivered = delivered || ok;
          }

          // Webhook channel (Slack-compatible JSON POST)
          if (rule.webhook_url) {
            const ok = await sendAlertWebhook(
              rule.webhook_url,
              rule,
              currentValue,
            );
            delivered = delivered || ok;
          }

          // If at least one channel fired, record the trigger so we
          // don't spam while cooldown is active.
          if (delivered) {
            await pool.query(
              "UPDATE alert_rules SET last_triggered_at = NOW() WHERE id = $1",
              [rule.id],
            );
          }
        }
      } catch (ruleErr) {
        console.error(`checkAlerts rule ${rule.id} error:`, ruleErr);
      }
    }
  } catch (err) {
    console.error("checkAlerts error:", err);
  }
}

export function createAlertRoutes(
  pool: Pool,
  ensureVisitor: any,
  _deps: {
    checkTansoFeatureAccess: (
      visitorId: string,
      featureKey: string,
      email?: string,
    ) => Promise<{ allowed: boolean; reason?: string }>;
  },
) {
  const router = Router();

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
        const email =
          parsed.email && parsed.email.length > 0 ? parsed.email : null;
        const webhookUrl =
          parsed.webhook_url && parsed.webhook_url.length > 0
            ? parsed.webhook_url
            : null;
        if (!email && !webhookUrl) {
          return res.status(400).json({
            error:
              "Alert needs at least one delivery channel (email or webhook URL)",
          });
        }
        const { rows } = await pool.query(
          `INSERT INTO alert_rules (user_id, name, metric, operator, threshold, email, webhook_url, cooldown_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [
            req.visitorId,
            parsed.name,
            parsed.metric,
            parsed.operator,
            parsed.threshold,
            email,
            webhookUrl,
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
          "webhook_url",
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
