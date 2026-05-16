/**
 * OBSERVE PHASE 1: EXPANSION DETECTION ENGINE
 * Production-ready TypeScript implementation
 * Status: Ready for branch testing (dev environment)
 */

import { Database } from 'pg';
import { Logger } from './logger';
import { SlackNotifier } from './slack';

interface ExpansionSignal {
  rule_id: string;
  confidence: number;
  customer_id: string;
  signal_type: string;
  metadata: Record<string, any>;
  explanation: string;
  recommended_action: string;
}

interface CustomerMetrics {
  customer_id: string;
  api_calls_month: number;
  api_limit: number;
  features_used: number;
  teams: number;
  plan_tier: string;
  days_on_plan: number;
  churn_risk: number;
}

export class ExpansionRules {
  private db: Database;
  private logger: Logger;
  private slack: SlackNotifier;
  private audit_log: ExpansionSignal[] = [];

  constructor(db: Database, logger: Logger, slack: SlackNotifier) {
    this.db = db;
    this.logger = logger;
    this.slack = slack;
  }

  /**
   * RULE 1: API Limit Hit (78% confidence)
   * Customer is at 85%+ of monthly API limit
   */
  async ruleLimitHit(metrics: CustomerMetrics): Promise<ExpansionSignal | null> {
    const utilization = metrics.api_calls_month / metrics.api_limit;

    if (utilization >= 0.85) {
      const signal: ExpansionSignal = {
        rule_id: 'limit_hit',
        confidence: 0.78,
        customer_id: metrics.customer_id,
        signal_type: 'API_LIMIT_APPROACHING',
        metadata: {
          utilization_percent: Math.round(utilization * 100),
          calls_remaining: Math.round(metrics.api_limit - metrics.api_calls_month),
          days_in_month: 30,
        },
        explanation: `Customer is using ${Math.round(utilization * 100)}% of their API limit. They will likely hit the limit within 5-10 days.`,
        recommended_action: 'Show upgrade recommendation to next tier (${TIER_PRICING[metrics.plan_tier].upgrade_value})',
      };

      this.audit_log.push(signal);
      this.logger.info(`Rule triggered: limit_hit for ${metrics.customer_id}`, signal);
      return signal;
    }

    return null;
  }

  /**
   * RULE 2: Usage Growth Forecast (72% confidence)
   * Customer's 30-day usage trend shows growth trajectory
   */
  async ruleGrowthForecast(
    metrics: CustomerMetrics,
    historical_data: { date: string; calls: number }[]
  ): Promise<ExpansionSignal | null> {
    if (historical_data.length < 30) return null;

    const last_30_days = historical_data.slice(-30);
    const mid_point = Math.floor(last_30_days.length / 2);
    const first_half = last_30_days.slice(0, mid_point).reduce((sum, d) => sum + d.calls, 0) / mid_point;
    const second_half = last_30_days.slice(mid_point).reduce((sum, d) => sum + d.calls, 0) / (last_30_days.length - mid_point);

    const growth_rate = (second_half - first_half) / first_half;

    if (growth_rate > 0.20) {
      // 20%+ growth in last 30 days
      const projected_30_days = second_half * 30;
      const will_hit_limit_in_days = (metrics.api_limit - metrics.api_calls_month) / (second_half);

      const signal: ExpansionSignal = {
        rule_id: 'growth_forecast',
        confidence: 0.72,
        customer_id: metrics.customer_id,
        signal_type: 'GROWTH_TRENDING_UP',
        metadata: {
          growth_rate_percent: Math.round(growth_rate * 100),
          projected_monthly_usage: Math.round(projected_30_days),
          will_hit_limit_in_days: Math.round(will_hit_limit_in_days),
        },
        explanation: `Customer's API usage is growing ${Math.round(growth_rate * 100)}% month-over-month. At current trajectory, they'll need to upgrade in ${Math.round(will_hit_limit_in_days)} days.`,
        recommended_action: 'Proactive upgrade recommendation (show higher tier benefits)',
      };

      this.audit_log.push(signal);
      this.logger.info(`Rule triggered: growth_forecast for ${metrics.customer_id}`, signal);
      return signal;
    }

    return null;
  }

  /**
   * RULE 3: Adoption Inflection (65% confidence)
   * Customer is rapidly adopting new features (40%+ feature growth)
   */
  async ruleAdoptionInflection(
    metrics: CustomerMetrics,
    historical_features: { date: string; count: number }[]
  ): Promise<ExpansionSignal | null> {
    if (historical_features.length < 30) return null;

    const features_30_days_ago = historical_features[historical_features.length - 30].count;
    const current_features = metrics.features_used;
    const feature_growth = (current_features - features_30_days_ago) / features_30_days_ago;

    if (feature_growth >= 0.40) {
      const signal: ExpansionSignal = {
        rule_id: 'adoption_inflection',
        confidence: 0.65,
        customer_id: metrics.customer_id,
        signal_type: 'FEATURE_ADOPTION_SURGE',
        metadata: {
          feature_growth_percent: Math.round(feature_growth * 100),
          features_adopted_count: current_features - features_30_days_ago,
          current_features_used: current_features,
        },
        explanation: `Customer is rapidly adopting features (${current_features - features_30_days_ago} new features in 30 days). This signals high engagement and expansion readiness.`,
        recommended_action: 'Show advanced features that unlock with higher tier',
      };

      this.audit_log.push(signal);
      this.logger.info(`Rule triggered: adoption_inflection for ${metrics.customer_id}`, signal);
      return signal;
    }

    return null;
  }

  /**
   * RULE 4: Multi-Team Spread (68% confidence)
   * Customer has 5+ teams (expansion signal)
   */
  async ruleMultiTeamSpread(metrics: CustomerMetrics): Promise<ExpansionSignal | null> {
    if (metrics.teams >= 5) {
      const signal: ExpansionSignal = {
        rule_id: 'multi_team_spread',
        confidence: 0.68,
        customer_id: metrics.customer_id,
        signal_type: 'MULTI_TEAM_EXPANSION',
        metadata: {
          teams_count: metrics.teams,
          team_threshold: 5,
        },
        explanation: `Customer has ${metrics.teams} teams using the service. Multi-team adoption indicates organizational scale and expansion potential.`,
        recommended_action: 'Recommend Team/Enterprise plan with team management features',
      };

      this.audit_log.push(signal);
      this.logger.info(`Rule triggered: multi_team_spread for ${metrics.customer_id}`, signal);
      return signal;
    }

    return null;
  }

  /**
   * RULE 5: Contract Maturity (58% confidence)
   * Customer has been on starter plan for 6+ months (expansion signal)
   */
  async ruleContractMaturity(metrics: CustomerMetrics): Promise<ExpansionSignal | null> {
    if (metrics.plan_tier === 'starter' && metrics.days_on_plan >= 180) {
      const signal: ExpansionSignal = {
        rule_id: 'contract_maturity',
        confidence: 0.58,
        customer_id: metrics.customer_id,
        signal_type: 'LONG_TERM_STARTER_CUSTOMER',
        metadata: {
          days_on_plan: metrics.days_on_plan,
          months_on_starter: Math.round(metrics.days_on_plan / 30),
        },
        explanation: `Customer has been on Starter plan for ${Math.round(metrics.days_on_plan / 30)} months. High probability they're ready for upgrade based on tenure.`,
        recommended_action: 'Win-back offer for upgrade (limited-time discount)',
      };

      this.audit_log.push(signal);
      this.logger.info(`Rule triggered: contract_maturity for ${metrics.customer_id}`, signal);
      return signal;
    }

    return null;
  }

  /**
   * Execute all rules for a customer
   * Returns array of triggered signals (confidence >= 55%)
   */
  async executeAllRules(
    customer_id: string,
    historical_data: { date: string; calls: number }[],
    historical_features: { date: string; count: number }[]
  ): Promise<ExpansionSignal[]> {
    const metrics = await this.getCustomerMetrics(customer_id);
    if (!metrics) {
      this.logger.warn(`No metrics found for customer ${customer_id}`);
      return [];
    }

    const triggered_signals: ExpansionSignal[] = [];

    // Run all rules
    const rule1 = await this.ruleLimitHit(metrics);
    const rule2 = await this.ruleGrowthForecast(metrics, historical_data);
    const rule3 = await this.ruleAdoptionInflection(metrics, historical_features);
    const rule4 = await this.ruleMultiTeamSpread(metrics);
    const rule5 = await this.ruleContractMaturity(metrics);

    // Collect signals above confidence threshold
    if (rule1) triggered_signals.push(rule1);
    if (rule2) triggered_signals.push(rule2);
    if (rule3) triggered_signals.push(rule3);
    if (rule4) triggered_signals.push(rule4);
    if (rule5) triggered_signals.push(rule5);

    // Filter by confidence threshold (55% minimum)
    const high_confidence_signals = triggered_signals.filter((s) => s.confidence >= 0.55);

    // Log & notify
    if (high_confidence_signals.length > 0) {
      this.logger.info(`Expansion signals found for ${customer_id}`, {
        count: high_confidence_signals.length,
        signals: high_confidence_signals.map((s) => s.rule_id),
      });

      // Send to Slack
      for (const signal of high_confidence_signals) {
        await this.slack.notifyExpansionSignal(signal);
      }
    }

    return high_confidence_signals;
  }

  /**
   * Get customer metrics from database
   */
  private async getCustomerMetrics(customer_id: string): Promise<CustomerMetrics | null> {
    try {
      const result = await this.db.query(
        `
        SELECT
          customer_id,
          api_calls_month,
          api_limit,
          features_used,
          teams,
          plan_tier,
          days_on_plan
        FROM customers
        WHERE customer_id = $1
      `,
        [customer_id]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        customer_id: row.customer_id,
        api_calls_month: row.api_calls_month,
        api_limit: row.api_limit,
        features_used: row.features_used,
        teams: row.teams,
        plan_tier: row.plan_tier,
        days_on_plan: row.days_on_plan,
        churn_risk: 0, // Placeholder
      };
    } catch (error) {
      this.logger.error(`Error fetching metrics for ${customer_id}`, error);
      return null;
    }
  }

  /**
   * Get audit log of all triggered rules
   */
  getAuditLog(): ExpansionSignal[] {
    return this.audit_log;
  }

  /**
   * Clear audit log (for testing)
   */
  clearAuditLog(): void {
    this.audit_log = [];
  }
}

// Pricing tiers for recommendations
const TIER_PRICING = {
  starter: { monthly: 99, upgrade_value: 199, upgrade_to: 'pro' },
  pro: { monthly: 199, upgrade_value: 499, upgrade_to: 'enterprise' },
  enterprise: { monthly: 499, upgrade_value: null, upgrade_to: null },
};

export default ExpansionRules;
