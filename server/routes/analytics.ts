import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";
import { getAllPricing } from "../model-pricing.js";

function inferModelProvider(model: string | undefined): string | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.startsWith("claude-")) return "anthropic";
  if (
    m.startsWith("gpt-") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4") ||
    m.startsWith("text-embedding-")
  )
    return "openai";
  if (m.startsWith("dall-e-")) return "openai";
  if (m.startsWith("gemini-")) return "google";
  if (m.startsWith("mistral-") || m.startsWith("codestral")) return "mistral";
  if (m.startsWith("llama-")) return "meta";
  return null;
}

export function createAnalyticsRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  // GET /analytics/customer-pnl — per-customer profit & loss, sorted by margin ascending (worst first)
  router.get(
    "/analytics/customer-pnl",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.visitorId!;

        const result = await pool.query(
          `SELECT oe.customer_id,
                COALESCE(c.name, oe.customer_id) as customer_name,
                COUNT(*) as event_count,
                COALESCE(SUM(oe.revenue_amount), 0) as total_revenue,
                COALESCE(SUM(oe.cost_amount), 0) as total_cost
         FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1 AND oe.customer_id IS NOT NULL
         GROUP BY oe.customer_id, c.name
         ORDER BY total_revenue - total_cost ASC`,
          [userId],
        );

        const subResult = await pool.query(
          `SELECT s.customer_id, COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as sub_revenue
         FROM subscriptions s
         LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id
         WHERE s.user_id = $1 AND s.is_active = true
         GROUP BY s.customer_id`,
          [userId],
        );
        const subRevenueMap: Record<string, number> = {};
        for (const row of subResult.rows) {
          subRevenueMap[row.customer_id] = parseFloat(row.sub_revenue) || 0;
        }

        const topFeatureResult = await pool.query(
          `SELECT DISTINCT ON (customer_id) customer_id, feature_key, SUM(cost_amount) as feat_cost
         FROM observe_events
         WHERE user_id = $1 AND customer_id IS NOT NULL AND feature_key IS NOT NULL
         GROUP BY customer_id, feature_key
         ORDER BY customer_id, feat_cost DESC`,
          [userId],
        );
        const topFeatureMap: Record<string, string> = {};
        for (const row of topFeatureResult.rows) {
          topFeatureMap[row.customer_id] = row.feature_key;
        }

        const customers = result.rows.map((row) => {
          const eventRevenue = parseFloat(row.total_revenue) || 0;
          const subRevenue = subRevenueMap[row.customer_id] || 0;
          const totalRevenue = eventRevenue + subRevenue;
          const totalCost = parseFloat(row.total_cost) || 0;
          const marginPct =
            totalRevenue > 0
              ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100)
              : totalCost > 0
                ? -100
                : null;

          return {
            customer_id: row.customer_id,
            customer_name: row.customer_name,
            total_revenue: totalRevenue,
            total_cost: totalCost,
            margin_pct: marginPct,
            event_count: parseInt(row.event_count),
            unprofitable: marginPct !== null && marginPct < 0,
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
        const userId = req.visitorId!;
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
                COALESCE(SUM(oe.revenue_amount), 0) as total_revenue,
                COALESCE(SUM(oe.cost_amount), 0) as total_cost
         FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1 AND oe.customer_id IS NOT NULL
         GROUP BY oe.customer_id, c.name
         HAVING COALESCE(SUM(oe.cost_amount), 0) > COALESCE(SUM(oe.revenue_amount), 0)`,
          [userId],
        );
        for (const row of custResult.rows) {
          const rev = parseFloat(row.total_revenue) || 0;
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
         WHERE user_id = $1 AND feature_key IS NOT NULL
         GROUP BY feature_key
         HAVING COALESCE(SUM(cost_amount), 0) > COALESCE(SUM(revenue_amount), 0)`,
          [userId],
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
         WHERE user_id = $1 AND model IS NOT NULL AND timestamp >= NOW() - INTERVAL '60 days'
         GROUP BY model
         HAVING COALESCE(SUM(CASE WHEN timestamp >= NOW() - INTERVAL '60 days' AND timestamp < NOW() - INTERVAL '30 days' THEN cost_amount ELSE 0 END), 0) > 0`,
          [userId],
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
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1 AND oe.customer_id IS NOT NULL
         GROUP BY oe.customer_id, c.name`,
          [userId],
        );
        const subRevMap: Record<string, number> = {};
        const subRows = await pool.query(
          `SELECT s.customer_id, COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as sub_revenue
         FROM subscriptions s
         LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id
         WHERE s.user_id = $1 AND s.is_active = true
         GROUP BY s.customer_id`,
          [userId],
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

  // GET /recommendations/model-swap — find cheaper model alternatives per feature
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
         WHERE user_id = $1
           AND model IS NOT NULL
           AND cost_amount > 0
           AND timestamp > NOW() - MAKE_INTERVAL(days => $2)
         GROUP BY feature_key, model, model_provider
         ORDER BY total_cost DESC`,
          [req.visitorId, days],
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

  // GET /recommendations/underwater-customers — customers where cost > revenue
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
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1
           AND oe.timestamp > NOW() - MAKE_INTERVAL(days => $2)
         GROUP BY oe.customer_id, c.name
         HAVING SUM(oe.cost_amount) > SUM(oe.revenue_amount)
         ORDER BY (SUM(oe.cost_amount) - SUM(oe.revenue_amount)) DESC`,
          [req.visitorId, days],
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
              : -100,
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

  // GET /simulations/opportunities — auto-detect pricing issues
  router.get(
    "/simulations/opportunities",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT feature_key,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COUNT(*) as event_count
         FROM observe_events
         WHERE user_id = $1 AND feature_key IS NOT NULL
         GROUP BY feature_key`,
          [req.visitorId],
        );

        const opportunities: Array<{
          id: string;
          title: string;
          description: string;
          severity: string;
          suggested_action: string;
          feature_key?: string;
          estimated_impact?: string;
        }> = [];

        let idx = 0;
        for (const row of result.rows) {
          const cost = parseFloat(row.total_cost) || 0;
          const revenue = parseFloat(row.total_revenue) || 0;
          const margin =
            revenue > 0 ? ((revenue - cost) / revenue) * 100 : -100;

          if (margin < 0) {
            idx++;
            opportunities.push({
              id: `opp-${idx}`,
              title: `Negative margin on ${row.feature_key}`,
              description: `Feature "${row.feature_key}" is losing money: margin is ${Math.round(margin)}%. Cost ($${cost.toFixed(2)}) exceeds revenue ($${revenue.toFixed(2)}).`,
              severity: "critical",
              suggested_action: `Increase pricing for ${row.feature_key} or reduce cost by switching models.`,
              feature_key: row.feature_key,
              estimated_impact: `$${(cost - revenue).toFixed(2)} loss`,
            });
          } else if (margin < 20) {
            idx++;
            opportunities.push({
              id: `opp-${idx}`,
              title: `Low margin on ${row.feature_key}`,
              description: `Feature "${row.feature_key}" has only ${Math.round(margin)}% margin. Consider adjusting pricing to improve sustainability.`,
              severity: "warning",
              suggested_action: `Increase pricing for ${row.feature_key} by at least ${Math.round(20 - margin)}% to reach 20% margin.`,
              feature_key: row.feature_key,
              estimated_impact: `+$${((revenue * 0.2) / (1 - 0.2) - revenue + revenue - cost).toFixed(2)} potential improvement`,
            });
          }
        }

        res.json(opportunities);
      } catch (error) {
        console.error("Get opportunities error:", error);
        res.status(500).json({ error: "Failed to get opportunities" });
      }
    },
  );

  // POST /simulations/suggest — AI-generated simulation scenarios based on user data
  router.post(
    "/simulations/suggest",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const [featureRes, customerRes] = await Promise.all([
          pool.query(
            `SELECT feature_key,
             COUNT(*) as event_count,
             COALESCE(SUM(cost_amount), 0) as total_cost,
             COALESCE(SUM(revenue_amount), 0) as total_revenue,
             COALESCE(SUM(usage_units), 0) as total_usage
           FROM observe_events WHERE user_id = $1 AND feature_key IS NOT NULL
           GROUP BY feature_key ORDER BY total_cost DESC`,
            [req.visitorId],
          ),
          pool.query(
            `SELECT oe.customer_id, c.name as customer_name, c.segment,
             COALESCE(SUM(oe.cost_amount), 0) as total_cost,
             COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
           FROM observe_events oe
           LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
           WHERE oe.user_id = $1
           GROUP BY oe.customer_id, c.name, c.segment ORDER BY total_revenue DESC LIMIT 10`,
            [req.visitorId],
          ),
        ]);

        if (featureRes.rows.length === 0) {
          return res.status(400).json({
            error:
              "No data available to suggest simulations. Add events first.",
          });
        }

        const featureLines = featureRes.rows
          .map((r: Record<string, string>) => {
            const cost = parseFloat(r.total_cost) || 0;
            const revenue = parseFloat(r.total_revenue) || 0;
            const margin =
              revenue > 0
                ? Math.round(((revenue - cost) / revenue) * 100)
                : -100;
            return `- ${r.feature_key}: cost=$${cost.toFixed(2)}, revenue=$${revenue.toFixed(2)}, margin=${margin}%, ${r.event_count} events`;
          })
          .join("\n");

        const customerLines = customerRes.rows
          .map((r: Record<string, string>) => {
            const cost = parseFloat(r.total_cost) || 0;
            const revenue = parseFloat(r.total_revenue) || 0;
            return `- ${r.customer_name || r.customer_id || "Unknown"} (${r.segment || "unknown"}): cost=$${cost.toFixed(2)}, revenue=$${revenue.toFixed(2)}`;
          })
          .join("\n");

        const featureKeys = featureRes.rows.map(
          (r: Record<string, string>) => r.feature_key,
        );

        const prompt = `You are an AI SaaS pricing strategist. Based on the data below, suggest a simulation with 2-3 scenarios the user can run to optimize their pricing.

Feature Data:
${featureLines}

Customer Data:
${customerLines}

Available feature_keys: ${JSON.stringify(featureKeys)}

Return a JSON object with these fields:
- name: a short simulation name (e.g. "Margin Recovery Q1")
- rationale: 1-2 sentences explaining WHY these scenarios make sense given the data
- scenarios: array of 2-3 scenarios, each with:
  - name: short scenario name (e.g. "Conservative +10%")
  - description: 1 sentence explaining this scenario's strategy
  - changes: array of pricing changes, each with:
    - feature_key: must be one of the available feature_keys listed above
    - change_type: one of "percentage_increase", "percentage_decrease", "flat_increase", "flat_decrease", "new_price"
    - change_value: a positive number

Design scenarios that represent different risk levels:
1. A conservative/safe option (small adjustments)
2. A moderate option (meaningful changes)
3. An aggressive option (bigger bets for higher margin)

Focus on features with poor margins or high cost. Be specific with numbers.
Return ONLY the JSON object, no markdown or explanation.`;

        const openaiKey = process.env.OPENAI_API_KEY;
        let suggestion: {
          name: string;
          rationale: string;
          scenarios: Array<{
            name: string;
            description: string;
            changes: Array<{
              feature_key: string;
              change_type: string;
              change_value: number;
            }>;
          }>;
        };

        if (openaiKey) {
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
                messages: [{ role: "user", content: prompt }],
                temperature: 0.4,
                max_tokens: 1500,
              }),
            },
          );

          if (!openaiResponse.ok) {
            const errBody = await openaiResponse.text();
            console.error("OpenAI API error (suggest):", errBody);
            return res.status(502).json({
              error: "AI service unavailable. Check your OpenAI API key.",
            });
          }

          const completion = (await openaiResponse.json()) as {
            choices: Array<{ message: { content: string } }>;
          };
          const content = completion.choices[0]?.message?.content || "{}";

          try {
            const cleaned = content
              .replace(/^```json?\n?/i, "")
              .replace(/\n?```$/i, "")
              .trim();
            const parsed = JSON.parse(cleaned);
            suggestion = parsed.suggestion || parsed;
            if (
              !suggestion.name ||
              !suggestion.rationale ||
              !Array.isArray(suggestion.scenarios)
            ) {
              throw new Error("AI response missing required fields");
            }
          } catch {
            console.error(
              "Failed to parse OpenAI suggestion response:",
              content,
            );
            return res
              .status(502)
              .json({ error: "AI returned invalid response. Try again." });
          }
        } else {
          const scenarios: typeof suggestion.scenarios = [];

          const features = featureRes.rows
            .map((r: Record<string, string>) => {
              const cost = parseFloat(r.total_cost) || 0;
              const revenue = parseFloat(r.total_revenue) || 0;
              const margin =
                revenue > 0 ? ((revenue - cost) / revenue) * 100 : -100;
              return { key: r.feature_key, cost, revenue, margin };
            })
            .sort((a, b) => a.margin - b.margin);

          const worstFeatures = features
            .filter((f) => f.margin < 50)
            .slice(0, 3);
          if (worstFeatures.length === 0) worstFeatures.push(features[0]);

          scenarios.push({
            name: "Conservative (+10%)",
            description:
              "Small price increases on underperforming features to improve margins safely.",
            changes: worstFeatures.map((f) => ({
              feature_key: f.key,
              change_type: "percentage_increase",
              change_value: 10,
            })),
          });

          scenarios.push({
            name: "Moderate (+20%)",
            description:
              "Meaningful price adjustments targeting features with the worst margins.",
            changes: worstFeatures.map((f) => ({
              feature_key: f.key,
              change_type: "percentage_increase",
              change_value: 20,
            })),
          });

          scenarios.push({
            name: "Aggressive (+35%)",
            description:
              "Bold repricing to reach healthy margins, may increase churn risk.",
            changes: worstFeatures.map((f) => ({
              feature_key: f.key,
              change_type: "percentage_increase",
              change_value: 35,
            })),
          });

          const worstNames = worstFeatures.map((f) => f.key).join(", ");
          suggestion = {
            name: "Margin Optimization",
            rationale: `Features with the lowest margins (${worstNames}) are candidates for price increases. These three scenarios let you compare conservative vs aggressive approaches.`,
            scenarios,
          };
        }

        const validKeys = new Set(featureKeys);
        for (const scenario of suggestion.scenarios) {
          scenario.changes = scenario.changes.filter((c) =>
            validKeys.has(c.feature_key),
          );
        }
        suggestion.scenarios = suggestion.scenarios.filter(
          (s) => s.changes.length > 0,
        );

        if (suggestion.scenarios.length === 0) {
          return res.status(400).json({
            error: "Could not generate valid scenarios from your data.",
          });
        }

        res.json(suggestion);
      } catch (error) {
        console.error("Suggest simulation error:", error);
        res
          .status(500)
          .json({ error: "Failed to generate simulation suggestion" });
      }
    },
  );

  // GET /simulations — list all simulations
  router.get(
    "/simulations",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          "SELECT * FROM simulations WHERE user_id = $1 ORDER BY created_at DESC",
          [req.visitorId],
        );
        res.json(
          result.rows.map((row: Record<string, unknown>) => ({
            ...row,
            scenarios: row.scenarios || [],
            customer_impacts: row.customer_impacts || [],
            feature_analysis: row.feature_analysis || [],
          })),
        );
      } catch (error) {
        console.error("List simulations error:", error);
        res.status(500).json({ error: "Failed to list simulations" });
      }
    },
  );

  // POST /simulations — create a new simulation
  router.post(
    "/simulations",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const visitorId = req.visitorId!;

      try {
        const { name, scenarios, time_range } = req.body;
        if (!name) {
          return res.status(400).json({ error: "Name is required" });
        }

        const result = await pool.query(
          `INSERT INTO simulations (user_id, name, scenarios, time_range, status)
         VALUES ($1, $2, $3, $4, 'draft')
         RETURNING *`,
          [
            visitorId,
            name,
            JSON.stringify(scenarios || []),
            time_range ? JSON.stringify(time_range) : null,
          ],
        );

        const row = result.rows[0];

        res.json({
          ...row,
          scenarios: row.scenarios || [],
          customer_impacts: row.customer_impacts || [],
          feature_analysis: row.feature_analysis || [],
        });
      } catch (error) {
        console.error("Create simulation error:", error);
        res.status(500).json({ error: "Failed to create simulation" });
      }
    },
  );

  // GET /simulations/:id — get a single simulation
  router.get(
    "/simulations/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { id } = req.params;
        const result = await pool.query(
          "SELECT * FROM simulations WHERE id = $1 AND user_id = $2",
          [id, req.visitorId],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Simulation not found" });
        }
        const row = result.rows[0];
        res.json({
          ...row,
          scenarios: row.scenarios || [],
          customer_impacts: row.customer_impacts || [],
          feature_analysis: row.feature_analysis || [],
        });
      } catch (error) {
        console.error("Get simulation error:", error);
        res.status(500).json({ error: "Failed to get simulation" });
      }
    },
  );

  // PUT /simulations/:id — update a simulation (including running it)
  router.put(
    "/simulations/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        const { id } = req.params;
        const updates = req.body;

        const existing = await client.query(
          "SELECT * FROM simulations WHERE id = $1 AND user_id = $2",
          [id, req.visitorId],
        );
        if (existing.rows.length === 0) {
          return res.status(404).json({ error: "Simulation not found" });
        }

        const sim = existing.rows[0];

        if (updates.status === "running") {
          await client.query("BEGIN");

          await client.query(
            "UPDATE simulations SET status = 'running', updated_at = NOW() WHERE id = $1",
            [id],
          );

          const scenarios = updates.scenarios || sim.scenarios || [];

          const featureResult = await client.query(
            `SELECT feature_key,
             COALESCE(SUM(cost_amount), 0) as total_cost,
             COALESCE(SUM(revenue_amount), 0) as total_revenue,
             COALESCE(SUM(usage_units), 0) as total_usage,
             COUNT(*) as event_count
           FROM observe_events
           WHERE user_id = $1 AND feature_key IS NOT NULL
           GROUP BY feature_key`,
            [req.visitorId],
          );

          const customerResult = await client.query(
            `SELECT oe.customer_id, c.name as customer_name, c.segment,
             COALESCE(SUM(oe.cost_amount), 0) as total_cost,
             COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
           FROM observe_events oe
           LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
           WHERE oe.user_id = $1
           GROUP BY oe.customer_id, c.name, c.segment`,
            [req.visitorId],
          );

          const featureMap = new Map<
            string,
            { cost: number; revenue: number; usage: number }
          >();
          for (const row of featureResult.rows) {
            featureMap.set(row.feature_key, {
              cost: parseFloat(row.total_cost) || 0,
              revenue: parseFloat(row.total_revenue) || 0,
              usage: parseFloat(row.total_usage) || 0,
            });
          }

          function computeScenarioProjections(
            changes: Array<{
              feature_key: string;
              change_type: string;
              change_value: number;
            }>,
          ) {
            const projections = new Map<string, number>();
            for (const [key, data] of featureMap.entries()) {
              let projectedRevenue = data.revenue;
              const change = changes.find((c) => c.feature_key === key);
              if (change) {
                switch (change.change_type) {
                  case "percentage_increase":
                    projectedRevenue =
                      data.revenue * (1 + change.change_value / 100);
                    break;
                  case "percentage_decrease":
                    projectedRevenue =
                      data.revenue * (1 - change.change_value / 100);
                    break;
                  case "flat_increase":
                    projectedRevenue = data.revenue + change.change_value;
                    break;
                  case "flat_decrease":
                    projectedRevenue = data.revenue - change.change_value;
                    break;
                  case "new_price":
                    projectedRevenue = change.change_value * (data.usage || 1);
                    break;
                }
              }
              projections.set(key, projectedRevenue);
            }
            return projections;
          }

          const totalCurrentRevenue = Array.from(featureMap.values()).reduce(
            (s, d) => s + d.revenue,
            0,
          );
          const totalCost = Array.from(featureMap.values()).reduce(
            (s, d) => s + d.cost,
            0,
          );
          const currentMarginPct =
            totalCurrentRevenue > 0
              ? Math.round(
                  ((totalCurrentRevenue - totalCost) / totalCurrentRevenue) *
                    100,
                )
              : 0;

          const updatedScenarios = scenarios.map(
            (s: Record<string, unknown>) => {
              const changes =
                (s.changes as Array<{
                  feature_key: string;
                  change_type: string;
                  change_value: number;
                }>) || [];
              const projections = computeScenarioProjections(changes);
              const scenarioRevenue = Array.from(projections.values()).reduce(
                (sum, v) => sum + v,
                0,
              );
              const scenarioMarginPct =
                scenarioRevenue > 0
                  ? Math.round(
                      ((scenarioRevenue - totalCost) / scenarioRevenue) * 100,
                    )
                  : 0;
              return {
                ...s,
                projected_revenue: scenarioRevenue,
                projected_cost: totalCost,
                projected_margin_pct: scenarioMarginPct,
              };
            },
          );

          let bestScenario = updatedScenarios[0];
          for (const s of updatedScenarios) {
            if (
              (s.projected_margin_pct || 0) >
              (bestScenario.projected_margin_pct || 0)
            ) {
              bestScenario = s;
            }
          }

          const bestChanges =
            (bestScenario.changes as Array<{
              feature_key: string;
              change_type: string;
              change_value: number;
            }>) || [];
          const featureProjections = computeScenarioProjections(bestChanges);
          const totalProjectedRevenue = Array.from(
            featureProjections.values(),
          ).reduce((s, v) => s + v, 0);
          const projectedMarginPct =
            totalProjectedRevenue > 0
              ? Math.round(
                  ((totalProjectedRevenue - totalCost) /
                    totalProjectedRevenue) *
                    100,
                )
              : 0;

          const featureAnalysis = Array.from(featureMap.entries()).map(
            ([key, data]) => {
              const projectedRevenue =
                featureProjections.get(key) || data.revenue;
              const currentMargin =
                data.revenue > 0
                  ? Math.round(
                      ((data.revenue - data.cost) / data.revenue) * 100,
                    )
                  : 0;
              const projectedMargin =
                projectedRevenue > 0
                  ? Math.round(
                      ((projectedRevenue - data.cost) / projectedRevenue) * 100,
                    )
                  : 0;
              return {
                feature_key: key,
                current_cost: data.cost,
                current_revenue: data.revenue,
                current_margin_pct: currentMargin,
                projected_revenue: projectedRevenue,
                projected_margin_pct: projectedMargin,
                margin_delta_pct: projectedMargin - currentMargin,
              };
            },
          );

          const revenueRatio =
            totalCurrentRevenue > 0
              ? totalProjectedRevenue / totalCurrentRevenue
              : 1;
          const customerImpacts = customerResult.rows.map(
            (row: Record<string, unknown>) => {
              const currentRevenue =
                parseFloat(row.total_revenue as string) || 0;
              const projectedRevenue = currentRevenue * revenueRatio;
              const delta = projectedRevenue - currentRevenue;
              const deltaPct =
                currentRevenue > 0
                  ? Math.round((delta / currentRevenue) * 100)
                  : 0;

              let churnRisk: "low" | "medium" | "high" = "low";
              if (deltaPct > 30) churnRisk = "high";
              else if (deltaPct > 15) churnRisk = "medium";
              if (delta < 0) churnRisk = "low";

              return {
                customer_id: row.customer_id as string,
                customer_name:
                  (row.customer_name as string) || (row.customer_id as string),
                current_revenue: currentRevenue,
                projected_revenue: projectedRevenue,
                revenue_delta: delta,
                revenue_delta_pct: deltaPct,
                churn_risk: churnRisk,
                segment: (row.segment as string) || undefined,
              };
            },
          );

          const marginImpact = {
            current_margin_pct: currentMarginPct,
            projected_margin_pct: projectedMarginPct,
            margin_delta_pct: projectedMarginPct - currentMarginPct,
            total_current_revenue: totalCurrentRevenue,
            total_projected_revenue: totalProjectedRevenue,
            total_cost: totalCost,
            customers_affected: customerImpacts.length,
            high_churn_risk_count: customerImpacts.filter(
              (c: { churn_risk: string }) => c.churn_risk === "high",
            ).length,
          };

          const totalEvents = featureResult.rows.reduce(
            (s: number, r: { event_count: string }) =>
              s + parseInt(r.event_count),
            0,
          );
          const confidenceScore = Math.min(
            95,
            Math.max(30, Math.round(40 + Math.log2(totalEvents + 1) * 10)),
          );

          const marginDelta = projectedMarginPct - currentMarginPct;
          const highChurnCount = customerImpacts.filter(
            (c: { churn_risk: string }) => c.churn_risk === "high",
          ).length;
          let keyInsight = "";
          if (marginDelta > 0) {
            keyInsight = `This pricing change would improve overall margin from ${currentMarginPct}% to ${projectedMarginPct}% (+${marginDelta}pp).`;
          } else if (marginDelta < 0) {
            keyInsight = `This pricing change would reduce margin from ${currentMarginPct}% to ${projectedMarginPct}% (${marginDelta}pp).`;
          } else {
            keyInsight = `This pricing change has minimal impact on overall margin (${currentMarginPct}%).`;
          }
          if (highChurnCount > 0) {
            keyInsight += ` ${highChurnCount} customer${highChurnCount > 1 ? "s" : ""} at high churn risk.`;
          }

          const winningScenarioId = (bestScenario.id as string) || null;

          await client.query(
            `UPDATE simulations SET
             status = 'completed',
             scenarios = $2,
             feature_analysis = $3,
             customer_impacts = $4,
             margin_impact = $5,
             confidence_score = $6,
             key_insight = $7,
             winning_scenario_id = $8,
             updated_at = NOW()
           WHERE id = $1`,
            [
              id,
              JSON.stringify(updatedScenarios),
              JSON.stringify(featureAnalysis),
              JSON.stringify(customerImpacts),
              JSON.stringify(marginImpact),
              confidenceScore,
              keyInsight,
              winningScenarioId,
            ],
          );

          await client.query("COMMIT");

          const updated = await client.query(
            "SELECT * FROM simulations WHERE id = $1",
            [id],
          );
          const row = updated.rows[0];
          return res.json({
            ...row,
            scenarios: row.scenarios || [],
            customer_impacts: row.customer_impacts || [],
            feature_analysis: row.feature_analysis || [],
          });
        }

        if (updates.status === "rolled_out") {
          await client.query(
            "UPDATE simulations SET status = 'rolled_out', rolled_out_at = NOW(), updated_at = NOW() WHERE id = $1",
            [id],
          );
          const updated = await client.query(
            "SELECT * FROM simulations WHERE id = $1",
            [id],
          );
          const row = updated.rows[0];
          return res.json({
            ...row,
            scenarios: row.scenarios || [],
            customer_impacts: row.customer_impacts || [],
            feature_analysis: row.feature_analysis || [],
          });
        }

        const setClauses: string[] = ["updated_at = NOW()"];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (updates.name !== undefined) {
          setClauses.push(`name = $${paramIdx++}`);
          params.push(updates.name);
        }
        if (updates.scenarios !== undefined) {
          setClauses.push(`scenarios = $${paramIdx++}`);
          params.push(JSON.stringify(updates.scenarios));
        }
        if (updates.segment_name !== undefined) {
          setClauses.push(`segment_name = $${paramIdx++}`);
          params.push(updates.segment_name);
        }
        if (updates.time_range !== undefined) {
          setClauses.push(`time_range = $${paramIdx++}`);
          params.push(JSON.stringify(updates.time_range));
        }

        params.push(id);
        await client.query(
          `UPDATE simulations SET ${setClauses.join(", ")} WHERE id = $${paramIdx}`,
          params,
        );

        const updated = await client.query(
          "SELECT * FROM simulations WHERE id = $1",
          [id],
        );
        const row = updated.rows[0];
        res.json({
          ...row,
          scenarios: row.scenarios || [],
          customer_impacts: row.customer_impacts || [],
          feature_analysis: row.feature_analysis || [],
        });
      } catch (error) {
        await client
          .query("ROLLBACK")
          .catch((err) => console.error("ROLLBACK failed:", err));
        console.error("Update simulation error:", error);
        res.status(500).json({ error: "Failed to update simulation" });
      } finally {
        client.release();
      }
    },
  );

  // DELETE /simulations/:id — delete a simulation
  router.delete(
    "/simulations/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { id } = req.params;
        const result = await pool.query(
          "DELETE FROM simulations WHERE id = $1 AND user_id = $2 RETURNING id",
          [id, req.visitorId],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Simulation not found" });
        }
        res.json({ success: true });
      } catch (error) {
        console.error("Delete simulation error:", error);
        res.status(500).json({ error: "Failed to delete simulation" });
      }
    },
  );

  return router;
}
