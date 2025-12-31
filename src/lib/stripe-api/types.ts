/**
 * Stripe API Types
 *
 * Comprehensive TypeScript definitions for Stripe API integration.
 * These types mirror Stripe's API responses and support both test and live modes.
 *
 * @module lib/stripe-api/types
 */

// =============================================================================
// API KEY & AUTHENTICATION
// =============================================================================

/**
 * Stripe API key mode - test keys start with 'sk_test_', live with 'sk_live_'
 */
export type StripeKeyMode = 'test' | 'live'

/**
 * API key validation result
 */
export interface StripeKeyValidation {
  /** Whether the key is valid */
  isValid: boolean
  /** Key mode (test or live) */
  mode: StripeKeyMode | null
  /** Account ID if valid */
  accountId?: string
  /** Account display name */
  accountName?: string
  /** Error message if invalid */
  error?: string
}

/**
 * Stripe connection configuration
 */
export interface StripeConnection {
  /** The secret API key */
  apiKey: string
  /** Whether this is a test or live key */
  mode: StripeKeyMode
  /** Connected Stripe account ID */
  accountId: string
  /** Account display name */
  accountName?: string
  /** When the connection was established */
  connectedAt: string
}

// =============================================================================
// STRIPE API CORE TYPES
// =============================================================================

/**
 * Base Stripe object with common fields
 */
export interface StripeObject {
  /** Unique identifier */
  id: string
  /** Object type (e.g., 'customer', 'subscription') */
  object: string
  /** Whether this is a live mode object */
  livemode: boolean
  /** Unix timestamp of creation */
  created: number
  /** Additional metadata attached to the object */
  metadata: Record<string, string>
}

/**
 * Stripe pagination cursor
 */
export interface StripePagination {
  /** Whether there are more items */
  has_more: boolean
  /** URL for the next page */
  url: string
}

/**
 * Generic Stripe list response
 */
export interface StripeList<T> {
  object: 'list'
  data: T[]
  has_more: boolean
  url: string
}

// =============================================================================
// CUSTOMER TYPES
// =============================================================================

/**
 * Stripe Address object
 */
export interface StripeAddress {
  city: string | null
  country: string | null
  line1: string | null
  line2: string | null
  postal_code: string | null
  state: string | null
}

/**
 * Stripe Customer object
 * @see https://stripe.com/docs/api/customers/object
 */
export interface StripeCustomer extends StripeObject {
  object: 'customer'
  /** Customer's email address */
  email: string | null
  /** Customer's full name */
  name: string | null
  /** Customer's phone number */
  phone: string | null
  /** Customer's description */
  description: string | null
  /** Billing address */
  address: StripeAddress | null
  /** Account balance in cents */
  balance: number
  /** Three-letter ISO currency code */
  currency: string | null
  /** Default payment method ID */
  default_source: string | null
  /** Whether the customer is deleted */
  deleted?: boolean
  /** Whether invoices are delinquent */
  delinquent: boolean
  /** Discount applied to customer */
  discount: StripeDiscount | null
  /** Invoice prefix */
  invoice_prefix: string
  /** Tax IDs */
  tax_ids?: StripeList<StripeTaxId>
}

/**
 * Stripe Tax ID
 */
export interface StripeTaxId extends StripeObject {
  object: 'tax_id'
  country: string
  customer: string
  type: string
  value: string
  verification: {
    status: 'pending' | 'verified' | 'unverified' | 'unavailable'
    verified_name: string | null
    verified_address: string | null
  } | null
}

/**
 * Stripe Discount
 */
export interface StripeDiscount {
  id: string
  object: 'discount'
  coupon: StripeCoupon
  customer: string
  end: number | null
  start: number
}

/**
 * Stripe Coupon
 */
export interface StripeCoupon {
  id: string
  object: 'coupon'
  amount_off: number | null
  currency: string | null
  duration: 'forever' | 'once' | 'repeating'
  duration_in_months: number | null
  name: string | null
  percent_off: number | null
  valid: boolean
}

// =============================================================================
// SUBSCRIPTION TYPES
// =============================================================================

/**
 * Subscription status values
 */
export type StripeSubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'paused'
  | 'trialing'
  | 'unpaid'

/**
 * Stripe Price object (part of subscription items)
 */
export interface StripePrice extends StripeObject {
  object: 'price'
  /** Whether the price is active */
  active: boolean
  /** Billing scheme: per_unit or tiered */
  billing_scheme: 'per_unit' | 'tiered'
  /** Three-letter ISO currency code */
  currency: string
  /** Price nickname */
  nickname: string | null
  /** Associated product ID */
  product: string | StripeProduct
  /** Recurring interval configuration */
  recurring: {
    interval: 'day' | 'week' | 'month' | 'year'
    interval_count: number
    usage_type: 'licensed' | 'metered'
    aggregate_usage?: 'sum' | 'last_during_period' | 'last_ever' | 'max' | null
  } | null
  /** Pricing tiers (for tiered pricing) */
  tiers?: StripePriceTier[]
  /** Tiers mode */
  tiers_mode: 'graduated' | 'volume' | null
  /** Transform quantity configuration */
  transform_quantity: {
    divide_by: number
    round: 'up' | 'down'
  } | null
  /** Price type */
  type: 'one_time' | 'recurring'
  /** Unit amount in cents */
  unit_amount: number | null
  /** Unit amount as decimal string */
  unit_amount_decimal: string | null
}

/**
 * Stripe price tier for tiered pricing
 */
export interface StripePriceTier {
  flat_amount: number | null
  flat_amount_decimal: string | null
  unit_amount: number | null
  unit_amount_decimal: string | null
  up_to: number | null
}

/**
 * Stripe Product object
 */
export interface StripeProduct extends StripeObject {
  object: 'product'
  active: boolean
  name: string
  description: string | null
  default_price: string | StripePrice | null
  images: string[]
  unit_label: string | null
  url: string | null
}

/**
 * Stripe Subscription Item
 */
export interface StripeSubscriptionItem extends StripeObject {
  object: 'subscription_item'
  /** Billing thresholds */
  billing_thresholds: {
    usage_gte: number | null
  } | null
  /** Associated price */
  price: StripePrice
  /** Quantity of the plan */
  quantity: number
  /** Associated subscription */
  subscription: string
  /** Tax rates */
  tax_rates: StripeTaxRate[]
}

/**
 * Stripe Tax Rate
 */
export interface StripeTaxRate extends StripeObject {
  object: 'tax_rate'
  active: boolean
  country: string | null
  description: string | null
  display_name: string
  inclusive: boolean
  jurisdiction: string | null
  percentage: number
  state: string | null
  tax_type: string | null
}

/**
 * Stripe Subscription object
 * @see https://stripe.com/docs/api/subscriptions/object
 */
export interface StripeSubscription extends StripeObject {
  object: 'subscription'
  /** ID of the customer */
  customer: string | StripeCustomer
  /** Subscription status */
  status: StripeSubscriptionStatus
  /** Current billing period start (Unix timestamp) */
  current_period_start: number
  /** Current billing period end (Unix timestamp) */
  current_period_end: number
  /** When the subscription started (Unix timestamp) */
  start_date: number
  /** When the subscription ended or will end */
  ended_at: number | null
  /** When the subscription was canceled */
  canceled_at: number | null
  /** When to cancel the subscription at period end */
  cancel_at: number | null
  /** Whether to cancel at period end */
  cancel_at_period_end: boolean
  /** Trial start date */
  trial_start: number | null
  /** Trial end date */
  trial_end: number | null
  /** Subscription items (plans/prices) */
  items: StripeList<StripeSubscriptionItem>
  /** Default payment method */
  default_payment_method: string | null
  /** Collection method */
  collection_method: 'charge_automatically' | 'send_invoice'
  /** Days until due (for send_invoice) */
  days_until_due: number | null
  /** Latest invoice ID */
  latest_invoice: string | StripeInvoice | null
  /** Discount applied */
  discount: StripeDiscount | null
  /** Application fee percent */
  application_fee_percent: number | null
  /** Billing cycle anchor */
  billing_cycle_anchor: number
  /** Quantity (deprecated, use items) */
  quantity?: number
  /** Plan (deprecated, use items) */
  plan?: StripePlan
}

/**
 * Stripe Plan (legacy, now use Price)
 */
export interface StripePlan extends StripeObject {
  object: 'plan'
  active: boolean
  amount: number | null
  amount_decimal: string | null
  currency: string
  interval: 'day' | 'week' | 'month' | 'year'
  interval_count: number
  nickname: string | null
  product: string | StripeProduct
  usage_type: 'licensed' | 'metered'
}

// =============================================================================
// INVOICE TYPES
// =============================================================================

/**
 * Invoice status values
 */
export type StripeInvoiceStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'uncollectible'
  | 'void'

/**
 * Stripe Invoice Line Item
 */
export interface StripeInvoiceLineItem extends StripeObject {
  object: 'line_item'
  /** Amount in cents */
  amount: number
  /** Amount excluding tax */
  amount_excluding_tax: number | null
  /** Currency */
  currency: string
  /** Description */
  description: string | null
  /** Discount amounts */
  discount_amounts: Array<{
    amount: number
    discount: string | StripeDiscount
  }> | null
  /** Whether discountable */
  discountable: boolean
  /** Invoice item ID (if from invoice item) */
  invoice_item?: string
  /** Period the line item covers */
  period: {
    start: number
    end: number
  }
  /** Price associated with line item */
  price: StripePrice | null
  /** Whether prorated */
  proration: boolean
  /** Proration details */
  proration_details?: {
    credited_items?: {
      invoice: string
      invoice_line_items: string[]
    } | null
  }
  /** Quantity */
  quantity: number | null
  /** Subscription ID */
  subscription: string | null
  /** Subscription item ID */
  subscription_item?: string
  /** Tax amounts */
  tax_amounts: Array<{
    amount: number
    inclusive: boolean
    tax_rate: string | StripeTaxRate
    taxability_reason: string | null
    taxable_amount: number | null
  }>
  /** Type of line item */
  type: 'invoiceitem' | 'subscription'
  /** Unit amount excluding tax */
  unit_amount_excluding_tax: string | null
}

/**
 * Stripe Invoice object
 * @see https://stripe.com/docs/api/invoices/object
 */
export interface StripeInvoice extends StripeObject {
  object: 'invoice'
  /** Customer ID */
  customer: string | StripeCustomer
  /** Customer email at time of invoice */
  customer_email: string | null
  /** Customer name at time of invoice */
  customer_name: string | null
  /** Invoice number */
  number: string | null
  /** Invoice status */
  status: StripeInvoiceStatus | null
  /** Total amount due in cents */
  amount_due: number
  /** Amount paid in cents */
  amount_paid: number
  /** Amount remaining in cents */
  amount_remaining: number
  /** Subtotal in cents */
  subtotal: number
  /** Subtotal excluding tax */
  subtotal_excluding_tax: number | null
  /** Total in cents */
  total: number
  /** Total excluding tax */
  total_excluding_tax: number | null
  /** Tax amount in cents */
  tax: number | null
  /** Currency */
  currency: string
  /** Due date (Unix timestamp) */
  due_date: number | null
  /** Period start (Unix timestamp) */
  period_start: number
  /** Period end (Unix timestamp) */
  period_end: number
  /** Associated subscription ID */
  subscription: string | null
  /** Invoice line items */
  lines: StripeList<StripeInvoiceLineItem>
  /** Discounts applied */
  discounts: Array<string | StripeDiscount> | null
  /** Total discount amounts */
  total_discount_amounts: Array<{
    amount: number
    discount: string | StripeDiscount
  }> | null
  /** Billing reason */
  billing_reason:
    | 'subscription_create'
    | 'subscription_cycle'
    | 'subscription_update'
    | 'subscription'
    | 'manual'
    | 'upcoming'
    | 'subscription_threshold'
    | null
  /** Collection method */
  collection_method: 'charge_automatically' | 'send_invoice'
  /** Paid status */
  paid: boolean
  /** Paid out of band */
  paid_out_of_band: boolean
  /** Hosted invoice URL */
  hosted_invoice_url: string | null
  /** Invoice PDF URL */
  invoice_pdf: string | null
  /** Finalized at timestamp */
  finalized_at: number | null
  /** Voided at timestamp */
  voided_at: number | null
  /** Payment intent ID */
  payment_intent: string | null
  /** Charge ID */
  charge: string | null
  /** Attempt count */
  attempt_count: number
  /** Whether attempted */
  attempted: boolean
  /** Next payment attempt */
  next_payment_attempt: number | null
  /** Webhooks delivered at */
  webhooks_delivered_at: number | null
}

// =============================================================================
// USAGE RECORD TYPES (for metered billing)
// =============================================================================

/**
 * Stripe Usage Record
 * @see https://stripe.com/docs/api/usage_records
 */
export interface StripeUsageRecord extends StripeObject {
  object: 'usage_record'
  /** Quantity of usage */
  quantity: number
  /** Subscription item ID */
  subscription_item: string
  /** Timestamp of the usage */
  timestamp: number
}

/**
 * Stripe Usage Record Summary
 * @see https://stripe.com/docs/api/usage_records/subscription_item_summary_list
 */
export interface StripeUsageRecordSummary {
  id: string
  object: 'usage_record_summary'
  /** Invoice ID */
  invoice: string | null
  /** Whether live mode */
  livemode: boolean
  /** Period for this summary */
  period: {
    start: number
    end: number
  }
  /** Subscription item ID */
  subscription_item: string
  /** Total usage in period */
  total_usage: number
}

// =============================================================================
// SYNC JOB TYPES
// =============================================================================

/**
 * Data type being synced
 */
export type StripeSyncDataType = 'customers' | 'subscriptions' | 'invoices' | 'usage'

/**
 * Sync job status
 */
export type StripeSyncStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * Progress for a single data type
 */
export interface StripeSyncProgress {
  /** Data type being synced */
  type: StripeSyncDataType
  /** Current status */
  status: StripeSyncStatus
  /** Total items to sync */
  total: number
  /** Items synced so far */
  synced: number
  /** Progress percentage (0-100) */
  percentage: number
  /** Error message if failed */
  error?: string
}

/**
 * Overall sync job state
 */
export interface StripeSyncJob {
  /** Unique job ID */
  id: string
  /** Stripe account ID */
  accountId: string
  /** Overall job status */
  status: StripeSyncStatus
  /** Progress for each data type */
  progress: Record<StripeSyncDataType, StripeSyncProgress>
  /** When sync started */
  startedAt: string
  /** When sync completed */
  completedAt?: string
  /** Total records synced */
  totalRecords: number
  /** Any errors encountered */
  errors: Array<{
    type: StripeSyncDataType
    message: string
    timestamp: string
  }>
}

// =============================================================================
// DATA QUALITY VALIDATION
// =============================================================================

/**
 * Data quality issue severity
 */
export type DataQualitySeverity = 'error' | 'warning' | 'info'

/**
 * Individual data quality issue
 */
export interface DataQualityIssue {
  /** Severity level */
  severity: DataQualitySeverity
  /** Issue category */
  category: 'missing_data' | 'inconsistency' | 'format' | 'duplicate' | 'orphaned'
  /** Human-readable message */
  message: string
  /** Affected record IDs */
  affectedIds: string[]
  /** Count of affected records */
  count: number
}

/**
 * Data quality validation result
 */
export interface DataQualityReport {
  /** Whether data passed validation */
  isValid: boolean
  /** Overall quality score (0-100) */
  score: number
  /** List of issues found */
  issues: DataQualityIssue[]
  /** Summary statistics */
  stats: {
    totalCustomers: number
    totalSubscriptions: number
    totalInvoices: number
    customersWithoutSubscriptions: number
    subscriptionsWithoutInvoices: number
    orphanedInvoices: number
  }
}

// =============================================================================
// API ERROR TYPES
// =============================================================================

/**
 * Stripe API error types
 */
export type StripeErrorType =
  | 'api_error'
  | 'authentication_error'
  | 'card_error'
  | 'idempotency_error'
  | 'invalid_request_error'
  | 'rate_limit_error'

/**
 * Stripe API error response
 */
export interface StripeApiError {
  type: StripeErrorType
  code?: string
  message: string
  param?: string
  doc_url?: string
  decline_code?: string
}

// =============================================================================
// TRANSFORMED DATA TYPES (for internal use)
// =============================================================================

/**
 * Transformed customer for internal storage
 */
export interface TransformedCustomer {
  id: string
  stripeId: string
  email: string | null
  name: string | null
  phone: string | null
  createdAt: string
  metadata: Record<string, string>
  isTest: boolean
}

/**
 * Transformed subscription for internal storage
 */
export interface TransformedSubscription {
  id: string
  stripeId: string
  customerId: string
  status: StripeSubscriptionStatus
  planId: string
  planName: string | null
  pricePerUnit: number
  currency: string
  interval: 'day' | 'week' | 'month' | 'year'
  intervalCount: number
  quantity: number
  currentPeriodStart: string
  currentPeriodEnd: string
  startDate: string
  endedAt: string | null
  canceledAt: string | null
  cancelAtPeriodEnd: boolean
  trialStart: string | null
  trialEnd: string | null
  mrrOverride: number | null
  metadata: Record<string, string>
  isTest: boolean
}

/**
 * Transformed invoice for internal storage
 */
export interface TransformedInvoice {
  id: string
  stripeId: string
  customerId: string
  subscriptionId: string | null
  number: string | null
  status: StripeInvoiceStatus | null
  amountDue: number
  amountPaid: number
  subtotal: number
  total: number
  tax: number | null
  currency: string
  periodStart: string
  periodEnd: string
  dueDate: string | null
  paidAt: string | null
  billingReason: string | null
  hostedInvoiceUrl: string | null
  metadata: Record<string, string>
  isTest: boolean
}

/**
 * Transformed usage record for internal storage
 */
export interface TransformedUsageRecord {
  id: string
  customerId: string
  subscriptionId: string
  subscriptionItemId: string
  quantity: number
  timestamp: string
  periodStart: string
  periodEnd: string
  totalUsage: number
  isTest: boolean
}
