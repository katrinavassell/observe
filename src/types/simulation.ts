// =============================================================================
// Simulation Engine Types (used by useSimulation composable)
// =============================================================================

export type SimulationProgress = 'idle' | 'fetching' | 'calculating' | 'saving'

export interface PricingModelConfig {
  type: 'per_seat' | 'usage_based' | 'hybrid' | 'flat_rate'
  billingPeriod: 'monthly' | 'quarterly' | 'annual'
  seatPrice?: number
  monthlyFee?: number
  usagePricePerUnit?: number
  freeTier?: number
  growthRate?: number
}

export interface SimulationRequest {
  scenarioName: string
  scenarioDescription?: string
  isBaseline: boolean
  pricingModel: PricingModelConfig
}

export interface SimulationSummary {
  totalRevenue: number
  totalCost: number
  totalMargin: number
  avgMarginPercent: number
  customerCount: number
  profitableCustomers: number
  unprofitableCustomers: number
  totalTokens: number
  pricingModel: string
  billingPeriod: string
}

export interface MonthlyProjection {
  month: string
  monthLabel: string
  revenue: number
  cost: number
  margin: number
  marginPercent: number
  customers: number
  usage: number
  projectedGrowth: number
}

export interface CustomerMargin {
  customerId: string
  customerName?: string
  customerEmail?: string
  revenue: number
  cost: number
  margin: number
  marginPercent: number
  profitable: boolean
}

export interface ModelCost {
  model: string
  tokens: number
  cost: number
  percentOfTotal: number
}

export interface PricingRecommendation {
  breakEvenPrice: number
  currentImpliedPrice: number
  recommendedPriceFor20Percent: number
  recommendedPriceFor30Percent: number
  recommendedPriceFor40Percent: number
  recommendedPriceFor50Percent: number
}

export interface SimulationAssumptions {
  growthRate: number
  dataSources: Array<{ id: string; name: string; dataTypes: string[] }>
  dateRange: { start: string; end: string }
  simulatedAt: string
}

export interface SimulationResult {
  summary: SimulationSummary
  monthlyData: MonthlyProjection[]
  customerBreakdown: CustomerMargin[]
  modelBreakdown: ModelCost[]
  recommendations: PricingRecommendation
  assumptions: SimulationAssumptions
}

// =============================================================================
// Phase 2 Simulation Types (used by SimulationsPage)
// =============================================================================

export type SimulationStatus = 'draft' | 'running' | 'completed' | 'rolled_out'

export type PricingChangeType =
  | 'percentage_increase'
  | 'percentage_decrease'
  | 'flat_increase'
  | 'flat_decrease'
  | 'new_price'

export interface SimulationScenario {
  id: string
  name: string
  description: string
  changes: Array<{
    feature_key: string
    change_type: PricingChangeType
    change_value: number
  }>
  projected_revenue?: number
  projected_cost?: number
  projected_margin_pct?: number
}

export interface SimulationCustomerImpact {
  customer_id: string
  customer_name: string
  current_revenue: number
  projected_revenue: number
  revenue_delta: number
  revenue_delta_pct: number
  churn_risk: 'low' | 'medium' | 'high'
  segment?: string
}

export interface FeatureMarginAnalysis {
  feature_key: string
  current_cost: number
  current_revenue: number
  current_margin_pct: number
  projected_revenue: number
  projected_margin_pct: number
  margin_delta_pct: number
}

export interface MarginImpactSummary {
  current_margin_pct: number
  projected_margin_pct: number
  margin_delta_pct: number
  total_current_revenue: number
  total_projected_revenue: number
  total_cost: number
  customers_affected: number
  high_churn_risk_count: number
}

export interface PricingOpportunity {
  id: string
  title: string
  description: string
  severity: 'critical' | 'warning' | 'info'
  suggested_action: string
  feature_key?: string
  estimated_impact?: string
}

export interface Simulation {
  id: string
  user_id: string
  name: string
  status: SimulationStatus
  segment_name?: string
  time_range?: { start: string; end: string }
  scenarios: SimulationScenario[]
  summary_table?: Record<string, unknown>
  customer_impacts: SimulationCustomerImpact[]
  feature_analysis: FeatureMarginAnalysis[]
  margin_impact: MarginImpactSummary | null
  confidence_score: number | null
  key_insight: string | null
  winning_scenario_id: string | null
  rolled_out_at: string | null
  created_at: string
  updated_at: string
}

// Helper functions

export function getSimulationStatusColor(status: SimulationStatus): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-100 text-gray-700 border-gray-200'
    case 'running':
      return 'bg-blue-100 text-blue-700 border-blue-200'
    case 'completed':
      return 'bg-green-100 text-green-700 border-green-200'
    case 'rolled_out':
      return 'bg-purple-100 text-purple-700 border-purple-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

export function getSimulationStatusLabel(status: SimulationStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'running':
      return 'Running'
    case 'completed':
      return 'Completed'
    case 'rolled_out':
      return 'Rolled Out'
    default:
      return status
  }
}
