/**
 * Stripe API Types
 *
 * Comprehensive type definitions for Stripe API responses including:
 * - Customers with metadata
 * - Subscriptions with items and metadata
 * - Invoices with line items
 * - Usage records for metered billing
 * - Products and Prices
 */

// =============================================================================
// CORE STRIPE API TYPES
// =============================================================================

/**
 * Generic Stripe list response wrapper
 */
export interface StripeList<T> {
  object: 'list'
  data: T[]
  has_more: boolean
  url: string
}

/**
 * Stripe metadata - key-value pairs attached to objects
 */
export type StripeMetadata = Record<string, string>

/**
 * Stripe address object
 */
export interface StripeAddress {
  city: string | null
  country: string | null
  line1: string | null
  line2: string | null
  postal_code: string | null
  state: string | null
}

// =============================================================================
// CUSTOMERS
// =============================================================================

/**
 * Stripe Customer object with full metadata
 */
export interface StripeApiCustomer {
  id: string
  object: 'customer'
  address: StripeAddress | null
  balance: number
  created: number // Unix timestamp
  currency: string | null
  default_source: string | null
  delinquent: boolean
  description: string | null
  discount: StripeDiscount | null
  email: string | null
  invoice_prefix: string
  invoice_settings: {
    custom_fields: Array<{ name: string; value: string }> | null
    default_payment_method: string | null
    footer: string | null
    rendering_options: Record<string, unknown> | null
  }
  livemode: boolean
  metadata: StripeMetadata
  name: string | null
  phone: string | null
  preferred_locales: string[]
  shipping: {
    address: StripeAddress
    name: string
    phone: string | null
  } | null
  tax_exempt: 'none' | 'exempt' | 'reverse'
  test_clock: string | null
}

/**
 * Stripe Discount object
 */
export interface StripeDiscount {
  id: string
  object: 'discount'
  checkout_session: string | null
  coupon: StripeCoupon
  customer: string
  end: number | null
  invoice: string | null
  invoice_item: string | null
  promotion_code: string | null
  start: number
  subscription: string | null
  subscription_item: string | null
}

/**
 * Stripe Coupon object
 */
export interface StripeCoupon {
  id: string
  object: 'coupon'
  amount_off: number | null
  created: number
  currency: string | null
  duration: 'forever' | 'once' | 'repeating'
  duration_in_months: number | null
  livemode: boolean
  max_redemptions: number | null
  metadata: StripeMetadata
  name: string | null
  percent_off: number | null
  redeem_by: number | null
  times_redeemed: number
  valid: boolean
}

// =============================================================================
// PRODUCTS & PRICES
// =============================================================================

/**
 * Stripe Product object
 */
export interface StripeProduct {
  id: string
  object: 'product'
  active: boolean
  created: number
  default_price: string | null
  description: string | null
  images: string[]
  livemode: boolean
  metadata: StripeMetadata
  name: string
  package_dimensions: {
    height: number
    length: number
    weight: number
    width: number
  } | null
  shippable: boolean | null
  statement_descriptor: string | null
  tax_code: string | null
  type: 'good' | 'service'
  unit_label: string | null
  updated: number
  url: string | null
}

/**
 * Stripe Price object (replaces Plans)
 */
export interface StripePrice {
  id: string
  object: 'price'
  active: boolean
  billing_scheme: 'per_unit' | 'tiered'
  created: number
  currency: string
  custom_unit_amount: {
    maximum: number | null
    minimum: number | null
    preset: number | null
  } | null
  livemode: boolean
  lookup_key: string | null
  metadata: StripeMetadata
  nickname: string | null
  product: string | StripeProduct
  recurring: {
    aggregate_usage: 'sum' | 'last_during_period' | 'last_ever' | 'max' | null
    interval: 'day' | 'week' | 'month' | 'year'
    interval_count: number
    meter: string | null
    trial_period_days: number | null
    usage_type: 'metered' | 'licensed'
  } | null
  tax_behavior: 'exclusive' | 'inclusive' | 'unspecified'
  tiers_mode: 'graduated' | 'volume' | null
  transform_quantity: {
    divide_by: number
    round: 'up' | 'down'
  } | null
  type: 'one_time' | 'recurring'
  unit_amount: number | null
  unit_amount_decimal: string | null
}

// =============================================================================
// SUBSCRIPTIONS
// =============================================================================

/**
 * Stripe Subscription Item
 */
export interface StripeSubscriptionItem {
  id: string
  object: 'subscription_item'
  billing_thresholds: {
    usage_gte: number
  } | null
  created: number
  metadata: StripeMetadata
  price: StripePrice
  quantity: number
  subscription: string
  tax_rates: Array<{
    id: string
    display_name: string
    percentage: number
  }>
}

/**
 * Stripe Subscription object with full details
 */
export interface StripeApiSubscription {
  id: string
  object: 'subscription'
  application: string | null
  application_fee_percent: number | null
  automatic_tax: {
    enabled: boolean
    liability: { type: string } | null
  }
  billing_cycle_anchor: number
  billing_cycle_anchor_config: {
    day_of_month: number
    hour: number | null
    minute: number | null
    month: number | null
    second: number | null
  } | null
  billing_thresholds: {
    amount_gte: number | null
    reset_billing_cycle_anchor: boolean | null
  } | null
  cancel_at: number | null
  cancel_at_period_end: boolean
  canceled_at: number | null
  cancellation_details: {
    comment: string | null
    feedback: string | null
    reason: 'cancellation_requested' | 'payment_disputed' | 'payment_failed' | null
  } | null
  collection_method: 'charge_automatically' | 'send_invoice'
  created: number
  currency: string
  current_period_end: number
  current_period_start: number
  customer: string
  days_until_due: number | null
  default_payment_method: string | null
  default_source: string | null
  default_tax_rates: Array<{ id: string; percentage: number }>
  description: string | null
  discount: StripeDiscount | null
  discounts: string[]
  ended_at: number | null
  invoice_settings: {
    account_tax_ids: string[] | null
    issuer: { type: string } | null
  }
  items: StripeList<StripeSubscriptionItem>
  latest_invoice: string | null
  livemode: boolean
  metadata: StripeMetadata
  next_pending_invoice_item_invoice: number | null
  on_behalf_of: string | null
  pause_collection: {
    behavior: 'keep_as_draft' | 'mark_uncollectible' | 'void'
    resumes_at: number | null
  } | null
  payment_settings: {
    payment_method_options: Record<string, unknown> | null
    payment_method_types: string[] | null
    save_default_payment_method: 'off' | 'on_subscription' | null
  }
  pending_invoice_item_interval: {
    interval: 'day' | 'week' | 'month' | 'year'
    interval_count: number
  } | null
  pending_setup_intent: string | null
  pending_update: {
    billing_cycle_anchor: number | null
    expires_at: number
    subscription_items: StripeSubscriptionItem[] | null
    trial_end: number | null
    trial_from_plan: boolean | null
  } | null
  schedule: string | null
  start_date: number
  status: 'active' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'paused' | 'trialing' | 'unpaid'
  test_clock: string | null
  transfer_data: {
    amount_percent: number | null
    destination: string
  } | null
  trial_end: number | null
  trial_settings: {
    end_behavior: {
      missing_payment_method: 'cancel' | 'create_invoice' | 'pause'
    }
  }
  trial_start: number | null
}

// =============================================================================
// INVOICES
// =============================================================================

/**
 * Stripe Invoice Line Item
 */
export interface StripeInvoiceLineItem {
  id: string
  object: 'line_item'
  amount: number
  amount_excluding_tax: number | null
  currency: string
  description: string | null
  discount_amounts: Array<{
    amount: number
    discount: string
  }> | null
  discountable: boolean
  discounts: string[]
  invoice: string | null
  invoice_item: string | null
  livemode: boolean
  metadata: StripeMetadata
  period: {
    end: number
    start: number
  }
  price: StripePrice | null
  proration: boolean
  proration_details: {
    credited_items: {
      invoice: string
      invoice_line_items: string[]
    } | null
  } | null
  quantity: number | null
  subscription: string | null
  subscription_item: string | null
  tax_amounts: Array<{
    amount: number
    inclusive: boolean
    tax_rate: string
  }>
  tax_rates: Array<{
    id: string
    percentage: number
  }>
  type: 'invoiceitem' | 'subscription'
  unit_amount_excluding_tax: string | null
}

/**
 * Stripe Invoice object with full details
 */
export interface StripeApiInvoice {
  id: string
  object: 'invoice'
  account_country: string | null
  account_name: string | null
  account_tax_ids: string[] | null
  amount_due: number
  amount_paid: number
  amount_remaining: number
  amount_shipping: number
  application: string | null
  application_fee_amount: number | null
  attempt_count: number
  attempted: boolean
  auto_advance: boolean
  automatic_tax: {
    enabled: boolean
    liability: { type: string } | null
    status: 'complete' | 'failed' | 'requires_location_inputs' | null
  }
  billing_reason: 'automatic_pending_invoice_item_invoice' | 'manual' | 'quote_accept' | 'subscription' | 'subscription_create' | 'subscription_cycle' | 'subscription_threshold' | 'subscription_update' | 'upcoming' | null
  charge: string | null
  collection_method: 'charge_automatically' | 'send_invoice'
  created: number
  currency: string
  custom_fields: Array<{ name: string; value: string }> | null
  customer: string
  customer_address: StripeAddress | null
  customer_email: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_shipping: {
    address: StripeAddress
    name: string
    phone: string | null
  } | null
  customer_tax_exempt: 'none' | 'exempt' | 'reverse' | null
  customer_tax_ids: Array<{
    type: string
    value: string
  }> | null
  default_payment_method: string | null
  default_source: string | null
  default_tax_rates: Array<{ id: string; percentage: number }>
  description: string | null
  discount: StripeDiscount | null
  discounts: string[]
  due_date: number | null
  effective_at: number | null
  ending_balance: number | null
  footer: string | null
  from_invoice: {
    action: string
    invoice: string
  } | null
  hosted_invoice_url: string | null
  invoice_pdf: string | null
  issuer: { type: string } | null
  last_finalization_error: {
    code: string
    message: string
    type: string
  } | null
  latest_revision: string | null
  lines: StripeList<StripeInvoiceLineItem>
  livemode: boolean
  metadata: StripeMetadata
  next_payment_attempt: number | null
  number: string | null
  on_behalf_of: string | null
  paid: boolean
  paid_out_of_band: boolean
  payment_intent: string | null
  payment_settings: {
    default_mandate: string | null
    payment_method_options: Record<string, unknown> | null
    payment_method_types: string[] | null
  }
  period_end: number
  period_start: number
  post_payment_credit_notes_amount: number
  pre_payment_credit_notes_amount: number
  quote: string | null
  receipt_number: string | null
  rendering: {
    amount_tax_display: string | null
    pdf: { page_size: string } | null
  } | null
  shipping_cost: {
    amount_subtotal: number
    amount_tax: number
    amount_total: number
    shipping_rate: string | null
  } | null
  shipping_details: {
    address: StripeAddress
    name: string
    phone: string | null
  } | null
  starting_balance: number
  statement_descriptor: string | null
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void' | null
  status_transitions: {
    finalized_at: number | null
    marked_uncollectible_at: number | null
    paid_at: number | null
    voided_at: number | null
  }
  subscription: string | null
  subscription_details: {
    metadata: StripeMetadata | null
  } | null
  subscription_proration_date: number | null
  subtotal: number
  subtotal_excluding_tax: number | null
  tax: number | null
  test_clock: string | null
  total: number
  total_discount_amounts: Array<{
    amount: number
    discount: string
  }> | null
  total_excluding_tax: number | null
  total_tax_amounts: Array<{
    amount: number
    inclusive: boolean
    tax_rate: string
  }>
  transfer_data: {
    amount: number | null
    destination: string
  } | null
  webhooks_delivered_at: number | null
}

// =============================================================================
// USAGE RECORDS
// =============================================================================

/**
 * Stripe Usage Record for metered billing
 */
export interface StripeUsageRecord {
  id: string
  object: 'usage_record'
  livemode: boolean
  quantity: number
  subscription_item: string
  timestamp: number
}

/**
 * Stripe Usage Record Summary
 */
export interface StripeUsageRecordSummary {
  id: string
  object: 'usage_record_summary'
  invoice: string | null
  livemode: boolean
  period: {
    end: number | null
    start: number | null
  }
  subscription_item: string
  total_usage: number
}

// =============================================================================
// PROCESSED/UNIFIED TYPES
// =============================================================================

/**
 * Unified customer data with enhanced metadata
 */
export interface UnifiedStripeCustomer {
  id: string
  email: string | null
  name: string | null
  description: string | null
  created: Date
  metadata: StripeMetadata
  // Computed fields
  totalSpend: number
  subscriptionCount: number
  segment: 'SMB' | 'Mid-Market' | 'Enterprise'
  // Address info
  country: string | null
  city: string | null
  // Tax info
  taxExempt: boolean
  // Balance
  balance: number
  delinquent: boolean
}

/**
 * Unified subscription data with all pricing details
 */
export interface UnifiedStripeSubscription {
  id: string
  customerId: string
  status: string
  created: Date
  currentPeriodStart: Date
  currentPeriodEnd: Date
  canceledAt: Date | null
  endedAt: Date | null
  trialEnd: Date | null
  metadata: StripeMetadata
  // Pricing
  mrr: number
  currency: string
  billingInterval: 'day' | 'week' | 'month' | 'year'
  intervalCount: number
  // Items
  items: Array<{
    id: string
    priceId: string
    productId: string
    productName: string
    quantity: number
    unitAmount: number
    usageType: 'metered' | 'licensed'
    metadata: StripeMetadata
  }>
  // Discounts
  discountPercent: number | null
  discountAmount: number | null
  // Cancel info
  cancelAtPeriodEnd: boolean
  cancellationReason: string | null
}

/**
 * Unified invoice data with line item details
 */
export interface UnifiedStripeInvoice {
  id: string
  customerId: string
  subscriptionId: string | null
  number: string | null
  status: string
  created: Date
  dueDate: Date | null
  paidAt: Date | null
  metadata: StripeMetadata
  // Amounts
  amountDue: number
  amountPaid: number
  amountRemaining: number
  subtotal: number
  tax: number | null
  total: number
  currency: string
  // Details
  billingReason: string | null
  attemptCount: number
  // Line items
  lineItems: Array<{
    id: string
    description: string | null
    amount: number
    quantity: number
    priceId: string | null
    productId: string | null
    periodStart: Date
    periodEnd: Date
    proration: boolean
  }>
}

/**
 * Unified usage data
 */
export interface UnifiedStripeUsage {
  subscriptionItemId: string
  customerId: string
  subscriptionId: string
  priceId: string
  productName: string
  periodStart: Date
  periodEnd: Date
  totalUsage: number
  metric: string
}

/**
 * Complete Stripe data export for analysis
 */
export interface StripeDataExport {
  exportedAt: Date
  accountId: string
  accountName: string
  customers: UnifiedStripeCustomer[]
  subscriptions: UnifiedStripeSubscription[]
  invoices: UnifiedStripeInvoice[]
  usage: UnifiedStripeUsage[]
  products: StripeProduct[]
  prices: StripePrice[]
  // Summary metrics
  summary: {
    totalCustomers: number
    activeSubscriptions: number
    totalMrr: number
    totalArr: number
    averageRevenuePerCustomer: number
    churnedSubscriptions: number
    trialingSubscriptions: number
    totalInvoicesPaid: number
    totalRevenue: number
  }
}

/**
 * Sync operation result
 */
export interface StripeSyncResult {
  success: boolean
  message: string
  data: StripeDataExport | null
  errors: Array<{
    type: string
    message: string
    objectId?: string
  }>
  timing: {
    startedAt: Date
    completedAt: Date
    durationMs: number
  }
}
