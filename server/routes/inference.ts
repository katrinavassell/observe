import { Router, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { type AuthRequest } from "./auth.js";
import { inferModelProvider, inferenceConfidence } from "../lib/models.js";

export async function computeInferenceProfiles(
  pool: Pool,
  userId: string,
): Promise<number> {
  const result = await pool.query(
    `SELECT model_provider, feature_key,
            COUNT(*)::int as event_count,
            SUM(cost_amount)::numeric as total_cost
     FROM observe_events
     WHERE user_id = $1 AND source = 'sdk' AND model_provider IS NOT NULL
     GROUP BY model_provider, feature_key`,
    [userId],
  );

  if (result.rows.length === 0) return 0;

  const providerData: Record<
    string,
    { features: Record<string, number>; totalCost: number; totalCount: number }
  > = {};
  for (const row of result.rows) {
    const provider = row.model_provider;
    if (!providerData[provider]) {
      providerData[provider] = { features: {}, totalCost: 0, totalCount: 0 };
    }
    const cost = parseFloat(row.total_cost) || 0;
    providerData[provider].features[row.feature_key] = cost;
    providerData[provider].totalCost += cost;
    providerData[provider].totalCount += row.event_count;
  }

  let profilesUpdated = 0;
  for (const [provider, data] of Object.entries(providerData)) {
    const distribution: Record<string, number> = {};
    if (data.totalCost > 0) {
      for (const [feature, cost] of Object.entries(data.features)) {
        distribution[feature] =
          Math.round((cost / data.totalCost) * 10000) / 10000;
      }
    } else {
      const featureCount = Object.keys(data.features).length;
      for (const feature of Object.keys(data.features)) {
        distribution[feature] = Math.round((1 / featureCount) * 10000) / 10000;
      }
    }

    const windowResult = await pool.query(
      `SELECT MIN(timestamp) as window_start, MAX(timestamp) as window_end
       FROM observe_events
       WHERE user_id = $1 AND source = 'sdk' AND model_provider = $2`,
      [userId, provider],
    );

    await pool.query(
      `INSERT INTO inference_profiles (user_id, profile_type, scope_key, distribution, sample_count, time_window_start, time_window_end)
       VALUES ($1, 'feature_distribution', $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, profile_type, scope_key) DO UPDATE SET
         distribution = EXCLUDED.distribution,
         sample_count = EXCLUDED.sample_count,
         time_window_start = EXCLUDED.time_window_start,
         time_window_end = EXCLUDED.time_window_end,
         created_at = NOW()`,
      [
        userId,
        provider,
        JSON.stringify(distribution),
        data.totalCount,
        windowResult.rows[0]?.window_start,
        windowResult.rows[0]?.window_end,
      ],
    );
    profilesUpdated++;
  }

  return profilesUpdated;
}

async function applyInference(
  pool: Pool,
  userId: string,
): Promise<{ rows_inferred: number; rows_split: number }> {
  const coarseRows = await pool.query(
    `SELECT id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit,
            revenue_amount, usage_units, model, model_provider, source, granularity, properties
     FROM observe_events
     WHERE user_id = $1
       AND source IN ('csv', 'openai', 'anthropic')
       AND granularity IN ('monthly_aggregate', 'daily')
       AND is_inferred = false
       AND (properties->>'inference_status') IS NULL`,
    [userId],
  );

  if (coarseRows.rows.length === 0) return { rows_inferred: 0, rows_split: 0 };

  const profiles = await pool.query(
    `SELECT scope_key, distribution, sample_count
     FROM inference_profiles
     WHERE user_id = $1 AND profile_type = 'feature_distribution'`,
    [userId],
  );

  if (profiles.rows.length === 0) return { rows_inferred: 0, rows_split: 0 };

  const profileMap: Record<
    string,
    { distribution: Record<string, number>; sample_count: number }
  > = {};
  for (const p of profiles.rows) {
    profileMap[p.scope_key] = {
      distribution: p.distribution,
      sample_count: p.sample_count,
    };
  }

  let rowsInferred = 0;
  let rowsSplit = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const row of coarseRows.rows) {
      const provider = row.model_provider || row.feature_key;
      const profile = profileMap[provider];
      if (!profile) continue;

      const distribution = profile.distribution;
      const featureKeys = Object.keys(distribution);
      if (featureKeys.length === 0) continue;

      const confidence = inferenceConfidence(profile.sample_count);
      const originalCost = parseFloat(row.cost_amount) || 0;
      const originalRevenue = parseFloat(row.revenue_amount) || 0;
      const originalUsage = parseFloat(row.usage_units) || 0;
      const properties = row.properties || {};

      const updatedProperties = {
        ...properties,
        original_cost_amount: originalCost,
        original_revenue_amount: originalRevenue,
        inference_status: "split_source",
      };

      await client.query(
        `UPDATE observe_events
         SET cost_amount = 0, revenue_amount = 0, properties = $1
         WHERE id = $2`,
        [JSON.stringify(updatedProperties), row.id],
      );
      rowsSplit++;

      for (const [featureKey, ratio] of Object.entries(distribution)) {
        const childCost = Math.round(originalCost * ratio * 10000) / 10000;
        const childRevenue =
          Math.round(originalRevenue * ratio * 10000) / 10000;
        const childUsage = Math.round(originalUsage * ratio * 10000) / 10000;

        await client.query(
          `INSERT INTO observe_events
           (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit,
            revenue_amount, usage_units, model, model_provider, source, granularity, properties,
            is_inferred, inference_method, inference_confidence, inferred_from_source, original_event_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                   true, 'proportional', $15, $16, $17)`,
          [
            userId,
            row.customer_id,
            featureKey,
            row.event_name,
            row.timestamp,
            childCost,
            row.cost_unit,
            childRevenue,
            childUsage,
            row.model,
            row.model_provider || provider,
            row.source,
            row.granularity,
            JSON.stringify({ inferred_from_profile: provider }),
            confidence,
            row.source,
            row.id,
          ],
        );
        rowsInferred++;
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { rows_inferred: rowsInferred, rows_split: rowsSplit };
}

const heliconeEventSchema = z.object({
  request_id: z.string().optional(),
  created_at: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  prompt_tokens: z.number().optional(),
  completion_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  cost: z.number().optional(),
  user_id: z.string().optional(),
  properties: z.record(z.string(), z.string()).optional(),
});

export function createInferenceRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  router.post(
    "/inference/run",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.visitorId!;
        const profilesUpdated = await computeInferenceProfiles(pool, userId);
        const { rows_inferred, rows_split } = await applyInference(
          pool,
          userId,
        );
        res.json({
          profiles_updated: profilesUpdated,
          rows_inferred,
          rows_split,
        });
      } catch (err) {
        console.error("POST /inference/run error:", err);
        res.status(500).json({ error: "Inference run failed" });
      }
    },
  );

  router.get(
    "/inference/profiles",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT id, profile_type, scope_key, distribution, sample_count,
                time_window_start, time_window_end, created_at
         FROM inference_profiles
         WHERE user_id = $1
         ORDER BY created_at DESC`,
          [req.visitorId],
        );
        res.json(result.rows);
      } catch (err) {
        console.error("GET /inference/profiles error:", err);
        res.status(500).json({ error: "Failed to fetch inference profiles" });
      }
    },
  );

  router.post(
    "/import/helicone",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.visitorId;
        if (!userId)
          return res.status(401).json({ error: "Not authenticated" });

        const body = z
          .object({
            events: z.array(heliconeEventSchema).min(1).max(10000),
          })
          .safeParse(req.body);

        if (!body.success) {
          return res
            .status(400)
            .json({ error: "Invalid format", details: body.error.flatten() });
        }

        const events = body.data.events;
        let imported = 0;

        for (const event of events) {
          const model = event.model || "unknown";
          const provider =
            event.provider || inferModelProvider(model) || "unknown";
          const inputTokens = event.prompt_tokens || 0;
          const outputTokens = event.completion_tokens || 0;
          const cost = event.cost || 0;
          const customerId =
            event.user_id ||
            event.properties?.["Helicone-User-Id"] ||
            "unknown";
          const featureKey =
            event.properties?.["Helicone-Session-Id"] ||
            event.properties?.["feature"] ||
            "imported";
          const timestamp = event.created_at
            ? new Date(event.created_at)
            : new Date();
          const idempotencyKey = event.request_id || null;

          const result = await pool.query(
            `INSERT INTO observe_events (
            user_id, customer_id, feature_key, event_name, timestamp,
            cost_amount, cost_unit, revenue_amount, usage_units,
            model, model_provider, source, granularity, is_inferred, properties,
            idempotency_key
          ) VALUES ($1, $2, $3, 'cost', $4, $5, 'usd', 0, $6, $7, $8, 'helicone_import', 'event', false, $9, $10)
          ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
            [
              userId,
              customerId,
              featureKey,
              timestamp,
              cost,
              inputTokens + outputTokens,
              model,
              provider,
              JSON.stringify(event.properties || {}),
              idempotencyKey,
            ],
          );
          if (result.rowCount && result.rowCount > 0) imported++;
        }

        res.json({ success: true, imported, total: events.length });
      } catch (err) {
        console.error("POST /import/helicone error:", err);
        res.status(500).json({ error: "Import failed" });
      }
    },
  );

  return router;
}
