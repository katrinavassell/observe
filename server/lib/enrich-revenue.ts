import { Pool } from "pg";

export interface SubMeta {
  mrr: number;
  pricingModel: "flat" | "tiered" | "metered" | "hybrid" | null;
  pricingTiers: unknown | null;
  unitPrice: number | null;
}

export interface RevenueResult {
  revenue: number;
  revenueSource: string;
}

export function tierUnitPrice(tiers: unknown, mtdUsage: number): number | null {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  for (const t of tiers) {
    const row = t as {
      up_to: number | null | "inf";
      unit_amount?: number | null;
      unit_amount_decimal?: string | null;
    };
    const cap =
      row.up_to === null || row.up_to === "inf" ? Infinity : Number(row.up_to);
    if (mtdUsage < cap) {
      const amount =
        row.unit_amount_decimal != null
          ? parseFloat(row.unit_amount_decimal)
          : (row.unit_amount ?? 0);
      return amount / 100;
    }
  }
  const last = tiers[tiers.length - 1] as {
    unit_amount?: number | null;
    unit_amount_decimal?: string | null;
  };
  const amount =
    last.unit_amount_decimal != null
      ? parseFloat(last.unit_amount_decimal)
      : (last.unit_amount ?? 0);
  return amount / 100;
}

export function enrichRevenueFromSub(
  meta: SubMeta,
  usageUnits: number,
  mtdUsage: number,
): RevenueResult {
  if (meta.pricingModel === "metered" && meta.unitPrice != null) {
    return { revenue: meta.unitPrice * usageUnits, revenueSource: "per_unit" };
  }
  if (meta.pricingModel === "tiered" && meta.pricingTiers != null) {
    const price = tierUnitPrice(meta.pricingTiers, mtdUsage);
    if (price != null) {
      return { revenue: price * usageUnits, revenueSource: "tiered" };
    }
    return { revenue: 0, revenueSource: "subscription" };
  }
  if (meta.pricingModel === "hybrid") {
    const metered = meta.unitPrice != null ? meta.unitPrice * usageUnits : 0;
    if (metered > 0) {
      return { revenue: metered, revenueSource: "hybrid" };
    }
    return { revenue: 0, revenueSource: "subscription" };
  }
  return { revenue: 0, revenueSource: "subscription" };
}

export async function loadSubMeta(
  pool: Pool,
  accountId: number,
  customerId: string,
): Promise<SubMeta | null> {
  const result = await pool.query(
    `SELECT SUM(COALESCE(s.mrr_override, 0)) AS mrr,
            MAX(s.pricing_model) AS pricing_model,
            MAX(CASE WHEN s.pricing_model = 'tiered' OR s.pricing_model = 'hybrid'
                     THEN s.pricing_tiers::text END) AS pricing_tiers,
            MAX(s.unit_price) AS unit_price
     FROM subscriptions s
     WHERE s.account_id = $1 AND s.is_active = true AND s.customer_id = $2
     GROUP BY s.customer_id`,
    [accountId, customerId],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    mrr: parseFloat(row.mrr) || 0,
    pricingModel: row.pricing_model,
    pricingTiers: row.pricing_tiers ? JSON.parse(row.pricing_tiers) : null,
    unitPrice: row.unit_price != null ? parseFloat(row.unit_price) : null,
  };
}

export async function loadMtdUsage(
  pool: Pool,
  accountId: number,
  customerId: string,
): Promise<number> {
  const result = await pool.query(
    `SELECT COALESCE(SUM(usage_units), 0) AS usage
     FROM observe_events
     WHERE account_id = $1 AND customer_id = $2
       AND timestamp >= date_trunc('month', NOW())`,
    [accountId, customerId],
  );
  return parseFloat(result.rows[0]?.usage) || 0;
}

export async function enrichRevenue(
  pool: Pool,
  accountId: number | null,
  customerId: string,
  featureKey: string,
  usageUnits: number,
): Promise<RevenueResult> {
  if (accountId == null) return { revenue: 0, revenueSource: "none" };

  try {
    const fpResult = await pool.query(
      "SELECT revenue_per_unit FROM feature_pricing WHERE account_id = $1 AND feature_key = $2",
      [accountId, featureKey],
    );
    if (fpResult.rows.length > 0) {
      return {
        revenue: parseFloat(fpResult.rows[0].revenue_per_unit),
        revenueSource: "feature_pricing",
      };
    }
  } catch (err) {
    console.error("Feature pricing lookup failed:", err);
  }

  if (!customerId || customerId === "unknown" || customerId === "default") {
    return { revenue: 0, revenueSource: "none" };
  }

  try {
    const meta = await loadSubMeta(pool, accountId, customerId);
    if (!meta) return { revenue: 0, revenueSource: "none" };

    const mtdUsage =
      meta.pricingModel === "tiered" || meta.pricingModel === "hybrid"
        ? await loadMtdUsage(pool, accountId, customerId)
        : 0;

    return enrichRevenueFromSub(meta, usageUnits, mtdUsage);
  } catch (err) {
    console.error("Subscription enrichment failed:", err);
    return { revenue: 0, revenueSource: "none" };
  }
}
