import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest, ensureScoped } from "./auth.js";

export function createSimulationRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  // GET /simulations/opportunities — auto-detect pricing issues
  router.get(
    "/simulations/opportunities",
    ensureVisitor,
    ensureScoped("usage.read"),
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT feature_key,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COUNT(*) as event_count
         FROM observe_events
         WHERE account_id = $1 AND feature_key IS NOT NULL
           AND (source IS NULL OR source != 'stripe')
         GROUP BY feature_key`,
          [req.accountId],
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
    ensureScoped("usage.write"),
    async (req: AuthRequest, res: Response) => {
      try {
        const [featureRes, customerRes] = await Promise.all([
          pool.query(
            `SELECT feature_key,
             COUNT(*) as event_count,
             COALESCE(SUM(cost_amount), 0) as total_cost,
             COALESCE(SUM(revenue_amount), 0) as total_revenue,
             COALESCE(SUM(usage_units), 0) as total_usage
           FROM observe_events WHERE account_id = $1 AND feature_key IS NOT NULL
             AND (source IS NULL OR source != 'stripe')
           GROUP BY feature_key ORDER BY total_cost DESC`,
            [req.accountId],
          ),
          pool.query(
            `SELECT oe.customer_id, c.name as customer_name, c.segment,
             COALESCE(SUM(oe.cost_amount), 0) as total_cost,
             COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
           FROM observe_events oe
           LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
           WHERE oe.account_id = $1
             AND (oe.source IS NULL OR oe.source != 'stripe')
           GROUP BY oe.customer_id, c.name, c.segment ORDER BY total_revenue DESC LIMIT 10`,
            [req.accountId],
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
    ensureScoped("usage.read"),
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          "SELECT * FROM simulations WHERE account_id = $1 ORDER BY created_at DESC",
          [req.accountId],
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
    ensureScoped("usage.write"),
    async (req: AuthRequest, res: Response) => {
      const visitorId = req.visitorId!;

      try {
        const { name, scenarios, time_range } = req.body;
        if (!name) {
          return res.status(400).json({ error: "Name is required" });
        }

        const result = await pool.query(
          `INSERT INTO simulations (user_id, account_id, name, scenarios, time_range, status)
         VALUES ($1, $2, $3, $4, $5, 'draft')
         RETURNING *`,
          [
            visitorId,
            req.accountId ?? null,
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
    ensureScoped("usage.read"),
    async (req: AuthRequest, res: Response) => {
      try {
        const { id } = req.params;
        const result = await pool.query(
          "SELECT * FROM simulations WHERE id = $1 AND account_id = $2",
          [id, req.accountId],
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
    ensureScoped("usage.write"),
    async (req: AuthRequest, res: Response) => {
      const client = await pool.connect();
      try {
        const { id } = req.params;
        const updates = req.body;

        const existing = await client.query(
          "SELECT * FROM simulations WHERE id = $1 AND account_id = $2",
          [id, req.accountId],
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
           WHERE account_id = $1 AND feature_key IS NOT NULL
             AND (source IS NULL OR source != 'stripe')
           GROUP BY feature_key`,
            [req.accountId],
          );

          const customerResult = await client.query(
            `SELECT oe.customer_id, c.name as customer_name, c.segment,
             COALESCE(SUM(oe.cost_amount), 0) as total_cost,
             COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
           FROM observe_events oe
           LEFT JOIN customers c ON oe.account_id = c.account_id AND oe.customer_id = c.customer_id
           WHERE oe.account_id = $1
             AND (oe.source IS NULL OR oe.source != 'stripe')
           GROUP BY oe.customer_id, c.name, c.segment`,
            [req.accountId],
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
    ensureScoped("usage.write"),
    async (req: AuthRequest, res: Response) => {
      try {
        const { id } = req.params;
        const result = await pool.query(
          "DELETE FROM simulations WHERE id = $1 AND account_id = $2 RETURNING id",
          [id, req.accountId],
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
