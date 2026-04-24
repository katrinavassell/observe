import type { Pool } from "pg";
import { getStripeClientForUser } from "../stripe-client.js";
import { resolveModelPricing, type ModelPrice } from "../model-pricing.js";

export async function resolveStripeCustomerNames(
  pool: Pool,
  userId: string,
  accountId: number | null,
  customerStripeMap: Map<string, string>,
): Promise<void> {
  if (customerStripeMap.size === 0 || accountId == null) return;
  const dbIds = [...customerStripeMap.keys()];

  // Also pull mappings from stripe_customers table
  try {
    const scRows = await pool.query(
      `SELECT stripe_customer_id, customer_id FROM stripe_customers
       WHERE account_id = $1 AND customer_id = ANY($2)`,
      [accountId, dbIds],
    );
    for (const row of scRows.rows) {
      if (row.customer_id && !customerStripeMap.has(row.customer_id)) {
        customerStripeMap.set(row.customer_id, row.stripe_customer_id);
      }
    }
  } catch {
    // stripe_customers table may not exist yet
  }

  const unresolved = await pool.query(
    `SELECT customer_id, stripe_customer_id FROM customers
     WHERE account_id = $1 AND customer_id = ANY($2)
       AND (name = customer_id OR name IS NULL)`,
    [accountId, dbIds],
  );
  if (unresolved.rows.length === 0) return;
  let stripe;
  try {
    stripe = await getStripeClientForUser(pool, userId, accountId);
  } catch (err) {
    console.error(
      "resolveStripeCustomerNames: Stripe client unavailable:",
      err,
    );
    return;
  }
  for (const row of unresolved.rows) {
    const stripeId =
      row.stripe_customer_id || customerStripeMap.get(row.customer_id);
    if (!stripeId) continue;
    try {
      const cust = await stripe.customers.retrieve(stripeId);
      if (cust.deleted) continue;
      const name = cust.name || cust.email || row.customer_id;
      const email = cust.email || null;
      await pool.query(
        `UPDATE customers
         SET name = $1, email = COALESCE(customers.email, $2),
             stripe_customer_id = COALESCE(customers.stripe_customer_id, $3),
             updated_at = NOW()
         WHERE account_id = $4 AND customer_id = $5
           AND (name = customer_id OR name IS NULL)`,
        [name, email, stripeId, accountId, row.customer_id],
      );
    } catch (err) {
      console.error(
        "resolveStripeCustomerNames: failed to resolve",
        row.customer_id,
        "via",
        stripeId,
        err,
      );
      continue;
    }
  }
}

/**
 * Annotate a list of already-coerced event rows with derived `input_cost` +
 * `output_cost`. Tokens × resolved rate — matches the ingest-time pricing
 * chain (tier > user override > global). Cached per-request so N rows with M
 * unique models do M pricing lookups, not N.
 */
export async function attachSplitCosts(
  pool: Pool,
  userId: string,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const cache = new Map<string, ModelPrice | null>();
  async function lookup(model: string): Promise<ModelPrice | null> {
    if (cache.has(model)) return cache.get(model)!;
    const p = await resolveModelPricing(pool, model, userId);
    cache.set(model, p);
    return p;
  }
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const model = typeof row.model === "string" ? row.model : null;
    const inputTokens =
      typeof row.input_tokens === "number" ? row.input_tokens : null;
    const outputTokens =
      typeof row.output_tokens === "number" ? row.output_tokens : null;
    let inputCost: number | null = null;
    let outputCost: number | null = null;
    if (model && (inputTokens != null || outputTokens != null)) {
      const pricing = await lookup(model);
      if (pricing) {
        if (inputTokens != null) {
          inputCost =
            Math.round(
              ((inputTokens * pricing.input_cost_per_million) / 1_000_000) *
                1_000_000,
            ) / 1_000_000;
        }
        if (outputTokens != null) {
          outputCost =
            Math.round(
              ((outputTokens * pricing.output_cost_per_million) / 1_000_000) *
                1_000_000,
            ) / 1_000_000;
        }
      }
    }
    out.push({ ...row, input_cost: inputCost, output_cost: outputCost });
  }
  return out;
}

export function coerceEventRow(row: Record<string, unknown>) {
  return {
    ...row,
    cost_amount:
      row.cost_amount != null ? parseFloat(row.cost_amount as string) : null,
    revenue_amount:
      row.revenue_amount != null
        ? parseFloat(row.revenue_amount as string)
        : null,
    usage_units:
      row.usage_units != null ? parseFloat(row.usage_units as string) : null,
    input_tokens:
      row.input_tokens != null
        ? parseInt(row.input_tokens as string, 10)
        : null,
    output_tokens:
      row.output_tokens != null
        ? parseInt(row.output_tokens as string, 10)
        : null,
    tokens_source: (row.tokens_source as string | null) ?? null,
  };
}

// Dedup partition: only collapse rows that share a user_id + idempotency_key
// (the same event arriving from multiple sources — e.g. proxy mirrored from
// SDK). Rows without an idempotency_key fall back to their primary key, so
// every call ends up in its own partition and nothing is silently dropped.
// Earlier partition was (user_id, model, customer_id, feature_key, day) which
// undercounted aggregates by collapsing every gpt-4o blog_post call for a
// given day into one row.
export const SOURCE_PRIORITY_CTE = `
  WITH ranked AS (
    SELECT oe.*,
      ROW_NUMBER() OVER (
        PARTITION BY oe.user_id, COALESCE(oe.idempotency_key, oe.id::text)
        ORDER BY CASE oe.source WHEN 'proxy' THEN 1 WHEN 'sdk' THEN 2 WHEN 'csv' THEN 3 WHEN 'sample' THEN 4 ELSE 5 END
      ) AS _src_rank
    FROM observe_events oe
    LEFT JOIN user_data_status uds ON uds.account_id = oe.account_id
    WHERE oe.account_id = $1
      AND oe.timestamp >= NOW() - INTERVAL '90 days'
      AND (oe.source != 'sample' OR COALESCE(uds.data_mode, 'none') = 'sample')
      AND oe.event_name != 'revenue'
  ),
  deduped AS (SELECT * FROM ranked WHERE _src_rank = 1)
`;

// In-memory dedup: tracks which usage alerts have already been sent this month
export const usageAlertsSent = new Set<string>();

export async function sendUsageLimitEmail(
  pool: Pool,
  userId: string,
  threshold: 80 | 100,
  used: number,
  limit: number,
): Promise<void> {
  const month = new Date().toISOString().slice(0, 7); // "2026-04"
  const key = `${userId}-${month}-${threshold}`;
  if (usageAlertsSent.has(key)) return;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const accountResult = await pool.query(
    `SELECT email FROM users WHERE visitor_id = $1`,
    [userId],
  );
  const email = accountResult.rows[0]?.email;
  if (!email) return;

  const subject =
    threshold === 80
      ? "You're approaching your monthly event limit"
      : "Monthly event limit reached";

  const body =
    threshold === 80
      ? `<p>You've used ${used.toLocaleString()} of your ${limit.toLocaleString()} monthly events on Observe.</p><p>Need more capacity? Check out <a href="https://tansohq.com">Tanso</a> for unlimited events and full monetization tools.</p>`
      : `<p>You've reached your ${limit.toLocaleString()} monthly event limit on Observe.</p><p>New events will be rejected until next month. Need more? Check out <a href="https://tansohq.com">Tanso</a> for unlimited events.</p>`;

  usageAlertsSent.add(key);

  fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: "Observe <kat@tansohq.com>",
      to: email,
      subject,
      html: body,
    }),
  })
    .then(() =>
      console.warn("Usage alert sent:", { email, threshold, used, limit }),
    )
    .catch((err) => {
      console.error("Failed to send usage alert email:", err);
      usageAlertsSent.delete(key);
    });
}
