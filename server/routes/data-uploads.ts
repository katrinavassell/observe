import { Router, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { type AuthRequest } from "./auth.js";
import {
  clearSampleData,
  type CheckBillingFeatureAccessFn,
  type TrackBillingUsageFn,
  type ConvertReferralFn,
} from "./data-helpers.js";

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

export function createDataUploadRoutes(
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

  // POST /data/upload/costs
  router.post(
    "/data/upload/costs",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const access = await checkBillingFeatureAccess(
        req.visitorId!,
        "csv_upload",
        req.accountEmail,
        req.accountId,
      );
      if (!access.allowed)
        return res.status(403).json({
          error:
            access.reason ||
            "Upload limit reached. Upgrade your plan for more capacity.",
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
        req.accountId,
      );
      if (!access.allowed)
        return res.status(403).json({
          error:
            access.reason ||
            "Upload limit reached. Upgrade your plan for more capacity.",
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
        req.accountId,
      );
      if (!access.allowed)
        return res.status(403).json({
          error:
            access.reason ||
            "Upload limit reached. Upgrade your plan for more capacity.",
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
              "INSERT INTO customers (account_id, customer_id, name, email, segment) VALUES ($1, $2, $3, $4, $5)",
              [
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

  // POST /data/upload/provider-csv — auto-detect and import OpenAI/Anthropic billing exports
  router.post(
    "/data/upload/provider-csv",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const access = await checkBillingFeatureAccess(
        req.visitorId!,
        "csv_upload",
        req.accountEmail,
        req.accountId,
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
