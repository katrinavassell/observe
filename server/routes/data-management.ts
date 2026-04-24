import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";

export function createDataManagementRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

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

  return router;
}
