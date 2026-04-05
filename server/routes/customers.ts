import { Router, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { type AuthRequest } from "./auth.js";
import { checkAlerts } from "./alerts.js";

type CheckBillingFeatureAccessFn = (
  visitorId: string,
  featureKey: string,
  email?: string,
) => Promise<{
  allowed: boolean;
  reason?: string;
  usage?: number;
  limit?: number;
  remaining?: number;
}>;
type TrackBillingUsageFn = (
  visitorId: string,
  featureKey: string,
  eventName: string,
) => void;
type ConvertReferralFn = (visitorId: string) => Promise<void>;

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

async function clearSampleData(
  db: { query: (text: string, params: unknown[]) => Promise<unknown> },
  userId: string,
): Promise<void> {
  await db.query(
    "DELETE FROM observe_events WHERE user_id = $1 AND source = 'sample'",
    [userId],
  );
  await db.query(
    "DELETE FROM cost_records WHERE user_id = $1 AND cost_type = 'ai_inference' AND customer_id IS NULL AND period_start IS NOT NULL",
    [userId],
  );
  await db.query(
    "DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id IN ('sub_001','sub_002','sub_003','sub_004','sub_005')",
    [userId],
  );
  await db.query(
    "DELETE FROM customers WHERE user_id = $1 AND customer_id IN ('cus_001','cus_002','cus_003','cus_004','cus_005')",
    [userId],
  );
  await db.query(
    "DELETE FROM plans WHERE user_id = $1 AND plan_id IN ('starter', 'pro', 'enterprise')",
    [userId],
  );
}

const costRecordSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM format"),
  cost: z.coerce.number().nonnegative(),
  customer_id: z.string().optional(),
  provider: z.string().optional(),
});
const usageRecordSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM format"),
  customer_id: z.string().optional(),
  metric: z.string().optional(),
  metric_key: z.string().optional(),
  value: z.coerce.number().optional(),
  metric_value: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  metric_limit: z.coerce.number().optional(),
});
const revenueUploadSchema = z.object({
  customers: z
    .array(
      z.object({
        customer_id: z.string(),
        name: z.string(),
        email: z.string().optional(),
        segment: z.string().optional(),
      }),
    )
    .optional(),
  plans: z
    .array(
      z.object({
        plan_id: z.string(),
        name: z.string(),
        price_amount: z.coerce.number(),
        interval_months: z.number().optional(),
      }),
    )
    .optional(),
  subscriptions: z
    .array(
      z.object({
        subscription_id: z.string(),
        customer_id: z.string(),
        plan_id: z.string(),
        is_active: z.boolean().optional(),
        mrr_override: z.coerce.number().optional(),
        current_period_start: z.string().optional(),
        current_period_end: z.string().optional(),
      }),
    )
    .optional(),
});

export function createCustomersRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    checkBillingFeatureAccess: CheckBillingFeatureAccessFn;
    trackBillingUsage: TrackBillingUsageFn;
    convertReferralIfPending: ConvertReferralFn;
  },
) {
  const router = Router();

  router.get(
    "/data/status",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const statusResult = await pool.query(
          "SELECT * FROM user_data_status WHERE user_id = $1",
          [req.visitorId],
        );
        const customersResult = await pool.query(
          "SELECT COUNT(*) FROM customers WHERE user_id = $1",
          [req.visitorId],
        );
        const costsResult = await pool.query(
          "SELECT COUNT(*) FROM cost_records WHERE user_id = $1",
          [req.visitorId],
        );
        const usageResult = await pool.query(
          "SELECT COUNT(*) FROM usage_records WHERE user_id = $1",
          [req.visitorId],
        );

        const status = statusResult.rows[0] || { data_mode: "none" };
        const customerCount = parseInt(customersResult.rows[0].count);
        const costsCount = parseInt(costsResult.rows[0].count);
        const usageCount = parseInt(usageResult.rows[0].count);

        res.json({
          data_mode: status.data_mode,
          has_data: customerCount > 0,
          customer_count: customerCount,
          has_revenue: customerCount > 0,
          has_costs: costsCount > 0,
          has_usage: usageCount > 0,
          revenue_customer_count: customerCount,
          costs_record_count: costsCount,
          usage_record_count: usageCount,
          last_sync_at: status.updated_at,
        });
      } catch (error) {
        console.error("Get data status error:", error);
        res.status(500).json({ error: "Failed to get data status" });
      }
    },
  );

  router.get(
    "/customers",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const [result, countResult] = await Promise.all([
          pool.query(
            "SELECT * FROM customers WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
            [req.visitorId, limit, offset],
          ),
          pool.query("SELECT COUNT(*) FROM customers WHERE user_id = $1", [
            req.visitorId,
          ]),
        ]);
        res.json({
          data: result.rows,
          total: parseInt(countResult.rows[0].count),
          limit,
          offset,
        });
      } catch (error) {
        console.error("Get customers error:", error);
        res.status(500).json({ error: "Failed to get customers" });
      }
    },
  );

  router.get(
    "/subscriptions",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const [result, countResult] = await Promise.all([
          pool.query(
            "SELECT s.*, c.name as customer_name, c.email as customer_email, p.name as plan_name, p.price_amount FROM subscriptions s LEFT JOIN customers c ON s.user_id = c.user_id AND s.customer_id = c.customer_id LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT $2 OFFSET $3",
            [req.visitorId, limit, offset],
          ),
          pool.query("SELECT COUNT(*) FROM subscriptions WHERE user_id = $1", [
            req.visitorId,
          ]),
        ]);
        res.json({
          data: result.rows,
          total: parseInt(countResult.rows[0].count),
          limit,
          offset,
        });
      } catch (error) {
        console.error("Get subscriptions error:", error);
        res.status(500).json({ error: "Failed to get subscriptions" });
      }
    },
  );

  router.get(
    "/plans",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const result = await pool.query(
          "SELECT * FROM plans WHERE user_id = $1 ORDER BY price_amount ASC LIMIT $2 OFFSET $3",
          [req.visitorId, limit, offset],
        );
        res.json(result.rows);
      } catch (error) {
        console.error("Get plans error:", error);
        res.status(500).json({ error: "Failed to get plans" });
      }
    },
  );

  router.get(
    "/usage",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const [result, countResult] = await Promise.all([
          pool.query(
            "SELECT * FROM usage_records WHERE user_id = $1 ORDER BY period_start DESC LIMIT $2 OFFSET $3",
            [req.visitorId, limit, offset],
          ),
          pool.query("SELECT COUNT(*) FROM usage_records WHERE user_id = $1", [
            req.visitorId,
          ]),
        ]);
        res.json({
          data: result.rows,
          total: parseInt(countResult.rows[0].count),
          limit,
          offset,
        });
      } catch (error) {
        console.error("Get usage error:", error);
        res.status(500).json({ error: "Failed to get usage" });
      }
    },
  );

  router.get(
    "/costs",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const [result, countResult] = await Promise.all([
          pool.query(
            "SELECT * FROM cost_records WHERE user_id = $1 ORDER BY period_start DESC LIMIT $2 OFFSET $3",
            [req.visitorId, limit, offset],
          ),
          pool.query("SELECT COUNT(*) FROM cost_records WHERE user_id = $1", [
            req.visitorId,
          ]),
        ]);
        res.json({
          data: result.rows,
          total: parseInt(countResult.rows[0].count),
          limit,
          offset,
        });
      } catch (error) {
        console.error("Get costs error:", error);
        res.status(500).json({ error: "Failed to get costs" });
      }
    },
  );

  router.get(
    "/data/analyzer",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const analyzerLimit = 5000;
        const [plans, customers, subscriptions, usage, costs] =
          await Promise.all([
            pool.query("SELECT * FROM plans WHERE user_id = $1 LIMIT $2", [
              req.visitorId,
              analyzerLimit,
            ]),
            pool.query("SELECT * FROM customers WHERE user_id = $1 LIMIT $2", [
              req.visitorId,
              analyzerLimit,
            ]),
            pool.query(
              "SELECT * FROM subscriptions WHERE user_id = $1 LIMIT $2",
              [req.visitorId, analyzerLimit],
            ),
            pool.query(
              "SELECT * FROM usage_records WHERE user_id = $1 LIMIT $2",
              [req.visitorId, analyzerLimit],
            ),
            pool.query(
              "SELECT * FROM cost_records WHERE user_id = $1 LIMIT $2",
              [req.visitorId, analyzerLimit],
            ),
          ]);

        if (customers.rows.length === 0) {
          res.json(null);
          return;
        }

        res.json({
          plans: plans.rows.map((p) => ({
            plan_id: p.plan_id,
            name: p.name,
            price_amount: Number(p.price_amount),
            interval_months: p.interval_months || 1,
            billing_model: p.billing_model || "recurring",
          })),
          customers: customers.rows.map((c) => ({
            customer_id: c.customer_id,
            name: c.name,
            email: c.email || undefined,
            segment: c.segment || undefined,
            created_at: c.created_at,
          })),
          subscriptions: subscriptions.rows.map((s) => ({
            subscription_id: s.subscription_id,
            customer_id: s.customer_id,
            plan_id: s.plan_id,
            is_active: s.is_active,
            mrr_override: s.mrr_override ? Number(s.mrr_override) : undefined,
            previous_mrr: s.previous_mrr ? Number(s.previous_mrr) : undefined,
            current_period_start: s.current_period_start,
            current_period_end: s.current_period_end,
            cancelled_at: s.cancelled_at,
          })),
          usage: usage.rows.map((u) => ({
            customer_id: u.customer_id,
            metric_key: u.metric_key,
            metric_value: Number(u.metric_value),
            metric_limit: u.metric_limit ? Number(u.metric_limit) : undefined,
            period_start: u.period_start,
            period_end: u.period_end,
          })),
          costs: costs.rows.map((c) => ({
            customer_id: c.customer_id || undefined,
            cost_type: c.cost_type,
            amount: Number(c.amount),
            period_start: c.period_start,
            period_end: c.period_end,
          })),
        });
      } catch (error) {
        console.error("Get analyzer data error:", error);
        res.status(500).json({ error: "Failed to get analyzer data" });
      }
    },
  );

  router.post(
    "/data/sample",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await client.query("DELETE FROM ai_insights WHERE user_id = $1", [
          req.visitorId,
        ]);

        await client.query("DELETE FROM observe_events WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM usage_records WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM cost_records WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM subscriptions WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM customers WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM plans WHERE user_id = $1", [
          req.visitorId,
        ]);

        const plans = [
          {
            plan_id: "starter",
            name: "Starter",
            price_amount: 29,
            interval_months: 1,
          },
          {
            plan_id: "pro",
            name: "Professional",
            price_amount: 99,
            interval_months: 1,
          },
          {
            plan_id: "enterprise",
            name: "Enterprise",
            price_amount: 299,
            interval_months: 1,
          },
        ];
        for (const plan of plans) {
          await client.query(
            "INSERT INTO plans (user_id, plan_id, name, price_amount, interval_months) VALUES ($1, $2, $3, $4, $5)",
            [
              req.visitorId,
              plan.plan_id,
              plan.name,
              plan.price_amount,
              plan.interval_months,
            ],
          );
        }

        const customers = [
          {
            customer_id: "cus_001",
            name: "Acme Corp",
            email: "billing@acme.com",
            segment: "Enterprise",
            created_at: "2025-08-01T00:00:00Z",
          },
          {
            customer_id: "cus_002",
            name: "TechStart Inc",
            email: "admin@techstart.io",
            segment: "SMB",
            created_at: "2025-11-15T00:00:00Z",
          },
          {
            customer_id: "cus_003",
            name: "Global Solutions",
            email: "accounts@global.com",
            segment: "Mid-Market",
            created_at: "2025-09-10T00:00:00Z",
          },
          {
            customer_id: "cus_004",
            name: "Startup Labs",
            email: "hello@startuplabs.co",
            segment: "SMB",
            created_at: "2026-02-01T00:00:00Z",
          },
          {
            customer_id: "cus_005",
            name: "Enterprise Co",
            email: "procurement@enterprise.com",
            segment: "Enterprise",
            created_at: "2025-06-01T00:00:00Z",
          },
        ];
        for (const customer of customers) {
          await client.query(
            "INSERT INTO customers (user_id, customer_id, name, email, segment, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
            [
              req.visitorId,
              customer.customer_id,
              customer.name,
              customer.email,
              customer.segment,
              customer.created_at,
            ],
          );
        }

        const subscriptions = [
          {
            subscription_id: "sub_001",
            customer_id: "cus_001",
            plan_id: "enterprise",
            is_active: true,
            mrr_override: 299,
            previous_mrr: 99,
            created_at: "2025-08-01T00:00:00Z",
            current_period_start: "2026-03-01T00:00:00Z",
            current_period_end: "2026-04-01T00:00:00Z",
          },
          {
            subscription_id: "sub_002",
            customer_id: "cus_002",
            plan_id: "starter",
            is_active: true,
            mrr_override: 29,
            previous_mrr: 0,
            created_at: "2025-11-15T00:00:00Z",
            current_period_start: "2026-03-01T00:00:00Z",
            current_period_end: "2026-04-01T00:00:00Z",
          },
          {
            subscription_id: "sub_003",
            customer_id: "cus_003",
            plan_id: "pro",
            is_active: true,
            mrr_override: 99,
            previous_mrr: 29,
            created_at: "2025-09-10T00:00:00Z",
            current_period_start: "2026-03-01T00:00:00Z",
            current_period_end: "2026-04-01T00:00:00Z",
          },
          {
            subscription_id: "sub_004",
            customer_id: "cus_004",
            plan_id: "starter",
            is_active: true,
            mrr_override: 29,
            previous_mrr: 0,
            created_at: "2026-02-01T00:00:00Z",
            current_period_start: "2026-03-01T00:00:00Z",
            current_period_end: "2026-04-01T00:00:00Z",
          },
          {
            subscription_id: "sub_005",
            customer_id: "cus_005",
            plan_id: "enterprise",
            is_active: true,
            mrr_override: 299,
            previous_mrr: 299,
            created_at: "2025-06-01T00:00:00Z",
            current_period_start: "2026-03-01T00:00:00Z",
            current_period_end: "2026-04-01T00:00:00Z",
          },
        ];
        for (const sub of subscriptions) {
          await client.query(
            `INSERT INTO subscriptions (user_id, subscription_id, customer_id, plan_id, is_active, mrr_override, previous_mrr, created_at, current_period_start, current_period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              req.visitorId,
              sub.subscription_id,
              sub.customer_id,
              sub.plan_id,
              sub.is_active,
              sub.mrr_override,
              sub.previous_mrr,
              sub.created_at,
              sub.current_period_start,
              sub.current_period_end,
            ],
          );
        }

        const _now = new Date();
        for (let i = 5; i >= 0; i--) {
          const start = new Date(_now.getFullYear(), _now.getMonth() - i, 1);
          const end = new Date(_now.getFullYear(), _now.getMonth() - i + 1, 0);
          const amount = 3200 + (5 - i) * 600;
          await client.query(
            "INSERT INTO cost_records (user_id, cost_type, amount, period_start, period_end) VALUES ($1, $2, $3, $4, $5)",
            [
              req.visitorId,
              "ai_inference",
              amount,
              start.toISOString(),
              end.toISOString(),
            ],
          );
        }

        function daysAgo(d: number) {
          return new Date(Date.now() - d * 86400000).toISOString();
        }
        const sampleEvents = [
          // --- chat_assistant: mixed models, moderate-high margins (~75%) ---
          {
            customer_id: "acme_saas",
            feature_key: "chat_assistant",
            event_name: "chat_completion",
            ts: daysAgo(1),
            cost: 0.32,
            cost_unit: "usd",
            revenue: 1.2,
            usage: 1200,
            model: "gpt-4o",
            provider: "openai",
            source: "sample",
            properties: {
              agent: "support_v2",
              trace_id: "tr_a1b2c3d4",
              span_id: "sp_001",
            },
            request_body: {
              messages: [
                {
                  role: "system",
                  content:
                    "You are a helpful customer support agent for a SaaS platform.",
                },
                {
                  role: "user",
                  content:
                    "How do I upgrade my plan to Enterprise? I need more API calls.",
                },
              ],
              model: "gpt-4o",
              temperature: 0.7,
            },
            response_body: {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content:
                      "To upgrade to Enterprise, go to Settings > Billing > Plans and click 'Upgrade'. Enterprise includes unlimited API calls, priority support, and SSO. I can also connect you with our sales team if you need a custom contract.",
                  },
                },
              ],
              usage: { prompt_tokens: 800, completion_tokens: 400 },
            },
          },
          {
            customer_id: "tidewater_ai",
            feature_key: "chat_assistant",
            event_name: "chat_completion",
            ts: daysAgo(2),
            cost: 0.08,
            cost_unit: "usd",
            revenue: 0.35,
            usage: 800,
            model: "gpt-4o-mini",
            provider: "openai",
            source: "sample",
            properties: { agent: "support_v2" },
            request_body: {
              messages: [
                {
                  role: "user",
                  content: "Why is my webhook failing with a 403?",
                },
              ],
              model: "gpt-4o-mini",
            },
            response_body: {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content:
                      "A 403 on webhooks usually means your endpoint requires authentication. Make sure you've whitelisted our IP ranges or disabled auth on the webhook path. Check Settings > Webhooks > Security for the current config.",
                  },
                },
              ],
              usage: { prompt_tokens: 500, completion_tokens: 300 },
            },
          },
          {
            customer_id: "neondata",
            feature_key: "chat_assistant",
            event_name: "chat_completion",
            ts: daysAgo(5),
            cost: 0.45,
            cost_unit: "usd",
            revenue: 1.8,
            usage: 1500,
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            source: "sample",
            properties: { trace_id: "tr_e5f6g7h8", span_id: "sp_002" },
            request_body: {
              messages: [
                {
                  role: "system",
                  content: "You are a technical support agent. Be concise.",
                },
                {
                  role: "user",
                  content:
                    "Our data pipeline is showing 30% higher latency since yesterday. What should I check?",
                },
              ],
              model: "claude-sonnet-4-6",
            },
            response_body: {
              content: [
                {
                  type: "text",
                  text: "Check three things: 1) Recent deployment changes in your ingestion service, 2) Database connection pool saturation (look at pg_stat_activity), 3) Upstream API response times. The 30% jump suggests a single bottleneck rather than general degradation.",
                },
              ],
              usage: { input_tokens: 1200, output_tokens: 300 },
            },
          },
          {
            customer_id: "circleops",
            feature_key: "chat_assistant",
            event_name: "chat_completion",
            ts: daysAgo(9),
            cost: 0.12,
            cost_unit: "usd",
            revenue: 0.5,
            usage: 600,
            model: "gpt-4o-mini",
            provider: "openai",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "blazeml",
            feature_key: "chat_assistant",
            event_name: "chat_completion",
            ts: daysAgo(15),
            cost: 0.6,
            cost_unit: "usd",
            revenue: 2.4,
            usage: 2000,
            model: "claude-opus-4-6",
            provider: "anthropic",
            source: "sample",
            properties: {
              agent: "support_v2",
              trace_id: "tr_i9j0k1l2",
              span_id: "sp_003",
            },
          },
          {
            customer_id: "quantumhr",
            feature_key: "chat_assistant",
            event_name: "chat_completion",
            ts: daysAgo(22),
            cost: 0.18,
            cost_unit: "usd",
            revenue: 0.7,
            usage: 900,
            model: "gpt-4o",
            provider: "openai",
            source: "sample",
            properties: {},
          },

          // --- code_review: lower margins (50-60%) ---
          {
            customer_id: "acme_saas",
            feature_key: "code_review",
            event_name: "review_completed",
            ts: daysAgo(1),
            cost: 1.2,
            cost_unit: "usd",
            revenue: 2.4,
            usage: 3200,
            model: "claude-opus-4-6",
            provider: "anthropic",
            source: "sample",
            properties: {
              language: "typescript",
              trace_id: "tr_m3n4o5p6",
              span_id: "sp_010",
            },
            request_body: {
              messages: [
                {
                  role: "system",
                  content:
                    "Review this TypeScript code for bugs, security issues, and performance problems.",
                },
                {
                  role: "user",
                  content:
                    "```typescript\nasync function fetchUsers(ids: string[]) {\n  const results = await Promise.all(\n    ids.map(id => db.query('SELECT * FROM users WHERE id = ' + id))\n  );\n  return results.flat();\n}\n```",
                },
              ],
              model: "claude-opus-4-6",
            },
            response_body: {
              content: [
                {
                  type: "text",
                  text: "Critical: SQL injection vulnerability on line 3. Use parameterized queries: `db.query('SELECT * FROM users WHERE id = $1', [id])`. Also, `Promise.all` with unbounded array could cause connection pool exhaustion — batch with a concurrency limit of 10.",
                },
              ],
              usage: { input_tokens: 2400, output_tokens: 800 },
            },
          },
          {
            customer_id: "neondata",
            feature_key: "code_review",
            event_name: "review_completed",
            ts: daysAgo(3),
            cost: 0.85,
            cost_unit: "usd",
            revenue: 1.6,
            usage: 2800,
            model: "gpt-4o",
            provider: "openai",
            source: "sample",
            properties: { language: "typescript" },
          },
          {
            customer_id: "blazeml",
            feature_key: "code_review",
            event_name: "review_completed",
            ts: daysAgo(7),
            cost: 0.95,
            cost_unit: "usd",
            revenue: 1.8,
            usage: 3000,
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            source: "sample",
            properties: {
              language: "typescript",
              trace_id: "tr_q7r8s9t0",
              span_id: "sp_011",
            },
          },
          {
            customer_id: "tidewater_ai",
            feature_key: "code_review",
            event_name: "review_completed",
            ts: daysAgo(12),
            cost: 0.7,
            cost_unit: "usd",
            revenue: 1.4,
            usage: 2200,
            model: "gpt-4o",
            provider: "openai",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "circleops",
            feature_key: "code_review",
            event_name: "review_completed",
            ts: daysAgo(20),
            cost: 1.1,
            cost_unit: "usd",
            revenue: 2.1,
            usage: 3500,
            model: "claude-opus-4-6",
            provider: "anthropic",
            source: "sample",
            properties: { language: "typescript" },
          },

          // --- document_qa: moderate-high margins (~75%) ---
          {
            customer_id: "quantumhr",
            feature_key: "document_qa",
            event_name: "question_answered",
            ts: daysAgo(2),
            cost: 0.28,
            cost_unit: "usd",
            revenue: 1.1,
            usage: 1800,
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            source: "sample",
            properties: {
              doc_type: "pdf",
              trace_id: "tr_u1v2w3x4",
              span_id: "sp_020",
            },
            request_body: {
              messages: [
                {
                  role: "system",
                  content:
                    "Answer questions based on the provided document context. Cite specific sections.",
                },
                {
                  role: "user",
                  content:
                    "Based on the employee handbook, what is the policy on remote work for engineering teams?",
                },
              ],
              model: "claude-sonnet-4-6",
            },
            response_body: {
              content: [
                {
                  type: "text",
                  text: "Per Section 4.2 of the Employee Handbook: Engineering teams may work remotely up to 3 days per week. Full remote requires VP approval and a quarterly on-site commitment of 1 week. All remote engineers must maintain core hours (10am-3pm local time) for synchronous collaboration.",
                },
              ],
              usage: { input_tokens: 1400, output_tokens: 400 },
            },
          },
          {
            customer_id: "acme_saas",
            feature_key: "document_qa",
            event_name: "question_answered",
            ts: daysAgo(4),
            cost: 0.15,
            cost_unit: "usd",
            revenue: 0.6,
            usage: 1000,
            model: "gpt-4o-mini",
            provider: "openai",
            source: "sample",
            properties: { doc_type: "pdf" },
          },
          {
            customer_id: "tidewater_ai",
            feature_key: "document_qa",
            event_name: "question_answered",
            ts: daysAgo(8),
            cost: 0.35,
            cost_unit: "usd",
            revenue: 1.4,
            usage: 2200,
            model: "gpt-4o",
            provider: "openai",
            source: "sample",
            properties: {
              doc_type: "pdf",
              trace_id: "tr_y5z6a7b8",
              span_id: "sp_021",
            },
          },
          {
            customer_id: "neondata",
            feature_key: "document_qa",
            event_name: "question_answered",
            ts: daysAgo(14),
            cost: 0.22,
            cost_unit: "usd",
            revenue: 0.85,
            usage: 1400,
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "blazeml",
            feature_key: "document_qa",
            event_name: "question_answered",
            ts: daysAgo(25),
            cost: 0.18,
            cost_unit: "usd",
            revenue: 0.7,
            usage: 1100,
            model: "gpt-4o-mini",
            provider: "openai",
            source: "sample",
            properties: { doc_type: "pdf" },
          },

          // --- content_generation: moderate margins (60-70%) ---
          {
            customer_id: "circleops",
            feature_key: "content_generation",
            event_name: "content_created",
            ts: daysAgo(1),
            cost: 0.55,
            cost_unit: "usd",
            revenue: 1.5,
            usage: 2500,
            model: "gpt-4o",
            provider: "openai",
            source: "sample",
            properties: { trace_id: "tr_c9d0e1f2", span_id: "sp_030" },
            request_body: {
              messages: [
                {
                  role: "system",
                  content:
                    "You are a marketing copywriter. Write engaging, concise copy.",
                },
                {
                  role: "user",
                  content:
                    "Write a product announcement for our new real-time analytics dashboard feature.",
                },
              ],
              model: "gpt-4o",
            },
            response_body: {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content:
                      "Introducing Real-Time Analytics\n\nStop waiting for yesterday's data. Our new real-time dashboard gives you instant visibility into user behavior, revenue trends, and system health — as it happens. Built for teams who ship fast and need answers faster.\n\nAvailable now on all Growth and Enterprise plans.",
                  },
                },
              ],
              usage: { prompt_tokens: 1800, completion_tokens: 700 },
            },
          },
          {
            customer_id: "acme_saas",
            feature_key: "content_generation",
            event_name: "content_created",
            ts: daysAgo(3),
            cost: 0.72,
            cost_unit: "usd",
            revenue: 2.0,
            usage: 3200,
            model: "claude-opus-4-6",
            provider: "anthropic",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "quantumhr",
            feature_key: "content_generation",
            event_name: "content_created",
            ts: daysAgo(6),
            cost: 0.4,
            cost_unit: "usd",
            revenue: 1.1,
            usage: 2000,
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "tidewater_ai",
            feature_key: "content_generation",
            event_name: "content_created",
            ts: daysAgo(11),
            cost: 0.3,
            cost_unit: "usd",
            revenue: 0.85,
            usage: 1800,
            model: "gpt-4o",
            provider: "openai",
            source: "sample",
            properties: { trace_id: "tr_g3h4i5j6", span_id: "sp_031" },
          },
          {
            customer_id: "neondata",
            feature_key: "content_generation",
            event_name: "content_created",
            ts: daysAgo(18),
            cost: 0.48,
            cost_unit: "usd",
            revenue: 1.3,
            usage: 2800,
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "blazeml",
            feature_key: "content_generation",
            event_name: "content_created",
            ts: daysAgo(27),
            cost: 0.35,
            cost_unit: "usd",
            revenue: 0.95,
            usage: 2100,
            model: "gpt-4o",
            provider: "openai",
            source: "sample",
            properties: {},
          },

          // --- search: high margins (90%+), embedding models ---
          {
            customer_id: "acme_saas",
            feature_key: "search",
            event_name: "search_query",
            ts: daysAgo(1),
            cost: 0.003,
            cost_unit: "usd",
            revenue: 0.05,
            usage: 500,
            model: "text-embedding-3-small",
            provider: "openai",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "tidewater_ai",
            feature_key: "search",
            event_name: "search_query",
            ts: daysAgo(2),
            cost: 0.008,
            cost_unit: "usd",
            revenue: 0.1,
            usage: 1200,
            model: "text-embedding-3-large",
            provider: "openai",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "neondata",
            feature_key: "search",
            event_name: "search_query",
            ts: daysAgo(4),
            cost: 0.002,
            cost_unit: "usd",
            revenue: 0.04,
            usage: 350,
            model: "text-embedding-3-small",
            provider: "openai",
            source: "sample",
            properties: { trace_id: "tr_k7l8m9n0", span_id: "sp_040" },
          },
          {
            customer_id: "circleops",
            feature_key: "search",
            event_name: "search_query",
            ts: daysAgo(7),
            cost: 0.005,
            cost_unit: "usd",
            revenue: 0.08,
            usage: 800,
            model: "text-embedding-3-small",
            provider: "openai",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "blazeml",
            feature_key: "search",
            event_name: "search_query",
            ts: daysAgo(10),
            cost: 0.012,
            cost_unit: "usd",
            revenue: 0.15,
            usage: 1500,
            model: "text-embedding-3-large",
            provider: "openai",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "quantumhr",
            feature_key: "search",
            event_name: "search_query",
            ts: daysAgo(16),
            cost: 0.004,
            cost_unit: "usd",
            revenue: 0.06,
            usage: 600,
            model: "text-embedding-3-small",
            provider: "openai",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "acme_saas",
            feature_key: "search",
            event_name: "search_query",
            ts: daysAgo(23),
            cost: 0.006,
            cost_unit: "usd",
            revenue: 0.08,
            usage: 900,
            model: "text-embedding-3-large",
            provider: "openai",
            source: "sample",
            properties: {},
          },

          // --- summarization: moderate-high margins (~75-80%) ---
          {
            customer_id: "neondata",
            feature_key: "summarization",
            event_name: "summary_generated",
            ts: daysAgo(1),
            cost: 0.2,
            cost_unit: "usd",
            revenue: 0.85,
            usage: 1600,
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            source: "sample",
            properties: { trace_id: "tr_o1p2q3r4", span_id: "sp_050" },
          },
          {
            customer_id: "acme_saas",
            feature_key: "summarization",
            event_name: "summary_generated",
            ts: daysAgo(3),
            cost: 0.1,
            cost_unit: "usd",
            revenue: 0.45,
            usage: 900,
            model: "gpt-4o-mini",
            provider: "openai",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "quantumhr",
            feature_key: "summarization",
            event_name: "summary_generated",
            ts: daysAgo(6),
            cost: 0.25,
            cost_unit: "usd",
            revenue: 1.0,
            usage: 2000,
            model: "gpt-4o",
            provider: "openai",
            source: "sample",
            properties: { agent: "support_v2" },
          },
          {
            customer_id: "circleops",
            feature_key: "summarization",
            event_name: "summary_generated",
            ts: daysAgo(13),
            cost: 0.15,
            cost_unit: "usd",
            revenue: 0.65,
            usage: 1200,
            model: "claude-sonnet-4-6",
            provider: "anthropic",
            source: "sample",
            properties: {},
          },
          {
            customer_id: "tidewater_ai",
            feature_key: "summarization",
            event_name: "summary_generated",
            ts: daysAgo(19),
            cost: 0.12,
            cost_unit: "usd",
            revenue: 0.5,
            usage: 1000,
            model: "gpt-4o-mini",
            provider: "openai",
            source: "sample",
            properties: { trace_id: "tr_s5t6u7v8", span_id: "sp_051" },
          },
          {
            customer_id: "blazeml",
            feature_key: "summarization",
            event_name: "summary_generated",
            ts: daysAgo(28),
            cost: 0.3,
            cost_unit: "usd",
            revenue: 1.2,
            usage: 2400,
            model: "claude-opus-4-6",
            provider: "anthropic",
            source: "sample",
            properties: {},
          },
        ];

        // Enrich sample events with cost_type and agent_id
        for (const ev of sampleEvents) {
          if (!ev.cost_type) {
            if (ev.feature_key === "search") ev.cost_type = "embedding";
            else if (ev.feature_key === "document_qa")
              ev.cost_type = "vector_db";
            else if (ev.feature_key === "summarization") ev.cost_type = "api";
            else ev.cost_type = "llm";
          }
          if (!ev.agent_id && ev.properties?.trace_id) {
            ev.agent_id = `agent_${ev.feature_key}`;
          }
        }

        for (const ev of sampleEvents) {
          await client.query(
            `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, revenue_amount, usage_units, model, model_provider, source, granularity, properties, request_body, response_body, agent_id, cost_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'event', $13, $14, $15, $16, $17)`,
            [
              req.visitorId,
              ev.customer_id,
              ev.feature_key,
              ev.event_name,
              ev.ts,
              ev.cost,
              ev.cost_unit,
              ev.revenue,
              ev.usage,
              ev.model,
              ev.provider,
              ev.source,
              JSON.stringify(ev.properties || {}),
              ev.request_body ? JSON.stringify(ev.request_body) : null,
              ev.response_body ? JSON.stringify(ev.response_body) : null,
              ev.agent_id || null,
              ev.cost_type || null,
            ],
          );
        }

        await client.query(
          "INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()",
          [req.visitorId, "sample"],
        );

        await client.query("COMMIT");
        deps.convertReferralIfPending(req.visitorId!);
        res.json({ success: true, message: "Sample data loaded" });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Load sample data error:", error);
        res.status(500).json({ error: "Failed to load sample data" });
      } finally {
        client.release();
      }
    },
  );

  router.delete(
    "/data/clear",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM ai_insights WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM observe_events WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM usage_records WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM cost_records WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM subscriptions WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM customers WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM plans WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1",
          [req.visitorId, "none"],
        );
        await client.query("COMMIT");
        res.json({ success: true });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Clear data error:", error);
        res.status(500).json({ error: "Failed to clear data" });
      } finally {
        client.release();
      }
    },
  );

  router.delete(
    "/data/clear/revenue",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'revenue'",
          [req.visitorId],
        );
        await client.query("DELETE FROM subscriptions WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM customers WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM plans WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("COMMIT");
        res.json({ success: true });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("DELETE /data/clear/revenue error:", error);
        res.status(500).json({ error: "Failed to clear revenue data" });
      } finally {
        client.release();
      }
    },
  );

  router.delete(
    "/data/clear/costs",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'cost'",
          [req.visitorId],
        );
        await client.query("DELETE FROM cost_records WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("COMMIT");
        res.json({ success: true });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("DELETE /data/clear/costs error:", error);
        res.status(500).json({ error: "Failed to clear cost data" });
      } finally {
        client.release();
      }
    },
  );

  router.delete(
    "/data/clear/usage",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'usage'",
          [req.visitorId],
        );
        await client.query("DELETE FROM usage_records WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("COMMIT");
        res.json({ success: true });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("DELETE /data/clear/usage error:", error);
        res.status(500).json({ error: "Failed to clear usage data" });
      } finally {
        client.release();
      }
    },
  );

  router.post(
    "/data/upload/costs",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const access = await deps.checkBillingFeatureAccess(
        req.visitorId!,
        "csv_upload",
        req.accountEmail,
      );
      if (!access.allowed)
        return res.status(403).json({
          error: access.reason || "Upload limit reached. Upgrade your plan.",
        });
      const client = await pool.connect();
      try {
        const { records } = req.body;
        if (!Array.isArray(records) || records.length === 0)
          return res.status(400).json({ error: "No records provided" });
        if (records.length > 10000)
          return res
            .status(400)
            .json({ error: "Too many records. Maximum 10,000 per upload." });
        const parseResult = z.array(costRecordSchema).safeParse(records);
        if (!parseResult.success)
          return res.status(400).json({
            error: "Invalid record format",
            details: parseResult.error.issues.slice(0, 5),
          });

        await client.query("BEGIN");
        await clearSampleData(client, req.visitorId!);
        await client.query("DELETE FROM cost_records WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query(
          "DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'cost'",
          [req.visitorId],
        );

        const batchSize = 500;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          const costValues: unknown[] = [];
          const costPlaceholders: string[] = [];
          const eventValues: unknown[] = [];
          const eventPlaceholders: string[] = [];
          let costIdx = 1;
          let eventIdx = 1;

          for (const record of batch) {
            const periodStart = `${record.month}-01`;
            const periodEnd = new Date(record.month + "-01");
            periodEnd.setMonth(periodEnd.getMonth() + 1);
            periodEnd.setDate(0);
            const periodEndStr = periodEnd.toISOString().split("T")[0];

            costPlaceholders.push(
              `($${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++})`,
            );
            costValues.push(
              req.visitorId,
              record.customer_id || null,
              record.provider || "infrastructure",
              record.cost,
              periodStart,
              periodEndStr,
            );

            eventPlaceholders.push(
              `($${eventIdx++}, $${eventIdx++}, $${eventIdx++}, 'cost', $${eventIdx++}, $${eventIdx++}, 'usd', 'csv', 'monthly_aggregate', $${eventIdx++})`,
            );
            eventValues.push(
              req.visitorId,
              record.customer_id || "_aggregate",
              record.provider || "infrastructure",
              new Date(`${record.month}-01`).toISOString(),
              record.cost,
              record.provider || null,
            );
          }

          await client.query(
            `INSERT INTO cost_records (user_id, customer_id, cost_type, amount, period_start, period_end) VALUES ${costPlaceholders.join(", ")}`,
            costValues,
          );
          await client.query(
            `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, source, granularity, model_provider) VALUES ${eventPlaceholders.join(", ")}`,
            eventValues,
          );
        }

        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1",
          [req.visitorId, "user"],
        );
        await client.query("COMMIT");
        deps.convertReferralIfPending(req.visitorId!);
        deps.trackBillingUsage(
          req.visitorId!,
          "csv_upload",
          "csv_upload_costs",
        );
        checkAlerts(pool, req.visitorId!).catch((err) =>
          console.error("checkAlerts error (csv upload):", err),
        );
        res.json({ success: true, count: records.length });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Upload costs error:", error);
        res.status(500).json({ error: "Failed to upload cost data" });
      } finally {
        client.release();
      }
    },
  );

  router.post(
    "/data/upload/usage",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const access = await deps.checkBillingFeatureAccess(
        req.visitorId!,
        "csv_upload",
        req.accountEmail,
      );
      if (!access.allowed)
        return res.status(403).json({
          error: access.reason || "Upload limit reached. Upgrade your plan.",
        });
      const client = await pool.connect();
      try {
        const { records } = req.body;
        if (!Array.isArray(records) || records.length === 0)
          return res.status(400).json({ error: "No records provided" });
        if (records.length > 10000)
          return res
            .status(400)
            .json({ error: "Too many records. Maximum 10,000 per upload." });
        const parseResult = z.array(usageRecordSchema).safeParse(records);
        if (!parseResult.success)
          return res.status(400).json({
            error: "Invalid record format",
            details: parseResult.error.issues.slice(0, 5),
          });

        await client.query("BEGIN");
        await clearSampleData(client, req.visitorId!);
        await client.query("DELETE FROM usage_records WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query(
          "DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'usage'",
          [req.visitorId],
        );

        const batchSize = 500;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          const usageValues: unknown[] = [];
          const usagePlaceholders: string[] = [];
          const eventValues: unknown[] = [];
          const eventPlaceholders: string[] = [];
          let usageIdx = 1;
          let eventIdx = 1;

          for (const record of batch) {
            const periodStart = `${record.month}-01`;
            const periodEnd = new Date(record.month + "-01");
            periodEnd.setMonth(periodEnd.getMonth() + 1);
            periodEnd.setDate(0);
            const periodEndStr = periodEnd.toISOString().split("T")[0];
            const metricKey = record.metric || record.metric_key;
            const metricValue = record.value ?? record.metric_value;

            usagePlaceholders.push(
              `($${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++})`,
            );
            usageValues.push(
              req.visitorId,
              record.customer_id,
              metricKey,
              metricValue,
              record.limit || record.metric_limit || null,
              periodStart,
              periodEndStr,
            );

            eventPlaceholders.push(
              `($${eventIdx++}, $${eventIdx++}, $${eventIdx++}, 'usage', $${eventIdx++}, $${eventIdx++}, 'csv', 'monthly_aggregate')`,
            );
            eventValues.push(
              req.visitorId,
              record.customer_id || "_aggregate",
              metricKey,
              new Date(`${record.month}-01`).toISOString(),
              metricValue,
            );
          }

          await client.query(
            `INSERT INTO usage_records (user_id, customer_id, metric_key, metric_value, metric_limit, period_start, period_end) VALUES ${usagePlaceholders.join(", ")}`,
            usageValues,
          );
          await client.query(
            `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, usage_units, source, granularity) VALUES ${eventPlaceholders.join(", ")}`,
            eventValues,
          );
        }

        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1",
          [req.visitorId, "user"],
        );
        await client.query("COMMIT");
        deps.convertReferralIfPending(req.visitorId!);
        deps.trackBillingUsage(
          req.visitorId!,
          "csv_upload",
          "csv_upload_usage",
        );
        checkAlerts(pool, req.visitorId!).catch((err) =>
          console.error("checkAlerts error (csv upload):", err),
        );
        res.json({ success: true, count: records.length });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Upload usage error:", error);
        res.status(500).json({ error: "Failed to upload usage data" });
      } finally {
        client.release();
      }
    },
  );

  router.post(
    "/data/upload/revenue",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const access = await deps.checkBillingFeatureAccess(
        req.visitorId!,
        "csv_upload",
        req.accountEmail,
      );
      if (!access.allowed)
        return res.status(403).json({
          error: access.reason || "Upload limit reached. Upgrade your plan.",
        });
      const client = await pool.connect();
      try {
        const parseResult = revenueUploadSchema.safeParse(req.body);
        if (!parseResult.success)
          return res.status(400).json({
            error: "Invalid revenue data format",
            details: parseResult.error.issues.slice(0, 5),
          });
        const { customers, plans, subscriptions } = parseResult.data;

        await client.query("BEGIN");
        await clearSampleData(client, req.visitorId!);
        await client.query("DELETE FROM subscriptions WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM customers WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query("DELETE FROM plans WHERE user_id = $1", [
          req.visitorId,
        ]);
        await client.query(
          "DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'revenue'",
          [req.visitorId],
        );

        if (Array.isArray(plans)) {
          for (const plan of plans) {
            await client.query(
              "INSERT INTO plans (user_id, plan_id, name, price_amount, interval_months) VALUES ($1, $2, $3, $4, $5)",
              [
                req.visitorId,
                plan.plan_id,
                plan.name,
                plan.price_amount,
                plan.interval_months || 1,
              ],
            );
          }
        }
        if (Array.isArray(customers)) {
          for (const customer of customers) {
            await client.query(
              "INSERT INTO customers (user_id, customer_id, name, email, segment) VALUES ($1, $2, $3, $4, $5)",
              [
                req.visitorId,
                customer.customer_id,
                customer.name,
                customer.email || null,
                customer.segment || null,
              ],
            );
          }
        }
        if (Array.isArray(subscriptions)) {
          for (const sub of subscriptions) {
            await client.query(
              "INSERT INTO subscriptions (user_id, subscription_id, customer_id, plan_id, is_active, mrr_override, current_period_start, current_period_end) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
              [
                req.visitorId,
                sub.subscription_id,
                sub.customer_id,
                sub.plan_id,
                sub.is_active !== false,
                sub.mrr_override || null,
                sub.current_period_start || null,
                sub.current_period_end || null,
              ],
            );
          }
        }
        if (Array.isArray(subscriptions)) {
          const planPriceMap = new Map(
            (plans || []).map(
              (p: { plan_id: string; price_amount: number }) => [
                p.plan_id,
                parseFloat(p.price_amount as unknown as string) || 0,
              ],
            ),
          );
          for (const sub of subscriptions) {
            const mrr = sub.mrr_override || planPriceMap.get(sub.plan_id) || 0;
            await client.query(
              `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity) VALUES ($1, $2, 'subscription', 'revenue', NOW(), $3, 'csv', 'monthly_aggregate')`,
              [req.visitorId, sub.customer_id, mrr],
            );
          }
        }

        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1",
          [req.visitorId, "user"],
        );
        await client.query("COMMIT");
        deps.convertReferralIfPending(req.visitorId!);
        deps.trackBillingUsage(
          req.visitorId!,
          "csv_upload",
          "csv_upload_revenue",
        );
        res.json({
          success: true,
          counts: {
            customers: customers?.length || 0,
            plans: plans?.length || 0,
            subscriptions: subscriptions?.length || 0,
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Upload revenue error:", error);
        res.status(500).json({ error: "Failed to upload revenue data" });
      } finally {
        client.release();
      }
    },
  );

  router.get(
    "/metrics/summary",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const customersResult = await pool.query(
          "SELECT COUNT(*) FROM customers WHERE user_id = $1",
          [req.visitorId],
        );
        const activeSubs = await pool.query(
          "SELECT COUNT(*) FROM subscriptions WHERE user_id = $1 AND is_active = true",
          [req.visitorId],
        );
        const mrrResult = await pool.query(
          "SELECT COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as mrr FROM subscriptions s LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id WHERE s.user_id = $1 AND s.is_active = true",
          [req.visitorId],
        );

        const mrr = parseFloat(mrrResult.rows[0].mrr) || 0;
        const customerCount = parseInt(customersResult.rows[0].count);

        res.json({
          total_customers: customerCount,
          active_subscriptions: parseInt(activeSubs.rows[0].count),
          mrr: mrr,
          arr: mrr * 12,
          arpc: customerCount > 0 ? mrr / customerCount : 0,
        });
      } catch (error) {
        console.error("Get metrics error:", error);
        res.status(500).json({ error: "Failed to get metrics" });
      }
    },
  );

  router.get(
    "/metrics/source-breakdown",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT source, is_inferred,
              COUNT(*) as event_count,
              COALESCE(SUM(cost_amount), 0) as total_cost,
              COALESCE(SUM(revenue_amount), 0) as total_revenue
       FROM observe_events
       WHERE user_id = $1
       GROUP BY source, is_inferred
       ORDER BY total_cost DESC`,
          [req.visitorId],
        );
        const sources = result.rows.map(
          (r: {
            source: string;
            is_inferred: boolean;
            event_count: string;
            total_cost: string;
            total_revenue: string;
          }) => ({
            source: r.is_inferred ? "inferred" : r.source,
            event_count: parseInt(r.event_count),
            total_cost: parseFloat(r.total_cost) || 0,
            total_revenue: parseFloat(r.total_revenue) || 0,
          }),
        );
        const total_events = sources.reduce(
          (s: number, r: { event_count: number }) => s + r.event_count,
          0,
        );
        res.json({ sources, total_events });
      } catch (error) {
        console.error("Get source breakdown error:", error);
        res.status(500).json({ error: "Failed to get source breakdown" });
      }
    },
  );

  // GET /customers/:id — enriched customer detail with events
  router.get(
    "/customers/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { id } = req.params;

        const [customerRes, subRes, eventsRes, featureRes] = await Promise.all([
          pool.query(
            "SELECT * FROM customers WHERE user_id = $1 AND customer_id = $2",
            [req.visitorId, id],
          ),
          pool.query(
            `SELECT s.*, p.name as plan_name, p.price_amount FROM subscriptions s LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id WHERE s.user_id = $1 AND s.customer_id = $2`,
            [req.visitorId, id],
          ),
          pool.query(
            `SELECT * FROM observe_events WHERE user_id = $1 AND customer_id = $2 ORDER BY timestamp DESC LIMIT 50`,
            [req.visitorId, id],
          ),
          pool.query(
            `SELECT feature_key, COUNT(*) as event_count, COALESCE(SUM(cost_amount), 0) as total_cost, COALESCE(SUM(revenue_amount), 0) as total_revenue, COALESCE(SUM(usage_units), 0) as total_usage FROM observe_events WHERE user_id = $1 AND customer_id = $2 AND feature_key IS NOT NULL GROUP BY feature_key ORDER BY total_cost DESC`,
            [req.visitorId, id],
          ),
        ]);

        if (customerRes.rows.length === 0) {
          return res.status(404).json({ error: "Customer not found" });
        }

        const c = customerRes.rows[0];
        const totalCost = featureRes.rows.reduce(
          (sum: number, r: { total_cost: string }) =>
            sum + (parseFloat(r.total_cost) || 0),
          0,
        );
        const totalRevenue = featureRes.rows.reduce(
          (sum: number, r: { total_revenue: string }) =>
            sum + (parseFloat(r.total_revenue) || 0),
          0,
        );
        const marginPct =
          totalRevenue > 0
            ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100)
            : null;

        res.json({
          customer: {
            customer_id: c.customer_id,
            name: c.name,
            email: c.email,
            segment: c.segment,
            created_at: c.created_at,
          },
          subscriptions: subRes.rows,
          total_cost: totalCost,
          total_revenue: totalRevenue,
          margin_pct: marginPct,
          recent_events: eventsRes.rows.map(coerceEventRow),
          by_feature: featureRes.rows.map(
            (r: {
              feature_key: string;
              event_count: string;
              total_cost: string;
              total_revenue: string;
              total_usage: string;
            }) => ({
              feature_key: r.feature_key,
              event_count: parseInt(r.event_count),
              total_cost: parseFloat(r.total_cost) || 0,
              total_revenue: parseFloat(r.total_revenue) || 0,
              total_usage: parseFloat(r.total_usage) || 0,
            }),
          ),
        });
      } catch (error) {
        console.error("Get customer detail error:", error);
        res.status(500).json({ error: "Failed to get customer detail" });
      }
    },
  );

  return router;
}
