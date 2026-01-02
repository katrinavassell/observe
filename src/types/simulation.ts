// Simulation Engine Types
// Adapted from margin-engine for metrics-onboarding integration

// ============================================
// Input Types
// ============================================

export interface SimulationRequest {
  scenarioName: string
  scenarioDescription?: string
  isBaseline: boolean
  pricingModel: PricingModelConfig
}

export interface PricingModelConfig {
  type: 'per_seat' | 'usage_based' | 'hybrid' | 'flat_rate'
  billingPeriod: 'monthly' | 'quarterly' | 'annual'
  seatPrice?: number
  monthlyFee?: number
  usagePricePerUnit?: number
  freeTier?: number
  growthRate: number
}

// ============================================
// Unified Data Formats (from data bridge)
// ============================================

export interface UsageRecord {
  date: string
  customerId: string
  customerEmail?: string
  model?: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
}

export interface BillingRecord {
  date: string
  customerId: string
  customerEmail?: string
  amount: number
  currency: string
  description?: string
  status: 'paid' | 'pending' | 'failed'
}

export interface SimulationInput {
  usageData: UsageRecord[]
  billingData: BillingRecord[]
  dateRange: {
    start: string
    end: string
  }
}

// ============================================
// Output Types
// ============================================

export interface SimulationResult {
  summary: SimulationSummary
  monthlyData: MonthlyProjection[]
  customerBreakdown: CustomerMargin[]
  modelBreakdown: ModelCost[]
  recommendations: PricingRecommendation
  assumptions: SimulationAssumptions
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
  month: string // "2024-01", "2024-02", etc.
  monthLabel: string // "Month 1", "January 2024"
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

export interface DataSourceSummary {
  id: string
  name: string
  type: string
  dataTypes: string[]
}

export interface SimulationAssumptions {
  growthRate: number
  dataSources: DataSourceSummary[]
  dateRange: {
    start: string
    end: string
  }
  simulatedAt: string
}

// ============================================
// Edge Function Types
// ============================================

export interface EdgeFunctionRequest {
  userId: string
  pricingModel: PricingModelConfig
}

export interface EdgeFunctionResponse {
  success: boolean
  results?: SimulationResult
  error?: {
    code: string
    message: string
  }
}

// ============================================
// Database Types
// ============================================

export interface PricingScenario {
  id: string
  user_id: string
  name: string
  description?: string
  pricing_model: PricingModelConfig
  results?: SimulationResult
  is_baseline: boolean
  created_at: string
  updated_at: string
}

// ============================================
// Simulation Progress State
// ============================================

export type SimulationProgress = 'idle' | 'fetching' | 'calculating' | 'saving'
