/**
 * Stripe API Integration
 *
 * Provides a complete Stripe API integration for fetching customer,
 * subscription, and invoice data with usage information.
 *
 * @module lib/stripe-api
 *
 * @example
 * ```ts
 * import { createStripeClient, transformCustomer } from '@/lib/stripe-api'
 *
 * const client = createStripeClient('sk_test_...')
 * const validation = await client.validateKey()
 *
 * if (validation.isValid) {
 *   for await (const customer of client.listCustomers()) {
 *     const transformed = transformCustomer(customer, validation.mode!)
 *     console.log(transformed)
 *   }
 * }
 * ```
 */

// Types
export type {
  // API Key & Authentication
  StripeKeyMode,
  StripeKeyValidation,
  StripeConnection,

  // Core Stripe types
  StripeObject,
  StripePagination,
  StripeList,
  StripeAddress,
  StripeCustomer,
  StripeTaxId,
  StripeDiscount,
  StripeCoupon,
  StripeSubscriptionStatus,
  StripePrice,
  StripePriceTier,
  StripeProduct,
  StripeSubscriptionItem,
  StripeTaxRate,
  StripeSubscription,
  StripePlan,
  StripeInvoiceStatus,
  StripeInvoiceLineItem,
  StripeInvoice,
  StripeUsageRecord,
  StripeUsageRecordSummary,

  // Sync types
  StripeSyncDataType,
  StripeSyncStatus,
  StripeSyncProgress,
  StripeSyncJob,

  // Data quality
  DataQualitySeverity,
  DataQualityIssue,
  DataQualityReport,

  // Errors
  StripeErrorType,
  StripeApiError,

  // Transformed types
  TransformedCustomer,
  TransformedSubscription,
  TransformedInvoice,
  TransformedUsageRecord,
} from './types'

// Client
export {
  StripeApiClient,
  StripeError,
  createStripeClient,
  detectKeyMode,
  unixToIso,
} from './client'

// Transformers
export {
  transformCustomer,
  transformSubscription,
  transformInvoice,
  transformUsageRecordSummary,
  transformCustomers,
  transformSubscriptions,
  transformInvoices,
  isValidCustomer,
  isValidSubscription,
  isValidInvoice,
  isRelevantSubscription,
  isRelevantInvoice,
} from './transformer'
