import { Router, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { type AuthRequest } from "./auth.js";
import rateLimit from "express-rate-limit";
import { getUncachableStripeClient } from "../stripe-client.js";

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

// Clear sample/demo data when transitioning to real user data
// Uses exact sample IDs to avoid deleting real Stripe data (sub_*, cus_* prefixes match real Stripe IDs)
const SAMPLE_SUBSCRIPTION_IDS = [
  "sub_001",
  "sub_002",
  "sub_003",
  "sub_004",
  "sub_005",
  // Legacy IDs from older sample data
  "sub_acme",
  "sub_acme_addon",
  "sub_tidewater",
  "sub_neon",
  "sub_neon_addon",
  "sub_circle",
  "sub_blaze",
  "sub_quantum",
];
const SAMPLE_CUSTOMER_IDS = [
  "cus_001",
  "cus_002",
  "cus_003",
  "cus_004",
  "cus_005",
  // Legacy IDs from older sample data
  "acme_saas",
  "tidewater_ai",
  "neondata",
  "circleops",
  "blazeml",
  "quantumhr",
];
const SAMPLE_PLAN_IDS = ["starter", "pro", "enterprise"];

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
    console.error("data: account_id fallback lookup failed:", err);
  }
  console.warn("data: no account_id resolved for user", userId);
  return null;
}

async function clearSampleData(
  db: { query: (text: string, params: unknown[]) => Promise<unknown> },
  pool: Pool,
  userId: string,
  accountId?: number,
): Promise<void> {
  const resolved = await resolveAccountIdForUser(pool, userId, accountId);
  await db.query(
    "DELETE FROM observe_events WHERE account_id = $1 AND source = 'sample'",
    [resolved],
  );
  await db.query(
    "DELETE FROM cost_records WHERE account_id = $1 AND cost_type = 'ai_inference' AND customer_id IS NULL AND period_start IS NOT NULL",
    [resolved],
  );
  await db.query(
    `DELETE FROM subscriptions WHERE account_id = $1 AND subscription_id = ANY($2)`,
    [resolved, SAMPLE_SUBSCRIPTION_IDS],
  );
  await db.query(
    `DELETE FROM customers WHERE account_id = $1 AND customer_id = ANY($2)`,
    [resolved, SAMPLE_CUSTOMER_IDS],
  );
  await db.query(
    `DELETE FROM plans WHERE account_id = $1 AND plan_id = ANY($2)`,
    [resolved, SAMPLE_PLAN_IDS],
  );
}

// Upload validation schemas
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

export function createDataRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    checkBillingFeatureAccess: CheckBillingFeatureAccessFn;
    trackBillingUsage: TrackBillingUsageFn;
    convertReferralIfPending: ConvertReferralFn;
  },
) {
  const router = Router();
  const {
    checkBillingFeatureAccess,
    trackBillingUsage,
    convertReferralIfPending,
  } = deps;

  const expensiveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again in a minute" },
  });

  // GET /data/status
  router.get(
    "/data/status",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const acct = req.accountId ?? null;
        const statusResult = await pool.query(
          "SELECT * FROM user_data_status WHERE account_id = $1",
          [acct],
        );
        const customersResult = await pool.query(
          "SELECT COUNT(*) FROM customers WHERE account_id = $1",
          [acct],
        );
        const costsResult = await pool.query(
          "SELECT COUNT(*) FROM cost_records WHERE account_id = $1",
          [acct],
        );
        const usageResult = await pool.query(
          "SELECT COUNT(*) FROM usage_records WHERE account_id = $1",
          [acct],
        );

        const eventsResult = await pool.query(
          "SELECT COUNT(*) FROM observe_events WHERE account_id = $1",
          [acct],
        );

        const status = statusResult.rows[0] || { data_mode: "none" };
        const customerCount = parseInt(customersResult.rows[0].count);
        const costsCount = parseInt(costsResult.rows[0].count);
        const usageCount = parseInt(usageResult.rows[0].count);
        const eventsCount = parseInt(eventsResult.rows[0].count);

        res.json({
          data_mode: status.data_mode,
          has_data: customerCount > 0 || eventsCount > 0,
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

  // GET /customers
  router.get(
    "/customers",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const [result, countResult] = await Promise.all([
          pool.query(
            "SELECT * FROM customers WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
            [req.accountId ?? null, limit, offset],
          ),
          pool.query("SELECT COUNT(*) FROM customers WHERE account_id = $1", [
            req.accountId ?? null,
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

  // GET /subscriptions
  router.get(
    "/subscriptions",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const [result, countResult] = await Promise.all([
          pool.query(
            "SELECT s.*, c.name as customer_name, c.email as customer_email, p.name as plan_name, p.price_amount FROM subscriptions s LEFT JOIN customers c ON s.account_id = c.account_id AND s.customer_id = c.customer_id LEFT JOIN plans p ON s.account_id = p.account_id AND s.plan_id = p.plan_id WHERE s.account_id = $1 ORDER BY s.created_at DESC LIMIT $2 OFFSET $3",
            [req.accountId ?? null, limit, offset],
          ),
          pool.query(
            "SELECT COUNT(*) FROM subscriptions WHERE account_id = $1",
            [req.accountId ?? null],
          ),
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

  // GET /plans
  router.get(
    "/plans",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const result = await pool.query(
          "SELECT * FROM plans WHERE account_id = $1 ORDER BY price_amount ASC LIMIT $2 OFFSET $3",
          [req.accountId ?? null, limit, offset],
        );
        res.json(result.rows);
      } catch (error) {
        console.error("Get plans error:", error);
        res.status(500).json({ error: "Failed to get plans" });
      }
    },
  );

  // GET /usage
  router.get(
    "/usage",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const [result, countResult] = await Promise.all([
          pool.query(
            "SELECT * FROM usage_records WHERE account_id = $1 ORDER BY period_start DESC LIMIT $2 OFFSET $3",
            [req.accountId ?? null, limit, offset],
          ),
          pool.query(
            "SELECT COUNT(*) FROM usage_records WHERE account_id = $1",
            [req.accountId ?? null],
          ),
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

  // GET /costs
  router.get(
    "/costs",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const [result, countResult] = await Promise.all([
          pool.query(
            "SELECT * FROM cost_records WHERE account_id = $1 ORDER BY period_start DESC LIMIT $2 OFFSET $3",
            [req.accountId ?? null, limit, offset],
          ),
          pool.query(
            "SELECT COUNT(*) FROM cost_records WHERE account_id = $1",
            [req.accountId ?? null],
          ),
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

  // GET /data/analyzer
  router.get(
    "/data/analyzer",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const analyzerLimit = 5000;
        const acct = req.accountId ?? null;
        const [plans, customers, subscriptions, usage, costs] =
          await Promise.all([
            pool.query("SELECT * FROM plans WHERE account_id = $1 LIMIT $2", [
              acct,
              analyzerLimit,
            ]),
            pool.query(
              "SELECT * FROM customers WHERE account_id = $1 LIMIT $2",
              [acct, analyzerLimit],
            ),
            pool.query(
              "SELECT * FROM subscriptions WHERE account_id = $1 LIMIT $2",
              [acct, analyzerLimit],
            ),
            pool.query(
              "SELECT * FROM usage_records WHERE account_id = $1 LIMIT $2",
              [acct, analyzerLimit],
            ),
            pool.query(
              "SELECT * FROM cost_records WHERE account_id = $1 LIMIT $2",
              [acct, analyzerLimit],
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

  // POST /data/sample — load sample data

  // DELETE /data/clear
  router.delete(
    "/data/clear",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        const acct = req.accountId ?? null;
        await client.query("BEGIN");
        await client.query("DELETE FROM ai_insights WHERE account_id = $1", [
          acct,
        ]);

        await client.query("DELETE FROM observe_events WHERE account_id = $1", [
          acct,
        ]);
        await client.query("DELETE FROM usage_records WHERE account_id = $1", [
          acct,
        ]);
        await client.query("DELETE FROM cost_records WHERE account_id = $1", [
          acct,
        ]);
        await client.query("DELETE FROM subscriptions WHERE account_id = $1", [
          acct,
        ]);
        await client.query("DELETE FROM customers WHERE account_id = $1", [
          acct,
        ]);
        await client.query("DELETE FROM plans WHERE account_id = $1", [acct]);
        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE account_id = $1",
          [acct, "none"],
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

  // DELETE /data/clear/revenue
  router.delete(
    "/data/clear/revenue",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        const acct = req.accountId ?? null;
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND event_name = 'revenue'",
          [acct],
        );
        await client.query("DELETE FROM subscriptions WHERE account_id = $1", [
          acct,
        ]);
        await client.query("DELETE FROM customers WHERE account_id = $1", [
          acct,
        ]);
        await client.query("DELETE FROM plans WHERE account_id = $1", [acct]);
        await client.query("COMMIT");
        res.json({ success: true });
      } catch (error) {
        console.error("Failed to clear revenue data:", error);
        await client.query("ROLLBACK");
        res.status(500).json({ error: "Failed to clear revenue data" });
      } finally {
        client.release();
      }
    },
  );

  // DELETE /data/clear/costs
  router.delete(
    "/data/clear/costs",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        const acct = req.accountId ?? null;
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND event_name = 'cost'",
          [acct],
        );
        await client.query("DELETE FROM cost_records WHERE account_id = $1", [
          acct,
        ]);
        await client.query("COMMIT");
        res.json({ success: true });
      } catch (error) {
        console.error("Failed to clear cost data:", error);
        await client.query("ROLLBACK");
        res.status(500).json({ error: "Failed to clear cost data" });
      } finally {
        client.release();
      }
    },
  );

  // DELETE /data/clear/usage
  router.delete(
    "/data/clear/usage",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        const acct = req.accountId ?? null;
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND event_name = 'usage'",
          [acct],
        );
        await client.query("DELETE FROM usage_records WHERE account_id = $1", [
          acct,
        ]);
        await client.query("COMMIT");
        res.json({ success: true });
      } catch (error) {
        console.error("Failed to clear usage data:", error);
        await client.query("ROLLBACK");
        res.status(500).json({ error: "Failed to clear usage data" });
      } finally {
        client.release();
      }
    },
  );

  // POST /data/upload/costs
  router.post(
    "/data/upload/costs",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const access = await checkBillingFeatureAccess(
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
        if (!Array.isArray(records) || records.length === 0) {
          return res.status(400).json({ error: "No records provided" });
        }
        if (records.length > 10000) {
          return res
            .status(400)
            .json({ error: "Too many records. Maximum 10,000 per upload." });
        }
        const parseResult = z.array(costRecordSchema).safeParse(records);
        if (!parseResult.success) {
          return res.status(400).json({
            error: "Invalid record format",
            details: parseResult.error.issues.slice(0, 5),
          });
        }

        await client.query("BEGIN");
        await client.query("DELETE FROM cost_records WHERE account_id = $1", [
          req.accountId ?? null,
        ]);
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND event_name = 'cost'",
          [req.accountId ?? null],
        );

        // Batch insert cost_records
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
              `($${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++})`,
            );
            costValues.push(
              req.visitorId,
              req.accountId ?? null,
              record.customer_id || null,
              record.provider || "infrastructure",
              record.cost,
              periodStart,
              periodEndStr,
            );

            eventPlaceholders.push(
              `($${eventIdx++}, $${eventIdx++}, $${eventIdx++}, $${eventIdx++}, 'cost', $${eventIdx++}, $${eventIdx++}, 'usd', 'csv', 'monthly_aggregate', $${eventIdx++})`,
            );
            eventValues.push(
              req.visitorId,
              req.accountId ?? null,
              record.customer_id || "_aggregate",
              record.provider || "infrastructure",
              new Date(`${record.month}-01`).toISOString(),
              record.cost,
              record.provider || null,
            );
          }

          await client.query(
            `INSERT INTO cost_records (user_id, account_id, customer_id, cost_type, amount, period_start, period_end) VALUES ${costPlaceholders.join(", ")}`,
            costValues,
          );
          await client.query(
            `INSERT INTO observe_events (user_id, account_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, source, granularity, model_provider) VALUES ${eventPlaceholders.join(", ")}`,
            eventValues,
          );
        }

        await clearSampleData(client, pool, req.visitorId!, req.accountId);
        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE account_id = $1",
          [req.accountId ?? null, "user"],
        );

        await client.query("COMMIT");
        convertReferralIfPending(req.visitorId!);
        trackBillingUsage(req.visitorId!, "csv_upload", "csv_upload_costs");
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

  // POST /data/upload/usage
  router.post(
    "/data/upload/usage",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const access = await checkBillingFeatureAccess(
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
        if (!Array.isArray(records) || records.length === 0) {
          return res.status(400).json({ error: "No records provided" });
        }
        if (records.length > 10000) {
          return res
            .status(400)
            .json({ error: "Too many records. Maximum 10,000 per upload." });
        }
        const parseResult = z.array(usageRecordSchema).safeParse(records);
        if (!parseResult.success) {
          return res.status(400).json({
            error: "Invalid record format",
            details: parseResult.error.issues.slice(0, 5),
          });
        }

        await client.query("BEGIN");
        await client.query("DELETE FROM usage_records WHERE account_id = $1", [
          req.accountId ?? null,
        ]);
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND event_name = 'usage'",
          [req.accountId ?? null],
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
              `($${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++})`,
            );
            usageValues.push(
              req.visitorId,
              req.accountId ?? null,
              record.customer_id,
              metricKey,
              metricValue,
              record.limit || record.metric_limit || null,
              periodStart,
              periodEndStr,
            );

            eventPlaceholders.push(
              `($${eventIdx++}, $${eventIdx++}, $${eventIdx++}, $${eventIdx++}, 'usage', $${eventIdx++}, $${eventIdx++}, 'csv', 'monthly_aggregate')`,
            );
            eventValues.push(
              req.visitorId,
              req.accountId ?? null,
              record.customer_id || "_aggregate",
              metricKey,
              new Date(`${record.month}-01`).toISOString(),
              metricValue,
            );
          }

          await client.query(
            `INSERT INTO usage_records (user_id, account_id, customer_id, metric_key, metric_value, metric_limit, period_start, period_end) VALUES ${usagePlaceholders.join(", ")}`,
            usageValues,
          );
          await client.query(
            `INSERT INTO observe_events (user_id, account_id, customer_id, feature_key, event_name, timestamp, usage_units, source, granularity) VALUES ${eventPlaceholders.join(", ")}`,
            eventValues,
          );
        }

        await clearSampleData(client, pool, req.visitorId!, req.accountId);
        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE account_id = $1",
          [req.accountId ?? null, "user"],
        );

        await client.query("COMMIT");
        convertReferralIfPending(req.visitorId!);
        trackBillingUsage(req.visitorId!, "csv_upload", "csv_upload_usage");
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

  // POST /data/upload/revenue
  router.post(
    "/data/upload/revenue",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const access = await checkBillingFeatureAccess(
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
        if (!parseResult.success) {
          return res.status(400).json({
            error: "Invalid revenue data format",
            details: parseResult.error.issues.slice(0, 5),
          });
        }
        const { customers, plans, subscriptions } = parseResult.data;

        if (!customers?.length && !plans?.length && !subscriptions?.length) {
          return res.status(400).json({
            error:
              "Upload must include at least one customer, plan, or subscription.",
          });
        }

        await client.query("BEGIN");

        // Clear existing revenue data
        const acctRev = req.accountId ?? null;
        await client.query("DELETE FROM subscriptions WHERE account_id = $1", [
          acctRev,
        ]);
        await client.query("DELETE FROM customers WHERE account_id = $1", [
          acctRev,
        ]);
        await client.query("DELETE FROM plans WHERE account_id = $1", [
          acctRev,
        ]);
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND event_name = 'revenue'",
          [acctRev],
        );

        // Insert plans
        if (Array.isArray(plans)) {
          for (const plan of plans) {
            await client.query(
              "INSERT INTO plans (user_id, account_id, plan_id, name, price_amount, interval_months) VALUES ($1, $2, $3, $4, $5, $6)",
              [
                req.visitorId,
                req.accountId ?? null,
                plan.plan_id,
                plan.name,
                plan.price_amount,
                plan.interval_months || 1,
              ],
            );
          }
        }

        // Insert customers
        if (Array.isArray(customers)) {
          for (const customer of customers) {
            await client.query(
              "INSERT INTO customers (user_id, account_id, customer_id, name, email, segment) VALUES ($1, $2, $3, $4, $5, $6)",
              [
                req.visitorId,
                req.accountId ?? null,
                customer.customer_id,
                customer.name,
                customer.email || null,
                customer.segment || null,
              ],
            );
          }
        }

        // Insert subscriptions
        if (Array.isArray(subscriptions)) {
          for (const sub of subscriptions) {
            await client.query(
              "INSERT INTO subscriptions (user_id, account_id, subscription_id, customer_id, plan_id, is_active, mrr_override, current_period_start, current_period_end) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
              [
                req.visitorId,
                req.accountId ?? null,
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

        // Dual-write subscriptions to observe_events (use plan price as MRR fallback)
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
              `INSERT INTO observe_events (user_id, account_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity)
             VALUES ($1, $2, $3, 'subscription', 'revenue', NOW(), $4, 'csv', 'monthly_aggregate')`,
              [req.visitorId, req.accountId ?? null, sub.customer_id, mrr],
            );
          }
        }

        await clearSampleData(client, pool, req.visitorId!, req.accountId);
        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE account_id = $1",
          [req.accountId ?? null, "user"],
        );

        await client.query("COMMIT");
        convertReferralIfPending(req.visitorId!);
        trackBillingUsage(req.visitorId!, "csv_upload", "csv_upload_revenue");
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

  // GET /metrics/summary
  router.get(
    "/metrics/summary",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const acct = req.accountId ?? null;
        const customersResult = await pool.query(
          "SELECT COUNT(*) FROM customers WHERE account_id = $1",
          [acct],
        );
        const activeSubs = await pool.query(
          "SELECT COUNT(*) FROM subscriptions WHERE account_id = $1 AND is_active = true",
          [acct],
        );
        const mrrResult = await pool.query(
          "SELECT COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as mrr FROM subscriptions s LEFT JOIN plans p ON s.account_id = p.account_id AND s.plan_id = p.plan_id WHERE s.account_id = $1 AND s.is_active = true",
          [acct],
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

  // GET /metrics/source-breakdown
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
         WHERE account_id = $1
         GROUP BY source, is_inferred
         ORDER BY total_cost DESC`,
          [req.accountId ?? null],
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

  // GET /stripe/status
  router.get(
    "/stripe/status",
    ensureVisitor,
    async (_req: AuthRequest, res: Response) => {
      try {
        const stripe = await getUncachableStripeClient();
        const account = await stripe.accounts.retrieve();
        res.json({
          connected: true,
          account_id: account.id,
          account_name:
            (
              account as {
                business_profile?: { name?: string };
                display_name?: string;
              }
            ).business_profile?.name ||
            (account as { display_name?: string }).display_name ||
            account.id,
        });
      } catch (error) {
        console.error("Stripe status check error:", error);
        res.json({ connected: false, error: "Not connected" });
      }
    },
  );

  // POST /stripe/sync
  router.post(
    "/stripe/sync",
    ensureVisitor,
    expensiveLimiter,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        const stripe = await getUncachableStripeClient();

        // Fetch all data from Stripe using auto-pagination
        const [
          stripeCustomersList,
          stripeSubscriptionsList,
          stripeProductsList,
          pricesList,
        ] = await Promise.all([
          stripe.customers
            .list({ limit: 100 })
            .autoPagingToArray({ limit: 10000 }),
          stripe.subscriptions
            .list({ limit: 100, status: "all" })
            .autoPagingToArray({ limit: 10000 }),
          stripe.products
            .list({ limit: 100, active: true })
            .autoPagingToArray({ limit: 10000 }),
          stripe.prices
            .list({ limit: 100, active: true })
            .autoPagingToArray({ limit: 10000 }),
        ]);
        const stripeCustomers = { data: stripeCustomersList };
        const stripeSubscriptions = { data: stripeSubscriptionsList };
        const stripeProducts = { data: stripeProductsList };
        const prices = pricesList;

        await client.query("BEGIN");

        // Clear existing revenue data
        const acctStripe = req.accountId ?? null;
        await client.query("DELETE FROM subscriptions WHERE account_id = $1", [
          acctStripe,
        ]);
        await client.query("DELETE FROM customers WHERE account_id = $1", [
          acctStripe,
        ]);
        await client.query("DELETE FROM plans WHERE account_id = $1", [
          acctStripe,
        ]);
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND source = 'stripe'",
          [acctStripe],
        );

        // Insert plans (from Stripe products + prices) — batched
        const planIds = new Set<string>();
        const planRows: {
          planId: string;
          name: string;
          amount: number;
          intervalMonths: number;
        }[] = [];
        for (const price of prices) {
          const planId = price.id;
          if (planIds.has(planId)) continue;
          planIds.add(planId);
          const product = stripeProducts.data.find(
            (p) =>
              p.id ===
              (typeof price.product === "string"
                ? price.product
                : price.product?.id),
          );
          const name = product?.name || planId;
          const amount = (price.unit_amount || 0) / 100;
          const intervalMonths = price.recurring?.interval === "year" ? 12 : 1;
          planRows.push({ planId, name, amount, intervalMonths });
        }
        const batchSize = 500;
        for (let i = 0; i < planRows.length; i += batchSize) {
          const batch = planRows.slice(i, i + batchSize);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;
          for (const p of batch) {
            placeholders.push(
              `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
            );
            values.push(
              req.visitorId,
              req.accountId ?? null,
              p.planId,
              p.name,
              p.amount,
              p.intervalMonths,
              "recurring",
            );
          }
          await client.query(
            `INSERT INTO plans (user_id, account_id, plan_id, name, price_amount, interval_months, billing_model) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
            values,
          );
        }

        // Insert customers — batched
        const validCustomers = stripeCustomers.data.filter(
          (c) => typeof c !== "string",
        );
        for (let i = 0; i < validCustomers.length; i += batchSize) {
          const batch = validCustomers.slice(i, i + batchSize);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;
          for (const customer of batch) {
            placeholders.push(
              `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
            );
            values.push(
              req.visitorId,
              req.accountId ?? null,
              customer.id,
              customer.email || customer.id,
              customer.email || null,
            );
          }
          await client.query(
            `INSERT INTO customers (user_id, account_id, customer_id, name, email) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
            values,
          );
        }

        // Insert subscriptions — batched
        let syncedSubs = 0;
        const subRows: {
          id: string;
          customerId: string;
          priceId: string;
          isActive: boolean;
          mrr: number;
        }[] = [];
        for (const sub of stripeSubscriptions.data) {
          const priceId = sub.items?.data?.[0]?.price?.id;
          if (!priceId) continue;
          const unitAmount = sub.items.data[0].price.unit_amount || 0;
          const mrr =
            sub.items.data[0].price.recurring?.interval === "year"
              ? Math.round(unitAmount / 12 / 100)
              : Math.round(unitAmount / 100);
          subRows.push({
            id: sub.id,
            customerId: sub.customer as string,
            priceId,
            isActive: sub.status === "active",
            mrr,
          });
          syncedSubs++;
        }
        for (let i = 0; i < subRows.length; i += batchSize) {
          const batch = subRows.slice(i, i + batchSize);
          const subValues: unknown[] = [];
          const subPlaceholders: string[] = [];
          const eventValues: unknown[] = [];
          const eventPlaceholders: string[] = [];
          let subIdx = 1;
          let eventIdx = 1;
          for (const s of batch) {
            subPlaceholders.push(
              `($${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++})`,
            );
            subValues.push(
              req.visitorId,
              req.accountId ?? null,
              s.id,
              s.customerId,
              s.priceId,
              s.isActive,
              s.mrr,
            );
            eventPlaceholders.push(
              `($${eventIdx++}, $${eventIdx++}, $${eventIdx++}, 'subscription', 'revenue', NOW(), $${eventIdx++}, 'stripe', 'monthly_aggregate')`,
            );
            eventValues.push(
              req.visitorId,
              req.accountId ?? null,
              s.customerId,
              s.mrr,
            );
          }
          await client.query(
            `INSERT INTO subscriptions (user_id, account_id, subscription_id, customer_id, plan_id, is_active, mrr_override) VALUES ${subPlaceholders.join(", ")} ON CONFLICT DO NOTHING`,
            subValues,
          );
          await client.query(
            `INSERT INTO observe_events (user_id, account_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity) VALUES ${eventPlaceholders.join(", ")}`,
            eventValues,
          );
        }

        await clearSampleData(client, pool, req.visitorId!, req.accountId);
        await client.query(
          "INSERT INTO user_data_status (user_id, account_id, data_mode) VALUES ($1, $2, $3) ON CONFLICT (account_id) DO UPDATE SET data_mode = $3, updated_at = NOW()",
          [req.visitorId, req.accountId ?? null, "user"],
        );

        await client.query("COMMIT");
        convertReferralIfPending(req.visitorId!);

        // Track Stripe sync usage in billing
        trackBillingUsage(req.visitorId!, "stripe_sync", "stripe_data_synced");

        res.json({
          success: true,
          synced: {
            customers: stripeCustomers.data.length,
            subscriptions: syncedSubs,
            plans: planIds.size,
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Stripe sync error:", error);
        res.status(500).json({ error: "Stripe sync failed" });
      } finally {
        client.release();
      }
    },
  );

  // POST /stripe/sync-invoices — import Stripe invoice line items for granular per-customer revenue
  router.post(
    "/stripe/sync-invoices",
    ensureVisitor,
    expensiveLimiter,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        const stripe = await getUncachableStripeClient();

        const [invoices, products] = await Promise.all([
          stripe.invoices
            .list({
              limit: 100,
              created: { gte: Math.floor(Date.now() / 1000) - 90 * 86400 },
            })
            .autoPagingToArray({ limit: 10000 }),
          stripe.products
            .list({ limit: 100 })
            .autoPagingToArray({ limit: 10000 }),
        ]);

        const productNameMap = new Map<string, string>();
        for (const product of products) {
          productNameMap.set(product.id, product.name);
        }

        await client.query("BEGIN");
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND source = 'stripe' AND granularity = 'invoice'",
          [req.accountId ?? null],
        );

        const lineItemRows: {
          customerId: string;
          featureKey: string;
          timestamp: Date;
          revenueAmount: number;
        }[] = [];
        let invoiceCount = 0;
        for (const invoice of invoices) {
          if (invoice.status !== "paid") continue;
          invoiceCount++;
          for (const line of invoice.lines.data) {
            const productId =
              typeof line.price?.product === "string"
                ? line.price.product
                : (line.price?.product as { id: string } | null)?.id;
            const featureKey =
              (productId && productNameMap.get(productId)) || "subscription";
            lineItemRows.push({
              customerId: invoice.customer as string,
              featureKey,
              timestamp: new Date((line.period?.start || 0) * 1000),
              revenueAmount: (line.amount || 0) / 100,
            });
          }
        }

        const batchSize = 500;
        for (let i = 0; i < lineItemRows.length; i += batchSize) {
          const batch = lineItemRows.slice(i, i + batchSize);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;
          for (const item of batch) {
            placeholders.push(
              `($${idx++}, $${idx++}, $${idx++}, $${idx++}, 'invoice_line_item', $${idx++}, $${idx++}, 'stripe', 'invoice', 'explicit')`,
            );
            values.push(
              req.visitorId,
              req.accountId ?? null,
              item.customerId,
              item.featureKey,
              item.timestamp,
              item.revenueAmount,
            );
          }
          await client.query(
            `INSERT INTO observe_events (user_id, account_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity, revenue_source)
           VALUES ${placeholders.join(", ")}`,
            values,
          );
        }

        await client.query("COMMIT");
        res.json({
          success: true,
          invoices: invoiceCount,
          line_items: lineItemRows.length,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Stripe invoice sync error:", error);
        res.status(500).json({ error: "Stripe invoice sync failed" });
      } finally {
        client.release();
      }
    },
  );

  // POST /data/upload/provider-csv — auto-detect and import OpenAI/Anthropic billing exports
  router.post(
    "/data/upload/provider-csv",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const access = await checkBillingFeatureAccess(
        req.visitorId!,
        "csv_upload",
        req.accountEmail,
      );
      if (!access.allowed)
        return res
          .status(403)
          .json({ error: access.reason || "Upload limit reached." });
      const client = await pool.connect();
      try {
        const { raw_csv } = req.body;
        if (!raw_csv || typeof raw_csv !== "string") {
          return res.status(400).json({ error: "raw_csv is required" });
        }

        const lines = raw_csv.trim().split("\n");
        if (lines.length < 2) {
          return res.status(400).json({
            error: "CSV must have a header row and at least one data row",
          });
        }

        const headers = lines[0]
          .split(",")
          .map((h) => h.trim().replace(/^"/, "").replace(/"$/, ""));
        const headersLower = headers.map((h) => h.toLowerCase());

        // Detect provider
        let provider: "openai" | "anthropic" | null = null;
        const hasOpenAI =
          headersLower.some((h) =>
            [
              "n_context_tokens",
              "n_completion_tokens",
              "input tokens",
              "output tokens",
            ].includes(h),
          ) && headersLower.some((h) => ["cost", "cost ($)"].includes(h));
        const hasAnthropic =
          headersLower.some((h) =>
            ["input_tokens", "input tokens"].includes(h),
          ) &&
          headersLower.some((h) =>
            ["output_tokens", "output tokens"].includes(h),
          ) &&
          headersLower.some((h) => ["total_cost", "cost"].includes(h));

        if (hasOpenAI) provider = "openai";
        else if (hasAnthropic) provider = "anthropic";

        let dateCol: number;
        let modelCol: number;
        let costCol: number;
        let inputTokenCol: number;
        let outputTokenCol: number;
        let customerIdCol = -1;
        let revenueCol = -1;
        let featureKeyCol = -1;

        if (provider) {
          // Known provider — use hardcoded column mapping
          const findCol = (names: string[]): number =>
            headersLower.findIndex((h) => names.includes(h));

          dateCol = findCol(["date"]);
          modelCol = findCol(["model"]);
          costCol = findCol(["cost", "cost ($)", "total_cost"]);
          inputTokenCol = findCol([
            "n_context_tokens",
            "input_tokens",
            "input tokens",
          ]);
          outputTokenCol = findCol([
            "n_completion_tokens",
            "output_tokens",
            "output tokens",
          ]);

          if (dateCol === -1 || costCol === -1) {
            return res
              .status(400)
              .json({ error: "CSV must have date and cost columns" });
          }
        } else {
          // Unknown format — try AI-powered column mapping
          const openaiKey = process.env.OPENAI_API_KEY;

          if (!openaiKey) {
            const sampleRows = lines
              .slice(1, 6)
              .map((line) =>
                line
                  .split(",")
                  .map((c) => c.trim().replace(/^"/, "").replace(/"$/, "")),
              );
            return res.status(400).json({
              error: "unknown_format",
              headers,
              sample_rows: sampleRows,
              message:
                "Unrecognized format. Map columns manually or add an OpenAI API key for auto-detection.",
            });
          }

          const sampleRows = lines
            .slice(1, 6)
            .map((line) =>
              line
                .split(",")
                .map((c) => c.trim().replace(/^"/, "").replace(/"$/, "")),
            );

          const mappingPrompt = `You are a data mapping assistant. Given these CSV headers and sample data, identify which columns map to these fields:
- customer_id: customer/user/account identifier
- cost_amount: monetary cost value
- revenue_amount: monetary revenue value
- model: AI model name (e.g., gpt-4, claude-3)
- feature_key: feature/product/service name
- timestamp: date or datetime
- usage_units: token count or usage metric

CSV Headers: ${JSON.stringify(headers)}
Sample rows:
${sampleRows.map((r) => JSON.stringify(r)).join("\n")}

Return a JSON object mapping our field names to the CSV column index (0-based). Only include fields you're confident about (>80% confidence). Example:
{"customer_id": 0, "cost_amount": 3, "timestamp": 1, "model": 2}`;

          const openaiResponse = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${openaiKey}`,
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: mappingPrompt }],
                temperature: 0.1,
                max_tokens: 500,
              }),
            },
          );

          if (!openaiResponse.ok) {
            const errBody = await openaiResponse.text();
            console.error("OpenAI column mapping error:", errBody);
            return res.status(400).json({
              error: "unknown_format",
              headers,
              sample_rows: sampleRows,
              message: "AI column mapping failed. Map columns manually.",
            });
          }

          const completion = (await openaiResponse.json()) as {
            choices: Array<{ message: { content: string } }>;
          };
          const content = completion.choices[0]?.message?.content || "{}";

          let mapping: Record<string, number>;
          try {
            const cleaned = content
              .replace(/^```json?\n?/i, "")
              .replace(/\n?```$/i, "")
              .trim();
            mapping = JSON.parse(cleaned);
          } catch {
            console.error("Failed to parse AI column mapping:", content);
            return res.status(400).json({
              error: "unknown_format",
              headers,
              sample_rows: sampleRows,
              message: "AI returned invalid mapping. Map columns manually.",
            });
          }

          // Validate minimum required fields
          const hasTimestamp = typeof mapping.timestamp === "number";
          const hasCostOrRevenue =
            typeof mapping.cost_amount === "number" ||
            typeof mapping.revenue_amount === "number";

          if (!hasTimestamp || !hasCostOrRevenue) {
            return res.status(400).json({
              error: "unknown_format",
              headers,
              sample_rows: sampleRows,
              message:
                "AI could not confidently map required columns (timestamp + cost or revenue). Map columns manually.",
            });
          }

          dateCol = mapping.timestamp;
          costCol = mapping.cost_amount ?? -1;
          modelCol = mapping.model ?? -1;
          inputTokenCol = -1;
          outputTokenCol = -1;
          customerIdCol = mapping.customer_id ?? -1;
          revenueCol = mapping.revenue_amount ?? -1;
          featureKeyCol = mapping.feature_key ?? -1;
          if (typeof mapping.usage_units === "number") {
            inputTokenCol = mapping.usage_units;
          }

          provider = null;
        }

        // Parse rows
        const rows: {
          date: Date;
          model: string;
          cost: number;
          tokens: number;
          customerId?: string;
          revenue?: number;
          featureKey?: string;
        }[] = [];
        const modelSet = new Set<string>();
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i]
            .split(",")
            .map((c) => c.trim().replace(/^"/, "").replace(/"$/, ""));
          if (cols.length < headers.length) continue;
          const cost = costCol !== -1 ? parseFloat(cols[costCol]) : 0;
          const revenue = revenueCol !== -1 ? parseFloat(cols[revenueCol]) : 0;
          if ((isNaN(cost) || cost === 0) && (isNaN(revenue) || revenue === 0))
            continue;
          const model = modelCol !== -1 ? cols[modelCol] : "unknown";
          const inputTokens =
            inputTokenCol !== -1 ? parseInt(cols[inputTokenCol]) || 0 : 0;
          const outputTokens =
            outputTokenCol !== -1 ? parseInt(cols[outputTokenCol]) || 0 : 0;
          modelSet.add(model);
          rows.push({
            date: new Date(cols[dateCol]),
            model,
            cost: isNaN(cost) ? 0 : cost,
            tokens: inputTokens + outputTokens,
            customerId: customerIdCol !== -1 ? cols[customerIdCol] : undefined,
            revenue: isNaN(revenue) ? undefined : revenue || undefined,
            featureKey: featureKeyCol !== -1 ? cols[featureKeyCol] : undefined,
          });
        }

        if (rows.length === 0) {
          return res.status(400).json({ error: "No valid data rows found" });
        }

        await client.query("BEGIN");
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND source = 'csv' AND event_name = 'provider_import'",
          [req.accountId ?? null],
        );

        const batchSize = 500;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          let idx = 1;
          for (const row of batch) {
            placeholders.push(
              `($${idx++}, $${idx++}, $${idx++}, $${idx++}, 'provider_import', $${idx++}, $${idx++}, $${idx++}, 'usd', $${idx++}, $${idx++}, 'csv', 'daily_aggregate')`,
            );
            values.push(
              req.visitorId,
              req.accountId ?? null,
              row.customerId || "_aggregate",
              row.featureKey || row.model,
              row.date,
              row.cost,
              row.revenue || null,
              row.tokens,
              provider,
            );
          }
          await client.query(
            `INSERT INTO observe_events (user_id, account_id, customer_id, feature_key, event_name, timestamp, cost_amount, revenue_amount, cost_unit, usage_units, model_provider, source, granularity)
           VALUES ${placeholders.join(", ")}`,
            values,
          );
        }

        await clearSampleData(client, pool, req.visitorId!, req.accountId);
        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE account_id = $1",
          [req.accountId ?? null, "user"],
        );
        await client.query("COMMIT");
        trackBillingUsage(req.visitorId!, "csv_upload", "csv_upload_provider");

        res.json({
          success: true,
          provider: provider || "ai_mapped",
          rows: rows.length,
          models: Array.from(modelSet),
        });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Provider CSV upload error:", error);
        res.status(500).json({ error: "Failed to import provider CSV" });
      } finally {
        client.release();
      }
    },
  );

  return router;
}
