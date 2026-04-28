import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";
import { getAllPricing } from "../model-pricing.js";
import { inferModelProvider } from "../lib/models.js";

type CohortLabel = "unprofitable" | "champion" | "inactive" | "rising_cost";

type MrrMovementCategory =
  | "new"
  | "expansion"
  | "contraction"
  | "churned"
  | "stable";

// ── Rule evaluation for dynamic cohorts ─────────────────────────────────────

interface CohortRule {
  field: string;
  operator: string;
  value: number | string;
}

interface CustomerData {
  customer_id: string;
  customer_name: string;
  total_revenue: number;
  total_cost: number;
  margin_pct: number | null;
  health_score: number;
  active_days_30d: number;
  cohort: string;
}

function evaluateRules(
  customers: CustomerData[],
  rules: CohortRule[],
): CustomerData[] {
  return customers.filter((c) =>
    rules.every((rule) => {
      const val =
        typeof rule.field === "string" ? (c as any)[rule.field] : undefined;
      if (val === undefined || val === null) return false;
      const numVal = typeof val === "number" ? val : parseFloat(val);
      const ruleVal =
        typeof rule.value === "number"
          ? rule.value
          : parseFloat(rule.value as string);
      switch (rule.operator) {
        case "gt":
          return numVal > ruleVal;
        case "lt":
          return numVal < ruleVal;
        case "gte":
          return numVal >= ruleVal;
        case "lte":
          return numVal <= ruleVal;
        case "eq":
          return typeof rule.value === "string"
            ? String(val) === rule.value
            : numVal === ruleVal;
        case "neq":
          return typeof rule.value === "string"
            ? String(val) !== rule.value
            : numVal !== ruleVal;
        default:
          return false;
      }
    }),
  );
}

async function getCustomerDataForRules(
  pool: Pool,
  accountId: number,
): Promise<CustomerData[]> {
  const result = await pool.query(
    `SELECT oe.customer_id,
            COALESCE(c.name, oe.customer_id) AS customer_name,
            COALESCE(SUM(oe.revenue_amount), 0) AS total_revenue,
            COALESCE(SUM(oe.cost_amount), 0) AS total_cost,
            COUNT(DISTINCT CASE WHEN oe.timestamp >= NOW() - INTERVAL '30 days' THEN DATE(oe.timestamp) END) AS active_days_30d
     FROM observe_events oe
     LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
     WHERE oe.account_id = $1 AND oe.customer_id IS NOT NULL
       AND (oe.source IS NULL OR oe.source != 'stripe')
     GROUP BY oe.customer_id, c.name`,
    [accountId],
  );
  return result.rows.map((r) => {
    const revenue = parseFloat(r.total_revenue) || 0;
    const cost = parseFloat(r.total_cost) || 0;
    const margin_pct = revenue > 0 ? ((revenue - cost) / revenue) * 100 : null;
    const active_days = parseInt(r.active_days_30d) || 0;
    const health_score = Math.max(
      0,
      Math.min(100, Math.round((margin_pct ?? -100) * 0.6 + active_days * 2)),
    );
    let cohort: string | null = null;
    if (revenue === 0 && cost > 0) cohort = "unprofitable";
    else if (margin_pct !== null && margin_pct < 0) cohort = "unprofitable";
    else if (active_days === 0) cohort = "inactive";
    else if (margin_pct !== null && margin_pct >= 50 && active_days >= 10)
      cohort = "champion";

    return {
      customer_id: r.customer_id,
      customer_name: r.customer_name,
      total_revenue: revenue,
      total_cost: cost,
      margin_pct:
        margin_pct !== null ? Math.round(margin_pct * 100) / 100 : null,
      health_score,
      active_days_30d: active_days,
      cohort,
    };
  });
}

export function createCohortsRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  // GET /cohorts — per-customer cohort data with health scores
  router.get(
    "/cohorts",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.visitorId!;
        const accountId = req.accountId!;
        const showInternal = req.query.show_internal === "true";
        const internalFilter = showInternal
          ? ""
          : "AND (c.is_internal IS NOT TRUE)";

        const periodStart =
          typeof req.query.period_start === "string"
            ? req.query.period_start
            : undefined;
        const periodEnd =
          typeof req.query.period_end === "string"
            ? req.query.period_end
            : undefined;
        const hasPeriod = periodStart && periodEnd;
        const oeTimeFilter = hasPeriod
          ? `AND oe.timestamp >= $2 AND oe.timestamp <= $3`
          : "";
        const plainTimeFilter = hasPeriod
          ? `AND timestamp >= $2 AND timestamp <= $3`
          : "";
        const periodParams = hasPeriod ? [periodStart, periodEnd] : [];

        // Backfill: create customer rows for event customer_ids that have
        // no matching row in the customers table yet.
        await pool
          .query(
            `INSERT INTO customers (account_id, customer_id, name)
             SELECT DISTINCT oe.account_id, oe.customer_id, oe.customer_id
             FROM observe_events oe
             WHERE oe.account_id = $1 AND oe.customer_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM customers c
                 WHERE c.account_id = oe.account_id AND c.customer_id = oe.customer_id
               )
             ON CONFLICT (account_id, customer_id) DO NOTHING`,
            [accountId],
          )
          .catch(() => {});

        // 9 parallel queries
        const [
          pnlResult,
          totalFeaturesResult,
          subRevenueResult,
          costTrendResult,
          stickinessResult,
          topModelResult,
          currentMrrResult,
          priorMrrResult,
          priorActiveDaysResult,
        ] = await Promise.all([
          // 1. Per-customer P&L — only customers with SDK events appear.
          // Customers imported via Stripe but with no events are not shown;
          // they appear once the SDK sends at least one event with their
          // customer_id, and Stripe enriches revenue from there.
          pool.query(
            `SELECT oe.customer_id,
                    COALESCE(c.name, oe.customer_id) AS customer_name,
                    c.email AS customer_email,
                    c.segment,
                    COALESCE(c.is_internal, FALSE) AS is_internal,
                    COALESCE(SUM(oe.revenue_amount), 0) AS total_revenue,
                    COALESCE(SUM(oe.cost_amount), 0) AS total_cost,
                    COUNT(oe.id) AS event_count,
                    COUNT(DISTINCT oe.feature_key) AS feature_count,
                    COUNT(DISTINCT oe.model) AS model_count,
                    MIN(oe.timestamp) AS first_seen,
                    MAX(oe.timestamp) AS last_seen
             FROM observe_events oe
             LEFT JOIN customers c
               ON c.account_id = oe.account_id AND c.customer_id = oe.customer_id
             WHERE oe.account_id = $1
               AND oe.customer_id IS NOT NULL
               ${showInternal ? "" : "AND (c.is_internal IS NOT TRUE OR c.is_internal IS NULL)"}
               ${oeTimeFilter}
             GROUP BY oe.customer_id, c.name, c.email, c.segment, c.is_internal
             HAVING COUNT(oe.id) > 0`,
            [accountId, ...periodParams],
          ),
          // 2. Total distinct features
          pool.query(
            `SELECT COUNT(DISTINCT feature_key) AS total_features
             FROM observe_events
             WHERE account_id = $1 AND feature_key IS NOT NULL`,
            [accountId],
          ),
          // 3. Subscription revenue per customer (bridged via customers.stripe_customer_id)
          pool.query(
            `SELECT COALESCE(c.customer_id, s.customer_id) AS customer_id,
                    COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) AS sub_revenue,
                    CASE WHEN COUNT(DISTINCT s.pricing_model) > 1 THEN 'hybrid' ELSE MAX(s.pricing_model) END AS pricing_model
             FROM subscriptions s
             LEFT JOIN plans p ON s.account_id = p.account_id AND s.plan_id = p.plan_id
             LEFT JOIN customers c ON s.account_id = c.account_id AND c.stripe_customer_id = s.customer_id
             WHERE s.account_id = $1 AND s.is_active = true
             GROUP BY COALESCE(c.customer_id, s.customer_id)`,
            [accountId],
          ),
          // 4. Cost trend: current 30d vs prior 30d per customer
          pool.query(
            `SELECT customer_id,
                    COALESCE(SUM(CASE WHEN timestamp >= NOW() - INTERVAL '30 days' THEN cost_amount ELSE 0 END), 0) AS current_cost,
                    COALESCE(SUM(CASE WHEN timestamp >= NOW() - INTERVAL '60 days' AND timestamp < NOW() - INTERVAL '30 days' THEN cost_amount ELSE 0 END), 0) AS prior_cost
             FROM observe_events
             WHERE account_id = $1 AND customer_id IS NOT NULL AND timestamp >= NOW() - INTERVAL '60 days'
               AND (source IS NULL OR source != 'stripe')
               ${plainTimeFilter}
             GROUP BY customer_id`,
            [accountId, ...periodParams],
          ),
          // 5. Stickiness: distinct active days in last 30d
          pool.query(
            `SELECT customer_id,
                    COUNT(DISTINCT DATE(timestamp)) AS active_days
             FROM observe_events
             WHERE account_id = $1 AND customer_id IS NOT NULL AND timestamp >= NOW() - INTERVAL '30 days'
               AND (source IS NULL OR source != 'stripe')
               ${plainTimeFilter}
             GROUP BY customer_id`,
            [accountId, ...periodParams],
          ),
          // 6. Top model by cost per customer
          pool.query(
            `SELECT DISTINCT ON (customer_id) customer_id, model, SUM(cost_amount) AS model_cost
             FROM observe_events
             WHERE account_id = $1 AND customer_id IS NOT NULL AND model IS NOT NULL
               AND (source IS NULL OR source != 'stripe')
             GROUP BY customer_id, model
             ORDER BY customer_id, model_cost DESC`,
            [accountId],
          ),
          // 7. Current MRR per customer (active subs, bridged via customers.stripe_customer_id)
          pool.query(
            `SELECT COALESCE(c.customer_id, s.customer_id) AS customer_id,
                    COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) AS mrr
             FROM subscriptions s
             LEFT JOIN plans p ON s.account_id = p.account_id AND s.plan_id = p.plan_id
             LEFT JOIN customers c ON s.account_id = c.account_id AND c.stripe_customer_id = s.customer_id
             WHERE s.account_id = $1 AND s.is_active = true
             GROUP BY COALESCE(c.customer_id, s.customer_id)`,
            [accountId],
          ),
          // 8. Prior MRR per customer (subs created 60+ days ago, bridged via customers.stripe_customer_id)
          pool.query(
            `SELECT COALESCE(c.customer_id, s.customer_id) AS customer_id,
                    COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) AS mrr
             FROM subscriptions s
             LEFT JOIN plans p ON s.account_id = p.account_id AND s.plan_id = p.plan_id
             LEFT JOIN customers c ON s.account_id = c.account_id AND c.stripe_customer_id = s.customer_id
             WHERE s.account_id = $1 AND s.created_at <= NOW() - INTERVAL '60 days'
             GROUP BY COALESCE(c.customer_id, s.customer_id)`,
            [accountId],
          ),
          // 9. Prior-months active-days average — used to contextualize
          // "inactive" signals. Excludes the current month (partial) and caps
          // at the last 4 prior months so seasonality dominates less.
          pool.query(
            `SELECT customer_id, AVG(active_days_per_month) AS avg_days
             FROM (
               SELECT customer_id,
                      DATE_TRUNC('month', timestamp) AS month,
                      COUNT(DISTINCT DATE(timestamp)) AS active_days_per_month
               FROM observe_events
               WHERE account_id = $1
                 AND customer_id IS NOT NULL
                 AND timestamp < DATE_TRUNC('month', NOW())
                 AND timestamp >= DATE_TRUNC('month', NOW()) - INTERVAL '4 months'
               GROUP BY customer_id, month
             ) monthly
             GROUP BY customer_id
             HAVING COUNT(*) >= 2`,
            [accountId],
          ),
        ]);

        const totalFeatures =
          parseInt(totalFeaturesResult.rows[0]?.total_features) || 1;

        // Build lookup maps
        const subRevenueMap: Record<string, number> = {};
        const pricingModelMap: Record<string, string> = {};
        for (const row of subRevenueResult.rows) {
          subRevenueMap[row.customer_id] = parseFloat(row.sub_revenue) || 0;
          if (row.pricing_model)
            pricingModelMap[row.customer_id] = row.pricing_model;
        }

        const costTrendMap: Record<string, { current: number; prior: number }> =
          {};
        for (const row of costTrendResult.rows) {
          costTrendMap[row.customer_id] = {
            current: parseFloat(row.current_cost) || 0,
            prior: parseFloat(row.prior_cost) || 0,
          };
        }

        const stickinessMap: Record<string, number> = {};
        for (const row of stickinessResult.rows) {
          stickinessMap[row.customer_id] = parseInt(row.active_days) || 0;
        }

        const topModelMap: Record<string, { model: string; cost: number }> = {};
        for (const row of topModelResult.rows) {
          topModelMap[row.customer_id] = {
            model: row.model,
            cost: parseFloat(row.model_cost) || 0,
          };
        }

        const currentMrrMap: Record<string, number> = {};
        for (const row of currentMrrResult.rows) {
          currentMrrMap[row.customer_id] = parseFloat(row.mrr) || 0;
        }

        const priorMrrMap: Record<string, number> = {};
        for (const row of priorMrrResult.rows) {
          priorMrrMap[row.customer_id] = parseFloat(row.mrr) || 0;
        }

        const priorActiveDaysAvgMap: Record<string, number> = {};
        for (const row of priorActiveDaysResult.rows) {
          priorActiveDaysAvgMap[row.customer_id] =
            parseFloat(row.avg_days) || 0;
        }

        // Model swap suggestions — find cheapest same-provider alternative
        const allPricing = await getAllPricing(pool);
        const pricingByProvider: Record<
          string,
          Array<{ model: string; input_cost: number }>
        > = {};
        for (const p of allPricing) {
          if (!pricingByProvider[p.provider]) {
            pricingByProvider[p.provider] = [];
          }
          pricingByProvider[p.provider].push({
            model: p.model,
            input_cost: p.input_cost_per_million,
          });
        }
        for (const models of Object.values(pricingByProvider)) {
          models.sort((a, b) => a.input_cost - b.input_cost);
        }

        const inputRateMap: Record<string, number> = {};
        for (const p of allPricing) {
          inputRateMap[p.model] = p.input_cost_per_million;
        }

        // Compute per-customer metrics
        const customers = pnlResult.rows.map((row) => {
          // Per-event revenue only captures metered/tiered portions for
          // hybrid plans — the flat subscription fee is not allocated per-event.
          // Use whichever is higher: event revenue or subscription MRR.
          const eventRevenue = parseFloat(row.total_revenue) || 0;
          const subRevenue = subRevenueMap[row.customer_id] || 0;
          const totalRevenue = Math.max(eventRevenue, subRevenue);
          const totalCost = parseFloat(row.total_cost) || 0;
          const eventCount = parseInt(row.event_count) || 0;
          const featureCount = parseInt(row.feature_count) || 0;
          const modelCount = parseInt(row.model_count) || 0;

          const marginPct =
            totalRevenue > 0
              ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100)
              : null;

          const adoptionDepth = Math.round(
            (featureCount / totalFeatures) * 100,
          );

          // Cost trend
          const trend = costTrendMap[row.customer_id];
          let costTrend: "up" | "down" | "stable" | "new" = "new";
          let costTrendPct: number | null = null;
          if (trend) {
            if (trend.prior === 0 && trend.current > 0) {
              costTrend = "new";
            } else if (trend.prior > 0) {
              const ratio = trend.current / trend.prior;
              if (ratio > 1.15) costTrend = "up";
              else if (ratio < 0.85) costTrend = "down";
              else costTrend = "stable";
              costTrendPct = Math.round(
                ((trend.current - trend.prior) / trend.prior) * 100,
              );
            }
          }

          const activeDays = stickinessMap[row.customer_id] || 0;
          const priorActiveDaysAvg = priorActiveDaysAvgMap[row.customer_id]
            ? Math.round(priorActiveDaysAvgMap[row.customer_id])
            : null;

          // Health score (0-100)
          // Margin (40 pts): 40 * clamp(margin/100, 0, 1)
          // Null margin (no revenue data yet) gets neutral midpoint, not 0
          const marginScore =
            marginPct !== null
              ? 40 * Math.max(0, Math.min(1, marginPct / 100))
              : 20;
          // Adoption (25 pts)
          const adoptionScore = 25 * Math.min(1, adoptionDepth / 100);
          // Trend (20 pts): margin-aware — growing + profitable = best
          const trendScore =
            costTrend === "new"
              ? 10
              : costTrend === "stable"
                ? 15
                : costTrend === "up" && marginPct !== null && marginPct >= 30
                  ? 20
                  : costTrend === "up"
                    ? 5
                    : costTrend === "down" && activeDays >= 15
                      ? 15
                      : 5;
          // Recency (15 pts): based on active days in 30d
          const recencyScore = 15 * Math.min(1, activeDays / 20);
          const healthScore = Math.round(
            marginScore + adoptionScore + trendScore + recencyScore,
          );

          // Model swap suggestion
          let modelSwapSuggestion: {
            suggested_model: string;
            current_cost_per_event: number;
            suggested_cost_per_event: number;
            potential_savings_pct: number;
          } | null = null;

          const topModel = topModelMap[row.customer_id];
          if (topModel && eventCount > 0) {
            const currentRate = inputRateMap[topModel.model];
            const provider = inferModelProvider(topModel.model) || "unknown";
            const sameProviderModels = pricingByProvider[provider] || [];
            const cheapest = sameProviderModels.find(
              (m) =>
                m.model !== topModel.model &&
                m.input_cost < (currentRate || Infinity),
            );
            if (cheapest && currentRate) {
              const currentCostPerEvent = topModel.cost / eventCount;
              const ratio = cheapest.input_cost / currentRate;
              modelSwapSuggestion = {
                suggested_model: cheapest.model,
                current_cost_per_event: currentCostPerEvent,
                suggested_cost_per_event: currentCostPerEvent * ratio,
                potential_savings_pct: Math.round((1 - ratio) * 100),
              };
            }
          }

          // MRR movement
          const currentMrr = currentMrrMap[row.customer_id] || 0;
          const priorMrr = priorMrrMap[row.customer_id] || 0;
          let mrrMovement: MrrMovementCategory | null = null;
          if (currentMrr > 0 && priorMrr === 0) mrrMovement = "new";
          else if (currentMrr === 0 && priorMrr > 0) mrrMovement = "churned";
          else if (currentMrr > priorMrr) mrrMovement = "expansion";
          else if (currentMrr < priorMrr) mrrMovement = "contraction";
          else if (currentMrr > 0) mrrMovement = "stable";

          // Cohort label
          let cohort: CohortLabel | null = null;
          if (
            (marginPct !== null && marginPct < 0) ||
            (totalRevenue === 0 && totalCost > 0)
          ) {
            cohort = "unprofitable";
          } else if (
            costTrend === "up" &&
            marginPct !== null &&
            marginPct < 30
          ) {
            cohort = "rising_cost";
          } else if (adoptionDepth < 20 && activeDays < 3) {
            cohort = "inactive";
          } else if (
            healthScore >= 70 &&
            marginPct !== null &&
            marginPct >= 50
          ) {
            cohort = "champion";
          }

          return {
            customer_id: row.customer_id,
            customer_name: row.customer_name,
            customer_email: row.customer_email || null,
            segment: row.segment || null,
            is_internal: row.is_internal || false,
            total_revenue: totalRevenue,
            total_cost: totalCost,
            margin_pct: marginPct,
            event_count: eventCount,
            feature_count: featureCount,
            model_count: modelCount,
            adoption_depth: adoptionDepth,
            first_seen: row.first_seen,
            last_seen: row.last_seen,
            cost_trend: costTrend,
            cost_trend_pct: costTrendPct,
            active_days_30d: activeDays,
            active_days_prior_avg: priorActiveDaysAvg,
            health_score: healthScore,
            top_model: topModel?.model || null,
            top_model_cost: topModel?.cost || null,
            model_swap_suggestion: modelSwapSuggestion,
            mrr: currentMrr,
            mrr_movement: mrrMovement,
            pricing_model: pricingModelMap[row.customer_id] || null,
            cohort,
          };
        });

        // Summary by cohort
        const summary: Record<
          CohortLabel,
          { count: number; total_revenue: number; total_cost: number }
        > = {
          unprofitable: { count: 0, total_revenue: 0, total_cost: 0 },
          champion: { count: 0, total_revenue: 0, total_cost: 0 },
          inactive: { count: 0, total_revenue: 0, total_cost: 0 },
          rising_cost: { count: 0, total_revenue: 0, total_cost: 0 },
        };

        let totalRevenue = 0;
        let totalCost = 0;
        let totalHealthScore = 0;

        for (const c of customers) {
          if (c.cohort && summary[c.cohort]) {
            summary[c.cohort].count++;
            summary[c.cohort].total_revenue += c.total_revenue;
            summary[c.cohort].total_cost += c.total_cost;
          }
          totalRevenue += c.total_revenue;
          totalCost += c.total_cost;
          totalHealthScore += c.health_score;
        }

        const totals = {
          customers: customers.length,
          revenue: totalRevenue,
          cost: totalCost,
          margin_pct:
            totalRevenue > 0
              ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100)
              : null,
          avg_health_score:
            customers.length > 0
              ? Math.round(totalHealthScore / customers.length)
              : 0,
        };

        // Fire-and-forget health snapshot insert (chunked to stay under PG param limit)
        if (customers.length > 0) {
          const CHUNK_SIZE = 1000;
          const healthAcctId = req.accountId ?? null;
          for (let i = 0; i < customers.length; i += CHUNK_SIZE) {
            const chunk = customers.slice(i, i + CHUNK_SIZE);
            const values: unknown[] = [];
            const placeholders: string[] = [];
            let idx = 1;
            for (const c of chunk) {
              placeholders.push(
                `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6})`,
              );
              values.push(
                userId,
                healthAcctId,
                c.customer_id,
                c.health_score,
                c.margin_pct,
                c.adoption_depth,
                c.active_days_30d,
              );
              idx += 7;
            }
            pool
              .query(
                `INSERT INTO customer_health_snapshots (user_id, account_id, customer_id, health_score, margin_pct, adoption_depth, active_days)
                 VALUES ${placeholders.join(", ")}
                 ON CONFLICT (account_id, customer_id, snapshot_date) DO UPDATE SET
                   health_score = EXCLUDED.health_score,
                   margin_pct = EXCLUDED.margin_pct,
                   adoption_depth = EXCLUDED.adoption_depth,
                   active_days = EXCLUDED.active_days`,
                values,
              )
              .catch((err) =>
                console.error("Health snapshot insert error:", err),
              );
          }
        }

        res.json({
          customers,
          summary,
          totals,
          period_start: periodStart || null,
          period_end: periodEnd || null,
        });
      } catch (error) {
        console.error("GET /cohorts error:", error);
        res
          .status(500)
          .json({ error: "Failed to compute cohorts", detail: String(error) });
      }
    },
  );

  // POST /cohorts/discover — AI cohort discovery
  router.post(
    "/cohorts/discover",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const accountId = req.accountId!;

        // Gather customer summaries
        const [pnlResult, costTrendResult, stickinessResult] =
          await Promise.all([
            pool.query(
              `SELECT oe.customer_id,
                      COALESCE(c.name, oe.customer_id) AS customer_name,
                      c.segment,
                      COALESCE(SUM(oe.revenue_amount), 0) AS total_revenue,
                      COALESCE(SUM(oe.cost_amount), 0) AS total_cost,
                      COUNT(*) AS event_count,
                      COUNT(DISTINCT oe.feature_key) AS feature_count
               FROM observe_events oe
               LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
               WHERE oe.account_id = $1 AND oe.customer_id IS NOT NULL
               GROUP BY oe.customer_id, c.name, c.segment`,
              [accountId],
            ),
            pool.query(
              `SELECT customer_id,
                      COALESCE(SUM(CASE WHEN timestamp >= NOW() - INTERVAL '30 days' THEN cost_amount ELSE 0 END), 0) AS current_cost,
                      COALESCE(SUM(CASE WHEN timestamp >= NOW() - INTERVAL '60 days' AND timestamp < NOW() - INTERVAL '30 days' THEN cost_amount ELSE 0 END), 0) AS prior_cost
               FROM observe_events
               WHERE account_id = $1 AND customer_id IS NOT NULL AND timestamp >= NOW() - INTERVAL '60 days'
               GROUP BY customer_id`,
              [accountId],
            ),
            pool.query(
              `SELECT customer_id, COUNT(DISTINCT DATE(timestamp)) AS active_days
               FROM observe_events
               WHERE account_id = $1 AND customer_id IS NOT NULL AND timestamp >= NOW() - INTERVAL '30 days'
               GROUP BY customer_id`,
              [accountId],
            ),
          ]);

        if (pnlResult.rows.length === 0) {
          return res.json({ clusters: [], source: "deterministic" as const });
        }

        // Build summary text for AI
        const trendMap: Record<string, { current: number; prior: number }> = {};
        for (const row of costTrendResult.rows) {
          trendMap[row.customer_id] = {
            current: parseFloat(row.current_cost) || 0,
            prior: parseFloat(row.prior_cost) || 0,
          };
        }
        const daysMap: Record<string, number> = {};
        for (const row of stickinessResult.rows) {
          daysMap[row.customer_id] = parseInt(row.active_days) || 0;
        }

        const customerSummaries = pnlResult.rows.map((row) => {
          const rev = parseFloat(row.total_revenue) || 0;
          const cost = parseFloat(row.total_cost) || 0;
          const margin =
            rev > 0
              ? Math.round(((rev - cost) / rev) * 100)
              : cost > 0
                ? -100
                : 0;
          const trend = trendMap[row.customer_id];
          let trendLabel = "new";
          if (trend && trend.prior > 0) {
            const ratio = trend.current / trend.prior;
            if (ratio > 1.15) trendLabel = "up";
            else if (ratio < 0.85) trendLabel = "down";
            else trendLabel = "stable";
          }

          return {
            id: row.customer_id,
            name: row.customer_name,
            revenue: rev,
            cost,
            margin,
            events: parseInt(row.event_count) || 0,
            features: parseInt(row.feature_count) || 0,
            active_days: daysMap[row.customer_id] || 0,
            cost_trend: trendLabel,
          };
        });

        const summaryText = customerSummaries
          .map(
            (c) =>
              `${c.name} (${c.id}): rev=$${c.revenue.toFixed(2)}, cost=$${c.cost.toFixed(2)}, margin=${c.margin}%, events=${c.events}, features=${c.features}, active_days=${c.active_days}, cost_trend=${c.cost_trend}`,
          )
          .join("\n");

        // Try AI discovery
        if (process.env.OPENAI_API_KEY) {
          try {
            const response = await fetch(
              "https://api.openai.com/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                  model: "gpt-4o",
                  temperature: 0.3,
                  messages: [
                    {
                      role: "system",
                      content: `You are a B2B SaaS analytics expert. Given customer data, identify 3-5 hidden clusters or segments that aren't obvious from standard metrics. Focus on actionable patterns.

Return JSON array of objects with these exact fields:
- name: short cluster name
- description: 1-2 sentence explanation
- customer_ids: array of customer IDs belonging to this cluster
- severity: "critical" | "warning" | "info" | "positive"
- recommended_action: 1 sentence action item

Return ONLY valid JSON array, no markdown.`,
                    },
                    {
                      role: "user",
                      content: `Analyze these customers and find hidden patterns:\n\n${summaryText}`,
                    },
                  ],
                }),
              },
            );

            if (response.ok) {
              const data = (await response.json()) as {
                choices: Array<{ message: { content: string } }>;
              };
              const content = data.choices?.[0]?.message?.content;
              if (content) {
                const clusters = JSON.parse(content);
                if (Array.isArray(clusters) && clusters.length > 0) {
                  return res.json({ clusters, source: "ai" as const });
                }
              }
            }
          } catch (aiError) {
            console.error(
              "AI cohort discovery failed, using fallback:",
              aiError,
            );
          }
        }

        // Deterministic fallback
        const clusters: Array<{
          name: string;
          description: string;
          customer_ids: string[];
          severity: "critical" | "warning" | "info" | "positive";
          recommended_action: string;
        }> = [];

        // High-Volume Loss Makers
        const lossmakers = customerSummaries.filter(
          (c) => c.margin < 0 && c.events > 10,
        );
        if (lossmakers.length > 0) {
          clusters.push({
            name: "High-Volume Loss Makers",
            description: `${lossmakers.length} customers with negative margins despite significant usage. They drive cost without covering it.`,
            customer_ids: lossmakers.map((c) => c.id),
            severity: "critical",
            recommended_action:
              "Review pricing for these accounts or switch to cheaper models to reduce cost.",
          });
        }

        // Shallow Power Users
        const shallow = customerSummaries.filter(
          (c) => c.events > 50 && c.features <= 2,
        );
        if (shallow.length > 0) {
          clusters.push({
            name: "Shallow Power Users",
            description: `${shallow.length} customers with high event volume but using 2 or fewer features. Expansion opportunity.`,
            customer_ids: shallow.map((c) => c.id),
            severity: "info",
            recommended_action:
              "Reach out with feature education to drive adoption breadth and stickiness.",
          });
        }

        // Margin Compression Risk
        const compressing = customerSummaries.filter(
          (c) => c.cost_trend === "up" && c.margin < 30 && c.margin >= 0,
        );
        if (compressing.length > 0) {
          clusters.push({
            name: "Margin Compression Risk",
            description: `${compressing.length} customers with rising costs and margins under 30%. At risk of becoming unprofitable.`,
            customer_ids: compressing.map((c) => c.id),
            severity: "warning",
            recommended_action:
              "Investigate cost drivers and consider model swaps or usage caps before margins go negative.",
          });
        }

        res.json({
          clusters,
          source: "deterministic" as const,
        });
      } catch (error) {
        console.error("POST /cohorts/discover error:", error);
        res.status(500).json({ error: "Failed to discover cohorts" });
      }
    },
  );

  // GET /cohorts/:customerId/health-history — last 90 snapshots
  router.get(
    "/cohorts/:customerId/health-history",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const customerId = req.params.customerId;

        const result = await pool.query(
          `SELECT snapshot_date, health_score, margin_pct, adoption_depth, active_days
           FROM customer_health_snapshots
           WHERE account_id = $1 AND customer_id = $2
           ORDER BY snapshot_date DESC
           LIMIT 90`,
          [req.accountId!, customerId],
        );

        res.json({ history: result.rows });
      } catch (error) {
        console.error("GET /cohorts/:customerId/health-history error:", error);
        res.status(500).json({ error: "Failed to get health history" });
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════
  // CUSTOM COHORTS — user-defined customer groups
  // ═══════════════════════════════════════════════════════════════════════

  // List custom cohorts with member counts
  router.get(
    "/cohorts/custom",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT cc.*, COUNT(cm.id) as member_count
           FROM custom_cohorts cc
           LEFT JOIN cohort_members cm ON cm.cohort_id = cc.id
           WHERE cc.account_id = $1
           GROUP BY cc.id
           ORDER BY cc.created_at DESC`,
          [req.accountId],
        );

        // For dynamic cohorts, compute member_count from rules
        const dynamicCohorts = result.rows.filter(
          (c) => c.cohort_type === "dynamic" && c.rules,
        );
        if (dynamicCohorts.length > 0) {
          const customers = await getCustomerDataForRules(pool, req.accountId!);
          for (const cohort of result.rows) {
            if (cohort.cohort_type === "dynamic" && cohort.rules) {
              const matched = evaluateRules(customers, cohort.rules);
              cohort.member_count = matched.length;
            }
          }
        }

        res.json({ cohorts: result.rows });
      } catch (error) {
        console.error("GET /cohorts/custom error:", error);
        res.status(500).json({ error: "Failed to list custom cohorts" });
      }
    },
  );

  // Create custom cohort
  router.post(
    "/cohorts/custom",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { name, description, color, customer_ids, cohort_type, rules } =
          req.body;
        if (!name || typeof name !== "string") {
          return res.status(400).json({ error: "name is required" });
        }

        const type = cohort_type === "dynamic" ? "dynamic" : "static";
        const cohortResult = await pool.query(
          "INSERT INTO custom_cohorts (user_id, account_id, name, description, color, cohort_type, rules) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
          [
            req.visitorId,
            req.accountId ?? null,
            name.trim(),
            description || null,
            color || "#6366f1",
            type,
            type === "dynamic" && Array.isArray(rules)
              ? JSON.stringify(rules)
              : null,
          ],
        );
        const cohort = cohortResult.rows[0];

        // Add members for static cohorts only
        if (
          type === "static" &&
          Array.isArray(customer_ids) &&
          customer_ids.length > 0
        ) {
          const values = customer_ids
            .map((_: string, i: number) => `($1, $${i + 2})`)
            .join(", ");
          await pool.query(
            `INSERT INTO cohort_members (cohort_id, customer_id) VALUES ${values} ON CONFLICT DO NOTHING`,
            [cohort.id, ...customer_ids],
          );
        }

        res.status(201).json(cohort);
      } catch (error: any) {
        if (error.code === "23505") {
          return res
            .status(409)
            .json({ error: "A cohort with this name already exists" });
        }
        console.error("POST /cohorts/custom error:", error);
        res.status(500).json({ error: "Failed to create cohort" });
      }
    },
  );

  // Get cohort with members
  router.get(
    "/cohorts/custom/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const cohortResult = await pool.query(
          "SELECT * FROM custom_cohorts WHERE id = $1 AND account_id = $2",
          [req.params.id, req.accountId],
        );
        if (cohortResult.rows.length === 0) {
          return res.status(404).json({ error: "Cohort not found" });
        }

        const cohort = cohortResult.rows[0];
        let members;

        if (cohort.cohort_type === "dynamic" && cohort.rules) {
          // Evaluate rules to compute members dynamically
          const customers = await getCustomerDataForRules(pool, req.accountId!);
          const matched = evaluateRules(customers, cohort.rules);
          members = matched.map((c) => ({
            customer_id: c.customer_id,
            customer_name: c.customer_name,
            margin_pct: c.margin_pct,
            total_cost: c.total_cost,
            total_revenue: c.total_revenue,
            health_score: c.health_score,
          }));
        } else {
          const result = await pool.query(
            `SELECT cm.customer_id, c.name as customer_name, cm.added_at
             FROM cohort_members cm
             LEFT JOIN customers c ON c.account_id = $2 AND c.customer_id = cm.customer_id
             WHERE cm.cohort_id = $1
             ORDER BY cm.added_at DESC`,
            [req.params.id, req.accountId!],
          );
          members = result.rows;
        }

        res.json({ ...cohort, members });
      } catch (error) {
        console.error("GET /cohorts/custom/:id error:", error);
        res.status(500).json({ error: "Failed to get cohort" });
      }
    },
  );

  // Add members to cohort
  router.post(
    "/cohorts/custom/:id/members",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { customer_ids } = req.body;
        if (!Array.isArray(customer_ids) || customer_ids.length === 0) {
          return res.status(400).json({ error: "customer_ids array required" });
        }

        // Verify ownership
        const check = await pool.query(
          "SELECT id FROM custom_cohorts WHERE id = $1 AND account_id = $2",
          [req.params.id, req.accountId],
        );
        if (check.rows.length === 0) {
          return res.status(404).json({ error: "Cohort not found" });
        }

        const values = customer_ids
          .map((_: string, i: number) => `($1, $${i + 2})`)
          .join(", ");
        await pool.query(
          `INSERT INTO cohort_members (cohort_id, customer_id) VALUES ${values} ON CONFLICT DO NOTHING`,
          [req.params.id, ...customer_ids],
        );

        res.json({ added: customer_ids.length });
      } catch (error) {
        console.error("POST /cohorts/custom/:id/members error:", error);
        res.status(500).json({ error: "Failed to add members" });
      }
    },
  );

  // Remove member from cohort
  router.delete(
    "/cohorts/custom/:id/members/:customerId",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const check = await pool.query(
          "SELECT id FROM custom_cohorts WHERE id = $1 AND account_id = $2",
          [req.params.id, req.accountId],
        );
        if (check.rows.length === 0) {
          return res.status(404).json({ error: "Cohort not found" });
        }

        await pool.query(
          "DELETE FROM cohort_members WHERE cohort_id = $1 AND customer_id = $2",
          [req.params.id, req.params.customerId],
        );
        res.json({ removed: true });
      } catch (error) {
        console.error("DELETE cohort member error:", error);
        res.status(500).json({ error: "Failed to remove member" });
      }
    },
  );

  // Delete cohort
  router.delete(
    "/cohorts/custom/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          "DELETE FROM custom_cohorts WHERE id = $1 AND account_id = $2 RETURNING id",
          [req.params.id, req.accountId],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Cohort not found" });
        }
        res.json({ deleted: true });
      } catch (error) {
        console.error("DELETE /cohorts/custom/:id error:", error);
        res.status(500).json({ error: "Failed to delete cohort" });
      }
    },
  );

  return router;
}
