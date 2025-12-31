/**
 * Stripe Data Transformer
 *
 * Transforms Stripe API responses into internal data formats
 * suitable for storage and analysis.
 *
 * @module lib/stripe-api/transformer
 */

import type {
  StripeCustomer,
  StripeSubscription,
  StripeInvoice,
  StripeUsageRecordSummary,
  StripeKeyMode,
  TransformedCustomer,
  TransformedSubscription,
  TransformedInvoice,
  TransformedUsageRecord,
  StripePrice,
  StripeProduct,
} from './types'
import { unixToIso } from './client'

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Extract product name from price, handling both expanded and unexpanded cases
 */
function getProductName(price: StripePrice | null): string | null {
  if (!price) return null

  const product = price.product
  if (typeof product === 'string') {
    return null // Not expanded
  }
  return (product as StripeProduct).name || null
}

/**
 * Calculate unit price in dollars from Stripe price object
 */
function calculateUnitPrice(price: StripePrice | null): number {
  if (!price) return 0

  // For tiered pricing, use the first tier's unit amount
  if (price.billing_scheme === 'tiered' && price.tiers && price.tiers.length > 0) {
    const firstTier = price.tiers[0]
    return (firstTier.unit_amount ?? firstTier.flat_amount ?? 0) / 100
  }

  // For per-unit pricing
  return (price.unit_amount ?? 0) / 100
}

/**
 * Extract the customer ID from a potentially expanded customer object
 */
function extractCustomerId(customer: string | StripeCustomer): string {
  return typeof customer === 'string' ? customer : customer.id
}

// =============================================================================
// CUSTOMER TRANSFORMER
// =============================================================================

/**
 * Transform a Stripe customer to internal format
 *
 * @param customer - Stripe customer object
 * @param mode - Whether this is test or live mode data
 * @returns Transformed customer
 */
export function transformCustomer(
  customer: StripeCustomer,
  mode: StripeKeyMode
): TransformedCustomer {
  return {
    id: crypto.randomUUID(),
    stripeId: customer.id,
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    createdAt: unixToIso(customer.created) || new Date().toISOString(),
    metadata: customer.metadata || {},
    isTest: mode === 'test',
  }
}

// =============================================================================
// SUBSCRIPTION TRANSFORMER
// =============================================================================

/**
 * Transform a Stripe subscription to internal format
 *
 * @param subscription - Stripe subscription object
 * @param mode - Whether this is test or live mode data
 * @returns Transformed subscription
 */
export function transformSubscription(
  subscription: StripeSubscription,
  mode: StripeKeyMode
): TransformedSubscription {
  // Get the first subscription item (most subscriptions have one)
  const firstItem = subscription.items?.data?.[0]
  const price = firstItem?.price

  // Calculate MRR based on price and interval
  let mrrOverride: number | null = null
  if (subscription.metadata?.mrr_override) {
    mrrOverride = parseFloat(subscription.metadata.mrr_override)
  }

  return {
    id: crypto.randomUUID(),
    stripeId: subscription.id,
    customerId: extractCustomerId(subscription.customer),
    status: subscription.status,
    planId: price?.id || subscription.plan?.id || '',
    planName: getProductName(price) || price?.nickname || subscription.plan?.nickname || null,
    pricePerUnit: calculateUnitPrice(price),
    currency: price?.currency || subscription.plan?.currency || 'usd',
    interval: price?.recurring?.interval || subscription.plan?.interval || 'month',
    intervalCount: price?.recurring?.interval_count || subscription.plan?.interval_count || 1,
    quantity: firstItem?.quantity || subscription.quantity || 1,
    currentPeriodStart: unixToIso(subscription.current_period_start) || new Date().toISOString(),
    currentPeriodEnd: unixToIso(subscription.current_period_end) || new Date().toISOString(),
    startDate: unixToIso(subscription.start_date) || new Date().toISOString(),
    endedAt: unixToIso(subscription.ended_at),
    canceledAt: unixToIso(subscription.canceled_at),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    trialStart: unixToIso(subscription.trial_start),
    trialEnd: unixToIso(subscription.trial_end),
    mrrOverride,
    metadata: subscription.metadata || {},
    isTest: mode === 'test',
  }
}

// =============================================================================
// INVOICE TRANSFORMER
// =============================================================================

/**
 * Transform a Stripe invoice to internal format
 *
 * @param invoice - Stripe invoice object
 * @param mode - Whether this is test or live mode data
 * @returns Transformed invoice
 */
export function transformInvoice(
  invoice: StripeInvoice,
  mode: StripeKeyMode
): TransformedInvoice {
  // Determine paid timestamp from finalized_at or created if paid
  const paidAt = invoice.paid
    ? unixToIso(invoice.finalized_at || invoice.created)
    : null

  return {
    id: crypto.randomUUID(),
    stripeId: invoice.id,
    customerId: extractCustomerId(invoice.customer),
    subscriptionId: typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id || null,
    number: invoice.number,
    status: invoice.status,
    amountDue: invoice.amount_due / 100,
    amountPaid: invoice.amount_paid / 100,
    subtotal: invoice.subtotal / 100,
    total: invoice.total / 100,
    tax: invoice.tax ? invoice.tax / 100 : null,
    currency: invoice.currency,
    periodStart: unixToIso(invoice.period_start) || new Date().toISOString(),
    periodEnd: unixToIso(invoice.period_end) || new Date().toISOString(),
    dueDate: unixToIso(invoice.due_date),
    paidAt,
    billingReason: invoice.billing_reason,
    hostedInvoiceUrl: invoice.hosted_invoice_url,
    metadata: invoice.metadata || {},
    isTest: mode === 'test',
  }
}

// =============================================================================
// USAGE RECORD TRANSFORMER
// =============================================================================

/**
 * Transform a Stripe usage record summary to internal format
 *
 * @param summary - Stripe usage record summary
 * @param subscriptionItemId - The subscription item this usage belongs to
 * @param customerId - The customer ID (from the subscription)
 * @param subscriptionId - The subscription ID
 * @param mode - Whether this is test or live mode data
 * @returns Transformed usage record
 */
export function transformUsageRecordSummary(
  summary: StripeUsageRecordSummary,
  subscriptionItemId: string,
  customerId: string,
  subscriptionId: string,
  mode: StripeKeyMode
): TransformedUsageRecord {
  return {
    id: crypto.randomUUID(),
    customerId,
    subscriptionId,
    subscriptionItemId,
    quantity: summary.total_usage,
    timestamp: unixToIso(summary.period.end) || new Date().toISOString(),
    periodStart: unixToIso(summary.period.start) || new Date().toISOString(),
    periodEnd: unixToIso(summary.period.end) || new Date().toISOString(),
    totalUsage: summary.total_usage,
    isTest: mode === 'test',
  }
}

// =============================================================================
// BATCH TRANSFORMERS
// =============================================================================

/**
 * Transform multiple customers
 */
export function transformCustomers(
  customers: StripeCustomer[],
  mode: StripeKeyMode
): TransformedCustomer[] {
  return customers.map(c => transformCustomer(c, mode))
}

/**
 * Transform multiple subscriptions
 */
export function transformSubscriptions(
  subscriptions: StripeSubscription[],
  mode: StripeKeyMode
): TransformedSubscription[] {
  return subscriptions.map(s => transformSubscription(s, mode))
}

/**
 * Transform multiple invoices
 */
export function transformInvoices(
  invoices: StripeInvoice[],
  mode: StripeKeyMode
): TransformedInvoice[] {
  return invoices.map(i => transformInvoice(i, mode))
}

// =============================================================================
// DATA QUALITY UTILITIES
// =============================================================================

/**
 * Check if a customer has required fields
 */
export function isValidCustomer(customer: StripeCustomer): boolean {
  return Boolean(customer.id && !customer.deleted)
}

/**
 * Check if a subscription has required fields
 */
export function isValidSubscription(subscription: StripeSubscription): boolean {
  return Boolean(
    subscription.id &&
    subscription.customer &&
    subscription.status
  )
}

/**
 * Check if an invoice has required fields
 */
export function isValidInvoice(invoice: StripeInvoice): boolean {
  return Boolean(
    invoice.id &&
    invoice.customer &&
    invoice.status !== 'draft' // Skip draft invoices
  )
}

/**
 * Filter to active or recently-active subscriptions
 */
export function isRelevantSubscription(subscription: StripeSubscription): boolean {
  const relevantStatuses = ['active', 'trialing', 'past_due', 'canceled']
  return relevantStatuses.includes(subscription.status)
}

/**
 * Filter to paid or finalized invoices
 */
export function isRelevantInvoice(invoice: StripeInvoice): boolean {
  return invoice.status === 'paid' || invoice.status === 'open'
}
