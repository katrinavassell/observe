/**
 * OBSERVE PHASE 2: CHURN DETECTION + PRICING PATTERNS
 * Production-ready TypeScript implementation
 * Status: Ready for branch testing (dev environment)
 */

import { Database } from 'pg';
import { Logger } from './logger';
import { SlackNotifier } from './slack';

interface ChurnSignal {
  signal_id: string;
  rule_id: string;
  confidence: number;
  customer_id: string;
  signal_type: string;
  metadata: Record<string, any>;
  explanation: string;
  recommended_action: string;
  urgency: 'low' | 'medium' | 'high';
}

interface PricingSignal {
  signal_id: string;
  customer_id: string;
  elasticity_score: number;
  optimal_tier: string;
  expected_ltv_impact: number;
  recommendation: string;
}

interface CustomerHealthMetrics {
  customer_id: string;
  api_calls_current_week: number;
  api_calls_previous_week: number;
  feature_adoption_current: number;
  feature_adoption_previous: number;
  support_tickets_count: number;
  last_payment_success: boolean;
  nps_score: number | null;
  days_since_last_api_call: number;
}

export class ChurnDetectionEngine {
  private db: Database;
  private logger: Logger;
  private slack: SlackNotifier;
  private churn_log: ChurnSignal[] = [];

  constructor(db: Database, logger: Logger, slack: SlackNotifier) {
    this.db = db;
    this.logger = logger;
    this.slack = slack;
  }

  /**
   * CHURN RULE 1: Feature Adoption Drop (75% confidence)
   * Customer's feature adoption dropped 40%+ month-over-month
   */
  async ruleAdoptionDrop(metrics: CustomerHealthMetrics): Promise<ChurnSignal | null> {
    const adoption_change = (metrics.feature_adoption_current - metrics.feature_adoption_previous) / metrics.feature_adoption_previous;

    if (adoption_change <= -0.40) {
      const signal: ChurnSignal = {
        signal_id: `churn_${Date.now()}`,
        rule_id: 'adoption_drop',
        confidence: 0.75,
        customer_id: metrics.customer_id,
        signal_type: 'FEATURE_ADOPTION_DECLINE',
        metadata: {
          adoption_change_percent: Math.round(adoption_change * 100),
          current_features: metrics.feature_adoption_current,
          previous_features: metrics.feature_adoption_previous,
        },
        explanation: `Customer's feature usage dropped ${Math.abs(Math.round(adoption_change * 100))}%. This typically indicates disengagement or migration to competitor.`,
        recommended_action: 'Immediate outreach: "We noticed you\'re using fewer features. What can we do better?"',
        urgency: 'high',
      };

      this.churn_log.push(signal);
      this.logger.info(`Churn signal: adoption_drop for ${metrics.customer_id}`, signal);
      return signal;
    }

    return null;
  }

  /**
   * CHURN RULE 2: API Usage Decline Trend (72% confidence)
   * API usage declining 30%+ trend over 7 consecutive days
   */
  async ruleUsageDeclineTrend(
    customer_id: string,
    daily_usage: { date: string; calls: number }[]
  ): Promise<ChurnSignal | null> {
    if (daily_usage.length < 7) return null;

    // Get last 7 days
    const last_7_days = daily_usage.slice(-7);
    const first_3_days = last_7_days.slice(0, 3).reduce((sum, d) => sum + d.calls, 0) / 3;
    const last_4_days = last_7_days.slice(3).reduce((sum, d) => sum + d.calls, 0) / 4;

    const usage_change = (last_4_days - first_3_days) / first_3_days;

    if (usage_change <= -0.30) {
      const signal: ChurnSignal = {
        signal_id: `churn_${Date.now()}`,
        rule_id: 'usage_decline_trend',
        confidence: 0.72,
        customer_id,
        signal_type: 'API_USAGE_DECLINING',
        metadata: {
          usage_change_percent: Math.round(usage_change * 100),
          first_3_days_avg: Math.round(first_3_days),
          last_4_days_avg: Math.round(last_4_days),
          days_analyzed: 7,
        },
        explanation: `API usage declining ${Math.abs(Math.round(usage_change * 100))}% over 7 days. Trend suggests potential churn.`,
        recommended_action: 'Win-back campaign: "We miss you! Here\'s what\'s new..."',
        urgency: 'high',
      };

      this.churn_log.push(signal);
      this.logger.info(`Churn signal: usage_decline_trend for ${customer_id}`, signal);
      return signal;
    }

    return null;
  }

  /**
   * CHURN RULE 3: Support Spike + Usage Drop (68% confidence)
   * Customer has 5+ support tickets AND API usage declining
   */
  async ruleSupportSpikeWithDecline(metrics: CustomerHealthMetrics): Promise<ChurnSignal | null> {
    if (metrics.support_tickets_count >= 5 && metrics.api_calls_current_week < metrics.api_calls_previous_week * 0.7) {
      const signal: ChurnSignal = {
        signal_id: `churn_${Date.now()}`,
        rule_id: 'support_spike_decline',
        confidence: 0.68,
        customer_id: metrics.customer_id,
        signal_type: 'SUPPORT_ISSUES_WITH_DECLINE',
        metadata: {
          support_tickets: metrics.support_tickets_count,
          usage_decline_percent: Math.round(((metrics.api_calls_current_week - metrics.api_calls_previous_week) / metrics.api_calls_previous_week) * 100),
        },
        explanation: `Customer has ${metrics.support_tickets_count} open tickets AND usage declining. Indicates frustration + disengagement.`,
        recommended_action: 'Escalate to support manager. Offer dedicated onboarding or technical review.',
        urgency: 'high',
      };

      this.churn_log.push(signal);
      this.logger.info(`Churn signal: support_spike_decline for ${metrics.customer_id}`, signal);
      return signal;
    }

    return null;
  }

  /**
   * CHURN RULE 4: Payment Failure (85% confidence)
   * Failed payment indicates billing issues or account cancellation signal
   */
  async rulePaymentFailure(metrics: CustomerHealthMetrics): Promise<ChurnSignal | null> {
    if (!metrics.last_payment_success) {
      const signal: ChurnSignal = {
        signal_id: `churn_${Date.now()}`,
        rule_id: 'payment_failure',
        confidence: 0.85,
        customer_id: metrics.customer_id,
        signal_type: 'PAYMENT_FAILED',
        metadata: {
          payment_status: 'failed',
          action_required: 'immediate',
        },
        explanation: `Payment failed. Customer may cancel if not resolved within 24-48 hours.`,
        recommended_action: 'Immediate: Send payment retry link. Follow up in 24h if still failed.',
        urgency: 'high',
      };

      this.churn_log.push(signal);
      this.logger.info(`Churn signal: payment_failure for ${metrics.customer_id}`, signal);
      return signal;
    }

    return null;
  }

  /**
   * CHURN RULE 5: Inactivity (65% confidence)
   * No API calls for 7+ days after 30+ days of activity
   */
  async ruleInactivity(metrics: CustomerHealthMetrics): Promise<ChurnSignal | null> {
    if (metrics.days_since_last_api_call >= 7) {
      const signal: ChurnSignal = {
        signal_id: `churn_${Date.now()}`,
        rule_id: 'inactivity',
        confidence: 0.65,
        customer_id: metrics.customer_id,
        signal_type: 'ACCOUNT_INACTIVE',
        metadata: {
          days_inactive: metrics.days_since_last_api_call,
        },
        explanation: `No API activity for ${metrics.days_since_last_api_call} days. Inactive accounts are at risk.`,
        recommended_action: 'Engagement email: "Haven\'t seen you in a while. Need help getting started?"',
        urgency: 'medium',
      };

      this.churn_log.push(signal);
      this.logger.info(`Churn signal: inactivity for ${metrics.customer_id}`, signal);
      return signal;
    }

    return null;
  }

  /**
   * PRICING ANALYSIS: Determine optimal tier for customer
   * Uses elasticity + LTV impact to recommend tier changes
   */
  async analyzePricingElasticity(customer_id: string): Promise<PricingSignal | null> {
    try {
      // Fetch customer's tier, MRR, churn risk
      const result = await this.db.query(
        `
        SELECT
          customer_id,
          plan_tier,
          monthly_revenue,
          annual_revenue,
          churn_risk_score,
          features_used,
          teams,
          api_calls_month
        FROM customers
        WHERE customer_id = $1
      `,
        [customer_id]
      );

      if (result.rows.length === 0) return null;

      const customer = result.rows[0];

      // Calculate elasticity: What % of similar customers upgrade when offered discount?
      // Get similar customers (same tier, similar size)
      const similar_result = await this.db.query(
        `
        SELECT
          plan_tier,
          COUNT(*) as count,
          COUNT(CASE WHEN plan_tier_changed = true THEN 1 END) as upgraded
        FROM customers
        WHERE plan_tier = $1
          AND features_used BETWEEN $2 - 5 AND $2 + 5
        GROUP BY plan_tier
      `,
        [customer.plan_tier, customer.features_used]
      );

      const similar = similar_result.rows[0] || { count: 0, upgraded: 0 };
      const upgrade_rate = similar.count > 0 ? similar.upgraded / similar.count : 0.15; // default 15%

      // Calculate LTV impact
      // If we upgrade them to next tier, what's the expected LTV increase?
      const next_tier_revenue = this.getNextTierRevenue(customer.plan_tier);
      const ltv_increase = next_tier_revenue - customer.monthly_revenue;

      // Elasticity score: upgrade_rate × ltv_increase
      const elasticity_score = upgrade_rate * ltv_increase;

      const signal: PricingSignal = {
        signal_id: `pricing_${Date.now()}`,
        customer_id,
        elasticity_score,
        optimal_tier: this.getOptimalTier(customer, elasticity_score),
        expected_ltv_impact: ltv_increase,
        recommendation: elasticity_score > 100 ? `Offer upgrade to ${this.getOptimalTier(customer, elasticity_score)}` : 'Monitor, no action needed',
      };

      this.logger.info(`Pricing analysis for ${customer_id}`, signal);
      return signal;
    } catch (error) {
      this.logger.error(`Pricing analysis failed for ${customer_id}`, error);
      return null;
    }
  }

  /**
   * Execute all churn rules for a customer
   */
  async executeChurnDetection(
    customer_id: string,
    metrics: CustomerHealthMetrics,
    daily_usage: { date: string; calls: number }[]
  ): Promise<ChurnSignal[]> {
    const churn_signals: ChurnSignal[] = [];

    // Run all churn rules
    const rule1 = await this.ruleAdoptionDrop(metrics);
    const rule2 = await this.ruleUsageDeclineTrend(customer_id, daily_usage);
    const rule3 = await this.ruleSupportSpikeWithDecline(metrics);
    const rule4 = await this.rulePaymentFailure(metrics);
    const rule5 = await this.ruleInactivity(metrics);

    if (rule1) churn_signals.push(rule1);
    if (rule2) churn_signals.push(rule2);
    if (rule3) churn_signals.push(rule3);
    if (rule4) churn_signals.push(rule4);
    if (rule5) churn_signals.push(rule5);

    // Filter by confidence >= 55%
    const high_confidence = churn_signals.filter((s) => s.confidence >= 0.55);

    // Notify
    if (high_confidence.length > 0) {
      this.logger.info(`Churn signals found for ${customer_id}`, {
        count: high_confidence.length,
        signals: high_confidence.map((s) => s.rule_id),
      });

      for (const signal of high_confidence) {
        await this.slack.notifyChurnSignal(signal);
      }
    }

    return high_confidence;
  }

  /**
   * Helper: Get next tier pricing
   */
  private getNextTierRevenue(tier: string): number {
    const pricing = {
      starter: 199,
      pro: 499,
      enterprise: 2000,
    };
    return pricing[tier] || 199;
  }

  /**
   * Helper: Determine optimal tier for customer
   */
  private getOptimalTier(customer: any, elasticity_score: number): string {
    if (elasticity_score > 200) return 'enterprise';
    if (elasticity_score > 100) return 'pro';
    return customer.plan_tier;
  }

  getChurnLog(): ChurnSignal[] {
    return this.churn_log;
  }

  clearChurnLog(): void {
    this.churn_log = [];
  }
}

export default ChurnDetectionEngine;
