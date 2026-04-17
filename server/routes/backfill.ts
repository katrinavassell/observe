import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";
import { decryptApiKey } from "../stripe-client.js";

// Retention windows: OpenAI exposes ~30d of usage, Anthropic ~90d.
// Rows older than this get counted under rows_out_of_retention.
const RETENTION_DAYS: Record<"openai" | "anthropic", number> = {
  openai: 30,
  anthropic: 90,
};

// ±5% tolerance — if our summed usage_units diverges from the provider's
// reported (input + output) total by more than this, we assume the bucket
// doesn't correspond to the same set of events and skip it.
const TOLERANCE = 0.05;

// UPDATE batch size — keeps each transaction short.
const BATCH_SIZE = 50;

interface BackfillSummary {
  buckets_processed: number;
  rows_updated: number;
  rows_skipped_no_data: number;
  rows_out_of_retention: number;
}

// OpenAI: snapshot_id can be a dated snapshot ("gpt-4o-2024-08-06") while
// observe_events.model sometimes holds the base name ("gpt-4o"). Normalize
// so we match both shapes.
function modelMatches(providerModel: string, eventModel: string): boolean {
  if (providerModel === eventModel) return true;
  if (providerModel.startsWith(eventModel + "-")) return true;
  if (eventModel.startsWith(providerModel + "-")) return true;
  return false;
}

interface ProviderBucket {
  date: string; // YYYY-MM-DD (UTC)
  model: string;
  inputTokens: number;
  outputTokens: number;
}

async function fetchOpenAIUsage(apiKey: string): Promise<ProviderBucket[]> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - RETENTION_DAYS.openai * 24 * 60 * 60;
  const resp = await fetch(
    `https://api.openai.com/v1/organization/usage/completions?start_time=${windowStart}&end_time=${now}&bucket_width=1d`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!resp.ok) {
    throw new Error(
      `OpenAI usage API returned ${resp.status}: ${await resp.text()}`,
    );
  }
  const data = (await resp.json()) as {
    data?: Array<{
      start_time?: number;
      results?: Array<{
        snapshot_id?: string;
        input_tokens?: number;
        output_tokens?: number;
      }>;
    }>;
  };
  const buckets: ProviderBucket[] = [];
  for (const bucket of data.data ?? []) {
    if (!bucket.start_time || !bucket.results) continue;
    const date = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
    for (const r of bucket.results) {
      if (!r.snapshot_id) continue;
      buckets.push({
        date,
        model: r.snapshot_id,
        inputTokens: r.input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
      });
    }
  }
  return buckets;
}

async function fetchAnthropicUsage(apiKey: string): Promise<ProviderBucket[]> {
  const today = new Date();
  const startWindow = new Date(
    today.getTime() - RETENTION_DAYS.anthropic * 24 * 60 * 60 * 1000,
  );
  const todayISO = today.toISOString().slice(0, 10);
  const startISO = startWindow.toISOString().slice(0, 10);
  const resp = await fetch(
    `https://api.anthropic.com/v1/organizations/usage?start_date=${startISO}&end_date=${todayISO}`,
    {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    },
  );
  if (!resp.ok) {
    throw new Error(
      `Anthropic usage API returned ${resp.status}: ${await resp.text()}`,
    );
  }
  const data = (await resp.json()) as {
    data?: Array<{
      model?: string;
      input_tokens?: number;
      output_tokens?: number;
      date?: string;
    }>;
  };
  const buckets: ProviderBucket[] = [];
  for (const entry of data.data ?? []) {
    if (!entry.model || !entry.date) continue;
    buckets.push({
      date: entry.date.slice(0, 10),
      model: entry.model,
      inputTokens: entry.input_tokens ?? 0,
      outputTokens: entry.output_tokens ?? 0,
    });
  }
  return buckets;
}

export function createBackfillRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  router.post(
    "/backfill/tokens",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const userId = req.visitorId!;
      const provider = req.body?.provider as "openai" | "anthropic" | undefined;

      if (provider !== "openai" && provider !== "anthropic") {
        return res
          .status(400)
          .json({ error: "provider must be 'openai' or 'anthropic'" });
      }

      // Look up the encrypted key from the user's integration row.
      const acct = req.accountId ?? null;
      const integResult = await pool.query(
        `SELECT encrypted_api_key FROM integrations
         WHERE account_id = $1 AND provider = $2`,
        [acct, provider],
      );
      if (integResult.rows.length === 0) {
        return res
          .status(400)
          .json({ error: `${provider} is not connected for this account` });
      }
      const encrypted = integResult.rows[0].encrypted_api_key;
      if (!encrypted) {
        return res.status(400).json({
          error: `Please reconnect your ${provider} integration to enable backfill (the stored key predates this feature).`,
        });
      }
      const apiKey = decryptApiKey(encrypted);

      // Count rows that fall outside the provider's retention window up-front —
      // these will never be backfillable so we report them separately.
      const retentionDays = RETENTION_DAYS[provider];
      const oorResult = await pool.query(
        `SELECT COUNT(*)::int AS n FROM observe_events
         WHERE account_id = $1
           AND model_provider = $2
           AND tokens_source IS NULL
           AND timestamp < NOW() - ($3 || ' days')::interval`,
        [acct, provider, retentionDays],
      );
      const rowsOutOfRetention: number = oorResult.rows[0]?.n ?? 0;

      // Fetch provider aggregates for the retention window.
      let providerBuckets: ProviderBucket[];
      try {
        providerBuckets =
          provider === "openai"
            ? await fetchOpenAIUsage(apiKey)
            : await fetchAnthropicUsage(apiKey);
      } catch (err) {
        console.error(`Backfill: ${provider} usage fetch failed:`, err);
        return res.status(502).json({
          error: `Failed to fetch ${provider} usage. Check that your API key has org-admin access.`,
        });
      }

      // Pull all candidate rows (NULL tokens_source, matching provider, inside
      // retention). Grouped into (date UTC, model) buckets in JS so we can
      // allocate proportionally by usage_units share.
      const rowsResult = await pool.query(
        `SELECT id,
                model,
                usage_units,
                (timestamp AT TIME ZONE 'UTC')::date::text AS day
         FROM observe_events
         WHERE account_id = $1
           AND model_provider = $2
           AND tokens_source IS NULL
           AND model IS NOT NULL
           AND timestamp >= NOW() - ($3 || ' days')::interval`,
        [acct, provider, retentionDays],
      );

      interface CandidateRow {
        id: number;
        model: string;
        usageUnits: number;
      }
      const rowsByBucket = new Map<string, CandidateRow[]>();
      for (const row of rowsResult.rows) {
        const key = `${row.day}::${row.model}`;
        const usageUnits =
          row.usage_units != null ? parseFloat(row.usage_units) : 0;
        const list = rowsByBucket.get(key) ?? [];
        list.push({ id: row.id, model: row.model, usageUnits });
        rowsByBucket.set(key, list);
      }

      let bucketsProcessed = 0;
      let rowsUpdated = 0;
      let rowsSkippedNoData = 0;

      // Walk each (date, model) bucket. Find the matching provider entry,
      // then allocate tokens proportional to each row's usage_units share.
      for (const [bucketKey, rows] of rowsByBucket) {
        bucketsProcessed++;
        const [day, eventModel] = bucketKey.split("::");

        // Find the provider bucket matching this day + model (with normalization).
        const providerEntry = providerBuckets.find(
          (b) => b.date === day && modelMatches(b.model, eventModel),
        );

        if (!providerEntry) {
          rowsSkippedNoData += rows.length;
          continue;
        }

        const providerTotal =
          providerEntry.inputTokens + providerEntry.outputTokens;
        if (providerTotal === 0) {
          rowsSkippedNoData += rows.length;
          continue;
        }

        const ourUsageSum = rows.reduce((s, r) => s + r.usageUnits, 0);
        if (ourUsageSum === 0) {
          rowsSkippedNoData += rows.length;
          continue;
        }

        // Tolerance check — our summed usage_units should be within ±5% of
        // the provider's (input + output) total. Otherwise the bucket
        // probably doesn't line up (missing events, double-counted, etc.).
        const drift = Math.abs(ourUsageSum - providerTotal) / providerTotal;
        if (drift > TOLERANCE) {
          console.warn(
            `Backfill: ${provider} bucket ${day}/${eventModel} skipped — ` +
              `ours=${ourUsageSum} provider=${providerTotal} drift=${(
                drift * 100
              ).toFixed(1)}%`,
          );
          rowsSkippedNoData += rows.length;
          continue;
        }

        // Allocate input/output tokens to each row proportionally.
        const assignments: Array<{ id: number; inp: number; out: number }> = [];
        for (const row of rows) {
          const share = row.usageUnits / ourUsageSum;
          const inp = Math.round(providerEntry.inputTokens * share);
          const out = Math.round(providerEntry.outputTokens * share);
          assignments.push({ id: row.id, inp, out });
        }

        // Batch the UPDATEs (50 rows per statement). The
        // `tokens_source IS NULL` guard keeps this idempotent even under
        // concurrent re-runs — previously-filled rows are never touched.
        for (let i = 0; i < assignments.length; i += BATCH_SIZE) {
          const chunk = assignments.slice(i, i + BATCH_SIZE);
          const valueTuples: string[] = [];
          const params: (number | string)[] = [];
          let p = 1;
          for (const a of chunk) {
            valueTuples.push(`($${p++}::int, $${p++}::int, $${p++}::int)`);
            params.push(a.id, a.inp, a.out);
          }
          const sql = `
            UPDATE observe_events AS e
               SET input_tokens = v.inp,
                   output_tokens = v.out,
                   tokens_source = 'estimated'
              FROM (VALUES ${valueTuples.join(", ")}) AS v(id, inp, out)
             WHERE e.id = v.id
               AND e.tokens_source IS NULL
          `;
          const updateResult = await pool.query(sql, params);
          rowsUpdated += updateResult.rowCount ?? 0;
        }
      }

      const summary: BackfillSummary = {
        buckets_processed: bucketsProcessed,
        rows_updated: rowsUpdated,
        rows_skipped_no_data: rowsSkippedNoData,
        rows_out_of_retention: rowsOutOfRetention,
      };

      console.warn(
        `Backfill complete for ${userId} (${provider}):`,
        JSON.stringify(summary),
      );
      res.json(summary);
    },
  );

  return router;
}
