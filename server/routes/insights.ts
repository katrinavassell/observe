import { Router, Response } from "express";
import type { Pool } from "pg";
import rateLimit from "express-rate-limit";
import { type AuthRequest } from "./auth.js";

const ADMIN_EMAILS_LIST = (() => {
  const legacy = process.env.ADMIN_EMAIL
    ? [process.env.ADMIN_EMAIL.toLowerCase()]
    : ["tansoadmin@tansohq.com"];
  const list = process.env.ADMIN_EMAILS
    ? process.env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase())
    : [];
  return Array.from(
    new Set([...legacy, ...list, "kat@tansohq.com", "doug@tansohq.com"]),
  );
})();

function isAdminEmail(email?: string | null): boolean {
  return !!email && ADMIN_EMAILS_LIST.includes(email.toLowerCase());
}

type CheckBillingFeatureAccessFn = (
  visitorId: string,
  featureKey: string,
  email?: string,
  accountId?: number,
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

export function createInsightsRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    checkBillingFeatureAccess: CheckBillingFeatureAccessFn;
    trackBillingUsage: TrackBillingUsageFn;
    expensiveLimiter: ReturnType<typeof rateLimit>;
  },
) {
  const router = Router();

  // GET /insights — list all insights for the session
  router.get(
    "/insights",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          "SELECT * FROM ai_insights WHERE account_id = $1 ORDER BY created_at DESC",
          [req.accountId],
        );
        res.json(result.rows);
      } catch (error) {
        console.error("List insights error:", error);
        res.status(500).json({ error: "Failed to list insights" });
      }
    },
  );

  // POST /insights/generate — generate AI insights from observe_events data
  router.post(
    "/insights/generate",
    ensureVisitor,
    deps.expensiveLimiter,
    async (req: AuthRequest, res: Response) => {
      const visitorId = req.visitorId!;

      // Billing entitlement check (fail closed)
      const aiAccess = await deps.checkBillingFeatureAccess(
        visitorId,
        "ai_insights",
        req.accountEmail,
        req.accountId,
      );
      if (!aiAccess.allowed) {
        return res.status(403).json({
          error: aiAccess.reason || "AI insights limit reached",
          usage: aiAccess.usage,
          limit: aiAccess.limit,
          remaining: aiAccess.remaining,
        });
      }

      try {
        // Gather rich summary data from observe_events for pricing analysis
        const [
          featureRes,
          customerRes,
          modelRes,
          overallRes,
          featureModelRes,
          customerFeatureRes,
          trendRes,
        ] = await Promise.all([
          pool.query(
            `SELECT feature_key,
             COUNT(*) as event_count,
             COALESCE(SUM(cost_amount), 0) as total_cost,
             COALESCE(SUM(revenue_amount), 0) as total_revenue,
             COALESCE(SUM(usage_units), 0) as total_usage,
             CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(cost_amount), 0) / COUNT(*) ELSE 0 END as cost_per_call,
             CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(revenue_amount), 0) / COUNT(*) ELSE 0 END as revenue_per_call
           FROM observe_events WHERE account_id = $1 AND feature_key IS NOT NULL
           GROUP BY feature_key ORDER BY total_cost DESC`,
            [req.accountId],
          ),
          pool.query(
            `SELECT oe.customer_id, c.name as customer_name, c.segment,
             COUNT(*) as event_count,
             COALESCE(SUM(oe.cost_amount), 0) as total_cost,
             COALESCE(SUM(oe.revenue_amount), 0) as total_revenue,
             CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(oe.cost_amount), 0) / COUNT(*) ELSE 0 END as cost_per_call
           FROM observe_events oe
           LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
           WHERE oe.account_id = $1
           GROUP BY oe.customer_id, c.name, c.segment ORDER BY total_cost DESC LIMIT 15`,
            [req.accountId],
          ),
          pool.query(
            `SELECT model, model_provider,
             COUNT(*) as event_count,
             COALESCE(SUM(cost_amount), 0) as total_cost
           FROM observe_events WHERE account_id = $1 AND model IS NOT NULL
           GROUP BY model, model_provider ORDER BY total_cost DESC`,
            [req.accountId],
          ),
          pool.query(
            `SELECT
             COUNT(*) as total_events,
             COALESCE(SUM(cost_amount), 0) as total_cost,
             COALESCE(SUM(revenue_amount), 0) as total_revenue
           FROM observe_events WHERE account_id = $1`,
            [req.accountId],
          ),
          pool.query(
            `SELECT feature_key, model,
             COUNT(*) as event_count,
             COALESCE(SUM(cost_amount), 0) as total_cost,
             CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(cost_amount), 0) / COUNT(*) ELSE 0 END as cost_per_call
           FROM observe_events
           WHERE account_id = $1 AND feature_key IS NOT NULL AND model IS NOT NULL
           GROUP BY feature_key, model ORDER BY feature_key, total_cost DESC`,
            [req.accountId],
          ),
          pool.query(
            `SELECT feature_key,
             COUNT(DISTINCT customer_id) as unique_customers,
             MIN(ct.calls) as min_calls, MAX(ct.calls) as max_calls,
             AVG(ct.calls) as avg_calls, STDDEV(ct.calls) as stddev_calls
           FROM (
             SELECT feature_key, customer_id, COUNT(*) as calls
             FROM observe_events
             WHERE account_id = $1 AND feature_key IS NOT NULL
             GROUP BY feature_key, customer_id
           ) ct
           GROUP BY feature_key`,
            [req.accountId],
          ),
          pool.query(
            `SELECT DATE_TRUNC('month', timestamp) as month,
             COALESCE(SUM(cost_amount), 0) as total_cost,
             COALESCE(SUM(revenue_amount), 0) as total_revenue,
             COUNT(*) as event_count
           FROM observe_events WHERE account_id = $1
           GROUP BY month ORDER BY month DESC LIMIT 6`,
            [req.accountId],
          ),
        ]);

        if (featureRes.rows.length === 0) {
          return res.status(400).json({
            error:
              "No data available to analyze. Load sample data or import your own first.",
          });
        }

        const overall = overallRes.rows[0];
        const totalCost = parseFloat(overall.total_cost) || 0;
        const totalRevenue = parseFloat(overall.total_revenue) || 0;
        const overallMargin =
          totalRevenue > 0
            ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100)
            : 0;

        const featureSummary = featureRes.rows
          .map((r: Record<string, string>) => {
            const cost = parseFloat(r.total_cost) || 0;
            const revenue = parseFloat(r.total_revenue) || 0;
            const margin =
              revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0;
            const costPerCall = parseFloat(r.cost_per_call) || 0;
            const revenuePerCall = parseFloat(r.revenue_per_call) || 0;
            return `- ${r.feature_key}: cost=$${cost.toFixed(2)}, revenue=$${revenue.toFixed(2)}, margin=${margin}%, ${r.event_count} events, cost/call=$${costPerCall.toFixed(4)}, revenue/call=$${revenuePerCall.toFixed(4)}`;
          })
          .join("\n");

        const customerSummary = customerRes.rows
          .map((r: Record<string, string>) => {
            const cost = parseFloat(r.total_cost) || 0;
            const revenue = parseFloat(r.total_revenue) || 0;
            const margin =
              revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0;
            const costPerCall = parseFloat(r.cost_per_call) || 0;
            return `- ${r.customer_name || r.customer_id} (${r.segment || "no segment"}): cost=$${cost.toFixed(2)}, revenue=$${revenue.toFixed(2)}, margin=${margin}%, ${r.event_count} calls, cost/call=$${costPerCall.toFixed(4)}`;
          })
          .join("\n");

        const modelSummary = modelRes.rows
          .map((r: Record<string, string>) => {
            const cost = parseFloat(r.total_cost) || 0;
            return `- ${r.model} (${r.model_provider || "unknown"}): cost=$${cost.toFixed(2)}, ${r.event_count} calls`;
          })
          .join("\n");

        const featureModelSummary =
          featureModelRes.rows.length > 0
            ? featureModelRes.rows
                .map((r: Record<string, string>) => {
                  const costPerCall = parseFloat(r.cost_per_call) || 0;
                  return `- ${r.feature_key} → ${r.model}: ${r.event_count} calls, cost/call=$${costPerCall.toFixed(4)}`;
                })
                .join("\n")
            : "No model-level feature data available.";

        const usageVarianceSummary =
          customerFeatureRes.rows.length > 0
            ? customerFeatureRes.rows
                .map((r: Record<string, string>) => {
                  const min = parseInt(r.min_calls) || 0;
                  const max = parseInt(r.max_calls) || 0;
                  const avg = parseFloat(r.avg_calls) || 0;
                  const stddev = parseFloat(r.stddev_calls) || 0;
                  const ratio = min > 0 ? Math.round(max / min) : max;
                  return `- ${r.feature_key}: ${r.unique_customers} customers, calls range ${min}–${max} (${ratio}x spread), avg=${Math.round(avg)}, stddev=${Math.round(stddev)}`;
                })
                .join("\n")
            : "No per-customer usage variance data available.";

        const trendSummary =
          trendRes.rows.length > 0
            ? trendRes.rows
                .map((r: any) => {
                  const month = r.month
                    ? new Date(r.month).toISOString().slice(0, 7)
                    : "unknown";
                  const cost = parseFloat(r.total_cost) || 0;
                  const revenue = parseFloat(r.total_revenue) || 0;
                  const margin =
                    revenue > 0
                      ? Math.round(((revenue - cost) / revenue) * 100)
                      : 0;
                  return `- ${month}: cost=$${cost.toFixed(2)}, revenue=$${revenue.toFixed(2)}, margin=${margin}%, ${r.event_count} events`;
                })
                .join("\n")
            : "No trend data available.";

        // Pull historic context (CSV uploads, OpenAI/Anthropic imports)
        let historicContext = "";
        try {
          const [costRecords, usageRecords, importedEvents] = await Promise.all(
            [
              pool.query(
                `SELECT cost_type, SUM(amount)::numeric as total, COUNT(*)::int as records,
               MIN(period_start) as earliest, MAX(period_end) as latest
             FROM cost_records WHERE account_id = $1 GROUP BY cost_type`,
                [req.accountId],
              ),
              pool.query(
                `SELECT metric_name, SUM(value)::numeric as total, COUNT(*)::int as records
             FROM usage_records WHERE account_id = $1 GROUP BY metric_name`,
                [req.accountId],
              ),
              pool.query(
                `SELECT source, model, model_provider,
               COUNT(*)::int as event_count,
               COALESCE(SUM(cost_amount), 0)::numeric as total_cost,
               MIN(timestamp) as earliest, MAX(timestamp) as latest
             FROM observe_events
             WHERE account_id = $1 AND source IN ('openai', 'anthropic', 'csv') AND granularity != 'event'
             GROUP BY source, model, model_provider`,
                [req.accountId],
              ),
            ],
          );

          const parts: string[] = [];

          if (costRecords.rows.length > 0) {
            const lines = costRecords.rows.map(
              (r: any) =>
                `- ${r.cost_type}: $${parseFloat(r.total).toFixed(2)} total (${r.records} records, ${r.earliest?.toISOString().slice(0, 10)} to ${r.latest?.toISOString().slice(0, 10)})`,
            );
            parts.push(
              `Historic cost data (from CSV/imports):\n${lines.join("\n")}`,
            );
          }

          if (usageRecords.rows.length > 0) {
            const lines = usageRecords.rows.map(
              (r: any) =>
                `- ${r.metric_name}: ${parseFloat(r.total).toLocaleString()} total (${r.records} records)`,
            );
            parts.push(
              `Historic usage data (from CSV/imports):\n${lines.join("\n")}`,
            );
          }

          if (importedEvents.rows.length > 0) {
            const lines = importedEvents.rows.map(
              (r: any) =>
                `- ${r.source} import: ${r.model || "various models"} (${r.model_provider || "unknown"}), $${parseFloat(r.total_cost).toFixed(2)} cost, ${r.event_count} records, ${r.earliest?.toISOString().slice(0, 10)} to ${r.latest?.toISOString().slice(0, 10)}`,
            );
            parts.push(
              `Imported provider data (daily aggregates, no per-customer breakdown):\n${lines.join("\n")}`,
            );
          }

          if (parts.length > 0) {
            historicContext =
              "\n\nHistoric Context (use to cross-reference with SDK event data above):\n" +
              parts.join("\n\n");
          }
        } catch (err) {
          console.error("Failed to fetch historic context for insights:", err);
        }

        const prompt = `You are an AI pricing consultant for SaaS companies that build on AI models. Your client pays you to analyze their cost and usage data and tell them exactly how to price their product. Be specific, quantitative, and actionable — like a $50k/year pricing advisor, not a generic dashboard.

## Client's Data

Overall: ${parseInt(overall.total_events)} events tracked, total cost $${totalCost.toFixed(2)}, total revenue $${totalRevenue.toFixed(2)}, overall margin ${overallMargin}%

### Features (cost, revenue, and unit economics per call)
${featureSummary}

### Customers (who costs how much to serve)
${customerSummary}

### AI Models Used
${modelSummary}

### Which Models Power Which Features
${featureModelSummary}

### Usage Variance Across Customers (signals for pricing model design)
${usageVarianceSummary}

### Monthly Trend (most recent first)
${trendSummary}${historicContext}

## Your Analysis

Return exactly 4-6 insights as a JSON array. Each insight must have:
- insight_type: one of "pricing_recommendation", "usage_pricing_signal", "model_routing", "margin_alert", "customer_risk", "cost_optimization"
- title: short headline (under 60 chars)
- description: 2-3 sentences. Include specific dollar amounts, percentages, and recommended actions. For pricing recommendations, state the exact price point or range.
- severity: one of "critical", "warning", "info", "positive"
- feature_key: the relevant feature key if applicable, or null
- customer_id: the relevant customer id if applicable, or null

### What a great pricing consultant would focus on:

1. **Pricing recommendations**: For each feature with poor margins, calculate what the price per call SHOULD be to hit 50%+ margin. State it explicitly: "Charge $X per call" or "Raise price by Y%".

2. **Usage-based pricing signals**: If some customers use a feature 10x more than others but pay the same, that's a clear signal for usage-based or tiered pricing. Quantify the spread and recommend a pricing model (per-call, tiered, or overage-based).

3. **Model routing opportunities**: If an expensive model is used for a feature where a cheaper model would work, calculate the savings. Be specific: "Routing 70% of summarization calls to haiku instead of sonnet saves $X/month".

4. **Margin trajectory**: If margins are improving or degrading over time, explain why and what to do about it. If model costs dropped but prices stayed flat, the client is leaving margin on the table — or could lower prices to grow volume.

5. **Customer profitability**: Flag customers who cost more to serve than they pay. Recommend whether to reprice, upsell, or accept the loss as acquisition cost.

6. **Cross-reference historic data**: If CSV/import data shows total historic spend, estimate how much went to each feature based on current usage proportions. Flag discrepancies between historic and current patterns.

Prioritize pricing recommendations and usage-based pricing signals — those are the highest-value insights. Every insight should end with a concrete "do this" action, not just an observation.

Return ONLY the JSON array, no markdown or explanation.`;

        // Check for OpenAI API key
        const openaiKey = process.env.OPENAI_API_KEY;
        let insights: Array<{
          insight_type: string;
          title: string;
          description: string;
          severity: string;
          feature_key?: string;
          customer_id?: string;
        }>;
        let tokensUsed = 0;
        let costUsd = 0;
        let llmRequestBody: Record<string, unknown> | null = null;
        let llmResponseBody: Record<string, unknown> | null = null;

        if (openaiKey) {
          const llmRequest = {
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            max_tokens: 3000,
          };
          llmRequestBody = llmRequest;
          const openaiResponse = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${openaiKey}`,
              },
              body: JSON.stringify(llmRequest),
            },
          );

          if (!openaiResponse.ok) {
            const errBody = await openaiResponse.text();
            console.error("OpenAI API error:", errBody);
            return res.status(502).json({
              error: "AI service unavailable. Check your OpenAI API key.",
            });
          }

          const completion = (await openaiResponse.json()) as {
            choices: Array<{ message: { content: string } }>;
            usage?: { total_tokens: number };
          };
          llmResponseBody = completion as Record<string, unknown>;
          const content = completion.choices[0]?.message?.content || "[]";
          tokensUsed = completion.usage?.total_tokens || 0;
          const promptTokens =
            (completion.usage as Record<string, number>)?.prompt_tokens || 0;
          const completionTokens =
            (completion.usage as Record<string, number>)?.completion_tokens ||
            0;
          costUsd = promptTokens * 0.0000025 + completionTokens * 0.00001;

          try {
            const cleaned = content
              .replace(/^```json?\n?/i, "")
              .replace(/\n?```$/i, "")
              .trim();
            let parsed = JSON.parse(cleaned);
            if (
              !Array.isArray(parsed) &&
              parsed.insights &&
              Array.isArray(parsed.insights)
            ) {
              parsed = parsed.insights;
            }
            if (!Array.isArray(parsed)) {
              throw new Error("Expected JSON array from AI");
            }
            insights = parsed;
          } catch {
            console.error("Failed to parse OpenAI response:", content);
            return res
              .status(502)
              .json({ error: "AI returned invalid response. Try again." });
          }
        } else {
          // Fallback: generate consultant-grade insights locally without OpenAI
          insights = [];

          // 1. Pricing recommendations for features with poor margins
          for (const row of featureRes.rows) {
            const cost = parseFloat(row.total_cost) || 0;
            const revenue = parseFloat(row.total_revenue) || 0;
            const margin =
              revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0;
            const costPerCall = parseFloat(row.cost_per_call) || 0;
            const revenuePerCall = parseFloat(row.revenue_per_call) || 0;
            const events = parseInt(row.event_count) || 0;
            const targetRevenuePerCall = costPerCall / 0.5; // 50% margin target

            if (margin < 0) {
              const lostPerPeriod = (cost - revenue).toFixed(2);
              insights.push({
                insight_type: "pricing_recommendation",
                title: `${row.feature_key} is losing you $${lostPerPeriod} every period`,
                description: `You pay $${costPerCall.toFixed(4)}/call to run this but charge $${revenuePerCall.toFixed(4)} (${margin}% margin). That's negative unit economics on ${events.toLocaleString()} calls. Price at $${targetRevenuePerCall.toFixed(4)}/call for 50% margin — or decide this is an acquisition feature and cap usage.`,
                severity: "critical",
                feature_key: row.feature_key,
              });
            } else if (margin < 30) {
              const gapPercent = Math.round(
                ((targetRevenuePerCall - revenuePerCall) /
                  (revenuePerCall || 0.0001)) *
                  100,
              );
              insights.push({
                insight_type: "pricing_recommendation",
                title: `${row.feature_key} is underpriced by ${gapPercent}%`,
                description: `At $${costPerCall.toFixed(4)} cost and $${revenuePerCall.toFixed(4)} revenue per call, you're leaving margin on the table. A ${gapPercent}% price increase to $${targetRevenuePerCall.toFixed(4)}/call gets you to 50% margin. At ${events.toLocaleString()} calls, that's $${((targetRevenuePerCall - revenuePerCall) * events).toFixed(2)} recovered.`,
                severity: "warning",
                feature_key: row.feature_key,
              });
            }
          }

          // 2. Usage-based pricing signals from customer variance
          for (const row of customerFeatureRes.rows) {
            const min = parseInt(row.min_calls) || 0;
            const max = parseInt(row.max_calls) || 0;
            const customers = parseInt(row.unique_customers) || 0;
            const ratio = min > 0 ? Math.round(max / min) : max;

            if (ratio >= 5 && customers >= 2) {
              insights.push({
                insight_type: "usage_pricing_signal",
                title: `${row.feature_key}: one customer uses ${ratio}x more than another — same price`,
                description: `Heaviest user makes ${max.toLocaleString()} calls, lightest makes ${min.toLocaleString()} (${ratio}x gap across ${customers} customers). Flat-rate pricing here means you're subsidizing power users. This is a usage-based pricing signal — charge per call or add overage tiers.`,
                severity: "warning",
                feature_key: row.feature_key,
              });
            }
          }

          // 3. Model routing opportunities
          const featureModels: Record<
            string,
            Array<{
              model: string;
              cost_per_call: number;
              event_count: number;
              total_cost: number;
            }>
          > = {};
          for (const row of featureModelRes.rows) {
            const key = row.feature_key;
            if (!featureModels[key]) featureModels[key] = [];
            featureModels[key].push({
              model: row.model,
              cost_per_call: parseFloat(row.cost_per_call) || 0,
              event_count: parseInt(row.event_count) || 0,
              total_cost: parseFloat(row.total_cost) || 0,
            });
          }
          for (const [feature, models] of Object.entries(featureModels)) {
            if (models.length >= 2) {
              const sorted = [...models].sort(
                (a, b) => b.cost_per_call - a.cost_per_call,
              );
              const expensive = sorted[0];
              const cheap = sorted[sorted.length - 1];
              if (expensive.cost_per_call > cheap.cost_per_call * 2) {
                const savingsIfRouted =
                  (expensive.cost_per_call - cheap.cost_per_call) *
                  expensive.event_count *
                  0.7;
                const multiplier = Math.round(
                  expensive.cost_per_call / (cheap.cost_per_call || 0.0001),
                );
                insights.push({
                  insight_type: "model_routing",
                  title: `${feature}: burning ${expensive.model} on tasks ${cheap.model} handles — ${multiplier}x overpay`,
                  description: `You're running ${expensive.event_count.toLocaleString()} calls on ${expensive.model} ($${expensive.cost_per_call.toFixed(4)}/call) when ${cheap.model} does it for $${cheap.cost_per_call.toFixed(4)}. Route 70% of traffic to the cheaper model and save ~$${savingsIfRouted.toFixed(2)}/period. Test quality on a sample first.`,
                  severity: "info",
                  feature_key: feature,
                });
              }
            }
          }

          // 4. Overall margin health
          if (overallMargin < 0) {
            insights.push({
              insight_type: "margin_alert",
              title: `You're losing money — overall margin is ${overallMargin}%`,
              description: `You spend $${totalCost.toFixed(2)} to earn $${totalRevenue.toFixed(2)}. Every request makes the hole deeper. This needs pricing changes, model routing, or usage caps — not incremental tweaks.`,
              severity: "critical",
            });
          } else if (overallMargin < 30) {
            insights.push({
              insight_type: "margin_alert",
              title: `Overall margin is ${overallMargin}% — you're leaving money on the table`,
              description: `AI SaaS targets 50%+ margin. At ${overallMargin}%, costs ($${totalCost.toFixed(2)}) eat too much of revenue ($${totalRevenue.toFixed(2)}). Combine pricing increases on underperforming features with model routing to close the gap.`,
              severity: "warning",
            });
          } else {
            insights.push({
              insight_type: "margin_alert",
              title: `Margins are healthy at ${overallMargin}%`,
              description: `Revenue ($${totalRevenue.toFixed(2)}) covers costs ($${totalCost.toFixed(2)}) with room to spare. You could lower prices to grow volume or hold margin and reinvest.`,
              severity: "positive",
            });
          }

          // 5. Customer profitability risk
          for (const row of customerRes.rows) {
            const cost = parseFloat(row.total_cost) || 0;
            const revenue = parseFloat(row.total_revenue) || 0;
            const margin =
              revenue > 0
                ? Math.round(((revenue - cost) / revenue) * 100)
                : -100;
            if (margin < 0 && cost > totalCost * 0.1) {
              const costPct = Math.round((cost / totalCost) * 100);
              const name = row.customer_name || row.customer_id;
              insights.push({
                insight_type: "customer_risk",
                title: `${name} costs $${cost.toFixed(2)} to serve but pays $${revenue.toFixed(2)}`,
                description: `${margin}% margin — this customer is ${costPct}% of your total cost. You had no idea. Reprice their plan, add usage caps, or decide this is acquisition cost with a deadline to convert.`,
                severity: "critical",
                customer_id: row.customer_id,
              });
            }
          }

          // 6. Margin trend
          if (trendRes.rows.length >= 2) {
            const recent = trendRes.rows[0];
            const older = trendRes.rows[trendRes.rows.length - 1];
            const recentMargin =
              parseFloat(recent.total_revenue) > 0
                ? Math.round(
                    ((parseFloat(recent.total_revenue) -
                      parseFloat(recent.total_cost)) /
                      parseFloat(recent.total_revenue)) *
                      100,
                  )
                : 0;
            const olderMargin =
              parseFloat(older.total_revenue) > 0
                ? Math.round(
                    ((parseFloat(older.total_revenue) -
                      parseFloat(older.total_cost)) /
                      parseFloat(older.total_revenue)) *
                      100,
                  )
                : 0;
            const delta = recentMargin - olderMargin;
            if (Math.abs(delta) >= 5) {
              insights.push({
                insight_type: delta > 0 ? "cost_optimization" : "margin_alert",
                title:
                  delta > 0
                    ? `Margins up ${Math.abs(delta)}pp — are you capturing it or giving it away?`
                    : `Margin dropped ${Math.abs(delta)}pp — something changed`,
                description:
                  delta > 0
                    ? `Margin went from ${olderMargin}% to ${recentMargin}%. If model costs dropped but your prices stayed flat, you're sitting on free margin. Lower prices to grow volume or pocket the difference.`
                    : `Margin fell from ${olderMargin}% to ${recentMargin}%. Check if usage shifted to more expensive models, or if one customer or feature drove the spike. This is your cost alert.`,
                severity: delta < -10 ? "warning" : "info",
              });
            }
          }

          // Prioritize: pricing recommendations first, then signals, then alerts
          const priority: Record<string, number> = {
            pricing_recommendation: 0,
            usage_pricing_signal: 1,
            model_routing: 2,
            customer_risk: 3,
            margin_alert: 4,
            cost_optimization: 5,
          };
          insights.sort(
            (a, b) =>
              (priority[a.insight_type] ?? 9) - (priority[b.insight_type] ?? 9),
          );
          insights = insights.slice(0, 6);
        }

        // Store insights
        const storedInsights: any[] = [];
        for (const insight of insights) {
          const result = await pool.query(
            `INSERT INTO ai_insights (user_id, account_id, insight_type, title, description, severity, feature_key, customer_id, tokens_used, cost_usd)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
            [
              req.visitorId,
              req.accountId ?? null,
              insight.insight_type,
              insight.title,
              insight.description,
              insight.severity || "info",
              insight.feature_key || null,
              insight.customer_id || null,
              tokensUsed,
              costUsd,
            ],
          );
          storedInsights.push(result.rows[0]);
        }

        // Log the generation as an observe_event
        await pool.query(
          `INSERT INTO observe_events
             (user_id, account_id, customer_id, feature_key, event_name, timestamp,
              cost_amount, cost_unit, usage_units, model, model_provider,
              source, granularity, request_body, response_body)
           VALUES ($1, $2, 'system', 'ai_insights', 'insight_generated', NOW(),
                   $3, 'usd', $4, 'gpt-4o', 'openai',
                   'internal', 'event', $5, $6)`,
          [
            visitorId,
            req.accountId ?? null,
            costUsd,
            tokensUsed,
            llmRequestBody ? JSON.stringify(llmRequestBody) : null,
            llmResponseBody ? JSON.stringify(llmResponseBody) : null,
          ],
        );

        // Track usage (insights are metered by counting ai_insights rows)
        deps.trackBillingUsage(visitorId, "ai_insights", "insights_generated");

        res.json({
          insights: storedInsights,
          tokens_used: tokensUsed,
          cost_usd: costUsd,
          source: openaiKey ? "openai" : "local",
        });
      } catch (error) {
        console.error("Generate insights error:", error);
        res.status(500).json({ error: "Failed to generate insights" });
      }
    },
  );

  // DELETE /insights — clear all insights
  router.delete(
    "/insights",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        await pool.query("DELETE FROM ai_insights WHERE account_id = $1", [
          req.accountId,
        ]);
        res.json({ success: true });
      } catch (error) {
        console.error("Clear insights error:", error);
        res.status(500).json({ error: "Failed to clear insights" });
      }
    },
  );

  // GET /usage/limits — return current usage for ai_insights
  router.get(
    "/usage/limits",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const visitorId = req.visitorId!;
      try {
        const [aiAccess, eventAccess] = await Promise.all([
          deps.checkBillingFeatureAccess(
            visitorId,
            "ai_insights",
            req.accountEmail,
            req.accountId,
          ),
          deps.checkBillingFeatureAccess(
            visitorId,
            "event_ingest",
            req.accountEmail,
            req.accountId,
          ),
        ]);
        res.json({
          configured: true,
          ai_insights: {
            allowed: aiAccess.allowed,
            usage: {
              used: aiAccess.usage ?? 0,
              limit: aiAccess.limit ?? 0,
              remaining: aiAccess.remaining ?? 0,
            },
          },
          event_ingest: {
            allowed: eventAccess.allowed,
            usage: {
              used: eventAccess.usage ?? 0,
              limit: eventAccess.limit ?? 0,
              remaining: eventAccess.remaining ?? 0,
            },
          },
        });
      } catch (err) {
        console.error("Usage limits check error:", err);
        res.status(503).json({
          configured: true,
          error: "Usage data temporarily unavailable",
        });
      }
    },
  );

  // GET /admin/usage — all users' event usage (admin only)
  router.get(
    "/admin/usage",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!isAdminEmail(req.accountEmail)) {
          return res.status(403).json({ error: "Admin access required" });
        }
        const showInternal = req.query.show_internal === "true";
        const result = await pool.query(`
          SELECT
            a.email,
            a.name,
            acc.stripe_plan,
            a.created_at,
            a.is_internal,
            COALESCE(e.event_count, 0) as events_this_month,
            COALESCE(e.total_cost, 0) as total_cost_this_month,
            COALESCE(e.total_revenue, 0) as total_revenue_this_month,
            COALESCE(i.insight_count, 0) as insights_this_month
          FROM users a
          LEFT JOIN user_accounts ua ON ua.user_id = a.id AND ua.role = 'owner'
          LEFT JOIN accounts acc ON acc.id = ua.account_id
          LEFT JOIN (
            SELECT user_id,
              COUNT(*) as event_count,
              SUM(cost_amount) as total_cost,
              SUM(revenue_amount) as total_revenue
            FROM observe_events
            WHERE timestamp >= date_trunc('month', NOW()) AND source != 'sample'
            GROUP BY user_id
          ) e ON e.user_id = a.visitor_id
          LEFT JOIN (
            SELECT user_id, COUNT(*) as insight_count
            FROM ai_insights
            WHERE created_at >= date_trunc('month', NOW())
            GROUP BY user_id
          ) i ON i.user_id = a.visitor_id
          ${showInternal ? "" : "WHERE a.is_internal IS NOT TRUE"}
          ORDER BY e.event_count DESC NULLS LAST
        `);
        res.json({ users: result.rows });
      } catch (err) {
        console.error("GET /admin/usage error:", err);
        res.status(500).json({ error: "Failed to fetch admin usage" });
      }
    },
  );

  // GET /admin/emails — list recent emails sent via Resend (admin only)
  router.get(
    "/admin/emails",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!isAdminEmail(req.accountEmail)) {
          return res.status(403).json({ error: "Admin access required" });
        }

        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
          return res.json({ emails: [], error: "Resend not configured" });
        }

        const response = await fetch("https://api.resend.com/emails", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });

        if (!response.ok) {
          const text = await response.text();
          console.error("Resend API error:", response.status, text);
          return res
            .status(502)
            .json({ error: "Failed to fetch emails from Resend" });
        }

        const data = await response.json();
        const all = (data.data ?? []) as Array<{ from?: string }>;
        const observeOnly = all.filter((e) =>
          (e.from ?? "").toLowerCase().includes("observe"),
        );
        res.json({ emails: observeOnly });
      } catch (err) {
        console.error("GET /admin/emails error:", err);
        res.status(500).json({ error: "Failed to fetch emails" });
      }
    },
  );

  // GET /admin/activity — recent user activity log
  router.get(
    "/admin/activity",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!isAdminEmail(req.accountEmail)) {
          return res.status(403).json({ error: "Admin access required" });
        }

        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

        const result = await pool.query(
          `SELECT
            a.email,
            a.name,
            e.event_name,
            e.model,
            e.model_provider,
            e.customer_id,
            e.feature_key,
            e.source,
            e.cost_amount,
            e.revenue_amount,
            e.timestamp,
            e.properties
          FROM observe_events e
          JOIN users a ON a.visitor_id = e.user_id
          WHERE e.source != 'sample'
            AND e.timestamp >= NOW() - INTERVAL '7 days'
          ORDER BY e.timestamp DESC
          LIMIT $1`,
          [limit],
        );

        // Also get recent signups and logins
        const signups = await pool.query(
          `SELECT email, name, created_at FROM users
           WHERE created_at >= NOW() - INTERVAL '7 days'
           ORDER BY created_at DESC`,
        );

        // Recent recommendation activity
        const recActivity = await pool.query(
          `SELECT r.type, r.title, r.severity, r.status, r.created_at, r.applied_at, r.dismissed_at,
            a.email
          FROM recommendations r
          JOIN users a ON a.visitor_id = r.user_id
          WHERE r.created_at >= NOW() - INTERVAL '7 days'
          ORDER BY r.created_at DESC
          LIMIT 50`,
        );

        res.json({
          events: result.rows,
          signups: signups.rows,
          recommendation_activity: recActivity.rows,
        });
      } catch (err) {
        console.error("GET /admin/activity error:", err);
        res.status(500).json({ error: "Failed to fetch activity log" });
      }
    },
  );

  // POST /admin/cleanup — delete events older than 30 days for free-plan users
  router.post(
    "/admin/cleanup",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const adminEmail4 = (
          process.env.ADMIN_EMAIL || "tansoadmin@tansohq.com"
        ).toLowerCase();
        if (
          !req.accountEmail ||
          req.accountEmail.toLowerCase() !== adminEmail4
        ) {
          return res.status(403).json({ error: "Admin access required" });
        }

        const freeUsers = await pool.query(
          `SELECT u.visitor_id
             FROM users u
             JOIN user_accounts ua ON ua.user_id = u.id AND ua.role = 'owner'
             JOIN accounts a ON a.id = ua.account_id
            WHERE a.stripe_plan = 'free' OR a.stripe_plan IS NULL`,
        );

        let cleaned = 0;
        let deletedEvents = 0;

        for (const row of freeUsers.rows) {
          // Admin cleanup — no req.accountId. Resolve owner's account_id.
          const accountIdResult = await pool.query(
            `SELECT account_id FROM user_accounts WHERE user_id = (SELECT id FROM users WHERE visitor_id = $1) AND role = 'owner' LIMIT 1`,
            [row.visitor_id],
          );
          const accountId: number | null =
            accountIdResult.rows[0]?.account_id ?? null;
          if (accountId === null) {
            console.warn(
              "admin/cleanup: no owner account_id for visitor",
              row.visitor_id,
            );
            continue;
          }
          const result = await pool.query(
            `DELETE FROM observe_events WHERE account_id = $1 AND timestamp < NOW() - INTERVAL '30 days' AND source != 'sample'`,
            [accountId],
          );
          const count = result.rowCount ?? 0;
          if (count > 0) {
            cleaned++;
            deletedEvents += count;
          }
        }

        res.json({ cleaned, deleted_events: deletedEvents });
      } catch (err) {
        console.error("POST /admin/cleanup error:", err);
        res.status(500).json({ error: "Failed to run data cleanup" });
      }
    },
  );

  // GET /insights/data-quality — rule-based data quality checks + optional LLM summary
  router.get(
    "/insights/data-quality",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const accountId = req.accountId;
      if (!accountId) return res.json({ advisories: [] });

      try {
        const [dupeNames, noSub, revenueGap, unresolvedNames, inactiveSub] =
          await Promise.all([
            // 1. Same name, different customer_id
            pool.query(
              `SELECT LOWER(name) as lname, COUNT(DISTINCT customer_id)::int as copies,
                      array_agg(customer_id) as customer_ids
               FROM customers WHERE account_id = $1 AND name IS NOT NULL
               GROUP BY LOWER(name) HAVING COUNT(DISTINCT customer_id) > 1
               LIMIT 10`,
              [accountId],
            ),
            // 2. Customers with cus_* IDs but no subscription
            pool.query(
              `SELECT c.customer_id, c.name
               FROM customers c
               WHERE c.account_id = $1
                 AND c.customer_id LIKE 'cus_%'
                 AND NOT EXISTS (
                   SELECT 1 FROM subscriptions s
                   WHERE s.customer_id = c.customer_id AND s.account_id = $1
                 )
                 AND EXISTS (
                   SELECT 1 FROM observe_events e
                   WHERE e.customer_id = c.customer_id AND e.account_id = $1
                 )
               LIMIT 10`,
              [accountId],
            ),
            // 3. Events with revenue_source='none' where customer has active subscription
            pool.query(
              `SELECT DISTINCT e.customer_id, c.name
               FROM observe_events e
               JOIN customers c ON c.customer_id = e.customer_id AND c.account_id = e.account_id
               JOIN subscriptions s ON s.customer_id = e.customer_id AND s.account_id = e.account_id AND s.is_active = true
               WHERE e.account_id = $1 AND e.revenue_source = 'none'
               LIMIT 10`,
              [accountId],
            ),
            // 4. Customers where name = customer_id (unresolved)
            pool.query(
              `SELECT c.customer_id, c.name
               FROM customers c
               WHERE c.account_id = $1 AND c.name = c.customer_id
                 AND EXISTS (
                   SELECT 1 FROM observe_events e
                   WHERE e.customer_id = c.customer_id AND e.account_id = $1
                 )
               LIMIT 10`,
              [accountId],
            ),
            // 5. Inactive subscriptions with recent events (last 7 days)
            pool.query(
              `SELECT DISTINCT e.customer_id, c.name, s.subscription_id
               FROM observe_events e
               JOIN customers c ON c.customer_id = e.customer_id AND c.account_id = e.account_id
               JOIN subscriptions s ON s.customer_id = e.customer_id AND s.account_id = e.account_id
               WHERE e.account_id = $1
                 AND s.is_active = false
                 AND e.timestamp > NOW() - INTERVAL '7 days'
               LIMIT 10`,
              [accountId],
            ),
          ]);

        const advisories: Array<{
          type: string;
          severity: string;
          title: string;
          description: string;
          affected_ids: string[];
        }> = [];

        for (const row of dupeNames.rows) {
          advisories.push({
            type: "duplicate_customers",
            severity: "warning",
            title: `"${row.lname}" appears ${row.copies} times`,
            description: `${row.copies} customers share the name "${row.lname}" but have different IDs. This may split revenue and cost data across duplicates.`,
            affected_ids: row.customer_ids,
          });
        }

        for (const row of noSub.rows) {
          advisories.push({
            type: "missing_subscription",
            severity: "info",
            title: `${row.name || row.customer_id} has no subscription`,
            description: `Stripe customer ${row.customer_id} has events but no subscription. Revenue attribution will show $0. Sync Stripe or check if the subscription is missing.`,
            affected_ids: [row.customer_id],
          });
        }

        for (const row of revenueGap.rows) {
          advisories.push({
            type: "revenue_gap",
            severity: "warning",
            title: `${row.name || row.customer_id} has events with no revenue despite active subscription`,
            description: `Events for this customer show revenue_source="none" even though they have an active subscription. Revenue enrichment may have failed during ingest.`,
            affected_ids: [row.customer_id],
          });
        }

        for (const row of unresolvedNames.rows) {
          advisories.push({
            type: "unresolved_name",
            severity: "info",
            title: `${row.customer_id} has no display name`,
            description: `Customer name is just the raw ID. Connect Stripe to resolve names automatically, or update via the Customers page.`,
            affected_ids: [row.customer_id],
          });
        }

        for (const row of inactiveSub.rows) {
          advisories.push({
            type: "inactive_sub_active_usage",
            severity: "warning",
            title: `${row.name || row.customer_id} is using the product but subscription is inactive`,
            description: `This customer has events in the last 7 days but their subscription is marked inactive. They may be churned but still consuming resources.`,
            affected_ids: [row.customer_id],
          });
        }

        // Optional: LLM summary of findings
        let llmSummary: string | null = null;
        if (
          advisories.length > 0 &&
          req.query.include_llm === "true" &&
          process.env.OPENAI_API_KEY
        ) {
          try {
            const prompt = `You are a data quality analyst for an AI cost tracking platform. Summarize these data quality issues in 2-3 sentences. Be specific and actionable.\n\n${JSON.stringify(advisories, null, 2)}`;
            const llmRes = await fetch(
              "https://api.openai.com/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "gpt-4o-mini",
                  messages: [{ role: "user", content: prompt }],
                  temperature: 0.2,
                  max_tokens: 300,
                }),
              },
            );
            if (llmRes.ok) {
              const data = (await llmRes.json()) as {
                choices: Array<{ message: { content: string } }>;
              };
              llmSummary = data.choices?.[0]?.message?.content ?? null;
            }
          } catch {
            // LLM summary is best-effort
          }
        }

        res.json({ advisories, summary: llmSummary });
      } catch (error) {
        console.error("Data quality check error:", error);
        res.status(500).json({ error: "Failed to run data quality checks" });
      }
    },
  );

  return router;
}
