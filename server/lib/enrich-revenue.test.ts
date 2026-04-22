// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  tierUnitPrice,
  enrichRevenueFromSub,
  loadSubMeta,
  loadMtdUsage,
  enrichRevenue,
  type SubMeta,
} from "./enrich-revenue.js";

function mockPool(queryFn: (...args: unknown[]) => unknown) {
  return { query: vi.fn(queryFn) } as unknown as import("pg").Pool;
}

describe("tierUnitPrice", () => {
  it("returns null for empty array", () => {
    expect(tierUnitPrice([], 0)).toBeNull();
  });

  it("returns null for non-array input", () => {
    expect(tierUnitPrice("not an array", 0)).toBeNull();
    expect(tierUnitPrice(null, 0)).toBeNull();
    expect(tierUnitPrice(undefined, 0)).toBeNull();
  });

  it("returns unit_amount / 100 for single tier within cap", () => {
    const tiers = [{ up_to: 1000, unit_amount: 500 }];
    expect(tierUnitPrice(tiers, 100)).toBe(5.0);
  });

  it("prefers unit_amount_decimal over unit_amount", () => {
    const tiers = [
      { up_to: 1000, unit_amount: 999, unit_amount_decimal: "250" },
    ];
    expect(tierUnitPrice(tiers, 100)).toBe(2.5);
  });

  it("selects correct tier in multi-tier setup", () => {
    const tiers = [
      { up_to: 100, unit_amount: 200 },
      { up_to: null, unit_amount: 100 },
    ];
    expect(tierUnitPrice(tiers, 50)).toBe(2.0);
    expect(tierUnitPrice(tiers, 150)).toBe(1.0);
  });

  it("treats up_to null as Infinity", () => {
    const tiers = [{ up_to: null, unit_amount: 300 }];
    expect(tierUnitPrice(tiers, 99999)).toBe(3.0);
  });

  it('treats up_to "inf" as Infinity', () => {
    const tiers = [{ up_to: "inf", unit_amount: 300 }];
    expect(tierUnitPrice(tiers, 99999)).toBe(3.0);
  });

  // Usage exactly at tier cap falls through to next tier (uses < not <=)
  it("at exact tier boundary, falls through to next tier", () => {
    const tiers = [
      { up_to: 100, unit_amount: 200 },
      { up_to: null, unit_amount: 100 },
    ];
    expect(tierUnitPrice(tiers, 100)).toBe(1.0);
  });

  it("falls back to last tier when all caps exceeded", () => {
    const tiers = [{ up_to: 10, unit_amount: 500 }];
    expect(tierUnitPrice(tiers, 20)).toBe(5.0);
  });

  it("handles null unit_amount as 0", () => {
    const tiers = [{ up_to: null, unit_amount: null }];
    expect(tierUnitPrice(tiers, 0)).toBe(0);
  });
});

describe("enrichRevenueFromSub", () => {
  const baseMeta: SubMeta = {
    mrr: 0,
    pricingModel: null,
    pricingTiers: null,
    unitPrice: null,
  };

  it("metered with unit price", () => {
    const meta: SubMeta = {
      ...baseMeta,
      pricingModel: "metered",
      unitPrice: 0.05,
    };
    expect(enrichRevenueFromSub(meta, 1000, 0)).toEqual({
      revenue: 50,
      revenueSource: "per_unit",
    });
  });

  it("metered with null unit price falls to subscription", () => {
    const meta: SubMeta = {
      ...baseMeta,
      pricingModel: "metered",
      unitPrice: null,
    };
    expect(enrichRevenueFromSub(meta, 1000, 0)).toEqual({
      revenue: 0,
      revenueSource: "subscription",
    });
  });

  it("tiered with valid tiers", () => {
    const meta: SubMeta = {
      ...baseMeta,
      pricingModel: "tiered",
      pricingTiers: [{ up_to: null, unit_amount: 100 }],
    };
    expect(enrichRevenueFromSub(meta, 500, 200)).toEqual({
      revenue: 500,
      revenueSource: "tiered",
    });
  });

  it("tiered with empty tiers falls to subscription", () => {
    const meta: SubMeta = {
      ...baseMeta,
      pricingModel: "tiered",
      pricingTiers: [],
    };
    expect(enrichRevenueFromSub(meta, 500, 0)).toEqual({
      revenue: 0,
      revenueSource: "subscription",
    });
  });

  it("hybrid with unit price", () => {
    const meta: SubMeta = {
      ...baseMeta,
      pricingModel: "hybrid",
      unitPrice: 0.1,
    };
    expect(enrichRevenueFromSub(meta, 1000, 0)).toEqual({
      revenue: 100,
      revenueSource: "hybrid",
    });
  });

  it("hybrid without unit price falls to subscription", () => {
    const meta: SubMeta = {
      ...baseMeta,
      pricingModel: "hybrid",
      unitPrice: null,
    };
    expect(enrichRevenueFromSub(meta, 1000, 0)).toEqual({
      revenue: 0,
      revenueSource: "subscription",
    });
  });

  // Flat pricing returns 0 revenue intentionally — MRR is attributed at query time
  it("flat pricing returns 0 with subscription source", () => {
    const meta: SubMeta = { ...baseMeta, pricingModel: "flat", mrr: 99 };
    expect(enrichRevenueFromSub(meta, 1000, 0)).toEqual({
      revenue: 0,
      revenueSource: "subscription",
    });
  });

  it("null pricing model returns subscription", () => {
    expect(enrichRevenueFromSub(baseMeta, 1000, 0)).toEqual({
      revenue: 0,
      revenueSource: "subscription",
    });
  });
});

describe("loadSubMeta", () => {
  it("returns null when no subscription found", async () => {
    const pool = mockPool(() => ({ rows: [] }));
    expect(await loadSubMeta(pool, 1, "cus_123")).toBeNull();
  });

  it("parses flat subscription row", async () => {
    const pool = mockPool(() => ({
      rows: [
        {
          mrr: "99.00",
          pricing_model: "flat",
          pricing_tiers: null,
          unit_price: null,
        },
      ],
    }));
    expect(await loadSubMeta(pool, 1, "cus_123")).toEqual({
      mrr: 99,
      pricingModel: "flat",
      pricingTiers: null,
      unitPrice: null,
    });
  });

  it("parses tiered subscription with JSON tiers", async () => {
    const tiers = [{ up_to: 100, unit_amount: 500 }];
    const pool = mockPool(() => ({
      rows: [
        {
          mrr: "0",
          pricing_model: "tiered",
          pricing_tiers: JSON.stringify(tiers),
          unit_price: null,
        },
      ],
    }));
    const result = await loadSubMeta(pool, 1, "cus_123");
    expect(result?.pricingTiers).toEqual(tiers);
  });

  it("passes correct params to query", async () => {
    const pool = mockPool(() => ({ rows: [] }));
    await loadSubMeta(pool, 42, "cus_abc");
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [
      42,
      "cus_abc",
    ]);
  });
});

describe("loadMtdUsage", () => {
  it("returns 0 for no events", async () => {
    const pool = mockPool(() => ({ rows: [{ usage: "0" }] }));
    expect(await loadMtdUsage(pool, 1, "cus_123")).toBe(0);
  });

  it("parses usage from string", async () => {
    const pool = mockPool(() => ({ rows: [{ usage: "1500.5" }] }));
    expect(await loadMtdUsage(pool, 1, "cus_123")).toBe(1500.5);
  });

  it("handles missing usage field gracefully", async () => {
    const pool = mockPool(() => ({ rows: [{}] }));
    expect(await loadMtdUsage(pool, 1, "cus_123")).toBe(0);
  });
});

describe("enrichRevenue", () => {
  it("returns none for null accountId", async () => {
    const pool = mockPool(() => ({ rows: [] }));
    expect(await enrichRevenue(pool, null, "cus_123", "feat", 1)).toEqual({
      revenue: 0,
      revenueSource: "none",
    });
  });

  it("feature pricing takes priority over subscription", async () => {
    const pool = mockPool((_sql: string) => {
      const sql = String(_sql);
      if (sql.includes("feature_pricing")) {
        return { rows: [{ revenue_per_unit: "0.25" }] };
      }
      return { rows: [] };
    });
    expect(await enrichRevenue(pool, 1, "cus_123", "chat", 100)).toEqual({
      revenue: 0.25,
      revenueSource: "feature_pricing",
    });
  });

  it("falls through to subscription when no feature pricing", async () => {
    const pool = mockPool((_sql: string) => {
      const sql = String(_sql);
      if (sql.includes("feature_pricing")) return { rows: [] };
      if (sql.includes("subscriptions")) {
        return {
          rows: [
            {
              mrr: "0",
              pricing_model: "metered",
              pricing_tiers: null,
              unit_price: "0.05",
            },
          ],
        };
      }
      return { rows: [] };
    });
    expect(await enrichRevenue(pool, 1, "cus_123", "chat", 1000)).toEqual({
      revenue: 50,
      revenueSource: "per_unit",
    });
  });

  it('returns none for customerId "unknown"', async () => {
    const pool = mockPool(() => ({ rows: [] }));
    expect(await enrichRevenue(pool, 1, "unknown", "feat", 1)).toEqual({
      revenue: 0,
      revenueSource: "none",
    });
  });

  it('returns none for customerId "default"', async () => {
    const pool = mockPool(() => ({ rows: [] }));
    expect(await enrichRevenue(pool, 1, "default", "feat", 1)).toEqual({
      revenue: 0,
      revenueSource: "none",
    });
  });

  it("returns none when no subscription exists", async () => {
    const pool = mockPool(() => ({ rows: [] }));
    expect(await enrichRevenue(pool, 1, "cus_123", "feat", 1)).toEqual({
      revenue: 0,
      revenueSource: "none",
    });
  });

  it("logs and returns none when subscription query throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let callCount = 0;
    const pool = mockPool(() => {
      callCount++;
      if (callCount === 1) return { rows: [] };
      throw new Error("db down");
    });
    const result = await enrichRevenue(pool, 1, "cus_123", "feat", 1);
    expect(result).toEqual({ revenue: 0, revenueSource: "none" });
    expect(consoleSpy).toHaveBeenCalledWith(
      "Subscription enrichment failed:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it("logs and falls through when feature pricing query throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let callCount = 0;
    const pool = mockPool(() => {
      callCount++;
      if (callCount === 1) throw new Error("fp table missing");
      return { rows: [] };
    });
    const result = await enrichRevenue(pool, 1, "cus_123", "feat", 1);
    expect(result).toEqual({ revenue: 0, revenueSource: "none" });
    expect(consoleSpy).toHaveBeenCalledWith(
      "Feature pricing lookup failed:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
