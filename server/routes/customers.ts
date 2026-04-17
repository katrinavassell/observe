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
  accountId: number,
): Promise<void> {
  await db.query(
    "DELETE FROM observe_events WHERE account_id = $1 AND source = 'sample'",
    [accountId],
  );
  await db.query(
    "DELETE FROM cost_records WHERE account_id = $1 AND cost_type = 'ai_inference' AND customer_id IS NULL AND period_start IS NOT NULL",
    [accountId],
  );
  await db.query(
    "DELETE FROM subscriptions WHERE account_id = $1 AND subscription_id IN ('sub_001','sub_002','sub_003','sub_004','sub_005','sub_acme','sub_acme_addon','sub_tidewater','sub_neon','sub_neon_addon','sub_circle','sub_blaze','sub_quantum')",
    [accountId],
  );
  await db.query(
    "DELETE FROM customers WHERE account_id = $1 AND customer_id IN ('cus_001','cus_002','cus_003','cus_004','cus_005','acme_saas','tidewater_ai','neondata','circleops','blazeml','quantumhr')",
    [accountId],
  );
  await db.query(
    "DELETE FROM plans WHERE account_id = $1 AND plan_id IN ('starter', 'pro', 'enterprise')",
    [accountId],
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
          "SELECT * FROM user_data_status WHERE account_id = $1",
          [req.accountId!],
        );
        const customersResult = await pool.query(
          "SELECT COUNT(*) FROM customers WHERE account_id = $1",
          [req.accountId!],
        );
        const costsResult = await pool.query(
          "SELECT COUNT(*) FROM cost_records WHERE account_id = $1",
          [req.accountId!],
        );
        const usageResult = await pool.query(
          "SELECT COUNT(*) FROM usage_records WHERE account_id = $1",
          [req.accountId!],
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
            "SELECT * FROM customers WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
            [req.accountId!, limit, offset],
          ),
          pool.query("SELECT COUNT(*) FROM customers WHERE account_id = $1", [
            req.accountId!,
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
            "SELECT s.*, c.name as customer_name, c.email as customer_email, p.name as plan_name, p.price_amount FROM subscriptions s LEFT JOIN customers c ON s.account_id = c.account_id AND s.customer_id = c.customer_id LEFT JOIN plans p ON s.account_id = p.account_id AND s.plan_id = p.plan_id WHERE s.account_id = $1 ORDER BY s.created_at DESC LIMIT $2 OFFSET $3",
            [req.accountId!, limit, offset],
          ),
          pool.query(
            "SELECT COUNT(*) FROM subscriptions WHERE account_id = $1",
            [req.accountId!],
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

  router.get(
    "/plans",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const result = await pool.query(
          "SELECT * FROM plans WHERE account_id = $1 ORDER BY price_amount ASC LIMIT $2 OFFSET $3",
          [req.accountId!, limit, offset],
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
            "SELECT * FROM usage_records WHERE account_id = $1 ORDER BY period_start DESC LIMIT $2 OFFSET $3",
            [req.accountId!, limit, offset],
          ),
          pool.query(
            "SELECT COUNT(*) FROM usage_records WHERE account_id = $1",
            [req.accountId!],
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
            [req.accountId!, limit, offset],
          ),
          pool.query(
            "SELECT COUNT(*) FROM cost_records WHERE account_id = $1",
            [req.accountId!],
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

  router.get(
    "/data/analyzer",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const analyzerLimit = 5000;
        const [plans, customers, subscriptions, usage, costs] =
          await Promise.all([
            pool.query("SELECT * FROM plans WHERE account_id = $1 LIMIT $2", [
              req.accountId!,
              analyzerLimit,
            ]),
            pool.query(
              "SELECT * FROM customers WHERE account_id = $1 LIMIT $2",
              [req.accountId!, analyzerLimit],
            ),
            pool.query(
              "SELECT * FROM subscriptions WHERE account_id = $1 LIMIT $2",
              [req.accountId!, analyzerLimit],
            ),
            pool.query(
              "SELECT * FROM usage_records WHERE account_id = $1 LIMIT $2",
              [req.accountId!, analyzerLimit],
            ),
            pool.query(
              "SELECT * FROM cost_records WHERE account_id = $1 LIMIT $2",
              [req.accountId!, analyzerLimit],
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

  router.delete(
    "/data/clear",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM ai_insights WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query("DELETE FROM observe_events WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query("DELETE FROM usage_records WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query("DELETE FROM cost_records WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query("DELETE FROM subscriptions WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query("DELETE FROM customers WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query("DELETE FROM plans WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE account_id = $1",
          [req.accountId!, "none"],
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
          "DELETE FROM observe_events WHERE account_id = $1 AND event_name = 'revenue'",
          [req.accountId!],
        );
        await client.query("DELETE FROM subscriptions WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query("DELETE FROM customers WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query("DELETE FROM plans WHERE account_id = $1", [
          req.accountId!,
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
          "DELETE FROM observe_events WHERE account_id = $1 AND event_name = 'cost'",
          [req.accountId!],
        );
        await client.query("DELETE FROM cost_records WHERE account_id = $1", [
          req.accountId!,
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
          "DELETE FROM observe_events WHERE account_id = $1 AND event_name = 'usage'",
          [req.accountId!],
        );
        await client.query("DELETE FROM usage_records WHERE account_id = $1", [
          req.accountId!,
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
        await clearSampleData(client, req.accountId!);
        await client.query("DELETE FROM cost_records WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND event_name = 'cost'",
          [req.accountId!],
        );

        const acctIdCost = req.accountId ?? null;
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
              acctIdCost,
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
              acctIdCost,
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

        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE account_id = $1",
          [req.accountId!, "user"],
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
        await clearSampleData(client, req.accountId!);
        await client.query("DELETE FROM usage_records WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND event_name = 'usage'",
          [req.accountId!],
        );

        const batchSize = 500;
        const acctIdUsage = req.accountId ?? null;
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
              acctIdUsage,
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
              acctIdUsage,
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

        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE account_id = $1",
          [req.accountId!, "user"],
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
        await clearSampleData(client, req.accountId!);
        await client.query("DELETE FROM subscriptions WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query("DELETE FROM customers WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query("DELETE FROM plans WHERE account_id = $1", [
          req.accountId!,
        ]);
        await client.query(
          "DELETE FROM observe_events WHERE account_id = $1 AND event_name = 'revenue'",
          [req.accountId!],
        );

        const acctId = req.accountId ?? null;
        if (Array.isArray(plans)) {
          for (const plan of plans) {
            await client.query(
              "INSERT INTO plans (user_id, account_id, plan_id, name, price_amount, interval_months) VALUES ($1, $2, $3, $4, $5, $6)",
              [
                req.visitorId,
                acctId,
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
              "INSERT INTO customers (user_id, account_id, customer_id, name, email, segment) VALUES ($1, $2, $3, $4, $5, $6)",
              [
                req.visitorId,
                acctId,
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
              "INSERT INTO subscriptions (user_id, account_id, subscription_id, customer_id, plan_id, is_active, mrr_override, current_period_start, current_period_end) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
              [
                req.visitorId,
                acctId,
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
              `INSERT INTO observe_events (user_id, account_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity) VALUES ($1, $2, $3, 'subscription', 'revenue', NOW(), $4, 'csv', 'monthly_aggregate')`,
              [req.visitorId, acctId, sub.customer_id, mrr],
            );
          }
        }

        await client.query(
          "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE account_id = $1",
          [req.accountId!, "user"],
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
          "SELECT COUNT(*) FROM customers WHERE account_id = $1",
          [req.accountId!],
        );
        const activeSubs = await pool.query(
          "SELECT COUNT(*) FROM subscriptions WHERE account_id = $1 AND is_active = true",
          [req.accountId!],
        );
        const mrrResult = await pool.query(
          "SELECT COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as mrr FROM subscriptions s LEFT JOIN plans p ON s.account_id = p.account_id AND s.plan_id = p.plan_id WHERE s.account_id = $1 AND s.is_active = true",
          [req.accountId!],
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
       WHERE account_id = $1
       GROUP BY source, is_inferred
       ORDER BY total_cost DESC`,
          [req.accountId!],
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
            "SELECT * FROM customers WHERE account_id = $1 AND customer_id = $2",
            [req.accountId!, id],
          ),
          pool.query(
            `SELECT s.*, p.name as plan_name, p.price_amount FROM subscriptions s LEFT JOIN plans p ON s.account_id = p.account_id AND s.plan_id = p.plan_id WHERE s.account_id = $1 AND s.customer_id = $2`,
            [req.accountId!, id],
          ),
          pool.query(
            `SELECT * FROM observe_events WHERE account_id = $1 AND customer_id = $2 ORDER BY timestamp DESC LIMIT 50`,
            [req.accountId!, id],
          ),
          pool.query(
            `SELECT feature_key, COUNT(*) as event_count, COALESCE(SUM(cost_amount), 0) as total_cost, COALESCE(SUM(revenue_amount), 0) as total_revenue, COALESCE(SUM(usage_units), 0) as total_usage, SUM(input_tokens) as total_input_tokens, SUM(output_tokens) as total_output_tokens FROM observe_events WHERE account_id = $1 AND customer_id = $2 AND feature_key IS NOT NULL GROUP BY feature_key ORDER BY total_cost DESC`,
            [req.accountId!, id],
          ),
        ]);

        // Customer may exist only in observe_events (not in customers table)
        // — e.g. events ingested with a customerReferenceId before Stripe sync.
        if (customerRes.rows.length === 0 && eventsRes.rows.length === 0) {
          return res.status(404).json({ error: "Customer not found" });
        }

        const c = customerRes.rows[0] ?? {
          customer_id: id,
          name: id,
          email: null,
          segment: null,
          created_at:
            eventsRes.rows[eventsRes.rows.length - 1]?.timestamp ?? null,
        };
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
              total_input_tokens: string | null;
              total_output_tokens: string | null;
            }) => ({
              feature_key: r.feature_key,
              event_count: parseInt(r.event_count),
              total_cost: parseFloat(r.total_cost) || 0,
              total_revenue: parseFloat(r.total_revenue) || 0,
              total_usage: parseFloat(r.total_usage) || 0,
              total_input_tokens:
                r.total_input_tokens == null
                  ? null
                  : parseFloat(r.total_input_tokens),
              total_output_tokens:
                r.total_output_tokens == null
                  ? null
                  : parseFloat(r.total_output_tokens),
            }),
          ),
        });
      } catch (error) {
        console.error("Get customer detail error:", error);
        res.status(500).json({ error: "Failed to get customer detail" });
      }
    },
  );

  // GET /customers/:id/timeseries — monthly aggregated metrics for a customer
  router.get(
    "/customers/:id/timeseries",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { id } = req.params;
        const timeseriesRes = await pool.query(
          `SELECT DATE_TRUNC('month', timestamp) as month,
                 COUNT(*) as event_count,
                 COALESCE(SUM(cost_amount), 0) as total_cost,
                 COALESCE(SUM(revenue_amount), 0) as total_revenue,
                 COALESCE(SUM(usage_units), 0) as total_usage
           FROM observe_events WHERE account_id = $1 AND customer_id = $2
           GROUP BY month ORDER BY month ASC`,
          [req.accountId!, id],
        );

        res.json({
          timeseries: timeseriesRes.rows.map(
            (r: {
              month: string;
              event_count: string;
              total_cost: string;
              total_revenue: string;
              total_usage: string;
            }) => ({
              month: r.month,
              event_count: parseInt(r.event_count),
              total_cost: parseFloat(r.total_cost) || 0,
              total_revenue: parseFloat(r.total_revenue) || 0,
              total_usage: parseFloat(r.total_usage) || 0,
            }),
          ),
        });
      } catch (error) {
        console.error("Get customer timeseries error:", error);
        res.status(500).json({ error: "Failed to get customer timeseries" });
      }
    },
  );

  // PATCH /customers/:customerId/internal — toggle is_internal flag
  router.patch(
    "/customers/:customerId/internal",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { customerId } = req.params;
        const { is_internal } = req.body;
        if (typeof is_internal !== "boolean") {
          return res
            .status(400)
            .json({ error: "is_internal must be a boolean" });
        }
        const result = await pool.query(
          `UPDATE customers SET is_internal = $1, updated_at = NOW()
           WHERE account_id = $2 AND customer_id = $3
           RETURNING customer_id, is_internal`,
          [is_internal, req.accountId!, customerId],
        );
        if (result.rows.length === 0) {
          // Customer might only exist in observe_events, not customers table — upsert
          await pool.query(
            `INSERT INTO customers (user_id, account_id, customer_id, name, is_internal)
             VALUES ($1, $2, $3, $3, $4)
             ON CONFLICT (account_id, customer_id) DO UPDATE SET is_internal = $4, updated_at = NOW()`,
            [req.visitorId, req.accountId ?? null, customerId, is_internal],
          );
        }
        res.json({ customer_id: customerId, is_internal });
      } catch (err) {
        console.error("PATCH /customers/:customerId/internal error:", err);
        res.status(500).json({ error: "Failed to update customer" });
      }
    },
  );

  return router;
}
