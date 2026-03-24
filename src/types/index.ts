/**
 * Centralized Type Definitions
 *
 * This module exports shared TypeScript types used across the application.
 * Import from '@/types' for consistent typing throughout the codebase.
 *
 * @module types
 */

// Re-export domain types from their source modules
export type {
  // Core entities
  Customer,
  Plan,
  Subscription,
  Invoice,
  UsageRecord,
  CostRecord,

  // Analysis types
  AnalyzerData,
  AnalysisResult,
  SaaSMetrics,
  PlanHealth,
  PriceExperiment,
  BundlingOpportunity,
  UsageAnomaly,
  NegativeMarginCustomer,
  CohortData,
} from '@/lib/pricing-analyzer'

export type {
  // API response types
  RevenueAnalytics,
  RevenueMetrics,
  TrendData,
  Discrepancy,
  Account,
  AccountDetail,
  AccountsResponse,
  MatchCandidate,
  MatchesResponse,
  PricingIntelligence,
  Integration,
  DataStatus,
  DataMode,
} from '@/api/client'


// =============================================================================
// COMMON UTILITY TYPES
// =============================================================================

/**
 * Represents a file reference that may or may not have the actual File object.
 * When `file` is present, it hasn't been saved yet.
 * When only `name` is present, the data has been saved to the database.
 */
export interface FileReference {
  /** Display name of the file */
  name: string
  /** The actual File object (present only for unsaved files) */
  file?: File
}

/**
 * Generic async operation state for tracking loading, error, and success.
 */
export interface AsyncState<T> {
  /** The data when loaded successfully */
  data: T | null
  /** Whether the operation is in progress */
  isLoading: boolean
  /** Error message if the operation failed */
  error: string | null
}

/**
 * Pagination parameters for list endpoints.
 */
export interface PaginationParams {
  /** Maximum number of items to return */
  limit?: number
  /** Number of items to skip */
  offset?: number
}

/**
 * Standard paginated response wrapper.
 */
export interface PaginatedResponse<T> {
  /** The items in this page */
  items: T[]
  /** Total number of items across all pages */
  total: number
  /** Whether there are more items after this page */
  hasMore: boolean
}

/**
 * Sort direction for list queries.
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Date range for filtering.
 */
export interface DateRange {
  /** Start date (ISO string) */
  start: string
  /** End date (ISO string) */
  end: string
}

// =============================================================================
// UI STATE TYPES
// =============================================================================

/**
 * Toast notification severity levels.
 */
export type ToastSeverity = 'success' | 'error' | 'warning' | 'info'

/**
 * Common form field state.
 */
export interface FormFieldState {
  /** Current field value */
  value: string
  /** Validation error message */
  error: string | null
  /** Whether the field has been touched/modified */
  touched: boolean
}

/**
 * Modal/dialog state.
 */
export interface ModalState {
  /** Whether the modal is open */
  isOpen: boolean
  /** Data passed to the modal */
  data?: unknown
}
