import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface Recommendation {
  id: number;
  user_id: string;
  type: string;
  title: string;
  description: string;
  severity: string;
  action_type: string;
  action_payload: Record<string, unknown>;
  context: Record<string, unknown>;
  status: string;
  created_at: string;
  applied_at: string | null;
  dismissed_at: string | null;
}

// ── Recommendation Compute Engine ────────────────────────────────────────────

// Model families we consider comparable for cost swap recommendations.
// Comparing a chat model's cost/event against an embedding or image model is
// meaningless — you can't substitute text-embedding-ada-002 for gpt-4o.
function isChatCompletionModel(model: string): boolean {
  const m = model.toLowerCase();
  if (m.includes("embedding")) return false;
  if (m.includes("dall-e") || m.includes("whisper") || m.includes("tts"))
    return false;
  if (m.includes("image") || m.includes("speech")) return false;
  return true;
}

// Recent dismissals act as a cooldown so dismissed suggestions don't reappear.
// Keyed by (type, scope_key) where scope_key is the canonical context field.
async function isRecentlyDismissed(
  pool: Pool,
  userId: string,
  type: string,
  scopeField: string,
  scopeValue: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM recommendations
     WHERE user_id = $1 AND type = $2 AND status = 'dismissed'
       AND dismissed_at > NOW() - INTERVAL '30 days'
       AND context->>$3 = $4
     LIMIT 1`,
    [userId, type, scopeField, scopeValue],
  );
  return result.rows.length > 0;
}

// Heuristic confidence score for a recommendation. Bounded [0.3, 0.95].
// This is NOT calibrated against ground truth — there's no OSS playbook for
// retrospective LLM recommendation engines, so the best we can do is surface
// a human-readable "how much signal is behind this" score so users can
// sort by trust and dismiss low-confidence noise.
//
//   n=1,    info    → 0.33
//   n=10,   warning → 0.49
//   n=100,  warning → 0.71
//   n=200,  warning → 0.78
//   n=1000, critical → 0.85 (capped)
function recommendationConfidence(
  sampleCount: number,
  severity: "critical" | "warning" | "info",
): number {
  if (sampleCount <= 0) return 0.3;
  const base = 0.3 + Math.min(Math.sqrt(sampleCount) / 30, 0.4);
  const severityBoost =
    severity === "critical" ? 0.15 : severity === "warning" ? 0.08 : 0;
  return Math.min(0.95, Math.round((base + severityBoost) * 100) / 100);
}

// Each rule runs in its own try block. A failure in one rule must not
// silently skip the remaining rules — they are independent and users
// depend on all of them.
async function runRule(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`computeRecommendations: rule "${name}" failed:`, err);
  }
}

export async function computeRecommendations(
  pool: Pool,
  userId: string,
): Promise<void> {
  // Background job — no req.accountId. Fallback: resolve owner's account_id.
  const accountIdResult = await pool.query(
    `SELECT account_id FROM user_accounts WHERE user_id = (SELECT id FROM users WHERE visitor_id = $1) AND role = 'owner' LIMIT 1`,
    [userId],
  );
  const accountId: number | null = accountIdResult.rows[0]?.account_id ?? null;
  if (accountId === null) {
    console.warn(
      "computeRecommendations: no owner account_id for visitor",
      userId,
    );
    return;
  }

  // 1. Find customers with negative margins (routing_cost_optimization)
  await runRule("customer_margin", async () => {
    const marginResult = await pool.query(
      `SELECT customer_id,
        SUM(cost_amount) as total_cost,
        SUM(revenue_amount) as total_revenue,
        CASE WHEN SUM(revenue_amount) > 0
          THEN ROUND(((SUM(revenue_amount) - SUM(cost_amount)) / SUM(revenue_amount)) * 100, 1)
          ELSE NULL END as margin_pct,
        COUNT(*) as event_count
       FROM observe_events
       WHERE account_id = $1 AND timestamp > NOW() - INTERVAL '30 days'
         AND customer_id IS NOT NULL AND customer_id != 'default'
       GROUP BY customer_id
       HAVING SUM(cost_amount) > 0`,
      [accountId],
    );

    for (const row of marginResult.rows) {
      const marginPct = parseFloat(row.margin_pct);
      if (isNaN(marginPct) || marginPct >= 20) continue;

      if (
        await isRecentlyDismissed(
          pool,
          userId,
          "routing_cost_optimization",
          "customer_id",
          row.customer_id,
        )
      )
        continue;

      // Check if we already have a pending recommendation for this customer
      const existing = await pool.query(
        `SELECT id FROM recommendations
         WHERE user_id = $1 AND type = 'routing_cost_optimization'
           AND status = 'pending'
           AND context->>'customer_id' = $2`,
        [userId, row.customer_id],
      );
      if (existing.rows.length > 0) continue;

      const totalCost = parseFloat(row.total_cost);
      const totalRevenue = parseFloat(row.total_revenue);

      await pool.query(
        `INSERT INTO recommendations (user_id, type, title, description, severity, action_type, action_payload, context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          "routing_cost_optimization",
          `${row.customer_id} has ${marginPct < 0 ? "negative" : "low"} margin (${marginPct}%)`,
          `This customer generated $${totalCost.toFixed(2)} in costs vs $${totalRevenue.toFixed(2)} in revenue over the last 30 days (${row.event_count} events). Consider routing their requests to a cheaper model.`,
          marginPct < 0 ? "critical" : "warning",
          "create_routing_rule",
          JSON.stringify({
            field: "customer_id",
            operator: "eq",
            value: row.customer_id,
          }),
          JSON.stringify({
            customer_id: row.customer_id,
            margin_pct: marginPct,
            total_cost: totalCost,
            total_revenue: totalRevenue,
            event_count: parseInt(row.event_count),
            confidence: recommendationConfidence(
              parseInt(row.event_count),
              marginPct < 0 ? "critical" : "warning",
            ),
          }),
        ],
      );
    }
  });

  // 2. Find expensive models that could be swapped (routing_model_swap)
  // Only compare within the same modality — suggesting an embedding model as
  // a replacement for a chat model is nonsense.
  await runRule("model_swap", async () => {
    const modelResult = await pool.query(
      `SELECT model, model_provider,
        COUNT(*) as event_count,
        SUM(cost_amount) as total_cost,
        AVG(cost_amount) as avg_cost_per_event
       FROM observe_events
       WHERE account_id = $1 AND timestamp > NOW() - INTERVAL '30 days'
         AND model IS NOT NULL AND cost_amount > 0
       GROUP BY model, model_provider
       ORDER BY total_cost DESC
       LIMIT 10`,
      [accountId],
    );

    // Only consider chat/completion models for this rule. Cost/event is only
    // a sound comparison within a single modality.
    const expensiveModels = modelResult.rows.filter(
      (r) =>
        parseFloat(r.avg_cost_per_event) > 0.01 &&
        isChatCompletionModel(r.model),
    );

    for (const model of expensiveModels) {
      // Find cheaper chat models the user already uses. Enforce same-modality
      // filtering in SQL so we never cross chat ↔ embedding ↔ image.
      const cheaperResult = await pool.query(
        `SELECT DISTINCT model, model_provider, AVG(cost_amount) as avg_cost
         FROM observe_events
         WHERE account_id = $1 AND timestamp > NOW() - INTERVAL '30 days'
           AND model IS NOT NULL AND cost_amount > 0
           AND model != $2
           AND model NOT ILIKE '%embedding%'
           AND model NOT ILIKE 'dall-e%'
           AND model NOT ILIKE '%whisper%'
           AND model NOT ILIKE '%tts%'
         GROUP BY model, model_provider
         HAVING AVG(cost_amount) < $3 * 0.5
         ORDER BY avg_cost ASC
         LIMIT 1`,
        [accountId, model.model, model.avg_cost_per_event],
      );

      if (cheaperResult.rows.length === 0) continue;

      const cheaper = cheaperResult.rows[0];

      if (
        await isRecentlyDismissed(
          pool,
          userId,
          "routing_model_swap",
          "current_model",
          model.model,
        )
      )
        continue;
      const existing = await pool.query(
        `SELECT id FROM recommendations
         WHERE user_id = $1 AND type = 'routing_model_swap'
           AND status = 'pending'
           AND context->>'current_model' = $2`,
        [userId, model.model],
      );
      if (existing.rows.length > 0) continue;

      const currentCost = parseFloat(model.avg_cost_per_event);
      const cheaperCost = parseFloat(cheaper.avg_cost);
      const savingsPct = Math.round((1 - cheaperCost / currentCost) * 100);
      const totalSavings =
        parseFloat(model.total_cost) * (1 - cheaperCost / currentCost);

      await pool.query(
        `INSERT INTO recommendations (user_id, type, title, description, severity, action_type, action_payload, context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          "routing_model_swap",
          `Switch ${model.model} to ${cheaper.model} to save ~${savingsPct}%`,
          `${model.model} costs $${currentCost.toFixed(4)}/event avg across ${model.event_count} events. ${cheaper.model} averages $${cheaperCost.toFixed(4)}/event — potential savings of ~$${totalSavings.toFixed(2)}/month.`,
          savingsPct > 50 ? "critical" : "warning",
          "update_routing_target",
          JSON.stringify({
            current_model: model.model,
            suggested_model: cheaper.model,
            suggested_provider: cheaper.model_provider,
          }),
          JSON.stringify({
            current_model: model.model,
            current_provider: model.model_provider,
            current_avg_cost: currentCost,
            suggested_model: cheaper.model,
            suggested_avg_cost: cheaperCost,
            savings_pct: savingsPct,
            total_monthly_savings: totalSavings,
            confidence: recommendationConfidence(
              parseInt(model.event_count),
              savingsPct > 50 ? "critical" : "warning",
            ),
          }),
        ],
      );
    }
  });

  // 3. Detect provider concentration risk
  await runRule("provider_concentration", async () => {
    const providerResult = await pool.query(
      `SELECT model_provider, COUNT(*) as event_count,
        SUM(cost_amount) as total_cost
       FROM observe_events
       WHERE account_id = $1 AND timestamp > NOW() - INTERVAL '30 days'
         AND model_provider IS NOT NULL
       GROUP BY model_provider`,
      [accountId],
    );

    if (
      providerResult.rows.length === 1 &&
      parseInt(providerResult.rows[0].event_count) > 50
    ) {
      const provider = providerResult.rows[0];
      const existing = await pool.query(
        `SELECT id FROM recommendations
         WHERE user_id = $1 AND type = 'provider_diversification'
           AND status = 'pending'`,
        [userId],
      );
      if (existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO recommendations (user_id, type, title, description, severity, action_type, action_payload, context)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            userId,
            "provider_diversification",
            `All traffic goes through ${provider.model_provider}`,
            `100% of your ${provider.event_count} events in the last 30 days used ${provider.model_provider}. Adding a fallback provider protects against outages.`,
            "info",
            "create_routing_config",
            JSON.stringify({
              suggested_fallback_providers: ["openai", "anthropic"].filter(
                (p) => p !== provider.model_provider,
              ),
            }),
            JSON.stringify({
              sole_provider: provider.model_provider,
              event_count: parseInt(provider.event_count),
              confidence: recommendationConfidence(
                parseInt(provider.event_count),
                "info",
              ),
            }),
          ],
        );
      }
    }
  });

  // 4. Feature underpricing — features where cost > 80% of revenue
  await runRule("feature_underpricing", async () => {
    const featurePricingResult = await pool.query(
      `SELECT feature_key,
        COUNT(*) as event_count,
        SUM(cost_amount) as total_cost,
        SUM(revenue_amount) as total_revenue,
        CASE WHEN COUNT(*) > 0 THEN SUM(cost_amount) / COUNT(*) ELSE 0 END as cost_per_call,
        CASE WHEN COUNT(*) > 0 THEN SUM(revenue_amount) / COUNT(*) ELSE 0 END as revenue_per_call
       FROM observe_events
       WHERE account_id = $1 AND timestamp > NOW() - INTERVAL '30 days'
         AND feature_key IS NOT NULL AND feature_key != 'unknown'
         AND cost_amount > 0
       GROUP BY feature_key
       HAVING SUM(revenue_amount) > 0 AND COUNT(*) >= 20`,
      [accountId],
    );

    for (const row of featurePricingResult.rows) {
      const costPerCall = parseFloat(row.cost_per_call);
      const revenuePerCall = parseFloat(row.revenue_per_call);
      if (revenuePerCall <= 0 || costPerCall / revenuePerCall < 0.8) continue;

      const existing = await pool.query(
        `SELECT id FROM recommendations
         WHERE user_id = $1 AND type = 'feature_underpricing'
           AND status = 'pending'
           AND context->>'feature_key' = $2`,
        [userId, row.feature_key],
      );
      if (existing.rows.length > 0) continue;

      const totalCost = parseFloat(row.total_cost);
      const totalRevenue = parseFloat(row.total_revenue);
      const loss = totalCost - totalRevenue;
      const marginPct = (
        ((totalRevenue - totalCost) / totalRevenue) *
        100
      ).toFixed(1);

      await pool.query(
        `INSERT INTO recommendations (user_id, type, title, description, severity, action_type, action_payload, context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          "feature_underpricing",
          `"${row.feature_key}" costs more than it earns (${marginPct}% margin)`,
          `This feature costs $${costPerCall.toFixed(4)}/call but earns $${revenuePerCall.toFixed(4)}/call. Over ${row.event_count} calls last month, you ${loss > 0 ? "lost" : "barely broke even on"} $${Math.abs(loss).toFixed(2)}.`,
          loss > 0 ? "critical" : "warning",
          "adjust_pricing",
          JSON.stringify({
            feature_key: row.feature_key,
            suggested_price_per_call: (costPerCall * 1.4).toFixed(4),
          }),
          JSON.stringify({
            feature_key: row.feature_key,
            cost_per_call: costPerCall,
            revenue_per_call: revenuePerCall,
            event_count: parseInt(row.event_count),
            margin_pct: parseFloat(marginPct),
            confidence: recommendationConfidence(
              parseInt(row.event_count),
              loss > 0 ? "critical" : "warning",
            ),
          }),
        ],
      );
    }
  });

  // 5. Revenue leakage — customers with cost > 0 but revenue = 0
  await runRule("revenue_leakage", async () => {
    const leakageResult = await pool.query(
      `SELECT customer_id,
        COUNT(*) as event_count,
        SUM(cost_amount) as total_cost
       FROM observe_events
       WHERE account_id = $1 AND timestamp > NOW() - INTERVAL '30 days'
         AND customer_id IS NOT NULL AND customer_id != 'default' AND customer_id != 'unknown'
         AND cost_amount > 0
       GROUP BY customer_id
       HAVING SUM(revenue_amount) = 0 AND SUM(cost_amount) > 1`,
      [accountId],
    );

    for (const row of leakageResult.rows) {
      const existing = await pool.query(
        `SELECT id FROM recommendations
         WHERE user_id = $1 AND type = 'revenue_leakage'
           AND status = 'pending'
           AND context->>'customer_id' = $2`,
        [userId, row.customer_id],
      );
      if (existing.rows.length > 0) continue;

      const totalCost = parseFloat(row.total_cost);

      await pool.query(
        `INSERT INTO recommendations (user_id, type, title, description, severity, action_type, action_payload, context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          "revenue_leakage",
          `${row.customer_id} has $${totalCost.toFixed(2)} in costs but $0 revenue`,
          `This customer made ${row.event_count} API calls costing $${totalCost.toFixed(2)} in the last 30 days with no revenue attached. They may be unbilled, internal, or on a free trial.`,
          totalCost > 50 ? "critical" : "warning",
          "tag_customer",
          JSON.stringify({ customer_id: row.customer_id }),
          JSON.stringify({
            customer_id: row.customer_id,
            total_cost: totalCost,
            event_count: parseInt(row.event_count),
            confidence: recommendationConfidence(
              parseInt(row.event_count),
              totalCost > 50 ? "critical" : "warning",
            ),
          }),
        ],
      );
    }
  });

  // 6. Churn risk — customers with >50% usage decline over 4 weeks
  await runRule("churn_risk", async () => {
    const churnResult = await pool.query(
      `WITH recent AS (
        SELECT customer_id, COUNT(*) as recent_count
        FROM observe_events
        WHERE account_id = $1 AND timestamp > NOW() - INTERVAL '14 days'
          AND customer_id IS NOT NULL AND customer_id != 'default' AND customer_id != 'unknown'
        GROUP BY customer_id
      ),
      prior AS (
        SELECT customer_id, COUNT(*) as prior_count
        FROM observe_events
        WHERE account_id = $1 AND timestamp BETWEEN NOW() - INTERVAL '28 days' AND NOW() - INTERVAL '14 days'
          AND customer_id IS NOT NULL AND customer_id != 'default' AND customer_id != 'unknown'
        GROUP BY customer_id
      )
      SELECT p.customer_id, p.prior_count, COALESCE(r.recent_count, 0) as recent_count,
        CASE WHEN p.prior_count > 0
          THEN ROUND(((p.prior_count - COALESCE(r.recent_count, 0))::numeric / p.prior_count) * 100, 1)
          ELSE 0 END as decline_pct
      FROM prior p
      LEFT JOIN recent r ON p.customer_id = r.customer_id
      WHERE p.prior_count >= 10
        AND COALESCE(r.recent_count, 0) < p.prior_count * 0.5`,
      [accountId],
    );

    for (const row of churnResult.rows) {
      const existing = await pool.query(
        `SELECT id FROM recommendations
         WHERE user_id = $1 AND type = 'churn_risk'
           AND status = 'pending'
           AND context->>'customer_id' = $2`,
        [userId, row.customer_id],
      );
      if (existing.rows.length > 0) continue;

      const declinePct = parseFloat(row.decline_pct);

      await pool.query(
        `INSERT INTO recommendations (user_id, type, title, description, severity, action_type, action_payload, context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          "churn_risk",
          `${row.customer_id} usage down ${declinePct}% — churn risk`,
          `This customer went from ${row.prior_count} events to ${row.recent_count} events over the last 2 weeks. Usage is declining significantly — consider reaching out.`,
          declinePct > 75 ? "critical" : "warning",
          "view_customer",
          JSON.stringify({ customer_id: row.customer_id }),
          JSON.stringify({
            customer_id: row.customer_id,
            prior_count: parseInt(row.prior_count),
            recent_count: parseInt(row.recent_count),
            decline_pct: declinePct,
            confidence: recommendationConfidence(
              parseInt(row.prior_count),
              declinePct > 75 ? "critical" : "warning",
            ),
          }),
        ],
      );
    }
  });

  // 7. Expansion signal — customers with >50% usage growth MoM
  await runRule("expansion_signal", async () => {
    const expansionResult = await pool.query(
      `WITH recent AS (
        SELECT customer_id, COUNT(*) as recent_count
        FROM observe_events
        WHERE account_id = $1 AND timestamp > NOW() - INTERVAL '14 days'
          AND customer_id IS NOT NULL AND customer_id != 'default' AND customer_id != 'unknown'
        GROUP BY customer_id
      ),
      prior AS (
        SELECT customer_id, COUNT(*) as prior_count
        FROM observe_events
        WHERE account_id = $1 AND timestamp BETWEEN NOW() - INTERVAL '28 days' AND NOW() - INTERVAL '14 days'
          AND customer_id IS NOT NULL AND customer_id != 'default' AND customer_id != 'unknown'
        GROUP BY customer_id
      )
      SELECT r.customer_id, COALESCE(p.prior_count, 0) as prior_count, r.recent_count,
        CASE WHEN COALESCE(p.prior_count, 0) > 0
          THEN ROUND(((r.recent_count - COALESCE(p.prior_count, 0))::numeric / COALESCE(p.prior_count, 1)) * 100, 1)
          ELSE 100 END as growth_pct
      FROM recent r
      LEFT JOIN prior p ON r.customer_id = p.customer_id
      WHERE r.recent_count >= 20
        AND r.recent_count > COALESCE(p.prior_count, 0) * 1.5`,
      [accountId],
    );

    for (const row of expansionResult.rows) {
      const existing = await pool.query(
        `SELECT id FROM recommendations
         WHERE user_id = $1 AND type = 'expansion_signal'
           AND status = 'pending'
           AND context->>'customer_id' = $2`,
        [userId, row.customer_id],
      );
      if (existing.rows.length > 0) continue;

      const growthPct = parseFloat(row.growth_pct);

      await pool.query(
        `INSERT INTO recommendations (user_id, type, title, description, severity, action_type, action_payload, context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          "expansion_signal",
          `${row.customer_id} usage up ${growthPct}% — expansion opportunity`,
          `This customer went from ${row.prior_count} to ${row.recent_count} events over the last 2 weeks. Growing usage signals they may be ready for a higher tier or increased limits.`,
          "info",
          "view_customer",
          JSON.stringify({ customer_id: row.customer_id }),
          JSON.stringify({
            customer_id: row.customer_id,
            prior_count: parseInt(row.prior_count),
            recent_count: parseInt(row.recent_count),
            growth_pct: growthPct,
            confidence: recommendationConfidence(
              parseInt(row.recent_count),
              "info",
            ),
          }),
        ],
      );
    }
  });

  // 8. Cost anomaly — features with cost spike > 3x their 7-day average
  await runRule("cost_anomaly", async () => {
    const anomalyResult = await pool.query(
      `WITH daily_costs AS (
        SELECT feature_key,
          DATE(timestamp) as day,
          SUM(cost_amount) as daily_cost
        FROM observe_events
        WHERE account_id = $1 AND timestamp > NOW() - INTERVAL '7 days'
          AND feature_key IS NOT NULL AND feature_key != 'unknown'
          AND cost_amount > 0
        GROUP BY feature_key, DATE(timestamp)
      ),
      averages AS (
        SELECT feature_key,
          AVG(daily_cost) as avg_daily_cost,
          MAX(daily_cost) as max_daily_cost
        FROM daily_costs
        GROUP BY feature_key
        HAVING COUNT(*) >= 3
      )
      SELECT feature_key, avg_daily_cost, max_daily_cost,
        ROUND((max_daily_cost / NULLIF(avg_daily_cost, 0))::numeric, 1) as spike_ratio
      FROM averages
      WHERE max_daily_cost > avg_daily_cost * 3 AND avg_daily_cost > 0.5`,
      [accountId],
    );

    for (const row of anomalyResult.rows) {
      const existing = await pool.query(
        `SELECT id FROM recommendations
         WHERE user_id = $1 AND type = 'cost_anomaly'
           AND status = 'pending'
           AND context->>'feature_key' = $2`,
        [userId, row.feature_key],
      );
      if (existing.rows.length > 0) continue;

      const avgCost = parseFloat(row.avg_daily_cost);
      const maxCost = parseFloat(row.max_daily_cost);
      const spikeRatio = parseFloat(row.spike_ratio);

      await pool.query(
        `INSERT INTO recommendations (user_id, type, title, description, severity, action_type, action_payload, context)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          "cost_anomaly",
          `"${row.feature_key}" cost spiked ${spikeRatio}x above average`,
          `This feature's daily cost hit $${maxCost.toFixed(2)} vs the 7-day average of $${avgCost.toFixed(2)}. Investigate if this is a legitimate usage increase or an anomaly.`,
          spikeRatio > 5 ? "critical" : "warning",
          "create_alert",
          JSON.stringify({
            metric: "daily_cost",
            feature_key: row.feature_key,
            threshold: avgCost * 2,
          }),
          JSON.stringify({
            feature_key: row.feature_key,
            avg_daily_cost: avgCost,
            max_daily_cost: maxCost,
            spike_ratio: spikeRatio,
            // 7 days of daily costs is the sample signal here, not event count.
            confidence: recommendationConfidence(
              7,
              spikeRatio > 5 ? "critical" : "warning",
            ),
          }),
        ],
      );
    }
  });
}

// ── Route factory ────────────────────────────────────────────────────────────

export function createRecommendationsRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  // GET /recommendations — list pending + recently applied/dismissed
  router.get(
    "/recommendations",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const status = (req.query.status as string) || "pending";
        const result = await pool.query(
          `SELECT * FROM recommendations
           WHERE user_id = $1 AND status = $2
           ORDER BY
             CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 ELSE 3 END,
             created_at DESC
           LIMIT 50`,
          [req.visitorId, status],
        );
        res.json({ recommendations: result.rows });
      } catch (error) {
        console.error("GET /recommendations error:", error);
        res.status(500).json({ error: "Failed to list recommendations" });
      }
    },
  );

  // GET /recommendations/count — pending count for badge
  router.get(
    "/recommendations/count",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          "SELECT COUNT(*) as count FROM recommendations WHERE user_id = $1 AND status = 'pending'",
          [req.visitorId],
        );
        res.json({ count: parseInt(result.rows[0].count) });
      } catch (error) {
        console.error("GET /recommendations/count error:", error);
        res.status(500).json({ error: "Failed to count recommendations" });
      }
    },
  );

  // POST /recommendations/compute — manually trigger recommendation computation
  router.post(
    "/recommendations/compute",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        await computeRecommendations(pool, req.visitorId!);
        const result = await pool.query(
          "SELECT COUNT(*) as count FROM recommendations WHERE user_id = $1 AND status = 'pending'",
          [req.visitorId],
        );
        res.json({
          computed: true,
          pending_count: parseInt(result.rows[0].count),
        });
      } catch (error) {
        console.error("POST /recommendations/compute error:", error);
        res.status(500).json({ error: "Failed to compute recommendations" });
      }
    },
  );

  // POST /recommendations/:id/apply — execute the action_payload
  router.post(
    "/recommendations/:id/apply",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const rec = await pool.query(
          "SELECT * FROM recommendations WHERE id = $1 AND user_id = $2 AND status = 'pending'",
          [req.params.id, req.visitorId],
        );
        if (rec.rows.length === 0) {
          return res
            .status(404)
            .json({ error: "Recommendation not found or already actioned" });
        }

        const recommendation = rec.rows[0] as Recommendation;

        // Execute action based on type
        let actionResult: Record<string, unknown> = {};
        switch (recommendation.action_type) {
          case "create_routing_rule": {
            // Find user's default config, create rule
            const configResult = await pool.query(
              "SELECT id FROM routing_configs WHERE account_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1",
              [req.accountId],
            );
            if (configResult.rows.length > 0) {
              const configId = configResult.rows[0].id;
              const payload = recommendation.action_payload as {
                field: string;
                operator: string;
                value: string;
                target_id?: number;
              };
              const ruleResult = await pool.query(
                "INSERT INTO routing_rules (config_id, field, operator, value, target_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
                [
                  configId,
                  payload.field,
                  payload.operator,
                  payload.value,
                  payload.target_id || null,
                ],
              );
              actionResult = {
                config_id: configId,
                rule_id: ruleResult.rows[0].id,
              };
            } else {
              actionResult = {
                error: "No active routing config found. Create one first.",
              };
            }
            break;
          }
          case "update_routing_target": {
            // Find the first active target using the current model and swap
            // it to the suggested model. Conservative: only updates one
            // target per apply so users can review before cascading.
            const payload = recommendation.action_payload as {
              current_model: string;
              suggested_model: string;
              suggested_provider: string;
            };
            const targetResult = await pool.query(
              `SELECT rt.id, rt.config_id, rc.name as config_name
               FROM routing_targets rt
               JOIN routing_configs rc ON rc.id = rt.config_id
               WHERE rc.account_id = $1
                 AND rt.model = $2
                 AND rt.enabled = true
                 AND rc.is_active = true
               ORDER BY rt.created_at ASC
               LIMIT 1`,
              [req.accountId, payload.current_model],
            );
            if (targetResult.rows.length === 0) {
              actionResult = {
                error: `No active routing target found with model '${payload.current_model}'. Create a routing config first, or apply manually.`,
              };
            } else {
              const {
                id: targetId,
                config_id: configId,
                config_name: configName,
              } = targetResult.rows[0];
              await pool.query(
                `UPDATE routing_targets
                 SET model = $1, provider = $2
                 WHERE id = $3`,
                [payload.suggested_model, payload.suggested_provider, targetId],
              );
              actionResult = {
                target_id: targetId,
                config_id: configId,
                config_name: configName,
                updated_from: payload.current_model,
                updated_to: payload.suggested_model,
              };
            }
            break;
          }
          case "create_routing_config": {
            actionResult = {
              note: "Navigate to /routing to create a config with fallback providers",
            };
            break;
          }
          default:
            actionResult = {
              note: "Action type not auto-executable. Apply manually.",
            };
        }

        await pool.query(
          "UPDATE recommendations SET status = 'applied', applied_at = NOW() WHERE id = $1",
          [req.params.id],
        );

        res.json({ applied: true, action_result: actionResult });
      } catch (error) {
        console.error("POST /recommendations/:id/apply error:", error);
        res.status(500).json({ error: "Failed to apply recommendation" });
      }
    },
  );

  // POST /recommendations/:id/dismiss
  router.post(
    "/recommendations/:id/dismiss",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          "UPDATE recommendations SET status = 'dismissed', dismissed_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id",
          [req.params.id, req.visitorId],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Recommendation not found" });
        }
        res.json({ dismissed: true });
      } catch (error) {
        console.error("POST /recommendations/:id/dismiss error:", error);
        res.status(500).json({ error: "Failed to dismiss recommendation" });
      }
    },
  );

  return router;
}
