import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  calculateMRR,
  calculateMRRMovement,
  calculatePlanHealth,
  calculateCohorts,
  analyzeUsageAnomalies,
  analyzeNegativeMargins,
  analyzeData,
  type Plan,
  type Subscription,
  type Customer,
  type UsageRecord,
  type CostRecord,
  type AnalyzerData,
} from "./pricing-analyzer";

// =============================================================================
// TEST DATA
// =============================================================================

const plans: Plan[] = [
  { plan_id: "starter", name: "Starter", price_amount: 29 },
  { plan_id: "pro", name: "Pro", price_amount: 99 },
  { plan_id: "enterprise", name: "Enterprise", price_amount: 299 },
  {
    plan_id: "annual",
    name: "Annual Pro",
    price_amount: 948,
    interval_months: 12,
  },
];

const customers: Customer[] = [
  { customer_id: "c1", email: "a@test.com", name: "Alpha Corp" },
  { customer_id: "c2", email: "b@test.com", name: "Beta Inc" },
  { customer_id: "c3", email: "c@test.com", name: "Gamma LLC" },
];

// =============================================================================
// formatCurrency
// =============================================================================

describe("formatCurrency", () => {
  it("formats small amounts without suffix", () => {
    expect(formatCurrency(0)).toBe("$0");
    expect(formatCurrency(500)).toBe("$500");
    expect(formatCurrency(999)).toBe("$999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatCurrency(1000)).toBe("$1.0k");
    expect(formatCurrency(5500)).toBe("$5.5k");
    expect(formatCurrency(999999)).toBe("$1000.0k");
  });

  it("formats millions with M suffix", () => {
    expect(formatCurrency(1000000)).toBe("$1.0M");
    expect(formatCurrency(2500000)).toBe("$2.5M");
  });
});

// =============================================================================
// calculateMRR
// =============================================================================

describe("calculateMRR", () => {
  it("returns 0 for empty subscriptions", () => {
    expect(calculateMRR([], plans)).toBe(0);
  });

  it("calculates MRR from active subscriptions", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "starter",
        is_active: true,
      },
      {
        subscription_id: "s2",
        customer_id: "c2",
        plan_id: "pro",
        is_active: true,
      },
    ];
    expect(calculateMRR(subs, plans)).toBe(29 + 99);
  });

  it("ignores inactive subscriptions", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "starter",
        is_active: true,
      },
      {
        subscription_id: "s2",
        customer_id: "c2",
        plan_id: "pro",
        is_active: false,
      },
    ];
    expect(calculateMRR(subs, plans)).toBe(29);
  });

  it("uses mrr_override when provided", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "pro",
        is_active: true,
        mrr_override: 150,
      },
    ];
    expect(calculateMRR(subs, plans)).toBe(150);
  });

  it("normalizes annual plans to monthly", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "annual",
        is_active: true,
      },
    ];
    // 948 / 12 = 79
    expect(calculateMRR(subs, plans)).toBe(79);
  });

  it("skips subscriptions with unknown plan_id", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "nonexistent",
        is_active: true,
      },
    ];
    expect(calculateMRR(subs, plans)).toBe(0);
  });
});

// =============================================================================
// calculateMRRMovement
// =============================================================================

describe("calculateMRRMovement", () => {
  it("returns zeros for empty subscriptions", () => {
    const result = calculateMRRMovement([], plans);
    expect(result.new).toBe(0);
    expect(result.expansion).toBe(0);
    expect(result.contraction).toBe(0);
    expect(result.churned).toBe(0);
    expect(result.netNew).toBe(0);
  });

  it("detects churned subscriptions", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "pro",
        is_active: false,
        cancelled_at: new Date().toISOString(),
        previous_mrr: 99,
      },
    ];
    const result = calculateMRRMovement(subs, plans);
    expect(result.churned).toBe(99);
    expect(result.netNew).toBe(-99);
  });

  it("detects expansion (upgrade)", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "enterprise",
        is_active: true,
        previous_mrr: 99,
      },
    ];
    const result = calculateMRRMovement(subs, plans);
    expect(result.expansion).toBe(200); // 299 - 99
  });

  it("detects contraction (downgrade)", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "starter",
        is_active: true,
        previous_mrr: 99,
      },
    ];
    const result = calculateMRRMovement(subs, plans);
    expect(result.contraction).toBe(70); // 99 - 29
  });

  it("calculates correct netNew", () => {
    const now = new Date();
    const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

    const subs: Subscription[] = [
      // New subscription
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "pro",
        is_active: true,
        current_period_start: recentDate.toISOString(),
        previous_mrr: 0,
      },
      // Churned subscription
      {
        subscription_id: "s2",
        customer_id: "c2",
        plan_id: "starter",
        is_active: false,
        cancelled_at: now.toISOString(),
        previous_mrr: 29,
      },
    ];
    const result = calculateMRRMovement(subs, plans);
    expect(result.new).toBe(99);
    expect(result.churned).toBe(29);
    expect(result.netNew).toBe(70);
  });
});

// =============================================================================
// calculatePlanHealth
// =============================================================================

describe("calculatePlanHealth", () => {
  it("returns health for each plan", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "starter",
        is_active: true,
      },
      {
        subscription_id: "s2",
        customer_id: "c2",
        plan_id: "pro",
        is_active: true,
      },
    ];
    const result = calculatePlanHealth(subs, plans, customers);
    expect(result.length).toBe(plans.length);

    const proPlan = result.find((p) => p.planId === "pro");
    expect(proPlan).toBeDefined();
    expect(proPlan!.customerCount).toBe(1);
    expect(proPlan!.totalMRR).toBe(99);
  });

  it("gives starter plans a lower health score", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "starter",
        is_active: true,
      },
      {
        subscription_id: "s2",
        customer_id: "c2",
        plan_id: "enterprise",
        is_active: true,
      },
    ];
    const result = calculatePlanHealth(subs, plans, customers);
    const starter = result.find((p) => p.planId === "starter")!;
    const enterprise = result.find((p) => p.planId === "enterprise")!;
    expect(starter.healthScore).toBeLessThan(enterprise.healthScore);
  });

  it("detects negative margin customers", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "starter",
        is_active: true,
      },
    ];
    const costs: CostRecord[] = [
      {
        customer_id: "c1",
        cost_type: "api",
        amount: 100,
        period_start: "2024-01-01",
      },
    ];
    const result = calculatePlanHealth(
      subs,
      plans,
      customers,
      undefined,
      costs,
    );
    const starter = result.find((p) => p.planId === "starter")!;
    expect(starter.negativeMarginCount).toBe(1);
    expect(starter.negativeMarginCustomers).toContain("Alpha Corp");
  });

  it("sorts results by total MRR descending", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "starter",
        is_active: true,
      },
      {
        subscription_id: "s2",
        customer_id: "c2",
        plan_id: "enterprise",
        is_active: true,
      },
    ];
    const result = calculatePlanHealth(subs, plans, customers);
    expect(result[0].planId).toBe("enterprise");
  });
});

// =============================================================================
// analyzeUsageAnomalies
// =============================================================================

describe("analyzeUsageAnomalies", () => {
  it("returns empty array for no usage data", () => {
    expect(analyzeUsageAnomalies([], [], plans, customers)).toEqual([]);
  });

  it("detects upsell-ready customers near plan limit", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "starter",
        is_active: true,
      },
    ];
    const usage: UsageRecord[] = [
      {
        customer_id: "c1",
        metric_key: "api_calls",
        metric_value: 950,
        metric_limit: 1000,
        period_start: "2024-03-01",
      },
    ];
    const result = analyzeUsageAnomalies(usage, subs, plans, customers);
    const upsell = result.find((a) => a.status === "upsell");
    expect(upsell).toBeDefined();
    expect(upsell!.customerId).toBe("c1");
  });

  it("detects churn risk from declining usage", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "pro",
        is_active: true,
      },
    ];
    const usage: UsageRecord[] = [
      {
        customer_id: "c1",
        metric_key: "api_calls",
        metric_value: 1000,
        metric_limit: 5000,
        period_start: "2024-01-01",
      },
      {
        customer_id: "c1",
        metric_key: "api_calls",
        metric_value: 800,
        metric_limit: 5000,
        period_start: "2024-02-01",
      },
      {
        customer_id: "c1",
        metric_key: "api_calls",
        metric_value: 500,
        metric_limit: 5000,
        period_start: "2024-03-01",
      },
      {
        customer_id: "c1",
        metric_key: "api_calls",
        metric_value: 200,
        metric_limit: 5000,
        period_start: "2024-04-01",
      },
    ];
    const result = analyzeUsageAnomalies(usage, subs, plans, customers);
    const churnRisk = result.find((a) => a.status === "churn_risk");
    expect(churnRisk).toBeDefined();
    expect(churnRisk!.customerId).toBe("c1");
  });
});

// =============================================================================
// analyzeNegativeMargins
// =============================================================================

describe("analyzeNegativeMargins", () => {
  it("returns empty array for no cost data", () => {
    expect(analyzeNegativeMargins([], [], plans, customers)).toEqual([]);
  });

  it("identifies customers where costs exceed revenue", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "starter",
        is_active: true,
      },
    ];
    const costs: CostRecord[] = [
      { customer_id: "c1", cost_type: "api", amount: 40 },
    ];
    // Starter = $29, cost = $40 → negative margin (ratio 1.38x → "Costs exceed revenue")
    const result = analyzeNegativeMargins(costs, subs, plans, customers);
    expect(result.length).toBe(1);
    expect(result[0].customerId).toBe("c1");
    expect(result[0].reason).toBe("Costs exceed revenue");
  });

  it("flags heavy usage for extreme cost overruns", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "starter",
        is_active: true,
      },
    ];
    const costs: CostRecord[] = [
      { customer_id: "c1", cost_type: "api", amount: 100 },
    ];
    // 100 > 29 * 2 → "Extremely high usage"
    const result = analyzeNegativeMargins(costs, subs, plans, customers);
    expect(result[0].reason).toBe("Extremely high usage");
  });

  it("ignores customers with positive margins", () => {
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "enterprise",
        is_active: true,
      },
    ];
    const costs: CostRecord[] = [
      { customer_id: "c1", cost_type: "api", amount: 50 },
    ];
    // Enterprise = $299, cost = $50 → positive
    const result = analyzeNegativeMargins(costs, subs, plans, customers);
    expect(result.length).toBe(0);
  });
});

// =============================================================================
// calculateCohorts
// =============================================================================

describe("calculateCohorts", () => {
  it("returns empty array for no customers", () => {
    expect(calculateCohorts([], [], plans)).toEqual([]);
  });

  it("groups customers by signup month", () => {
    const cohortCustomers: Customer[] = [
      {
        customer_id: "c1",
        email: "a@test.com",
        name: "A",
        created_at: "2024-01-15",
      },
      {
        customer_id: "c2",
        email: "b@test.com",
        name: "B",
        created_at: "2024-01-20",
      },
      {
        customer_id: "c3",
        email: "c@test.com",
        name: "C",
        created_at: "2024-02-10",
      },
    ];
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "pro",
        is_active: true,
      },
      {
        subscription_id: "s2",
        customer_id: "c2",
        plan_id: "pro",
        is_active: true,
      },
      {
        subscription_id: "s3",
        customer_id: "c3",
        plan_id: "starter",
        is_active: true,
      },
    ];
    const result = calculateCohorts(cohortCustomers, subs, plans);
    expect(result.length).toBe(2);

    const janCohort = result.find((c) => c.cohort.includes("Jan"));
    expect(janCohort).toBeDefined();
    expect(janCohort!.customerCount).toBe(2);
  });

  it("calculates retention rate correctly", () => {
    const cohortCustomers: Customer[] = [
      { customer_id: "c1", email: "a@test.com", created_at: "2024-01-15" },
      { customer_id: "c2", email: "b@test.com", created_at: "2024-01-20" },
    ];
    const subs: Subscription[] = [
      {
        subscription_id: "s1",
        customer_id: "c1",
        plan_id: "pro",
        is_active: true,
      },
      {
        subscription_id: "s2",
        customer_id: "c2",
        plan_id: "pro",
        is_active: false,
        cancelled_at: "2024-03-01",
      },
    ];
    const result = calculateCohorts(cohortCustomers, subs, plans);
    const cohort = result[0];
    expect(cohort.activeCount).toBe(1);
    expect(cohort.churnedCount).toBe(1);
    expect(cohort.retentionRate).toBe(50);
  });
});

// =============================================================================
// analyzeData (integration)
// =============================================================================

describe("analyzeData", () => {
  it("returns complete analysis for minimal data", () => {
    const data: AnalyzerData = {
      customers,
      plans,
      subscriptions: [
        {
          subscription_id: "s1",
          customer_id: "c1",
          plan_id: "starter",
          is_active: true,
        },
        {
          subscription_id: "s2",
          customer_id: "c2",
          plan_id: "pro",
          is_active: true,
        },
      ],
    };

    const result = analyzeData(data);

    expect(result.saasMetrics.mrr).toBe(128); // 29 + 99
    expect(result.saasMetrics.arr).toBe(128 * 12);
    expect(result.saasMetrics.customerCount).toBe(2);
    expect(result.saasMetrics.arpu).toBe(64); // 128 / 2
    expect(result.planHealth).toBeDefined();
    expect(result.planHealth.length).toBeGreaterThan(0);
  });

  it("handles empty data gracefully", () => {
    const data: AnalyzerData = {
      customers: [],
      plans: [],
      subscriptions: [],
    };

    const result = analyzeData(data);

    expect(result.saasMetrics.mrr).toBe(0);
    expect(result.saasMetrics.arr).toBe(0);
    expect(result.saasMetrics.customerCount).toBe(0);
    expect(result.saasMetrics.arpu).toBe(0);
  });

  it("includes cost and margin data when costs are provided", () => {
    const data: AnalyzerData = {
      customers,
      plans,
      subscriptions: [
        {
          subscription_id: "s1",
          customer_id: "c1",
          plan_id: "pro",
          is_active: true,
        },
      ],
      costs: [
        {
          customer_id: "c1",
          cost_type: "infrastructure",
          amount: 30,
          period_start: "2024-01-01",
        },
      ],
    };

    const result = analyzeData(data);
    expect(result.saasMetrics.totalCosts).toBeGreaterThanOrEqual(0);
    expect(result.saasMetrics.margin).toBeDefined();
  });
});
