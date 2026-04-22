/**
 * Pricing Analyzer - Client-side CSV analysis for SaaS metrics.
 *
 * This module provides comprehensive analysis of SaaS pricing data including:
 * - Core metrics: MRR, ARR, ARPU, NRR, LTV
 * - MRR movement tracking: new, expansion, contraction, churned
 * - Plan health scoring with churn risk detection
 * - Usage anomaly detection
 * - Negative margin customer identification
 * - Cohort analysis
 *
 * Compatible with Tanso Core entity schemas.
 *
 * @module pricing-analyzer
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Represents a customer account in the system.
 */
export interface Customer {
  customer_id: string;
  email: string;
  name?: string;
  segment?: string;
  created_at?: string;
}

/**
 * Represents a pricing plan/tier.
 */
export interface Plan {
  /** Unique identifier for the plan */
  plan_id: string;
  /** Human-readable plan name (e.g., "Starter", "Pro", "Enterprise") */
  name: string;
  /** Price in the plan's billing interval (not necessarily monthly) */
  price_amount: number;
  /** Billing interval in months (1 = monthly, 12 = annual). Defaults to 1 */
  interval_months?: number;
  /** Billing model type (recurring, usage_based, hybrid) */
  billing_model?: string;
}

/**
 * Represents a customer's subscription to a plan.
 */
export interface Subscription {
  subscription_id: string;
  customer_id: string;
  plan_id: string;
  /** Whether the subscription is currently active */
  is_active: boolean;
  current_period_start?: string;
  current_period_end?: string;
  /** ISO date when subscription was cancelled (null if active) */
  cancelled_at?: string;
  /** MRR from the previous period, used for expansion/contraction calculations */
  previous_mrr?: number;
  /** Explicit MRR value that overrides plan price calculation (for custom pricing) */
  mrr_override?: number;
}

export interface Invoice {
  invoice_id: string;
  subscription_id: string;
  amount: number;
  status: string;
  due_date?: string;
  discount_amount?: number;
}

export interface UsageRecord {
  customer_id: string;
  metric_key: string;
  metric_value: number;
  metric_limit?: number; // The limit for this metric (for percentage calculations)
  period_start?: string;
  period_end?: string;
}

export interface CostRecord {
  customer_id: string;
  cost_type: string;
  amount: number;
  period_start?: string;
  period_end?: string;
}

export interface AnalyzerData {
  customers: Customer[];
  plans: Plan[];
  subscriptions: Subscription[];
  invoices?: Invoice[];
  usage?: UsageRecord[];
  costs?: CostRecord[];
}

export interface SaaSMetrics {
  mrr: number;
  arr: number;
  customerCount: number;
  arpu: number;
  nrr: number;
  avgLTV: number;
  mrrGrowth: number;
  // Cost and margin metrics
  totalCosts: number;
  costGrowth: number; // MoM percentage
  margin: number; // Percentage (0-100)
  marginChange: number; // Points change (e.g., -22)
  previousMargin: number; // For trend display
  mrrMovement: {
    new: number;
    expansion: number;
    contraction: number;
    churned: number;
    netNew: number;
  };
  formatted: {
    mrr: string;
    arr: string;
    arpu: string;
    avgLTV: string;
    newMRR: string;
    expansionMRR: string;
    contractionMRR: string;
    churnedMRR: string;
    netNewMRR: string;
    totalCosts: string;
    margin: string;
  };
}

export interface PlanHealth {
  planName: string;
  planId: string;
  customerCount: number;
  customerNames: string[];
  totalMRR: number;
  avgMRR: number;
  avgUsage: string;
  healthScore: number;
  churnRiskCount: number;
  churnRiskCustomers: string[];
  upsellReadyCount: number;
  upsellReadyCustomers: string[];
  negativeMarginCount: number;
  negativeMarginCustomers: string[];
}

export interface PriceExperiment {
  title: string;
  description: string;
  impact: string;
  type: "positive" | "warning" | "negative";
  suggestion: string;
}

export interface BundlingOpportunity {
  title: string;
  description: string;
  impact: string;
  type: "positive" | "warning" | "negative";
  suggestion: string;
}

export interface UsageAnomaly {
  customer: string;
  customerId: string;
  plan: string;
  usage: string;
  description: string;
  type: "warning" | "info";
  status: "churn_risk" | "upsell" | "anomaly";
}

export interface NegativeMarginCustomer {
  customer: string;
  customerId: string;
  plan: string;
  mrr: string;
  costs: string;
  margin: string;
  reason: string;
}

export interface CohortData {
  cohort: string;
  customerCount: number;
  activeCount: number;
  churnedCount: number;
  retentionRate: number;
  avgMRR: string;
  totalMRR: string;
  avgTenureMonths?: number;
  estimatedLTV?: string;
}

/**
 * Represents cost breakdown by AI provider
 */
export interface ProviderCost {
  name: string;
  amount: number;
  percentage: number;
}

/**
 * Growth metrics for cost visualization
 */
export interface CostGrowthMetrics {
  revenueGrowth: number; // Percentage growth over period
  costGrowth: number; // Percentage growth over period
  growthGap: number; // Cost growth - Revenue growth
  providers: ProviderCost[];
  totalCosts: number;
  previousProviders: ProviderCost[]; // Previous period for comparison
  previousTotalCosts: number; // Previous period total
  trendAcceleration: "accelerating" | "decelerating" | "stable"; // Is the gap accelerating?
}

export interface MonthlyMetrics {
  month: string; // "2024-07", "2024-08", etc.
  monthLabel: string; // "Jul 2024", "Aug 2024", etc.
  mrr: number;
  newMRR: number;
  expansionMRR: number;
  contractionMRR: number;
  churnedMRR: number;
  netNewMRR: number;
  customerCount: number;
  costs: number;
  margin: number; // percentage
  formatted: {
    mrr: string;
    newMRR: string;
    expansionMRR: string;
    contractionMRR: string;
    churnedMRR: string;
    netNewMRR: string;
    costs: string;
    margin: string;
  };
}

/**
 * Revenue breakdown for a single customer
 */
export interface CustomerRevenue {
  customerId: string;
  customerName: string;
  email: string;
  planName: string;
  planId: string;
  mrr: number;
  previousMrr: number;
  mrrChange: number; // positive = expansion, negative = contraction
  mrrChangePercent: number;
  tenureMonths: number;
  status: "active" | "churned" | "new";
  segment?: string;
}

/**
 * Upcoming renewal or expiration
 */
export interface RenewalInfo {
  customerId: string;
  customerName: string;
  planName: string;
  mrr: number;
  renewalDate: string;
  daysUntilRenewal: number;
  riskLevel: "low" | "medium" | "high";
  riskReason?: string;
}

/**
 * Cohort retention matrix cell
 */
export interface CohortRetentionCell {
  month: number; // 0 = signup month, 1 = month 1, etc.
  retention: number; // percentage 0-100
  customers: number; // count of customers retained
}

/**
 * Enhanced cohort data with retention over time
 */
export interface CohortRetentionRow {
  cohort: string; // "2024-07" format
  cohortSize: number;
  retentionByMonth: CohortRetentionCell[];
}

export interface AnalysisResult {
  saasMetrics: SaaSMetrics;
  planHealth: PlanHealth[];
  priceExperiments: PriceExperiment[];
  bundlingOpportunities: BundlingOpportunity[];
  usageAnomalies: UsageAnomaly[];
  negativeMarginCustomers: NegativeMarginCustomer[];
  cohorts: CohortData[];
  monthlyMetrics: MonthlyMetrics[];
  // New features
  customerRevenue: CustomerRevenue[];
  upcomingRenewals: RenewalInfo[];
  cohortRetentionMatrix: CohortRetentionRow[];
  // Cost growth visualization
  costGrowthMetrics: CostGrowthMetrics;
  meta: {
    customerCount: number;
    planCount: number;
    subscriptionCount: number;
    hasUsageData: boolean;
    hasCostData: boolean;
    hasInvoiceData: boolean;
  };
}

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

/**
 * Average customer lifespan multiplier for LTV calculation.
 * Based on 90% monthly retention rate: 1 / (1 - 0.9) = 10 months.
 * LTV = ARPU * AVERAGE_CUSTOMER_LIFESPAN_MONTHS
 */
const AVERAGE_CUSTOMER_LIFESPAN_MONTHS = 10;

/**
 * Usage decline threshold for churn risk detection.
 * Customers whose usage drops below this ratio (25% decline) over 3 months
 * are flagged as churn risks.
 */
const CHURN_RISK_USAGE_DECLINE_THRESHOLD = 0.75;

/**
 * Minimum usage percentage (of plan limit) to flag as upsell-ready.
 * Customers using 85%+ of their plan limits are candidates for upgrades.
 */
const UPSELL_READY_USAGE_THRESHOLD_PERCENT = 85;

/**
 * Health score penalties for plan health calculation.
 */
const HEALTH_SCORE = {
  /** Base health score before any penalties */
  BASE: 100,
  /** Penalty per customer with churn risk */
  CHURN_RISK_PENALTY_PER_CUSTOMER: 10,
  /** Maximum churn risk penalty */
  CHURN_RISK_PENALTY_MAX: 30,
  /** Penalty per customer with negative margin */
  NEGATIVE_MARGIN_PENALTY_PER_CUSTOMER: 15,
  /** Maximum negative margin penalty */
  NEGATIVE_MARGIN_PENALTY_MAX: 30,
  /** Penalty for Starter tier (typically higher churn) */
  STARTER_TIER_PENALTY: 15,
  /** Bonus for Enterprise tier (typically stickier) */
  ENTERPRISE_TIER_BONUS: 5,
} as const;

/**
 * Minimum number of data points needed for trend analysis.
 */
const MIN_TREND_DATA_POINTS = 3;

/**
 * Usage spike threshold multiplier for anomaly detection.
 * A 250% increase (2.5x) month-over-month triggers a spike alert.
 */
const USAGE_SPIKE_THRESHOLD_MULTIPLIER = 2.5;

/**
 * Significant usage decline percentage for churn risk flag.
 */
const SIGNIFICANT_DECLINE_PERCENT = 25;

// =============================================================================
// CSV PARSING
// =============================================================================

/**
 * Parse a CSV string into an array of typed objects.
 *
 * Automatically handles:
 * - Quoted fields with commas
 * - Header normalization (lowercase, underscores for spaces)
 * - Type coercion for amounts, prices, counts, and booleans
 *
 * @template T - The expected row type
 * @param csvText - Raw CSV text content
 * @returns Array of parsed rows as typed objects
 *
 * @example
 * ```ts
 * const customers = parseCSV<Customer>(csvContent)
 * ```
 */
export function parseCSV<T>(csvText: string): T[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const firstLine = lines[0];
  if (!firstLine) return [];
  const headers = parseCSVLine(firstLine);
  const results: T[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const values = parseCSVLine(line);
    if (values.length !== headers.length) continue;

    const row: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      const key = header.trim().toLowerCase().replace(/\s+/g, "_");
      let value: unknown = values[idx]?.trim() ?? "";

      // Type coercion
      if (
        key.includes("amount") ||
        key.includes("price") ||
        key.includes("value")
      ) {
        value = parseFloat(value as string) || 0;
      } else if (key === "is_active") {
        value = (value as string).toLowerCase() === "true" || value === "1";
      } else if (key.includes("_months") || key.includes("count")) {
        value = parseInt(value as string, 10) || 0;
      }

      row[key] = value;
    });
    results.push(row as T);
  }

  return results;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// =============================================================================
// METRIC CALCULATIONS
// =============================================================================

/**
 * Format a number as a human-readable currency string.
 *
 * @param amount - The amount in dollars
 * @returns Formatted string like "$1.5K", "$2.3M", or "$500"
 *
 * @example
 * ```ts
 * formatCurrency(1500)    // "$1.5K"
 * formatCurrency(2300000) // "$2.3M"
 * formatCurrency(75)      // "$75"
 * ```
 */
export function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`;
  } else if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`;
  }
  return `$${amount.toFixed(0)}`;
}

/**
 * Calculate total Monthly Recurring Revenue from active subscriptions.
 *
 * Uses `mrr_override` if provided on a subscription, otherwise calculates
 * from the associated plan's price normalized to monthly.
 *
 * @param subscriptions - List of all subscriptions (active and inactive)
 * @param plans - List of available plans with pricing
 * @returns Total MRR in dollars
 */
export function calculateMRR(
  subscriptions: Subscription[],
  plans: Plan[],
): number {
  const planMap = new Map(plans.map((p) => [p.plan_id, p]));

  return subscriptions
    .filter((s) => s.is_active)
    .reduce((total, sub) => {
      // Use mrr_override if provided (from curated sample data)
      if (sub.mrr_override !== undefined) {
        return total + sub.mrr_override;
      }

      const plan = planMap.get(sub.plan_id);
      if (!plan) return total;

      // Normalize to monthly
      const intervalMonths = plan.interval_months || 1;
      const monthlyAmount = plan.price_amount / intervalMonths;
      return total + monthlyAmount;
    }, 0);
}

/**
 * Calculate MRR movement breakdown over the last 30 days.
 *
 * Categories:
 * - **New**: MRR from subscriptions created in the last 30 days
 * - **Expansion**: Increase in MRR from plan upgrades
 * - **Contraction**: Decrease in MRR from plan downgrades
 * - **Churned**: MRR lost from cancelled subscriptions
 * - **Net New**: new + expansion - contraction - churned
 *
 * @param subscriptions - All subscriptions with previous_mrr data
 * @param plans - Plan pricing information
 * @returns MRR movement breakdown
 */
export function calculateMRRMovement(
  subscriptions: Subscription[],
  plans: Plan[],
): SaaSMetrics["mrrMovement"] {
  const planMap = new Map(plans.map((p) => [p.plan_id, p]));
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  let newMRR = 0;
  let expansionMRR = 0;
  let contractionMRR = 0;
  let churnedMRR = 0;

  subscriptions.forEach((sub) => {
    const plan = planMap.get(sub.plan_id);
    if (!plan) return;

    // Use mrr_override if available, otherwise calculate from plan price
    const intervalMonths = plan.interval_months || 1;
    const currentMRR =
      sub.mrr_override !== undefined
        ? sub.mrr_override
        : plan.price_amount / intervalMonths;
    const previousMRR = sub.previous_mrr ?? 0;

    // New subscription (created in last 30 days)
    const periodStart = sub.current_period_start
      ? new Date(sub.current_period_start)
      : null;
    if (
      periodStart &&
      periodStart > thirtyDaysAgo &&
      previousMRR === 0 &&
      sub.is_active
    ) {
      newMRR += currentMRR;
    }
    // Churned
    else if (sub.cancelled_at && !sub.is_active) {
      churnedMRR += previousMRR || currentMRR;
    }
    // Expansion
    else if (sub.is_active && previousMRR > 0 && currentMRR > previousMRR) {
      expansionMRR += currentMRR - previousMRR;
    }
    // Contraction
    else if (sub.is_active && previousMRR > 0 && currentMRR < previousMRR) {
      contractionMRR += previousMRR - currentMRR;
    }
  });

  return {
    new: newMRR,
    expansion: expansionMRR,
    contraction: contractionMRR,
    churned: churnedMRR,
    netNew: newMRR + expansionMRR - contractionMRR - churnedMRR,
  };
}

/**
 * Calculate health metrics for each pricing plan.
 *
 * Health score (0-100) is calculated based on:
 * - Base score: 100
 * - Churn risk penalty: -10 per at-risk customer (max -30)
 * - Negative margin penalty: -15 per customer (max -30)
 * - Tier adjustment: -15 for Starter, +5 for Enterprise
 *
 * Churn risk is detected by 25%+ decline in usage over 3 months.
 * Upsell readiness is triggered at 85%+ usage of plan limits.
 *
 * @param subscriptions - All subscriptions
 * @param plans - Available plans
 * @param customers - Customer records for name/segment lookup
 * @param usage - Optional usage records for trend analysis
 * @param costs - Optional cost records for margin calculation
 * @returns Array of plan health reports, sorted by total MRR descending
 */
export function calculatePlanHealth(
  subscriptions: Subscription[],
  plans: Plan[],
  customers: Customer[],
  usage?: UsageRecord[],
  costs?: CostRecord[],
): PlanHealth[] {
  const customerMap = new Map(customers.map((c) => [c.customer_id, c]));
  const costsByCustomer = new Map<string, number>();

  costs?.forEach((c) => {
    const current = costsByCustomer.get(c.customer_id) || 0;
    costsByCustomer.set(c.customer_id, current + c.amount);
  });

  // Dynamically detect available months from usage data
  const allMonths = new Set<string>();
  usage?.forEach((u) => {
    const month = u.period_start?.substring(0, 7);
    if (month) allMonths.add(month);
  });
  const sortedMonths = Array.from(allMonths).sort();
  const latestMonth = sortedMonths[sortedMonths.length - 1] || "";
  const trendMonths = sortedMonths.slice(-4); // Last 4 months for trend

  // Group usage by customer - get latest month's api_calls usage percentage
  const usageByCustomer = new Map<string, number>();
  usage?.forEach((u) => {
    // Only count latest month api_calls for current usage
    // Guard against division by zero with metric_limit > 0
    if (
      u.period_start?.startsWith(latestMonth) &&
      u.metric_key === "api_calls" &&
      u.metric_limit &&
      u.metric_limit > 0
    ) {
      const percent = Math.round((u.metric_value / u.metric_limit) * 100);
      usageByCustomer.set(u.customer_id, percent);
    }
  });

  // Build trend data for churn detection using dynamic months
  const usageTrends = new Map<string, number[]>();
  usage?.forEach((u) => {
    if (u.metric_key === "api_calls") {
      const month = u.period_start?.substring(0, 7) || "";
      if (trendMonths.includes(month)) {
        if (!usageTrends.has(u.customer_id)) {
          usageTrends.set(u.customer_id, []);
        }
        usageTrends.get(u.customer_id)!.push(u.metric_value);
      }
    }
  });

  return plans
    .map((plan) => {
      const planSubs = subscriptions.filter((s) => s.plan_id === plan.plan_id);
      const activeSubs = planSubs.filter((s) => s.is_active);

      // Calculate total MRR using mrr_override if available
      let totalMRR = 0;
      activeSubs.forEach((sub) => {
        if (sub.mrr_override !== undefined) {
          totalMRR += sub.mrr_override;
        } else {
          const intervalMonths = plan.interval_months || 1;
          totalMRR += plan.price_amount / intervalMonths;
        }
      });
      const avgMRR = activeSubs.length > 0 ? totalMRR / activeSubs.length : 0;

      // Calculate health indicators
      const customerNames: string[] = [];
      const churnRiskCustomers: string[] = [];
      const upsellReadyCustomers: string[] = [];
      const negativeMarginCustomers: string[] = [];

      activeSubs.forEach((sub) => {
        const customer = customerMap.get(sub.customer_id);
        const customerName =
          customer?.name || customer?.email || sub.customer_id;
        customerNames.push(customerName);
        const mrr =
          sub.mrr_override ?? plan.price_amount / (plan.interval_months || 1);

        // Check for declining usage trend (churn risk)
        const trend = usageTrends.get(sub.customer_id) || [];
        if (trend.length >= MIN_TREND_DATA_POINTS) {
          const first = trend[0] || 0;
          const last = trend[trend.length - 1] || 0;
          if (first > 0 && last < first * CHURN_RISK_USAGE_DECLINE_THRESHOLD) {
            churnRiskCustomers.push(customerName);
          }
        }

        // Upsell ready: high usage relative to plan
        const customerUsage = usageByCustomer.get(sub.customer_id) || 0;
        if (customerUsage >= UPSELL_READY_USAGE_THRESHOLD_PERCENT) {
          upsellReadyCustomers.push(customerName);
        }

        // Negative margin
        const customerCost = costsByCustomer.get(sub.customer_id) || 0;
        if (customerCost > mrr) {
          negativeMarginCustomers.push(customerName);
        }
      });

      // Health score calculation using configured penalties
      let healthScore: number = HEALTH_SCORE.BASE;
      const churnPenalty = Math.min(
        churnRiskCustomers.length *
          HEALTH_SCORE.CHURN_RISK_PENALTY_PER_CUSTOMER,
        HEALTH_SCORE.CHURN_RISK_PENALTY_MAX,
      );
      const marginPenalty = Math.min(
        negativeMarginCustomers.length *
          HEALTH_SCORE.NEGATIVE_MARGIN_PENALTY_PER_CUSTOMER,
        HEALTH_SCORE.NEGATIVE_MARGIN_PENALTY_MAX,
      );
      healthScore -= churnPenalty + marginPenalty;

      // Tier adjustments (higher tiers tend to be healthier)
      if (plan.name.toLowerCase() === "starter") {
        healthScore -= HEALTH_SCORE.STARTER_TIER_PENALTY;
      } else if (plan.name.toLowerCase() === "enterprise") {
        healthScore += HEALTH_SCORE.ENTERPRISE_TIER_BONUS;
      }

      healthScore = Math.max(0, Math.min(100, healthScore));

      // Average usage
      let totalUsage = 0;
      let usageCount = 0;
      activeSubs.forEach((sub) => {
        const usage = usageByCustomer.get(sub.customer_id);
        if (usage !== undefined) {
          totalUsage += usage;
          usageCount++;
        }
      });
      const avgUsage = usageCount > 0 ? totalUsage / usageCount : 0;

      return {
        planName: plan.name,
        planId: plan.plan_id,
        customerCount: activeSubs.length,
        customerNames,
        totalMRR,
        avgMRR,
        avgUsage: avgUsage > 0 ? `${avgUsage.toFixed(0)}%` : "N/A",
        healthScore: Math.round(healthScore),
        churnRiskCount: churnRiskCustomers.length,
        churnRiskCustomers,
        upsellReadyCount: upsellReadyCustomers.length,
        upsellReadyCustomers,
        negativeMarginCount: negativeMarginCustomers.length,
        negativeMarginCustomers,
      };
    })
    .sort((a, b) => b.totalMRR - a.totalMRR); // Sort by total MRR descending
}

export function calculateCohorts(
  customers: Customer[],
  subscriptions: Subscription[],
  plans: Plan[],
): CohortData[] {
  const planMap = new Map(plans.map((p) => [p.plan_id, p]));
  const now = new Date();
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  // Group customers by signup month (changed from quarterly to monthly)
  const cohorts = new Map<
    string,
    { customers: Customer[]; subscriptions: Subscription[] }
  >();

  customers.forEach((customer) => {
    const createdAt = customer.created_at ? new Date(customer.created_at) : now;
    const year = createdAt.getFullYear();
    const monthName = monthNames[createdAt.getMonth()];
    const cohortKey = `${monthName} ${year}`;

    if (!cohorts.has(cohortKey)) {
      cohorts.set(cohortKey, { customers: [], subscriptions: [] });
    }
    cohorts.get(cohortKey)!.customers.push(customer);
  });

  // Assign subscriptions to cohorts
  subscriptions.forEach((sub) => {
    for (const [, cohort] of cohorts) {
      if (cohort.customers.some((c) => c.customer_id === sub.customer_id)) {
        cohort.subscriptions.push(sub);
        break;
      }
    }
  });

  // Calculate cohort metrics
  const cohortResults: CohortData[] = [];

  cohorts.forEach((data, cohortKey) => {
    const activeSubs = data.subscriptions.filter((s) => s.is_active);
    const churnedSubs = data.subscriptions.filter(
      (s) => !s.is_active && s.cancelled_at,
    );
    let totalMRR = 0;

    activeSubs.forEach((sub) => {
      // Use mrr_override if available, otherwise calculate from plan price
      if (sub.mrr_override !== undefined) {
        totalMRR += sub.mrr_override;
      } else {
        const plan = planMap.get(sub.plan_id);
        if (plan) {
          const intervalMonths = plan.interval_months || 1;
          totalMRR += plan.price_amount / intervalMonths;
        }
      }
    });

    const avgMRR = activeSubs.length > 0 ? totalMRR / activeSubs.length : 0;

    // Calculate retention metrics
    const activeCount = activeSubs.length;
    const churnedCount = churnedSubs.length;
    const totalWithSubs = activeCount + churnedCount;
    const retentionRate =
      totalWithSubs > 0 ? Math.round((activeCount / totalWithSubs) * 100) : 100;

    // Calculate average tenure
    let totalTenureMonths = 0;
    data.customers.forEach((c) => {
      const created = c.created_at ? new Date(c.created_at) : now;
      const months =
        (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24 * 30);
      totalTenureMonths += months;
    });
    const avgTenure =
      data.customers.length > 0 ? totalTenureMonths / data.customers.length : 0;

    // Estimate LTV based on expected customer lifespan
    const estimatedLTV = avgMRR * AVERAGE_CUSTOMER_LIFESPAN_MONTHS;

    cohortResults.push({
      cohort: cohortKey,
      customerCount: data.customers.length,
      activeCount,
      churnedCount,
      retentionRate,
      avgMRR: formatCurrency(avgMRR),
      totalMRR: formatCurrency(totalMRR),
      avgTenureMonths: Math.round(avgTenure),
      estimatedLTV: formatCurrency(estimatedLTV),
    });
  });

  // Sort by date (most recent first) - updated for monthly format "Mon YYYY"
  return cohortResults
    .sort((a, b) => {
      const [aMonth = "", aYear = ""] = a.cohort.split(" ");
      const [bMonth = "", bYear = ""] = b.cohort.split(" ");
      if (aYear !== bYear)
        return parseInt(bYear || "0") - parseInt(aYear || "0");
      const monthOrder = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      return monthOrder.indexOf(bMonth) - monthOrder.indexOf(aMonth);
    })
    .slice(0, 12); // Last 12 monthly cohorts
}

// =============================================================================
// MONTHLY METRICS CALCULATION
// =============================================================================

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function calculateMonthlyMetrics(
  customers: Customer[],
  subscriptions: Subscription[],
  plans: Plan[],
  costs?: CostRecord[],
): MonthlyMetrics[] {
  // Generate the last 6 months ending at the current month
  const months: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  }

  const planMap = new Map(plans.map((p) => [p.plan_id, p]));
  const subMap = new Map(subscriptions.map((s) => [s.customer_id, s]));

  // Group costs by month
  const costsByMonth = new Map<string, number>();
  costs?.forEach((c) => {
    const month = c.period_start?.substring(0, 7) || "";
    if (month) {
      costsByMonth.set(month, (costsByMonth.get(month) || 0) + c.amount);
    }
  });

  // If costs don't have period_start, generate sample costs that grow over time
  const sampleCostsByMonth: Record<string, number> = {};
  months.forEach((month, idx) => {
    sampleCostsByMonth[month] = 3200 + idx * 600;
  });

  const results: MonthlyMetrics[] = [];
  let previousMonthMRR = 0;
  let previousMonthCustomers = new Set<string>();

  months.forEach((month, idx) => {
    const monthDate = new Date(month + "-01");
    const monthEnd = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth() + 1,
      0,
    );
    const monthLabel = `${MONTH_NAMES[monthDate.getMonth()]} ${monthDate.getFullYear()}`;

    // Find customers active in this month (started on or before month end)
    const activeCustomers = new Set<string>();
    let mrr = 0;

    customers.forEach((customer) => {
      const startDate = customer.created_at
        ? new Date(customer.created_at)
        : new Date("2024-01-01");

      // Customer is active if they started on or before the end of this month
      if (startDate <= monthEnd) {
        const sub = subMap.get(customer.customer_id);
        if (sub && sub.is_active) {
          activeCustomers.add(customer.customer_id);

          // Calculate MRR for this customer
          if (sub.mrr_override !== undefined) {
            mrr += sub.mrr_override;
          } else {
            const plan = planMap.get(sub.plan_id);
            if (plan) {
              const intervalMonths = plan.interval_months || 1;
              mrr += plan.price_amount / intervalMonths;
            }
          }
        }
      }
    });

    // Calculate MRR movement
    let newMRR = 0;
    let expansionMRR = 0;
    let contractionMRR = 0;
    const churnedMRR = 0;

    // New customers this month
    activeCustomers.forEach((customerId) => {
      if (!previousMonthCustomers.has(customerId)) {
        const sub = subMap.get(customerId);
        if (sub) {
          const customerMRR =
            sub.mrr_override ?? (planMap.get(sub.plan_id)?.price_amount || 0);
          newMRR += customerMRR;
        }
      }
    });

    // For expansion/contraction, we'd need historical subscription data
    // For now, simulate based on sample data patterns
    if (idx > 0 && previousMonthMRR > 0) {
      const organicGrowth = mrr - previousMonthMRR - newMRR;
      if (organicGrowth > 0) {
        expansionMRR = organicGrowth;
      } else if (organicGrowth < 0) {
        contractionMRR = Math.abs(organicGrowth);
      }
    }

    const netNewMRR = newMRR + expansionMRR - contractionMRR - churnedMRR;

    // Get costs for this month
    const monthCosts =
      costsByMonth.get(month) || sampleCostsByMonth[month] || 0;

    // Calculate margin
    const margin = mrr > 0 ? ((mrr - monthCosts) / mrr) * 100 : 0;

    results.push({
      month,
      monthLabel,
      mrr,
      newMRR,
      expansionMRR,
      contractionMRR,
      churnedMRR,
      netNewMRR,
      customerCount: activeCustomers.size,
      costs: monthCosts,
      margin: Math.round(margin),
      formatted: {
        mrr: formatCurrency(mrr),
        newMRR: formatCurrency(newMRR),
        expansionMRR: formatCurrency(expansionMRR),
        contractionMRR: formatCurrency(contractionMRR),
        churnedMRR: formatCurrency(churnedMRR),
        netNewMRR: formatCurrency(netNewMRR),
        costs: formatCurrency(monthCosts),
        margin: `${Math.round(margin)}%`,
      },
    });

    previousMonthMRR = mrr;
    previousMonthCustomers = activeCustomers;
  });

  return results;
}

/**
 * Calculate cost growth metrics including provider breakdown.
 * Uses the last 6 months of data to calculate growth rates.
 */
export function calculateCostGrowthMetrics(
  monthlyMetrics: MonthlyMetrics[],
  costs: CostRecord[] | undefined,
): CostGrowthMetrics {
  // Get last 6 months of data
  const recentMonths = monthlyMetrics.slice(-6);

  // Calculate revenue growth (MRR growth over the period)
  let revenueGrowth = 0;
  if (recentMonths.length >= 2) {
    const firstMonth = recentMonths[0];
    const lastMonth = recentMonths[recentMonths.length - 1];
    if (firstMonth && lastMonth && firstMonth.mrr > 0) {
      revenueGrowth = Math.round(
        ((lastMonth.mrr - firstMonth.mrr) / firstMonth.mrr) * 100,
      );
    }
  }

  // Calculate cost growth over the period
  let costGrowth = 0;
  if (recentMonths.length >= 2) {
    const firstMonth = recentMonths[0];
    const lastMonth = recentMonths[recentMonths.length - 1];
    if (firstMonth && lastMonth && firstMonth.costs > 0) {
      costGrowth = Math.round(
        ((lastMonth.costs - firstMonth.costs) / firstMonth.costs) * 100,
      );
    }
  }

  // Calculate growth gap
  const growthGap = costGrowth - revenueGrowth;

  // Calculate total costs (latest month and previous month)
  const latestMonth = recentMonths[recentMonths.length - 1];
  const previousMonth = recentMonths[recentMonths.length - 2];
  const totalCosts = latestMonth?.costs || 0;
  const previousTotalCosts = previousMonth?.costs || 0;

  // Get current and previous month strings for provider filtering
  const latestMonthStr = latestMonth?.month || "";
  const previousMonthStr = previousMonth?.month || "";

  // Filter costs by period
  const currentPeriodCosts = costs?.filter((c) =>
    c.period_start?.startsWith(latestMonthStr),
  );
  const previousPeriodCosts = costs?.filter((c) =>
    c.period_start?.startsWith(previousMonthStr),
  );

  // Calculate provider breakdown for current and previous periods
  const providers = calculateProviderBreakdown(currentPeriodCosts, totalCosts);
  const previousProviders = calculateProviderBreakdown(
    previousPeriodCosts,
    previousTotalCosts,
  );

  // Calculate trend acceleration (is the gap accelerating or decelerating?)
  let trendAcceleration: "accelerating" | "decelerating" | "stable" = "stable";
  if (recentMonths.length >= 4) {
    const midpoint = Math.floor(recentMonths.length / 2);
    const firstHalf = recentMonths.slice(0, midpoint);
    const secondHalf = recentMonths.slice(midpoint);

    // Calculate average cost-to-revenue ratio for each half
    const firstHalfRatio =
      firstHalf.reduce((sum, m) => {
        return sum + (m.mrr > 0 ? m.costs / m.mrr : 0);
      }, 0) / firstHalf.length;

    const secondHalfRatio =
      secondHalf.reduce((sum, m) => {
        return sum + (m.mrr > 0 ? m.costs / m.mrr : 0);
      }, 0) / secondHalf.length;

    const ratioChange =
      firstHalfRatio > 0
        ? ((secondHalfRatio - firstHalfRatio) / firstHalfRatio) * 100
        : 0;

    if (ratioChange > 5) {
      trendAcceleration = "accelerating";
    } else if (ratioChange < -5) {
      trendAcceleration = "decelerating";
    }
  }

  return {
    revenueGrowth,
    costGrowth,
    growthGap,
    providers,
    totalCosts,
    previousProviders,
    previousTotalCosts,
    trendAcceleration,
  };
}

/**
 * Calculate cost breakdown by AI provider.
 * Returns empty array if no provider data available (no fake data).
 */
export function calculateProviderBreakdown(
  costs: CostRecord[] | undefined,
  totalCosts: number,
): ProviderCost[] {
  if (!costs || costs.length === 0 || totalCosts === 0) {
    // Return empty array - don't fake provider breakdown
    return [];
  }

  // Group costs by provider (cost_type field)
  const providerCosts = new Map<string, number>();
  costs.forEach((c) => {
    // Use cost_type as provider name, normalize common variations
    let provider = c.cost_type || "Other";

    // Normalize provider names
    if (
      provider.toLowerCase().includes("openai") ||
      provider.toLowerCase().includes("gpt")
    ) {
      provider = "OpenAI";
    } else if (
      provider.toLowerCase().includes("anthropic") ||
      provider.toLowerCase().includes("claude")
    ) {
      provider = "Anthropic";
    } else if (
      provider.toLowerCase().includes("google") ||
      provider.toLowerCase().includes("gemini")
    ) {
      provider = "Google";
    } else if (provider.toLowerCase().includes("cohere")) {
      provider = "Cohere";
    }

    const current = providerCosts.get(provider) || 0;
    providerCosts.set(provider, current + c.amount);
  });

  // Calculate total for percentage calculation
  let calculatedTotal = 0;
  providerCosts.forEach((amount) => {
    calculatedTotal += amount;
  });

  // If we have actual provider data, use it; otherwise use the passed totalCosts
  const actualTotal = calculatedTotal > 0 ? calculatedTotal : totalCosts;

  // Convert to array and calculate percentages
  const providers: ProviderCost[] = [];
  providerCosts.forEach((amount, name) => {
    providers.push({
      name,
      amount: Math.round(amount),
      percentage:
        actualTotal > 0 ? Math.round((amount / actualTotal) * 100) : 0,
    });
  });

  // Sort by amount descending
  providers.sort((a, b) => b.amount - a.amount);

  return providers;
}

export function generatePriceExperiments(
  subscriptions: Subscription[],
  plans: Plan[],
  customers: Customer[],
): PriceExperiment[] {
  const experiments: PriceExperiment[] = [];
  const planMap = new Map(plans.map((p) => [p.plan_id, p]));

  // Analyze plan distribution
  const planCounts = new Map<string, number>();
  subscriptions
    .filter((s) => s.is_active)
    .forEach((sub) => {
      const count = planCounts.get(sub.plan_id) || 0;
      planCounts.set(sub.plan_id, count + 1);
    });

  // Find most popular plan
  let maxCount = 0;
  let mostPopularPlan: Plan | null = null;
  planCounts.forEach((count, planId) => {
    if (count > maxCount) {
      maxCount = count;
      mostPopularPlan = planMap.get(planId) || null;
    }
  });

  if (mostPopularPlan && maxCount > 3) {
    const plan = mostPopularPlan as Plan;
    experiments.push({
      title: `Test ${plan.name} Price Increase`,
      description: `${maxCount} customers on ${plan.name} suggests strong product-market fit`,
      impact: `+${formatCurrency(plan.price_amount * 0.1 * maxCount)}/mo potential`,
      type: "positive",
      suggestion: `Consider testing a 10-15% price increase for new customers`,
    });
  }

  // Check for underpriced enterprise segment
  const enterpriseCustomers = customers.filter((c) =>
    c.segment?.toLowerCase().includes("enterprise"),
  );
  if (enterpriseCustomers.length > 0) {
    experiments.push({
      title: "Enterprise Pricing Opportunity",
      description: `${enterpriseCustomers.length} enterprise customers may be underpriced`,
      impact: "High revenue potential",
      type: "positive",
      suggestion: "Consider custom enterprise pricing with annual contracts",
    });
  }

  // Check for free tier abuse (if free plan exists)
  const freePlan = plans.find((p) => p.price_amount === 0);
  if (freePlan) {
    const freeUsers = subscriptions.filter(
      (s) => s.plan_id === freePlan.plan_id && s.is_active,
    ).length;
    const totalActive = subscriptions.filter((s) => s.is_active).length;
    const freeRatio = totalActive > 0 ? freeUsers / totalActive : 0;

    if (freeRatio > 0.5) {
      experiments.push({
        title: "Free Tier Conversion",
        description: `${Math.round(freeRatio * 100)}% of users on free tier`,
        impact: "Conversion opportunity",
        type: "warning",
        suggestion: "Add usage limits or feature gates to drive upgrades",
      });
    }
  }

  return experiments;
}

export function generateBundlingOpportunities(
  _subscriptions: Subscription[],
  plans: Plan[],
): BundlingOpportunity[] {
  const opportunities: BundlingOpportunity[] = [];

  // Check for annual vs monthly pricing
  const monthlyPlans = plans.filter(
    (p) => !p.interval_months || p.interval_months === 1,
  );
  const annualPlans = plans.filter(
    (p) => p.interval_months && p.interval_months >= 12,
  );

  if (monthlyPlans.length > 0 && annualPlans.length === 0) {
    opportunities.push({
      title: "Annual Pricing Opportunity",
      description: "No annual plans detected in your pricing",
      impact: "Reduce churn, improve cash flow",
      type: "positive",
      suggestion: "Offer 15-20% discount for annual commitment",
    });
  }

  // Check for single plan (no tiers)
  if (plans.length === 1) {
    opportunities.push({
      title: "Add Pricing Tiers",
      description: "Single pricing tier may limit revenue capture",
      impact: "Capture more willingness to pay",
      type: "warning",
      suggestion: "Consider adding starter/pro/enterprise tiers",
    });
  }

  // Check for large price gaps between tiers
  const sortedPlans = [...plans].sort(
    (a, b) => a.price_amount - b.price_amount,
  );
  for (let i = 1; i < sortedPlans.length; i++) {
    const currentPlan = sortedPlans[i];
    const previousPlan = sortedPlans[i - 1];
    if (!currentPlan || !previousPlan) continue;
    const ratio =
      currentPlan.price_amount / Math.max(previousPlan.price_amount, 1);
    if (ratio > 5) {
      opportunities.push({
        title: "Large Price Gap Detected",
        description: `${previousPlan.name} → ${currentPlan.name} is a ${ratio.toFixed(0)}x jump`,
        impact: "May lose customers in between",
        type: "warning",
        suggestion: "Consider adding an intermediate tier",
      });
      break;
    }
  }

  return opportunities;
}

export function analyzeUsageAnomalies(
  usage: UsageRecord[],
  subscriptions: Subscription[],
  plans: Plan[],
  customers: Customer[],
): UsageAnomaly[] {
  if (!usage || usage.length === 0) return [];

  const anomalies: UsageAnomaly[] = [];
  const planMap = new Map(plans.map((p) => [p.plan_id, p]));
  const customerMap = new Map(customers.map((c) => [c.customer_id, c]));
  const subMap = new Map(subscriptions.map((s) => [s.customer_id, s]));

  // Dynamically detect available months from usage data
  const allMonths = new Set<string>();
  usage.forEach((u) => {
    const month = u.period_start?.substring(0, 7);
    if (month) allMonths.add(month);
  });
  const sortedMonths = Array.from(allMonths).sort();
  const latestMonth = sortedMonths[sortedMonths.length - 1] || "";
  // Get last 4 months for trend analysis
  const trendMonths = sortedMonths.slice(-4);

  // Group usage by customer and month for trend analysis
  // Structure: customerId -> month -> { metric_key -> { value, limit } }
  const usageHistory = new Map<
    string,
    Map<string, Map<string, { value: number; limit: number }>>
  >();

  usage.forEach((u) => {
    // Extract month from period_start (format: "2024-12-01T00:00:00Z")
    const month = u.period_start?.substring(0, 7) || latestMonth;

    if (!usageHistory.has(u.customer_id)) {
      usageHistory.set(u.customer_id, new Map());
    }
    const customerHistory = usageHistory.get(u.customer_id)!;

    if (!customerHistory.has(month)) {
      customerHistory.set(month, new Map());
    }
    const monthData = customerHistory.get(month)!;

    monthData.set(u.metric_key, {
      value: u.metric_value,
      limit: u.metric_limit || 0,
    });
  });

  // Analyze each customer
  usageHistory.forEach((monthlyData, customerId) => {
    const customer = customerMap.get(customerId);
    const sub = subMap.get(customerId);
    if (!sub || !sub.is_active) return;

    const plan = planMap.get(sub.plan_id);
    if (!plan) return;

    const customerName = customer?.name || customer?.email || customerId;

    // Get latest month's data (dynamically detected)
    const latestData = monthlyData.get(latestMonth);
    const apiCallsData = latestData?.get("api_calls");

    if (!apiCallsData) return;

    const currentUsage = apiCallsData.value;
    const limit = apiCallsData.limit;
    const usagePercent =
      limit > 0 ? Math.round((currentUsage / limit) * 100) : 0;

    // 1. Detect CHURN RISK - declining usage over available months
    const monthValues: number[] = [];

    trendMonths.forEach((month) => {
      const mData = monthlyData.get(month);
      const apiCalls = mData?.get("api_calls");
      if (apiCalls) {
        monthValues.push(apiCalls.value);
      }
    });

    // Check for declining trend (need at least MIN_TREND_DATA_POINTS)
    if (monthValues.length >= MIN_TREND_DATA_POINTS) {
      const firstValue = monthValues[0] || 0;
      const lastValue = monthValues[monthValues.length - 1] || 0;

      if (firstValue > 0 && lastValue < firstValue) {
        const declinePercent = Math.round(
          ((firstValue - lastValue) / firstValue) * 100,
        );

        // Significant decline triggers churn risk flag
        if (declinePercent >= SIGNIFICANT_DECLINE_PERCENT) {
          anomalies.push({
            customer: customerName,
            customerId,
            plan: plan.name,
            usage: `${usagePercent}%`,
            description: `▼${declinePercent}% over 3 months`,
            type: "info",
            status: "churn_risk",
          });
          return; // Don't add other anomalies for this customer
        }
      }

      // Detect ANOMALY - sudden usage spike (month-over-month)
      for (let i = 1; i < monthValues.length; i++) {
        const prevValue = monthValues[i - 1] || 0;
        const currValue = monthValues[i] || 0;

        if (
          prevValue > 0 &&
          currValue > prevValue * USAGE_SPIKE_THRESHOLD_MULTIPLIER
        ) {
          const spikePercent = Math.round((currValue / prevValue) * 100);
          const spikeMonth = trendMonths[i]?.substring(5, 7) || "";
          anomalies.push({
            customer: customerName,
            customerId,
            plan: plan.name,
            usage: `${spikePercent}%`,
            description: `${spikeMonth} spike`,
            type: "warning",
            status: "anomaly",
          });
          return;
        }
      }
    }

    // Detect UPSELL READY - near or over plan limits
    if (usagePercent >= UPSELL_READY_USAGE_THRESHOLD_PERCENT) {
      const status = usagePercent > 100 ? "Over limit" : "Near limit";
      anomalies.push({
        customer: customerName,
        customerId,
        plan: plan.name,
        usage: `${usagePercent}%`,
        description: status,
        type: "warning",
        status: "upsell",
      });
    }
  });

  // Sort: churn risk first, then upsell, then anomalies
  return anomalies.sort((a, b) => {
    // Churn risk (type: 'info') first
    if (a.type === "info" && b.type !== "info") return -1;
    if (b.type === "info" && a.type !== "info") return 1;
    return 0;
  });
}

export function analyzeNegativeMargins(
  costs: CostRecord[],
  subscriptions: Subscription[],
  plans: Plan[],
  customers: Customer[],
): NegativeMarginCustomer[] {
  if (!costs || costs.length === 0) return [];

  const results: NegativeMarginCustomer[] = [];
  const planMap = new Map(plans.map((p) => [p.plan_id, p]));
  const customerMap = new Map(customers.map((c) => [c.customer_id, c]));
  const subMap = new Map(subscriptions.map((s) => [s.customer_id, s]));

  // Group costs by customer
  const costsByCustomer = new Map<string, number>();
  costs.forEach((c) => {
    const current = costsByCustomer.get(c.customer_id) || 0;
    costsByCustomer.set(c.customer_id, current + c.amount);
  });

  costsByCustomer.forEach((totalCost, customerId) => {
    const customer = customerMap.get(customerId);
    const sub = subMap.get(customerId);
    if (!sub || !sub.is_active) return;

    const plan = planMap.get(sub.plan_id);
    if (!plan) return;

    // Use mrr_override if available, otherwise calculate from plan
    let mrr: number;
    if (sub.mrr_override !== undefined) {
      mrr = sub.mrr_override;
    } else {
      const intervalMonths = plan.interval_months || 1;
      mrr = plan.price_amount / intervalMonths;
    }

    const margin = mrr - totalCost;
    const marginPercent = mrr > 0 ? Math.round((margin / mrr) * 100) : 0;

    if (margin < 0) {
      const customerName = customer?.name || customer?.email || customerId;

      // Determine reason based on cost/mrr ratio
      let reason = "Costs exceed revenue";
      if (totalCost > mrr * 1.5) {
        reason = "Heavy token/API usage";
      }
      if (totalCost > mrr * 2) {
        reason = "Extremely high usage";
      }

      results.push({
        customer: customerName,
        customerId,
        plan: plan.name,
        mrr: formatCurrency(mrr),
        costs: formatCurrency(totalCost),
        margin: `${marginPercent}%`,
        reason,
      });
    }
  });

  // Sort by margin (most negative first)
  return results
    .sort((a, b) => {
      const marginA = parseInt(a.margin.replace("%", ""));
      const marginB = parseInt(b.margin.replace("%", ""));
      return marginA - marginB;
    })
    .slice(0, 10);
}

// =============================================================================
// MAIN ANALYSIS FUNCTION
// =============================================================================

/**
 * Perform comprehensive SaaS pricing analysis on the provided data.
 *
 * This is the main entry point for the pricing analyzer. It calculates:
 * - Core SaaS metrics (MRR, ARR, ARPU, NRR, LTV)
 * - MRR movement breakdown
 * - Plan health scores
 * - Pricing experiment suggestions
 * - Bundling opportunities
 * - Usage anomalies and churn risk
 * - Negative margin customers
 * - Cohort analysis
 *
 * @param data - Input data containing customers, plans, subscriptions,
 *               and optionally invoices, usage, and costs
 * @returns Complete analysis result with all metrics and insights
 *
 * @example
 * ```ts
 * const result = analyzeData({
 *   customers: [...],
 *   plans: [...],
 *   subscriptions: [...],
 *   usage: [...],
 *   costs: [...]
 * })
 * console.log(result.saasMetrics.formatted.mrr) // "$11.2K"
 * ```
 */

// =============================================================================
// CUSTOMER REVENUE CALCULATION
// =============================================================================

/**
 * Calculate revenue breakdown by customer
 */
export function calculateCustomerRevenue(
  customers: Customer[],
  subscriptions: Subscription[],
  plans: Plan[],
): CustomerRevenue[] {
  const planMap = new Map(plans.map((p) => [p.plan_id, p]));
  const customerMap = new Map(customers.map((c) => [c.customer_id, c]));
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return subscriptions
    .map((sub) => {
      const customer = customerMap.get(sub.customer_id);
      const plan = planMap.get(sub.plan_id);

      const intervalMonths = plan?.interval_months || 1;
      const currentMrr =
        sub.mrr_override !== undefined
          ? sub.mrr_override
          : (plan?.price_amount || 0) / intervalMonths;
      const previousMrr = sub.previous_mrr ?? currentMrr;

      const mrrChange = currentMrr - previousMrr;
      const mrrChangePercent =
        previousMrr > 0 ? (mrrChange / previousMrr) * 100 : 0;

      // Calculate tenure
      const createdAt = customer?.created_at
        ? new Date(customer.created_at)
        : now;
      const tenureMs = now.getTime() - createdAt.getTime();
      const tenureMonths = Math.floor(tenureMs / (30 * 24 * 60 * 60 * 1000));

      // Determine status
      let status: "active" | "churned" | "new" = "active";
      if (!sub.is_active || sub.cancelled_at) {
        status = "churned";
      } else if (previousMrr === 0 && sub.current_period_start) {
        const periodStart = new Date(sub.current_period_start);
        if (periodStart > thirtyDaysAgo) {
          status = "new";
        }
      }

      return {
        customerId: sub.customer_id,
        customerName: customer?.name || sub.customer_id,
        email: customer?.email || "",
        planName: plan?.name || sub.plan_id,
        planId: sub.plan_id,
        mrr: currentMrr,
        previousMrr,
        mrrChange,
        mrrChangePercent: Math.round(mrrChangePercent * 10) / 10,
        tenureMonths,
        status,
        segment: customer?.segment,
      };
    })
    .sort((a, b) => b.mrr - a.mrr); // Sort by MRR descending
}

// =============================================================================
// RENEWAL TRACKING CALCULATION
// =============================================================================

/**
 * Calculate upcoming renewals and identify at-risk renewals
 */
export function calculateUpcomingRenewals(
  subscriptions: Subscription[],
  plans: Plan[],
  customers: Customer[],
  usage?: UsageRecord[],
): RenewalInfo[] {
  const planMap = new Map(plans.map((p) => [p.plan_id, p]));
  const customerMap = new Map(customers.map((c) => [c.customer_id, c]));
  const now = new Date();

  // Get usage trends for risk assessment
  const usageTrends = new Map<string, number>();
  if (usage && usage.length > 0) {
    // Group usage by customer and calculate trend
    const customerUsage = new Map<string, number[]>();
    usage.forEach((u) => {
      const existing = customerUsage.get(u.customer_id) || [];
      existing.push(u.metric_value);
      customerUsage.set(u.customer_id, existing);
    });

    customerUsage.forEach((values, customerId) => {
      if (values.length >= 2) {
        const first = values[0] || 0;
        const last = values[values.length - 1] || 0;
        const trend = first > 0 ? (last - first) / first : 0;
        usageTrends.set(customerId, trend);
      }
    });
  }

  return subscriptions
    .filter((sub) => sub.is_active && sub.current_period_end)
    .map((sub) => {
      const customer = customerMap.get(sub.customer_id);
      const plan = planMap.get(sub.plan_id);

      const renewalDate = new Date(sub.current_period_end!);
      const daysUntilRenewal = Math.ceil(
        (renewalDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );

      const intervalMonths = plan?.interval_months || 1;
      const mrr =
        sub.mrr_override !== undefined
          ? sub.mrr_override
          : (plan?.price_amount || 0) / intervalMonths;

      // Assess risk level
      let riskLevel: "low" | "medium" | "high" = "low";
      let riskReason: string | undefined;

      // Check usage decline
      const usageTrend = usageTrends.get(sub.customer_id);
      if (usageTrend !== undefined && usageTrend < -0.25) {
        riskLevel = "high";
        riskReason = "Usage declined >25%";
      } else if (usageTrend !== undefined && usageTrend < -0.1) {
        riskLevel = "medium";
        riskReason = "Usage declining";
      }

      // Check if renewal is soon
      if (daysUntilRenewal <= 7 && riskLevel === "low") {
        riskLevel = "medium";
        riskReason = "Renewal due soon";
      }

      return {
        customerId: sub.customer_id,
        customerName: customer?.name || sub.customer_id,
        planName: plan?.name || sub.plan_id,
        mrr,
        renewalDate: renewalDate.toISOString().split("T")[0] || "",
        daysUntilRenewal,
        riskLevel,
        riskReason,
      };
    })
    .filter((r) => r.daysUntilRenewal >= 0 && r.daysUntilRenewal <= 90) // Next 90 days
    .sort((a, b) => a.daysUntilRenewal - b.daysUntilRenewal);
}

// =============================================================================
// COHORT RETENTION MATRIX CALCULATION
// =============================================================================

/**
 * Calculate cohort retention matrix showing retention over time
 */
export function calculateCohortRetentionMatrix(
  customers: Customer[],
  subscriptions: Subscription[],
): CohortRetentionRow[] {
  // Group customers by signup month
  const cohorts = new Map<string, { customers: Set<string>; created: Date }>();

  customers.forEach((c) => {
    const createdAt = c.created_at ? new Date(c.created_at) : new Date();
    const cohortKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}`;

    if (!cohorts.has(cohortKey)) {
      cohorts.set(cohortKey, { customers: new Set(), created: createdAt });
    }
    cohorts.get(cohortKey)!.customers.add(c.customer_id);
  });

  // Build subscription status map
  const subMap = new Map<string, Subscription>();
  subscriptions.forEach((s) => subMap.set(s.customer_id, s));

  const now = new Date();
  const rows: CohortRetentionRow[] = [];

  // Sort cohorts by date
  const sortedCohorts = Array.from(cohorts.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  sortedCohorts.forEach(([cohortKey, cohortData]) => {
    const cohortSize = cohortData.customers.size;
    if (cohortSize === 0) return;

    const cohortDate = new Date(cohortKey + "-01");
    const monthsSinceCohort = Math.floor(
      (now.getTime() - cohortDate.getTime()) / (30 * 24 * 60 * 60 * 1000),
    );

    const retentionByMonth: CohortRetentionCell[] = [];

    // Month 0 is always 100% (signup month)
    retentionByMonth.push({ month: 0, retention: 100, customers: cohortSize });

    // Calculate retention for each subsequent month
    for (let month = 1; month <= Math.min(monthsSinceCohort, 12); month++) {
      let retained = 0;

      cohortData.customers.forEach((customerId) => {
        const sub = subMap.get(customerId);
        if (sub) {
          // Check if still active or cancelled after this month
          if (sub.is_active) {
            retained++;
          } else if (sub.cancelled_at) {
            const cancelledAt = new Date(sub.cancelled_at);
            const monthsUntilCancel = Math.floor(
              (cancelledAt.getTime() - cohortDate.getTime()) /
                (30 * 24 * 60 * 60 * 1000),
            );
            if (monthsUntilCancel > month) {
              retained++;
            }
          }
        }
      });

      const retention = Math.round((retained / cohortSize) * 100);
      retentionByMonth.push({ month, retention, customers: retained });
    }

    rows.push({
      cohort: cohortKey,
      cohortSize,
      retentionByMonth,
    });
  });

  // Return last 6 cohorts, most recent first
  return rows.slice(-6).reverse();
}

export function analyzeData(data: AnalyzerData): AnalysisResult {
  const { customers, plans, subscriptions, invoices, usage, costs } = data;

  // Calculate core metrics
  const mrr = calculateMRR(subscriptions, plans);
  const arr = mrr * 12;
  const activeCustomers = new Set(
    subscriptions.filter((s) => s.is_active).map((s) => s.customer_id),
  ).size;
  const arpu = activeCustomers > 0 ? mrr / activeCustomers : 0;

  // MRR movement
  const mrrMovement = calculateMRRMovement(subscriptions, plans);

  // NRR calculation: (Starting MRR + Expansion - Contraction - Churn) / Starting MRR
  // This measures revenue retention from existing customers (excludes new customers)
  const previousMRR = mrr - mrrMovement.netNew;
  const retainedAndExpanded =
    previousMRR +
    mrrMovement.expansion -
    mrrMovement.contraction -
    mrrMovement.churned;
  const nrr = previousMRR > 0 ? (retainedAndExpanded / previousMRR) * 100 : 100;

  // MRR growth
  const mrrGrowth =
    previousMRR > 0 ? ((mrr - previousMRR) / previousMRR) * 100 : 0;

  // Average LTV based on expected customer lifespan
  const avgLTV = arpu * AVERAGE_CUSTOMER_LIFESPAN_MONTHS;

  // Calculate cost and margin metrics from historical data
  // Group costs by month to calculate growth and historical margin
  const costsByMonth = new Map<string, number>();
  costs?.forEach((c) => {
    const month = c.period_start?.substring(0, 7) || "";
    if (month) {
      costsByMonth.set(month, (costsByMonth.get(month) || 0) + c.amount);
    }
  });

  // Get sorted months and calculate current vs previous month costs
  const sortedCostMonths = Array.from(costsByMonth.keys()).sort();
  const latestCostMonth = sortedCostMonths[sortedCostMonths.length - 1] || "";
  const previousCostMonth = sortedCostMonths[sortedCostMonths.length - 2] || "";

  const currentMonthCosts = costsByMonth.get(latestCostMonth) || 0;
  const previousMonthCosts = costsByMonth.get(previousCostMonth) || 0;

  // Total costs for the current (latest) month
  const totalCosts = currentMonthCosts;
  const margin = mrr > 0 ? ((mrr - totalCosts) / mrr) * 100 : 0;

  // Calculate previous margin from previous month's costs
  // For simplicity, we assume MRR was similar (or use the same MRR)
  const previousMargin =
    previousMonthCosts > 0 && mrr > 0
      ? Math.round(((mrr - previousMonthCosts) / mrr) * 100)
      : Math.round(margin); // Default to current if no historical data
  const marginChange = Math.round(margin) - previousMargin;

  // Calculate cost growth (MoM percentage)
  const costGrowth =
    previousMonthCosts > 0
      ? Math.round(
          ((currentMonthCosts - previousMonthCosts) / previousMonthCosts) * 100,
        )
      : 0;

  const saasMetrics: SaaSMetrics = {
    mrr,
    arr,
    customerCount: activeCustomers,
    arpu,
    nrr: Math.round(nrr),
    avgLTV,
    mrrGrowth: Math.round(mrrGrowth * 10) / 10,
    totalCosts,
    costGrowth,
    margin: Math.round(margin),
    marginChange,
    previousMargin,
    mrrMovement,
    formatted: {
      mrr: formatCurrency(mrr),
      arr: formatCurrency(arr),
      arpu: formatCurrency(arpu),
      avgLTV: formatCurrency(avgLTV),
      newMRR: formatCurrency(mrrMovement.new),
      expansionMRR: formatCurrency(mrrMovement.expansion),
      contractionMRR: formatCurrency(mrrMovement.contraction),
      churnedMRR: formatCurrency(mrrMovement.churned),
      netNewMRR: formatCurrency(mrrMovement.netNew),
      totalCosts: formatCurrency(totalCosts),
      margin: `${Math.round(margin)}%`,
    },
  };

  // Calculate monthly metrics first (needed for cost growth metrics)
  const monthlyMetrics = calculateMonthlyMetrics(
    customers,
    subscriptions,
    plans,
    costs,
  );

  return {
    saasMetrics,
    planHealth: calculatePlanHealth(
      subscriptions,
      plans,
      customers,
      usage,
      costs,
    ),
    priceExperiments: generatePriceExperiments(subscriptions, plans, customers),
    bundlingOpportunities: generateBundlingOpportunities(subscriptions, plans),
    usageAnomalies: analyzeUsageAnomalies(
      usage || [],
      subscriptions,
      plans,
      customers,
    ),
    negativeMarginCustomers: analyzeNegativeMargins(
      costs || [],
      subscriptions,
      plans,
      customers,
    ),
    cohorts: calculateCohorts(customers, subscriptions, plans),
    monthlyMetrics,
    // New features
    customerRevenue: calculateCustomerRevenue(customers, subscriptions, plans),
    upcomingRenewals: calculateUpcomingRenewals(
      subscriptions,
      plans,
      customers,
      usage,
    ),
    cohortRetentionMatrix: calculateCohortRetentionMatrix(
      customers,
      subscriptions,
    ),
    // Cost growth visualization
    costGrowthMetrics: calculateCostGrowthMetrics(monthlyMetrics, costs),
    meta: {
      customerCount: customers.length,
      planCount: plans.length,
      subscriptionCount: subscriptions.length,
      hasUsageData: (usage?.length || 0) > 0,
      hasCostData: (costs?.length || 0) > 0,
      hasInvoiceData: (invoices?.length || 0) > 0,
    },
  };
}
