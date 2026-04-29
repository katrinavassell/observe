import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";
import {
  getAllPricing,
  getModelPricing,
  type ModelPrice,
} from "../model-pricing.js";
import { inferModelProvider } from "../lib/models.js";

export function createAnalyticsReportRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  // GET /analytics/customer-pnl — per-customer profit & loss, sorted by margin ascending (worst first)
  router.get(
    "/analytics/customer-pnl",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT oe.customer_id,
                COALESCE(c.name, oe.customer_id) as customer_name,
                COUNT(*) as event_count,
                COALESCE(SUM(oe.revenue_amount), 0) as event_revenue,
                COALESCE(SUM(oe.cost_amount), 0) as total_cost,
                COALESCE(sub_mrr.mrr, 0) as subscription_mrr
         FROM observe_events oe
         LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
         LEFT JOIN (
           SELECT COALESCE(c2.customer_id, s.customer_id) AS customer_id, s.account_id,
                  SUM(COALESCE(s.mrr_override, 0)) as mrr
           FROM subscriptions s
           LEFT JOIN customers c2 ON s.account_id = c2.account_id AND c2.stripe_customer_id = s.customer_id
           WHERE s.is_active = true
           GROUP BY COALESCE(c2.customer_id, s.customer_id), s.account_id
         ) sub_mrr ON oe.account_id = sub_mrr.account_id AND oe.customer_id = sub_mrr.customer_id
         WHERE oe.account_id = $1 AND oe.customer_id IS NOT NULL
           AND (oe.source IS NULL OR oe.source != 'stripe')
         GROUP BY oe.customer_id, c.name, sub_mrr.mrr
         ORDER BY GREATEST(COALESCE(SUM(oe.revenue_amount), 0), COALESCE(sub_mrr.mrr, 0)) - COALESCE(SUM(oe.cost_amount), 0) ASC`,
          [req.accountId],
        );

        const topFeatureResult = await pool.query(
          `SELECT DISTINCT ON (customer_id) customer_id, feature_key, SUM(cost_amount) as feat_cost
         FROM observe_events
         WHERE account_id = $1 AND customer_id IS NOT NULL AND feature_key IS NOT NULL
           AND (source IS NULL OR source != 'stripe')
         GROUP BY customer_id, feature_key
         ORDER BY customer_id, feat_cost DESC`,
          [req.accountId],
        );
        const topFeatureMap: Record<string, string> = {};
        for (const row of topFeatureResult.rows) {
          topFeatureMap[row.customer_id] = row.feature_key;
        }

        const customers = result.rows.map((row) => {
          const eventRevenue = parseFloat(row.event_revenue) || 0;
          const subscriptionMrr = parseFloat(row.subscription_mrr) || 0;
          const totalRevenue = Math.max(eventRevenue, subscriptionMrr);
          const totalCost = parseFloat(row.total_cost) || 0;
          const marginPct =
            totalRevenue > 0
              ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100)
              : null;

          return {
            customer_id: row.customer_id,
            customer_name: row.customer_name,
            total_revenue: totalRevenue,
            total_cost: totalCost,
            margin_pct: marginPct,
            event_count: parseInt(row.event_count),
            unprofitable:
              (marginPct !== null && marginPct < 0) ||
              (totalRevenue === 0 && totalCost > 0),
            top_cost_feature: topFeatureMap[row.customer_id] || null,
          };
        });

        customers.sort(
          (a, b) => (a.margin_pct ?? -Infinity) - (b.margin_pct ?? -Infinity),
        );

        res.json({ customers });
      } catch (error) {
        console.error("GET /analytics/customer-pnl error:", error);
        res.status(500).json({ error: "Failed to get customer P&L" });
      }
    },
  );

  // GET /analytics/margin-alerts — scan for margin alert conditions
  router.get(
    "/analytics/margin-alerts",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const alerts: Array<{
          type: string;
          severity: string;
          title: string;
          description: string;
          entity_id: string | null;
          metric_value: number | null;
        }> = [];

        // 1. Customers with negative margin
        const custResult = await pool.query(
          `SELECT oe.customer_id, COALESCE(c.name, oe.customer_id) as customer_name,
                COALESCE(SUM(oe.revenue_amount), 0) as event_revenue,
                COALESCE(SUM(oe.cost_amount), 0) as total_cost,
                COALESCE(sub_mrr.mrr, 0) as subscription_mrr
         FROM observe_events oe
         LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
         LEFT JOIN (
           SELECT COALESCE(c2.customer_id, s.customer_id) AS customer_id, s.account_id,
                  SUM(COALESCE(s.mrr_override, 0)) as mrr
           FROM subscriptions s
           LEFT JOIN customers c2 ON s.account_id = c2.account_id AND c2.stripe_customer_id = s.customer_id
           WHERE s.is_active = true
           GROUP BY COALESCE(c2.customer_id, s.customer_id), s.account_id
         ) sub_mrr ON oe.account_id = sub_mrr.account_id AND oe.customer_id = sub_mrr.customer_id
         WHERE oe.account_id = $1 AND oe.customer_id IS NOT NULL
           AND (oe.source IS NULL OR oe.source != 'stripe')
         GROUP BY oe.customer_id, c.name, sub_mrr.mrr
         HAVING COALESCE(SUM(oe.cost_amount), 0) > GREATEST(COALESCE(SUM(oe.revenue_amount), 0), COALESCE(sub_mrr.mrr, 0))`,
          [req.accountId],
        );
        for (const row of custResult.rows) {
          const eventRev = parseFloat(row.event_revenue) || 0;
          const subMrr = parseFloat(row.subscription_mrr) || 0;
          const rev = Math.max(eventRev, subMrr);
          const cost = parseFloat(row.total_cost) || 0;
          const margin =
            rev > 0 ? Math.round(((rev - cost) / rev) * 100) : -100;
          alerts.push({
            type: "negative_margin_customer",
            severity: "critical",
            title: `${row.customer_name} is unprofitable`,
            description: `Cost $${cost.toFixed(2)} exceeds revenue $${rev.toFixed(2)} (margin: ${margin}%)`,
            entity_id: row.customer_id,
            metric_value: margin,
          });
        }

        // 2. Features where cost > revenue
        const featResult = await pool.query(
          `SELECT feature_key,
                COALESCE(SUM(cost_amount), 0) as total_cost,
                COALESCE(SUM(revenue_amount), 0) as total_revenue
         FROM observe_events
         WHERE account_id = $1 AND feature_key IS NOT NULL
           AND (source IS NULL OR source != 'stripe')
         GROUP BY feature_key
         HAVING COALESCE(SUM(cost_amount), 0) > COALESCE(SUM(revenue_amount), 0)`,
          [req.accountId],
        );
        for (const row of featResult.rows) {
          const cost = parseFloat(row.total_cost) || 0;
          const rev = parseFloat(row.total_revenue) || 0;
          alerts.push({
            type: "unprofitable_feature",
            severity: "warning",
            title: `Feature "${row.feature_key}" is losing money`,
            description: `Cost $${cost.toFixed(2)} exceeds revenue $${rev.toFixed(2)}`,
            entity_id: row.feature_key,
            metric_value:
              rev > 0 ? Math.round(((rev - cost) / rev) * 100) : -100,
          });
        }

        // 3. Models where cost increased >20% vs previous period
        const modelResult = await pool.query(
          `SELECT model,
                COALESCE(SUM(CASE WHEN timestamp >= NOW() - INTERVAL '30 days' THEN cost_amount ELSE 0 END), 0) as current_cost,
                COALESCE(SUM(CASE WHEN timestamp >= NOW() - INTERVAL '60 days' AND timestamp < NOW() - INTERVAL '30 days' THEN cost_amount ELSE 0 END), 0) as prior_cost
         FROM observe_events
         WHERE account_id = $1 AND model IS NOT NULL AND timestamp >= NOW() - INTERVAL '60 days'
           AND (source IS NULL OR source != 'stripe')
         GROUP BY model
         HAVING COALESCE(SUM(CASE WHEN timestamp >= NOW() - INTERVAL '60 days' AND timestamp < NOW() - INTERVAL '30 days' THEN cost_amount ELSE 0 END), 0) > 0`,
          [req.accountId],
        );
        for (const row of modelResult.rows) {
          const current = parseFloat(row.current_cost) || 0;
          const prior = parseFloat(row.prior_cost) || 0;
          if (prior > 0 && current > prior * 1.2) {
            const pctIncrease = Math.round(((current - prior) / prior) * 100);
            alerts.push({
              type: "model_cost_spike",
              severity: "warning",
              title: `Model "${row.model}" cost up ${pctIncrease}%`,
              description: `Cost increased from $${prior.toFixed(2)} to $${current.toFixed(2)} vs previous 30 days`,
              entity_id: row.model,
              metric_value: pctIncrease,
            });
          }
        }

        // 4. Customers spending >50% of subscription on AI costs
        const subSpendResult = await pool.query(
          `SELECT oe.customer_id, COALESCE(c.name, oe.customer_id) as customer_name,
                COALESCE(SUM(oe.cost_amount), 0) as total_cost
         FROM observe_events oe
         LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
         WHERE oe.account_id = $1 AND oe.customer_id IS NOT NULL
           AND (oe.source IS NULL OR oe.source != 'stripe')
         GROUP BY oe.customer_id, c.name`,
          [req.accountId],
        );
        const subRevMap: Record<string, number> = {};
        const subRows = await pool.query(
          `SELECT s.customer_id, COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as sub_revenue
         FROM subscriptions s
         LEFT JOIN plans p ON s.account_id = p.account_id AND s.plan_id = p.plan_id
         WHERE s.account_id = $1 AND s.is_active = true
         GROUP BY s.customer_id`,
          [req.accountId],
        );
        for (const row of subRows.rows) {
          subRevMap[row.customer_id] = parseFloat(row.sub_revenue) || 0;
        }
        for (const row of subSpendResult.rows) {
          const cost = parseFloat(row.total_cost) || 0;
          const subRev = subRevMap[row.customer_id] || 0;
          if (subRev > 0 && cost > subRev * 0.5) {
            const pct = Math.round((cost / subRev) * 100);
            alerts.push({
              type: "high_cost_ratio",
              severity: pct >= 100 ? "critical" : "warning",
              title: `${row.customer_name} AI costs are ${pct}% of subscription`,
              description: `AI costs $${cost.toFixed(2)} vs subscription revenue $${subRev.toFixed(2)}`,
              entity_id: row.customer_id,
              metric_value: pct,
            });
          }
        }

        alerts.sort(
          (a, b) =>
            (a.severity === "critical" ? 0 : 1) -
            (b.severity === "critical" ? 0 : 1),
        );

        res.json({ alerts });
      } catch (error) {
        console.error("GET /analytics/margin-alerts error:", error);
        res.status(500).json({ error: "Failed to get margin alerts" });
      }
    },
  );

  // GET /analytics/revenue-confidence — revenue source breakdown and confidence score
  router.get(
    "/analytics/revenue-confidence",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT
            revenue_source,
            COUNT(*) as event_count,
            COALESCE(SUM(revenue_amount), 0) as total_revenue,
            COALESCE(SUM(cost_amount), 0) as total_cost
          FROM observe_events
          WHERE account_id = $1
            AND (source IS NULL OR source != 'stripe')
          GROUP BY revenue_source
          ORDER BY total_revenue DESC`,
          [req.accountId],
        );

        const totalRevenue = result.rows.reduce(
          (sum, r) => sum + (parseFloat(r.total_revenue) || 0),
          0,
        );
        const totalCost = result.rows.reduce(
          (sum, r) => sum + (parseFloat(r.total_cost) || 0),
          0,
        );

        const breakdown = result.rows.map((row) => {
          const revenue = parseFloat(row.total_revenue) || 0;
          return {
            source: row.revenue_source,
            event_count: parseInt(row.event_count),
            revenue,
            cost: parseFloat(row.total_cost) || 0,
            pct_of_revenue:
              totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 100) : 0,
          };
        });

        const { score, label } = computeConfidence(breakdown);

        res.json({
          breakdown,
          confidence_score: score,
          confidence_label: label,
          total_revenue: totalRevenue,
          total_cost: totalCost,
        });
      } catch (error) {
        console.error("GET /analytics/revenue-confidence error:", error);
        res
          .status(500)
          .json({ error: "Failed to get revenue confidence breakdown" });
      }
    },
  );

  // GET /analytics/trends — monthly margin trends
  router.get(
    "/analytics/trends",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const months = Math.min(
          Math.max(parseInt(String(req.query.months)) || 12, 1),
          24,
        );

        const result = await pool.query(
          `SELECT month, total_cost, total_revenue, event_count,
            active_customers, active_features, models_used,
            ROUND((total_cost - LAG(total_cost) OVER (ORDER BY month))
              / NULLIF(LAG(total_cost) OVER (ORDER BY month), 0) * 100, 1) AS cost_change_pct,
            ROUND((total_revenue - LAG(total_revenue) OVER (ORDER BY month))
              / NULLIF(LAG(total_revenue) OVER (ORDER BY month), 0) * 100, 1) AS revenue_change_pct,
            ROUND((event_count - LAG(event_count) OVER (ORDER BY month))::numeric
              / NULLIF(LAG(event_count) OVER (ORDER BY month), 0) * 100, 1) AS event_count_change_pct
          FROM (
            SELECT
              DATE_TRUNC('month', timestamp) as month,
              COALESCE(SUM(cost_amount), 0) as total_cost,
              COALESCE(SUM(revenue_amount), 0) as total_revenue,
              COUNT(*) as event_count,
              COUNT(DISTINCT customer_id) as active_customers,
              COUNT(DISTINCT feature_key) as active_features,
              COUNT(DISTINCT model) as models_used
            FROM observe_events
            WHERE account_id = $1 AND timestamp >= NOW() - MAKE_INTERVAL(months => $2)
              AND (source IS NULL OR source != 'stripe')
            GROUP BY month
          ) sub
          ORDER BY month ASC`,
          [req.accountId, months],
        );

        const rows = result.rows.map((r) => {
          const cost = parseFloat(r.total_cost) || 0;
          const revenue = parseFloat(r.total_revenue) || 0;
          const marginPct =
            revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null;

          return {
            month: r.month
              ? new Date(r.month).toISOString().slice(0, 7)
              : "unknown",
            cost,
            revenue,
            margin_pct: marginPct,
            event_count: parseInt(r.event_count),
            active_customers: parseInt(r.active_customers),
            active_features: parseInt(r.active_features),
            models_used: parseInt(r.models_used),
            cost_change_pct:
              r.cost_change_pct != null ? parseFloat(r.cost_change_pct) : null,
            revenue_change_pct:
              r.revenue_change_pct != null
                ? parseFloat(r.revenue_change_pct)
                : null,
            event_count_change_pct:
              r.event_count_change_pct != null
                ? parseFloat(r.event_count_change_pct)
                : null,
          };
        });

        res.json({ months: rows, period_months: months });
      } catch (error) {
        console.error("GET /analytics/trends error:", error);
        res.status(500).json({ error: "Failed to get margin trends" });
      }
    },
  );

  // GET /analytics/retention — customer retention cohort matrix
  router.get(
    "/analytics/retention",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const [cohortResult, activeResult] = await Promise.all([
          pool.query(
            `SELECT customer_id, DATE_TRUNC('month', MIN(timestamp)) as cohort_month
             FROM observe_events
             WHERE account_id = $1 AND customer_id IS NOT NULL
             GROUP BY customer_id`,
            [req.accountId],
          ),
          pool.query(
            `SELECT customer_id, DATE_TRUNC('month', timestamp) as active_month
             FROM observe_events
             WHERE account_id = $1 AND customer_id IS NOT NULL
             GROUP BY customer_id, DATE_TRUNC('month', timestamp)`,
            [req.accountId],
          ),
        ]);

        // Build a set of active months per customer
        const activeMonths = new Map<string, Set<string>>();
        for (const row of activeResult.rows) {
          const key = row.customer_id;
          if (!activeMonths.has(key)) activeMonths.set(key, new Set());
          activeMonths.get(key)!.add(new Date(row.active_month).toISOString());
        }

        // Group customers by cohort month
        const cohortMap = new Map<string, string[]>();
        for (const row of cohortResult.rows) {
          const month = new Date(row.cohort_month).toISOString();
          if (!cohortMap.has(month)) cohortMap.set(month, []);
          cohortMap.get(month)!.push(row.customer_id);
        }

        // Limit to last 12 months
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 12);
        cutoff.setDate(1);
        cutoff.setHours(0, 0, 0, 0);

        const now = new Date();
        now.setDate(1);
        now.setHours(0, 0, 0, 0);

        const cohorts = Array.from(cohortMap.entries())
          .filter(([month]) => new Date(month) >= cutoff)
          .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
          .map(([cohortMonth, customerIds]) => {
            const cohortDate = new Date(cohortMonth);
            const maxMonths =
              (now.getFullYear() - cohortDate.getFullYear()) * 12 +
              (now.getMonth() - cohortDate.getMonth()) +
              1;

            const retention: number[] = [];
            for (let i = 0; i < maxMonths; i++) {
              const checkDate = new Date(cohortDate);
              checkDate.setMonth(checkDate.getMonth() + i);
              const checkKey = checkDate.toISOString();
              const activeCount = customerIds.filter((cid) =>
                activeMonths.get(cid)?.has(checkKey),
              ).length;
              retention.push(
                Math.round((activeCount / customerIds.length) * 100),
              );
            }

            const label = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, "0")}`;

            return {
              cohort_month: label,
              size: customerIds.length,
              retention,
            };
          });

        res.json({ cohorts });
      } catch (error) {
        console.error("GET /analytics/retention error:", error);
        res.status(500).json({ error: "Failed to get retention cohorts" });
      }
    },
  );

  // GET /analytics/mrr-movements — MRR movement categories per customer with summary
  router.get(
    "/analytics/mrr-movements",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const [currentResult, priorResult, customerResult] = await Promise.all([
          // Current MRR per customer (active subs)
          pool.query(
            `SELECT s.customer_id,
                  COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as mrr
           FROM subscriptions s
           LEFT JOIN plans p ON s.account_id = p.account_id AND s.plan_id = p.plan_id
           WHERE s.account_id = $1 AND s.is_active = true
           GROUP BY s.customer_id`,
            [req.accountId],
          ),

          // Prior period: subs created 60+ days ago (whether active or not)
          pool.query(
            `SELECT s.customer_id,
                  COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as mrr
           FROM subscriptions s
           LEFT JOIN plans p ON s.account_id = p.account_id AND s.plan_id = p.plan_id
           WHERE s.account_id = $1 AND s.created_at <= NOW() - INTERVAL '60 days'
           GROUP BY s.customer_id`,
            [req.accountId],
          ),

          // Customer names
          pool.query(
            `SELECT customer_id, name FROM customers WHERE account_id = $1`,
            [req.accountId],
          ),
        ]);

        const currentMrrMap: Record<string, number> = {};
        for (const row of currentResult.rows) {
          currentMrrMap[row.customer_id] = parseFloat(row.mrr) || 0;
        }
        const priorMrrMap: Record<string, number> = {};
        for (const row of priorResult.rows) {
          priorMrrMap[row.customer_id] = parseFloat(row.mrr) || 0;
        }
        const nameMap: Record<string, string> = {};
        for (const row of customerResult.rows) {
          nameMap[row.customer_id] = row.name;
        }

        // All customer IDs that appear in either period
        const allIds = new Set([
          ...Object.keys(currentMrrMap),
          ...Object.keys(priorMrrMap),
        ]);

        type MrrCategory =
          | "new"
          | "expansion"
          | "contraction"
          | "churned"
          | "stable";

        const movements: Array<{
          customer_id: string;
          customer_name: string;
          category: MrrCategory;
          current_mrr: number;
          prior_mrr: number;
          change: number;
        }> = [];

        let new_mrr = 0;
        let expansion_mrr = 0;
        let contraction_mrr = 0;
        let churned_mrr = 0;

        for (const customerId of allIds) {
          const current = currentMrrMap[customerId] ?? 0;
          const prior = priorMrrMap[customerId] ?? 0;
          const change = current - prior;

          let category: MrrCategory;
          if (current > 0 && prior === 0) {
            category = "new";
            new_mrr += change;
          } else if (current === 0 && prior > 0) {
            category = "churned";
            churned_mrr += Math.abs(change);
          } else if (current > prior) {
            category = "expansion";
            expansion_mrr += change;
          } else if (current < prior) {
            category = "contraction";
            contraction_mrr += Math.abs(change);
          } else {
            category = "stable";
          }

          movements.push({
            customer_id: customerId,
            customer_name: nameMap[customerId] || customerId,
            category,
            current_mrr: current,
            prior_mrr: prior,
            change,
          });
        }

        // Sort: non-stable first sorted by absolute change desc, then stable
        movements.sort((a, b) => {
          if (a.category === "stable" && b.category !== "stable") return 1;
          if (a.category !== "stable" && b.category === "stable") return -1;
          return Math.abs(b.change) - Math.abs(a.change);
        });

        res.json({
          movements,
          summary: {
            new_mrr,
            expansion_mrr,
            contraction_mrr,
            churned_mrr,
            net_new_mrr:
              new_mrr + expansion_mrr - contraction_mrr - churned_mrr,
          },
        });
      } catch (error) {
        console.error("GET /analytics/mrr-movements error:", error);
        res.status(500).json({ error: "Failed to get MRR movements" });
      }
    },
  );

  // GET /analytics/cost-by-token-type — daily cost split by input vs output tokens
  router.get(
    "/analytics/cost-by-token-type",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const days = Math.min(
          Math.max(parseInt(String(req.query.days)) || 30, 1),
          365,
        );

        const result = await pool.query(
          `SELECT
             DATE_TRUNC('day', timestamp) AS day,
             model,
             SUM(input_tokens) AS total_input,
             SUM(output_tokens) AS total_output
           FROM observe_events
           WHERE account_id = $1
             AND timestamp > NOW() - MAKE_INTERVAL(days => $2)
             AND input_tokens IS NOT NULL
             AND output_tokens IS NOT NULL
             AND model IS NOT NULL
             AND (source IS NULL OR source <> 'stripe')
           GROUP BY day, model
           ORDER BY day ASC`,
          [req.accountId, days],
        );

        // Per-request pricing cache so repeated models don't re-query
        const pricingCache = new Map<string, ModelPrice | null>();
        async function lookup(model: string): Promise<ModelPrice | null> {
          if (pricingCache.has(model)) return pricingCache.get(model)!;
          const p = await getModelPricing(pool, model);
          pricingCache.set(model, p);
          return p;
        }

        const byDay = new Map<
          string,
          { input_cost: number; output_cost: number }
        >();
        for (const row of result.rows) {
          const pricing = await lookup(row.model);
          if (!pricing) continue;
          const inputTokens = parseFloat(row.total_input) || 0;
          const outputTokens = parseFloat(row.total_output) || 0;
          const inputCost =
            (inputTokens * pricing.input_cost_per_million) / 1_000_000;
          const outputCost =
            (outputTokens * pricing.output_cost_per_million) / 1_000_000;

          const dateStr = new Date(row.day).toISOString().slice(0, 10);
          const entry = byDay.get(dateStr) || { input_cost: 0, output_cost: 0 };
          entry.input_cost += inputCost;
          entry.output_cost += outputCost;
          byDay.set(dateStr, entry);
        }

        const series = Array.from(byDay.entries())
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([date, v]) => ({
            date,
            input_cost: Math.round(v.input_cost * 10000) / 10000,
            output_cost: Math.round(v.output_cost * 10000) / 10000,
          }));

        res.json({ series });
      } catch (error) {
        console.error("GET /analytics/cost-by-token-type error:", error);
        res.status(500).json({ error: "Failed to get cost by token type" });
      }
    },
  );

  router.get(
    "/recommendations/model-swap",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const days = parseInt(req.query.days as string) || 90;

        const result = await pool.query(
          `SELECT
           feature_key, model, model_provider,
           COUNT(*) AS event_count,
           COALESCE(SUM(cost_amount), 0) AS total_cost,
           COALESCE(AVG(cost_amount), 0) AS avg_cost_per_event,
           COALESCE(SUM(usage_units), 0) AS total_usage_units
         FROM observe_events
         WHERE account_id = $1
           AND model IS NOT NULL
           AND cost_amount > 0
           AND timestamp > NOW() - MAKE_INTERVAL(days => $2)
           AND (source IS NULL OR source != 'stripe')
         GROUP BY feature_key, model, model_provider
         ORDER BY total_cost DESC`,
          [req.accountId, days],
        );

        const recommendations: Array<{
          feature_key: string;
          current_model: string;
          current_provider: string | null;
          current_avg_cost_per_event: number;
          total_cost: number;
          event_count: number;
          recommendations: Array<{
            model: string;
            provider: string;
            same_provider: boolean;
            estimated_savings_pct: number;
            estimated_monthly_savings: number;
          }>;
        }> = [];

        const allPricing = await getAllPricing(pool);
        const inputRateMap: Record<string, number> = {};
        for (const p of allPricing) {
          inputRateMap[p.model] = p.input_cost_per_million;
        }

        for (const row of result.rows) {
          const currentInputRate = inputRateMap[row.model];
          if (!currentInputRate) continue;
          const avgCost = parseFloat(row.avg_cost_per_event);
          const totalCost = parseFloat(row.total_cost);
          if (avgCost <= 0) continue;

          const candidates: Array<{
            model: string;
            provider: string;
            same_provider: boolean;
            estimated_savings_pct: number;
            estimated_monthly_savings: number;
          }> = [];

          const isEmbedding =
            row.model.includes("embedding") || row.model.includes("ada-002");
          for (const [altModel, altInputRate] of Object.entries(inputRateMap)) {
            if (altModel === row.model) continue;

            const altIsEmbedding =
              altModel.includes("embedding") || altModel.includes("ada-002");
            if (isEmbedding !== altIsEmbedding) continue;

            if (altInputRate >= currentInputRate * 0.8) continue;

            const costRatio = altInputRate / currentInputRate;
            const savingsPct = Math.round((1 - costRatio) * 100);
            const monthlySavings =
              Math.round(totalCost * (1 - costRatio) * 100) / 100;
            const altProvider = inferModelProvider(altModel) || "unknown";

            candidates.push({
              model: altModel,
              provider: altProvider,
              same_provider:
                altProvider ===
                (row.model_provider || inferModelProvider(row.model)),
              estimated_savings_pct: savingsPct,
              estimated_monthly_savings: monthlySavings,
            });
          }

          candidates.sort(
            (a, b) => b.estimated_monthly_savings - a.estimated_monthly_savings,
          );
          const topCandidates = candidates.slice(0, 3);

          if (topCandidates.length > 0) {
            recommendations.push({
              feature_key: row.feature_key,
              current_model: row.model,
              current_provider:
                row.model_provider || inferModelProvider(row.model),
              current_avg_cost_per_event: avgCost,
              total_cost: totalCost,
              event_count: parseInt(row.event_count),
              recommendations: topCandidates,
            });
          }
        }

        const byFeature = new Map<string, (typeof recommendations)[0]>();
        for (const rec of recommendations) {
          const existing = byFeature.get(rec.feature_key);
          if (!existing || rec.total_cost > existing.total_cost) {
            byFeature.set(rec.feature_key, rec);
          }
        }

        const final = Array.from(byFeature.values());
        const totalPotentialSavings = final.reduce(
          (sum, r) =>
            sum + (r.recommendations[0]?.estimated_monthly_savings || 0),
          0,
        );

        res.json({
          recommendations: final,
          total_potential_savings:
            Math.round(totalPotentialSavings * 100) / 100,
          days,
        });
      } catch (error) {
        console.error("GET /recommendations/model-swap error:", error);
        res
          .status(500)
          .json({ error: "Failed to generate model swap recommendations" });
      }
    },
  );

  router.get(
    "/recommendations/underwater-customers",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const days = parseInt(req.query.days as string) || 90;

        const result = await pool.query(
          `SELECT
           oe.customer_id,
           c.name AS customer_name,
           COALESCE(SUM(oe.cost_amount), 0) AS total_ai_cost,
           COALESCE(SUM(oe.revenue_amount), 0) AS total_revenue,
           COALESCE(SUM(oe.cost_amount), 0) - COALESCE(SUM(oe.revenue_amount), 0) AS loss_amount,
           COUNT(*) AS event_count
         FROM observe_events oe
         LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
         WHERE oe.account_id = $1
           AND oe.timestamp > NOW() - MAKE_INTERVAL(days => $2)
           AND (oe.source IS NULL OR oe.source != 'stripe')
         GROUP BY oe.customer_id, c.name
         HAVING SUM(oe.cost_amount) > SUM(oe.revenue_amount)
         ORDER BY (SUM(oe.cost_amount) - SUM(oe.revenue_amount)) DESC`,
          [req.accountId, days],
        );

        const customers = result.rows.map((r) => ({
          customer_id: r.customer_id,
          customer_name: r.customer_name || r.customer_id,
          total_ai_cost: parseFloat(r.total_ai_cost),
          total_revenue: parseFloat(r.total_revenue),
          loss_amount: parseFloat(r.loss_amount),
          margin_pct:
            parseFloat(r.total_revenue) > 0
              ? Math.round(
                  ((parseFloat(r.total_revenue) - parseFloat(r.total_ai_cost)) /
                    parseFloat(r.total_revenue)) *
                    100,
                )
              : null,
          event_count: parseInt(r.event_count),
        }));

        res.json({ customers, days });
      } catch (error) {
        console.error(
          "GET /recommendations/underwater-customers error:",
          error,
        );
        res.status(500).json({ error: "Failed to find underwater customers" });
      }
    },
  );

  // GET /analytics/daily-summary — daily cost/revenue aggregation
  router.get(
    "/analytics/daily-summary",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const days = Math.min(
          Math.max(parseInt(String(req.query.days)) || 30, 1),
          90,
        );

        const result = await pool.query(
          `SELECT
            DATE_TRUNC('day', timestamp) AS day,
            COALESCE(SUM(cost_amount), 0) AS total_cost,
            COALESCE(SUM(revenue_amount), 0) AS total_revenue,
            COUNT(*) AS event_count
          FROM observe_events
          WHERE account_id = $1
            AND timestamp >= NOW() - MAKE_INTERVAL(days => $2)
            AND (source IS NULL OR source NOT IN ('sample', 'stripe'))
          GROUP BY day
          ORDER BY day ASC`,
          [req.accountId, days],
        );

        const data = result.rows.map((r) => ({
          day: r.day ? new Date(r.day).toISOString().slice(0, 10) : "unknown",
          cost: parseFloat(r.total_cost) || 0,
          revenue: parseFloat(r.total_revenue) || 0,
          event_count: parseInt(r.event_count),
        }));

        res.json({ data });
      } catch (error) {
        console.error("GET /analytics/daily-summary error:", error);
        res.status(500).json({ error: "Failed to get daily summary" });
      }
    },
  );

  router.post(
    "/analytics/suggest-pricing",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const [featureResult, pricingResult, mrrResult] = await Promise.all([
          pool.query(
            `SELECT feature_key,
                  COUNT(*) as event_count,
                  COUNT(DISTINCT customer_id) as customer_count,
                  COALESCE(SUM(cost_amount), 0) as total_cost,
                  COALESCE(AVG(cost_amount), 0) as avg_cost_per_event,
                  COALESCE(SUM(revenue_amount), 0) as current_revenue
           FROM observe_events
           WHERE account_id = $1 AND feature_key IS NOT NULL
             AND (source IS NULL OR source != 'stripe')
           GROUP BY feature_key
           ORDER BY total_cost DESC`,
            [req.accountId],
          ),
          pool.query(
            `SELECT feature_key, revenue_per_unit FROM feature_pricing WHERE account_id = $1`,
            [req.accountId],
          ),
          pool.query(
            `SELECT COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as total_mrr
           FROM subscriptions s
           LEFT JOIN plans p ON s.account_id = p.account_id AND s.plan_id = p.plan_id
           WHERE s.account_id = $1 AND s.is_active = true`,
            [req.accountId],
          ),
        ]);

        if (featureResult.rows.length === 0) {
          return res.status(400).json({ error: "No feature data to analyze." });
        }

        const totalMrr = parseFloat(mrrResult.rows[0]?.total_mrr) || 0;
        const existingRules = pricingResult.rows.map(
          (r: Record<string, string>) =>
            `${r.feature_key}: $${parseFloat(r.revenue_per_unit).toFixed(4)}/call`,
        );

        const featureSummary = featureResult.rows
          .map((r: Record<string, string>) => {
            const cost = parseFloat(r.total_cost) || 0;
            const avg = parseFloat(r.avg_cost_per_event) || 0;
            const rev = parseFloat(r.current_revenue) || 0;
            return `- ${r.feature_key}: ${r.event_count} events, ${r.customer_count} customers, total_cost=$${cost.toFixed(2)}, avg_cost/event=$${avg.toFixed(4)}, current_revenue=$${rev.toFixed(2)}`;
          })
          .join("\n");

        const openaiKey = process.env.OPENAI_API_KEY;

        interface Suggestion {
          feature_key: string;
          suggested_price: number;
          unit_label: string;
          rationale: string;
          current_cost_per_unit: number;
          target_margin_pct: number;
        }

        let suggestions: Suggestion[];

        if (openaiKey) {
          const prompt = `You are a pricing analyst for an AI SaaS product. Based on the cost data below, suggest a revenue_per_unit price for each feature that would achieve a healthy margin (target: 60-70% gross margin).

Current cost data per feature:
${featureSummary}

Current subscription MRR: $${totalMrr.toFixed(2)}/month
Existing pricing rules: ${existingRules.length > 0 ? existingRules.join(", ") : "None configured"}

For each feature, respond with a JSON array:
[{"feature_key":"...","suggested_price":0.05,"unit_label":"call","rationale":"One sentence","current_cost_per_unit":0.02,"target_margin_pct":65}]

Only return the JSON array, no other text.`;

          const llmResponse = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${openaiKey}`,
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3,
              }),
            },
          );

          if (llmResponse.ok) {
            const completion = (await llmResponse.json()) as {
              choices: Array<{ message: { content: string } }>;
            };
            const raw = completion.choices?.[0]?.message?.content || "[]";
            const cleaned = raw
              .replace(/```json?\n?/g, "")
              .replace(/```/g, "")
              .trim();
            try {
              suggestions = JSON.parse(cleaned);
            } catch (err) {
              console.error("Failed to parse AI suggestions response:", err);
              suggestions = buildDeterministicSuggestions(featureResult.rows);
            }
          } else {
            suggestions = buildDeterministicSuggestions(featureResult.rows);
          }
        } else {
          suggestions = buildDeterministicSuggestions(featureResult.rows);
        }

        res.json({ suggestions });
      } catch (error) {
        console.error("POST /analytics/suggest-pricing error:", error);
        res.status(500).json({ error: "Failed to suggest pricing" });
      }
    },
  );

  return router;
}

function computeConfidence(
  breakdown: Array<{ source: string; pct_of_revenue: number }>,
): { score: number; label: string } {
  const weights: Record<string, number> = {
    explicit: 1.0,
    feature_pricing: 0.8,
    mrr_allocation: 0.4,
    none: 0,
  };

  let score = 0;
  for (const item of breakdown) {
    const weight = weights[item.source] ?? 0;
    score += item.pct_of_revenue * weight;
  }
  score = Math.round(Math.max(0, Math.min(100, score)));

  let label: string;
  if (score >= 80) label = "High";
  else if (score >= 50) label = "Medium";
  else if (score >= 20) label = "Low";
  else label = "Very Low";

  return { score, label };
}

function buildDeterministicSuggestions(
  rows: Array<Record<string, string>>,
): Array<{
  feature_key: string;
  suggested_price: number;
  unit_label: string;
  rationale: string;
  current_cost_per_unit: number;
  target_margin_pct: number;
}> {
  return rows.map((r) => {
    const avgCost = parseFloat(r.avg_cost_per_event) || 0;
    const suggestedPrice = Math.round(avgCost * 2.5 * 10000) / 10000;
    return {
      feature_key: r.feature_key,
      suggested_price: suggestedPrice,
      unit_label: "call",
      rationale: "Based on 2.5x cost markup for 60% target margin",
      current_cost_per_unit: avgCost,
      target_margin_pct: 60,
    };
  });
}
