import { Router, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { type AuthRequest } from "./auth.js";

// Schema accepts the 4 global metrics exposed in the UI.
// Legacy metrics (usage_velocity, customer_cost_share, etc.) still evaluate
// in METRIC_QUERIES for existing DB rules — just not creatable from the UI.
const alertRuleSchema = z.object({
  name: z.string().min(1).max(100),
  metric: z
    .enum([
      "daily_cost",
      "margin_percent",
      "customer_margin",
      "customer_concentration",
    ])
    .optional(),
  operator: z.enum(["gt", "lt"]),
  threshold: z.coerce.number(),
  email: z.string().email().optional().or(z.literal("")),
  webhook_url: z.string().url().optional().or(z.literal("")),
  cooldown_minutes: z.coerce.number().int().min(1).default(60),
  trigger_type: z.string().default("threshold"),
  segment_type: z.enum(["all", "cohort", "specific"]).default("all"),
  segment_value: z.string().optional().or(z.literal("")),
  evaluation: z.enum(["aggregate", "per_customer"]).default("aggregate"),
});

const METRIC_QUERIES: Record<string, string> = {
  daily_cost: `SELECT COALESCE(SUM(cost_amount), 0) as value FROM observe_events WHERE account_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours' AND (source IS NULL OR source != 'stripe')`,
  margin_percent: `SELECT CASE WHEN COALESCE(SUM(revenue_amount), 0) = 0 THEN 0 ELSE ((SUM(revenue_amount) - SUM(cost_amount)) / SUM(revenue_amount) * 100) END as value FROM observe_events WHERE account_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND (source IS NULL OR source != 'stripe')`,
  customer_margin: `SELECT CASE WHEN COALESCE(SUM(revenue_amount), 0) = 0 THEN 0 ELSE MIN((revenue_amount - cost_amount) / NULLIF(revenue_amount, 0) * 100) END as value FROM observe_events WHERE account_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND customer_id IS NOT NULL AND (source IS NULL OR source != 'stripe') GROUP BY customer_id ORDER BY value ASC LIMIT 1`,
  usage_velocity: `SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE (SELECT COUNT(*)::float / NULLIF((SELECT COUNT(*)::float / 7 FROM observe_events WHERE account_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND timestamp < NOW() - INTERVAL '1 day' AND (source IS NULL OR source != 'stripe')), 0) FROM observe_events WHERE account_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours' AND (source IS NULL OR source != 'stripe') GROUP BY customer_id ORDER BY 1 DESC LIMIT 1) END as value FROM observe_events WHERE account_id = $1 AND (source IS NULL OR source != 'stripe')`,
  customer_cost_share: `SELECT CASE WHEN COALESCE(SUM(cost_amount), 0) = 0 THEN 0 ELSE (SELECT SUM(cost_amount) FROM observe_events WHERE account_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND (source IS NULL OR source != 'stripe') GROUP BY customer_id ORDER BY 1 DESC LIMIT 1) / SUM(cost_amount) * 100 END as value FROM observe_events WHERE account_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND (source IS NULL OR source != 'stripe')`,
  top_customer_unprofitable: `SELECT COUNT(*) as value FROM (SELECT customer_id, SUM(revenue_amount) - SUM(cost_amount) as profit FROM observe_events WHERE account_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND customer_id IS NOT NULL AND (source IS NULL OR source != 'stripe') GROUP BY customer_id ORDER BY SUM(cost_amount) DESC LIMIT 10) t WHERE profit < 0`,
  model_cost_increase: `SELECT COALESCE((SELECT AVG(cost_amount) FROM observe_events WHERE account_id = $1 AND timestamp >= NOW() - INTERVAL '7 days' AND model IS NOT NULL AND (source IS NULL OR source != 'stripe')) / NULLIF((SELECT AVG(cost_amount) FROM observe_events WHERE account_id = $1 AND timestamp >= NOW() - INTERVAL '14 days' AND timestamp < NOW() - INTERVAL '7 days' AND model IS NOT NULL AND (source IS NULL OR source != 'stripe')), 0) * 100 - 100, 0) as value`,
  customer_concentration: `SELECT CASE WHEN COALESCE(SUM(cost_amount), 0) = 0 THEN 0 ELSE (SELECT SUM(cost_amount) FROM observe_events WHERE account_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND (source IS NULL OR source != 'stripe') GROUP BY customer_id ORDER BY 1 DESC LIMIT 1) / SUM(cost_amount) * 100 END as value FROM observe_events WHERE account_id = $1 AND timestamp >= NOW() - INTERVAL '30 days' AND (source IS NULL OR source != 'stripe')`,
};

const CUSTOMER_TRIGGER_QUERIES: Record<string, string> = {
  usage_decline: `SELECT CASE WHEN prev.cnt = 0 THEN 0 ELSE ((curr.cnt - prev.cnt)::float / prev.cnt * 100) END as value
    FROM (SELECT COUNT(*) as cnt FROM observe_events WHERE account_id = $1 AND customer_id = $2 AND timestamp >= NOW() - INTERVAL '30 days' AND (source IS NULL OR source != 'stripe')) curr,
         (SELECT COUNT(*) as cnt FROM observe_events WHERE account_id = $1 AND customer_id = $2 AND timestamp >= NOW() - INTERVAL '60 days' AND timestamp < NOW() - INTERVAL '30 days' AND (source IS NULL OR source != 'stripe')) prev`,
  usage_growth: `SELECT CASE WHEN prev.cnt = 0 THEN 0 ELSE ((curr.cnt - prev.cnt)::float / prev.cnt * 100) END as value
    FROM (SELECT COUNT(*) as cnt FROM observe_events WHERE account_id = $1 AND customer_id = $2 AND timestamp >= NOW() - INTERVAL '30 days' AND (source IS NULL OR source != 'stripe')) curr,
         (SELECT COUNT(*) as cnt FROM observe_events WHERE account_id = $1 AND customer_id = $2 AND timestamp >= NOW() - INTERVAL '60 days' AND timestamp < NOW() - INTERVAL '30 days' AND (source IS NULL OR source != 'stripe')) prev`,
  margin_negative: `SELECT CASE WHEN COALESCE(SUM(revenue_amount), 0) = 0 THEN 0 ELSE ((SUM(revenue_amount) - SUM(cost_amount)) / SUM(revenue_amount) * 100) END as value FROM observe_events WHERE account_id = $1 AND customer_id = $2 AND timestamp >= NOW() - INTERVAL '30 days' AND (source IS NULL OR source != 'stripe')`,
  inactive: `SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MAX(timestamp))) / 86400, 999999) as value FROM observe_events WHERE account_id = $1 AND customer_id = $2 AND (source IS NULL OR source != 'stripe')`,
  cost_spike: `SELECT CASE WHEN prev.cost = 0 THEN 0 ELSE ((curr.cost - prev.cost) / prev.cost * 100) END as value
    FROM (SELECT COALESCE(SUM(cost_amount), 0) as cost FROM observe_events WHERE account_id = $1 AND customer_id = $2 AND timestamp >= NOW() - INTERVAL '7 days' AND (source IS NULL OR source != 'stripe')) curr,
         (SELECT COALESCE(SUM(cost_amount), 0) as cost FROM observe_events WHERE account_id = $1 AND customer_id = $2 AND timestamp >= NOW() - INTERVAL '14 days' AND timestamp < NOW() - INTERVAL '7 days' AND (source IS NULL OR source != 'stripe')) prev`,
  customer_cost_budget: `SELECT COALESCE(SUM(cost_amount), 0) as value FROM observe_events WHERE account_id = $1 AND customer_id = $2 AND timestamp >= NOW() - INTERVAL '30 days' AND (source IS NULL OR source != 'stripe')`,
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

function formatValue(metric: string, rawValue: number | string): string {
  const value = typeof rawValue === "string" ? parseFloat(rawValue) : rawValue;
  if (!Number.isFinite(value)) return String(rawValue);
  switch (metric) {
    case "margin_percent":
    case "customer_margin":
    case "customer_cost_share":
    case "model_cost_increase":
    case "customer_concentration":
      return `${value.toFixed(1)}%`;
    case "usage_velocity":
      return `${value.toFixed(1)}x`;
    case "top_customer_unprofitable":
      return `${Math.round(value)}`;
    default:
      return `$${value.toFixed(4)}`;
  }
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

export async function checkAlerts(
  pool: Pool,
  userId: string,
  resolvedAccountId?: number | null,
) {
  try {
    let accountId = resolvedAccountId ?? null;
    if (accountId === null) {
      const accountIdResult = await pool.query(
        `SELECT account_id FROM user_accounts WHERE user_id = (SELECT id FROM users WHERE visitor_id = $1) AND role = 'owner' LIMIT 1`,
        [userId],
      );
      accountId = accountIdResult.rows[0]?.account_id ?? null;
    }
    if (accountId === null) {
      console.warn("checkAlerts: no account_id for visitor", userId);
      return;
    }

    const { rows: rules } = await pool.query(
      `SELECT * FROM alert_rules WHERE account_id = $1 AND enabled = true AND (evaluation = 'aggregate' OR evaluation IS NULL)`,
      [accountId],
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

        const { rows } = await pool.query(query, [accountId]);
        const currentValue = parseFloat(rows[0]?.value) || 0;
        const operatorFn = OPERATOR_FNS[rule.operator];
        if (!operatorFn) continue;

        if (operatorFn(currentValue, parseFloat(rule.threshold))) {
          const deliveryStatus: Record<string, string> = {};

          // Email channel
          if (rule.email) {
            const ok = await sendAlertEmail(rule.email, rule, currentValue);
            deliveryStatus.email = ok ? "sent" : "failed";
          }

          // Webhook channel (Slack-compatible JSON POST)
          if (rule.webhook_url) {
            const ok = await sendAlertWebhook(
              rule.webhook_url,
              rule,
              currentValue,
            );
            deliveryStatus.webhook = ok ? "sent" : "failed";
          }

          // Always update cooldown timestamp when alert triggers,
          // regardless of delivery success, to prevent spam on repeated failures.
          await pool.query(
            "UPDATE alert_rules SET last_triggered_at = NOW() WHERE id = $1",
            [rule.id],
          );

          // Write to history — customer_id/customer_name NULL for aggregate alerts.
          await pool.query(
            `INSERT INTO alert_history (user_id, account_id, alert_rule_id, customer_id, customer_name, trigger_type, current_value, threshold, delivery_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              userId,
              accountId,
              rule.id,
              null,
              null,
              rule.metric,
              currentValue,
              rule.threshold,
              JSON.stringify(deliveryStatus),
            ],
          );
        }
      } catch (ruleErr) {
        console.error(`checkAlerts rule ${rule.id} error:`, ruleErr);
      }
    }
  } catch (err) {
    console.error("checkAlerts error:", err);
  }
}

function matchesSegment(
  rule: { segment_type: string; segment_value: string | null },
  customerId: string,
  customer: { segment?: string } | undefined,
): boolean {
  switch (rule.segment_type) {
    case "all":
      return true;
    case "specific":
      return customerId === rule.segment_value;
    case "cohort":
      // Cohort matching requires the full cohort computation — for now match on segment field
      return customer?.segment === rule.segment_value;
    default:
      return false;
  }
}

async function sendCustomerAlertEmail(
  to: string,
  rule: {
    name: string;
    trigger_type: string;
    operator: string;
    threshold: number;
  },
  currentValue: number,
  customerId: string,
  customerName: string,
): Promise<boolean> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set, skipping customer alert email");
    return false;
  }

  const from = process.env.ALERT_FROM_EMAIL || "alerts@example.com";
  const triggerLabel = rule.trigger_type.replace(/_/g, " ");
  const subject = `Alert: ${customerName} — ${triggerLabel}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html: `<h2>${rule.name}</h2>
          <p><strong>Customer:</strong> ${customerName} (${customerId})</p>
          <p><strong>Trigger:</strong> ${triggerLabel}</p>
          <p><strong>Current value:</strong> ${currentValue.toFixed(1)}</p>
          <p><strong>Threshold:</strong> ${rule.operator} ${rule.threshold}</p>
          <p style="margin-top:16px"><a href="https://observe.tansohq.com/customers/${encodeURIComponent(customerId)}">View customer →</a></p>`,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("Customer alert email error:", err);
    return false;
  }
}

async function sendCustomerAlertWebhook(
  url: string,
  rule: {
    name: string;
    trigger_type: string;
    operator: string;
    threshold: number;
  },
  currentValue: number,
  customerId: string,
  customerName: string,
): Promise<boolean> {
  const triggerLabel = rule.trigger_type.replace(/_/g, " ");
  const summary = `${rule.name}: ${customerName} — ${triggerLabel} (${currentValue.toFixed(1)}, threshold: ${rule.operator} ${rule.threshold})`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: summary,
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: rule.name },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Customer:* ${customerName}\n*Trigger:* ${triggerLabel}\n*Value:* ${currentValue.toFixed(1)}\n*Threshold:* ${rule.operator} ${rule.threshold}`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "View Customer" },
                url: `https://observe.tansohq.com/customers/${encodeURIComponent(customerId)}`,
              },
            ],
          },
        ],
        alert_name: rule.name,
        trigger_type: rule.trigger_type,
        customer_id: customerId,
        customer_name: customerName,
        current_value: currentValue,
        threshold: rule.threshold,
        triggered_at: new Date().toISOString(),
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("Customer alert webhook error:", err);
    return false;
  }
}

export async function checkCustomerAlerts(
  pool: Pool,
  userId: string,
  customerId: string,
  resolvedAccountId?: number | null,
) {
  try {
    let accountId = resolvedAccountId ?? null;
    if (accountId === null) {
      const accountIdResult = await pool.query(
        `SELECT account_id FROM user_accounts WHERE user_id = (SELECT id FROM users WHERE visitor_id = $1) AND role = 'owner' LIMIT 1`,
        [userId],
      );
      accountId = accountIdResult.rows[0]?.account_id ?? null;
    }
    if (accountId === null) {
      console.warn("checkCustomerAlerts: no account_id for visitor", userId);
      return;
    }

    const { rows: rules } = await pool.query(
      `SELECT * FROM alert_rules WHERE account_id = $1 AND enabled = true AND evaluation = 'per_customer'`,
      [accountId],
    );

    if (rules.length === 0) return;

    // Get customer info for notifications
    const { rows: custRows } = await pool.query(
      `SELECT name, email, segment FROM customers WHERE account_id = $1 AND customer_id = $2`,
      [accountId, customerId],
    );
    const customerName = custRows[0]?.name || customerId;

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

        // Check segment match
        if (!matchesSegment(rule, customerId, custRows[0])) continue;

        const query = CUSTOMER_TRIGGER_QUERIES[rule.trigger_type];
        if (!query) continue;

        const { rows } = await pool.query(query, [accountId, customerId]);
        const currentValue = parseFloat(rows[0]?.value) || 0;

        // For usage_decline, value is negative when declining — trigger when below threshold (e.g. < -30)
        // For usage_growth, value is positive when growing — trigger when above threshold (e.g. > 20)
        // For margin_negative, trigger when below threshold (e.g. < 0)
        // For inactive, value is days — trigger when above threshold (e.g. > 14)
        // For cost_spike, trigger when above threshold (e.g. > 20)
        const operatorFn = OPERATOR_FNS[rule.operator];
        if (!operatorFn) continue;

        if (operatorFn(currentValue, parseFloat(rule.threshold))) {
          let deliveryStatus: Record<string, string> = {};

          if (rule.email) {
            const ok = await sendCustomerAlertEmail(
              rule.email,
              rule,
              currentValue,
              customerId,
              customerName,
            );
            deliveryStatus.email = ok ? "sent" : "failed";
          }

          if (rule.webhook_url) {
            const ok = await sendCustomerAlertWebhook(
              rule.webhook_url,
              rule,
              currentValue,
              customerId,
              customerName,
            );
            deliveryStatus.webhook = ok ? "sent" : "failed";
          }

          // Write to history regardless
          await pool.query(
            `INSERT INTO alert_history (user_id, account_id, alert_rule_id, customer_id, customer_name, trigger_type, current_value, threshold, delivery_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              userId,
              accountId,
              rule.id,
              customerId,
              customerName,
              rule.trigger_type,
              currentValue,
              rule.threshold,
              JSON.stringify(deliveryStatus),
            ],
          );

          // Always update cooldown timestamp to prevent spam on repeated delivery failures.
          await pool.query(
            "UPDATE alert_rules SET last_triggered_at = NOW() WHERE id = $1",
            [rule.id],
          );
        }
      } catch (ruleErr) {
        console.error(`checkCustomerAlerts rule ${rule.id} error:`, ruleErr);
      }
    }
  } catch (err) {
    console.error("checkCustomerAlerts error:", err);
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
        if (!req.accountEmail) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const { rows } = await pool.query(
          "SELECT * FROM alert_rules WHERE account_id = $1 ORDER BY created_at DESC",
          [req.accountId],
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
        if (!req.accountEmail) {
          return res.status(401).json({ error: "Authentication required" });
        }
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
          `INSERT INTO alert_rules (user_id, account_id, name, metric, operator, threshold, email, webhook_url, cooldown_minutes, trigger_type, segment_type, segment_value, evaluation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
          [
            req.visitorId,
            req.accountId ?? null,
            parsed.name,
            parsed.metric,
            parsed.operator,
            parsed.threshold,
            email,
            webhookUrl,
            parsed.cooldown_minutes,
            parsed.trigger_type,
            parsed.segment_type,
            parsed.segment_value || null,
            parsed.evaluation,
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
  const alertPatchSchema = alertRuleSchema
    .extend({ enabled: z.boolean() })
    .partial();

  router.patch(
    "/alerts/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.accountEmail) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const id = parseInt(req.params.id);

        const parsed = alertPatchSchema.parse(req.body);

        // Verify ownership
        const existing = await pool.query(
          "SELECT id FROM alert_rules WHERE id = $1 AND account_id = $2",
          [id, req.accountId],
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
          "trigger_type",
          "segment_type",
          "segment_value",
          "evaluation",
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
        if (!req.accountEmail) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const id = parseInt(req.params.id);
        const result = await pool.query(
          "DELETE FROM alert_rules WHERE id = $1 AND account_id = $2",
          [id, req.accountId],
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

  // POST /alerts/:id/test — send a test notification without recording history
  router.post(
    "/alerts/:id/test",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.accountEmail) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const id = parseInt(req.params.id);
        const { rows } = await pool.query(
          "SELECT * FROM alert_rules WHERE id = $1 AND account_id = $2",
          [id, req.accountId],
        );
        if (rows.length === 0)
          return res.status(404).json({ error: "Alert not found" });

        const rule = rows[0];
        const testValue =
          rule.operator === "gt"
            ? rule.threshold * 1.15
            : rule.threshold * 0.85;

        const testRule = {
          name: `[TEST] ${rule.name}`,
          metric: rule.metric || rule.trigger_type,
          operator: rule.operator,
          threshold: Number(rule.threshold),
        };

        const delivered: Record<string, string> = {};

        if (rule.email) {
          const ok = await sendAlertEmail(rule.email, testRule, testValue);
          delivered.email = ok ? "sent" : "failed";
        }
        if (rule.webhook_url) {
          const ok = await sendAlertWebhook(
            rule.webhook_url,
            testRule,
            testValue,
          );
          delivered.webhook = ok ? "sent" : "failed";
        }

        if (!rule.email && !rule.webhook_url) {
          return res
            .status(400)
            .json({ error: "No delivery channel configured on this alert" });
        }

        res.json({ delivered });
      } catch (err) {
        console.error("POST /alerts/:id/test error:", err);
        res.status(500).json({ error: "Failed to send test alert" });
      }
    },
  );

  // GET /alerts/history — paginated alert history
  router.get(
    "/alerts/history",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
        const offset = parseInt(req.query.offset as string) || 0;
        const customerId = req.query.customer_id as string;

        let where = "WHERE h.account_id = $1";
        const params: unknown[] = [req.accountId];
        if (customerId) {
          params.push(customerId);
          where += ` AND h.customer_id = $${params.length}`;
        }

        const [countRes, historyRes] = await Promise.all([
          pool.query(
            `SELECT COUNT(*) as total FROM alert_history h ${where}`,
            params,
          ),
          pool.query(
            `SELECT h.*, r.name AS rule_name
             FROM alert_history h
             LEFT JOIN alert_rules r ON r.id = h.alert_rule_id
             ${where}
             ORDER BY h.fired_at DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset],
          ),
        ]);

        res.json({
          history: historyRes.rows,
          total: parseInt(countRes.rows[0].total),
          limit,
          offset,
        });
      } catch (err) {
        console.error("GET /alerts/history error:", err);
        res.status(500).json({ error: "Failed to load alert history" });
      }
    },
  );

  // GET /alerts/history/count — count for nav badge (last 24h)
  router.get(
    "/alerts/history/count",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { rows } = await pool.query(
          `SELECT COUNT(*) as count FROM alert_history WHERE account_id = $1 AND fired_at >= NOW() - INTERVAL '24 hours'`,
          [req.accountId],
        );
        res.json({ count: parseInt(rows[0].count) });
      } catch (err) {
        console.error("GET /alerts/history/count error:", err);
        res.status(500).json({ error: "Failed to load alert count" });
      }
    },
  );

  return router;
}
