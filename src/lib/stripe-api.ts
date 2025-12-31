/**
 * Stripe API Service
 *
 * Client-side service for interacting with Stripe via the backend API.
 * Handles fetching customers, subscriptions, invoices, usage records,
 * and metadata through the backend proxy.
 */

import type {
  StripeList,
  StripeApiCustomer,
  StripeApiSubscription,
  StripeApiInvoice,
  StripeProduct,
  StripePrice,
  StripeUsageRecordSummary,
  UnifiedStripeCustomer,
  UnifiedStripeSubscription,
  UnifiedStripeInvoice,
  UnifiedStripeUsage,
  StripeDataExport,
  StripeSyncResult,
} from './stripe-api-types'

const API_BASE = '/api'

// =============================================================================
// API REQUEST HELPERS
// =============================================================================

interface StripeApiOptions {
  endpoint: string
  params?: Record<string, string | number | boolean>
}

/**
 * Make a request to the Stripe API via our backend
 */
async function stripeRequest<T>(options: StripeApiOptions): Promise<T> {
  const { endpoint, params = {} } = options

  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value))
    }
  })

  const query = searchParams.toString()
  const url = `${API_BASE}/stripe${endpoint}${query ? `?${query}` : ''}`

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }))
    throw new Error(error.message || `Stripe API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Fetch all pages of a Stripe list endpoint
 */
async function fetchAllPages<T>(
  endpoint: string,
  params: Record<string, string | number | boolean> = {},
  limit = 100
): Promise<T[]> {
  const results: T[] = []
  let hasMore = true
  let startingAfter: string | undefined

  while (hasMore) {
    const requestParams: Record<string, string | number | boolean> = {
      ...params,
      limit,
    }
    if (startingAfter) {
      requestParams.starting_after = startingAfter
    }

    const response = await stripeRequest<StripeList<T>>({
      endpoint,
      params: requestParams,
    })

    results.push(...response.data)
    hasMore = response.has_more

    if (response.data.length > 0) {
      const lastItem = response.data[response.data.length - 1] as { id: string }
      startingAfter = lastItem.id
    } else {
      hasMore = false
    }
  }

  return results
}

// =============================================================================
// DATA FETCHING
// =============================================================================

/**
 * Fetch all customers with their metadata
 */
export async function fetchCustomers(): Promise<StripeApiCustomer[]> {
  return fetchAllPages<StripeApiCustomer>('/customers', { expand: 'data.discount' })
}

/**
 * Fetch all subscriptions with expanded data
 */
export async function fetchSubscriptions(): Promise<StripeApiSubscription[]> {
  return fetchAllPages<StripeApiSubscription>('/subscriptions', {
    status: 'all',
    expand: 'data.items.data.price.product,data.discount',
  })
}

/**
 * Fetch all invoices with line items
 */
export async function fetchInvoices(limit = 100): Promise<StripeApiInvoice[]> {
  return fetchAllPages<StripeApiInvoice>('/invoices', {
    expand: 'data.lines.data.price.product',
    limit,
  })
}

/**
 * Fetch all products
 */
export async function fetchProducts(): Promise<StripeProduct[]> {
  return fetchAllPages<StripeProduct>('/products', { active: true })
}

/**
 * Fetch all prices
 */
export async function fetchPrices(): Promise<StripePrice[]> {
  return fetchAllPages<StripePrice>('/prices', {
    active: true,
    expand: 'data.product',
  })
}

/**
 * Fetch usage record summaries for a subscription item
 */
export async function fetchUsageSummaries(
  subscriptionItemId: string
): Promise<StripeUsageRecordSummary[]> {
  return fetchAllPages<StripeUsageRecordSummary>(
    `/subscription_items/${subscriptionItemId}/usage_record_summaries`
  )
}

/**
 * Fetch account info (for validation)
 */
export async function fetchAccountInfo(): Promise<{ id: string; business_profile?: { name?: string } }> {
  return stripeRequest({ endpoint: '/account' })
}

// =============================================================================
// DATA TRANSFORMATION
// =============================================================================

/**
 * Calculate segment based on MRR
 */
function calculateSegment(mrr: number): 'SMB' | 'Mid-Market' | 'Enterprise' {
  if (mrr >= 1000) return 'Enterprise'
  if (mrr >= 200) return 'Mid-Market'
  return 'SMB'
}

/**
 * Transform Stripe customer to unified format
 */
function transformCustomer(
  customer: StripeApiCustomer,
  invoices: StripeApiInvoice[],
  subscriptions: StripeApiSubscription[]
): UnifiedStripeCustomer {
  const customerInvoices = invoices.filter(inv => inv.customer === customer.id && inv.status === 'paid')
  const totalSpend = customerInvoices.reduce((sum, inv) => sum + inv.amount_paid, 0) / 100
  const customerSubscriptions = subscriptions.filter(sub => sub.customer === customer.id)
  const activeSubs = customerSubscriptions.filter(sub => sub.status === 'active' || sub.status === 'trialing')
  const mrr = calculateMrrFromSubscriptions(activeSubs)

  return {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    description: customer.description,
    created: new Date(customer.created * 1000),
    metadata: customer.metadata,
    totalSpend,
    subscriptionCount: customerSubscriptions.length,
    segment: calculateSegment(mrr),
    country: customer.address?.country ?? null,
    city: customer.address?.city ?? null,
    taxExempt: customer.tax_exempt !== 'none',
    balance: customer.balance / 100,
    delinquent: customer.delinquent,
  }
}

/**
 * Calculate MRR from subscription items
 */
function calculateMrrFromItems(subscription: StripeApiSubscription): number {
  let totalMonthlyAmount = 0

  for (const item of subscription.items.data) {
    const price = item.price
    const quantity = item.quantity || 1

    // Skip metered billing (usage-based) - they're calculated separately
    if (price.recurring?.usage_type === 'metered') continue

    const unitAmount = (price.unit_amount || 0) / 100

    if (price.recurring) {
      const { interval, interval_count } = price.recurring
      let monthlyAmount = unitAmount * quantity

      // Normalize to monthly
      switch (interval) {
        case 'year':
          monthlyAmount = monthlyAmount / 12
          break
        case 'week':
          monthlyAmount = monthlyAmount * 4.33 // Average weeks per month
          break
        case 'day':
          monthlyAmount = monthlyAmount * 30.44 // Average days per month
          break
      }

      // Account for interval count (e.g., every 3 months)
      if (interval_count > 1 && interval === 'month') {
        monthlyAmount = monthlyAmount / interval_count
      }

      totalMonthlyAmount += monthlyAmount
    }
  }

  return totalMonthlyAmount
}

/**
 * Calculate MRR from multiple subscriptions
 */
function calculateMrrFromSubscriptions(subscriptions: StripeApiSubscription[]): number {
  return subscriptions.reduce((total, sub) => {
    if (sub.status === 'active' || sub.status === 'trialing') {
      return total + calculateMrrFromItems(sub)
    }
    return total
  }, 0)
}

/**
 * Transform Stripe subscription to unified format
 */
function transformSubscription(
  subscription: StripeApiSubscription,
  products: Map<string, StripeProduct>
): UnifiedStripeSubscription {
  const mrr = calculateMrrFromItems(subscription)

  // Get discount info
  let discountPercent: number | null = null
  let discountAmount: number | null = null
  if (subscription.discount) {
    const coupon = subscription.discount.coupon
    if (coupon.percent_off) {
      discountPercent = coupon.percent_off
    }
    if (coupon.amount_off) {
      discountAmount = coupon.amount_off / 100
    }
  }

  // Get primary billing interval
  const primaryItem = subscription.items.data[0]
  const billingInterval = primaryItem?.price.recurring?.interval || 'month'
  const intervalCount = primaryItem?.price.recurring?.interval_count || 1

  return {
    id: subscription.id,
    customerId: subscription.customer,
    status: subscription.status,
    created: new Date(subscription.created * 1000),
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    endedAt: subscription.ended_at ? new Date(subscription.ended_at * 1000) : null,
    trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    metadata: subscription.metadata,
    mrr,
    currency: subscription.currency,
    billingInterval,
    intervalCount,
    items: subscription.items.data.map(item => {
      const price = item.price
      const productId = typeof price.product === 'string' ? price.product : price.product.id
      const product = products.get(productId)

      return {
        id: item.id,
        priceId: price.id,
        productId,
        productName: product?.name || (typeof price.product === 'object' ? price.product.name : productId),
        quantity: item.quantity,
        unitAmount: (price.unit_amount || 0) / 100,
        usageType: price.recurring?.usage_type || 'licensed',
        metadata: item.metadata,
      }
    }),
    discountPercent,
    discountAmount,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancellationReason: subscription.cancellation_details?.reason || null,
  }
}

/**
 * Transform Stripe invoice to unified format
 */
function transformInvoice(invoice: StripeApiInvoice): UnifiedStripeInvoice {
  return {
    id: invoice.id,
    customerId: invoice.customer,
    subscriptionId: invoice.subscription,
    number: invoice.number,
    status: invoice.status || 'unknown',
    created: new Date(invoice.created * 1000),
    dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : null,
    paidAt: invoice.status_transitions.paid_at
      ? new Date(invoice.status_transitions.paid_at * 1000)
      : null,
    metadata: invoice.metadata,
    amountDue: invoice.amount_due / 100,
    amountPaid: invoice.amount_paid / 100,
    amountRemaining: invoice.amount_remaining / 100,
    subtotal: invoice.subtotal / 100,
    tax: invoice.tax !== null ? invoice.tax / 100 : null,
    total: invoice.total / 100,
    currency: invoice.currency,
    billingReason: invoice.billing_reason,
    attemptCount: invoice.attempt_count,
    lineItems: invoice.lines.data.map(line => {
      const price = line.price
      const productId = price
        ? typeof price.product === 'string'
          ? price.product
          : price.product?.id
        : null

      return {
        id: line.id,
        description: line.description,
        amount: line.amount / 100,
        quantity: line.quantity || 1,
        priceId: price?.id || null,
        productId: productId || null,
        periodStart: new Date(line.period.start * 1000),
        periodEnd: new Date(line.period.end * 1000),
        proration: line.proration,
      }
    }),
  }
}

/**
 * Transform usage record summary to unified format
 */
function transformUsage(
  summary: StripeUsageRecordSummary,
  subscriptionItem: { id: string; price: StripePrice },
  subscription: StripeApiSubscription,
  products: Map<string, StripeProduct>
): UnifiedStripeUsage {
  const price = subscriptionItem.price
  const productId = typeof price.product === 'string' ? price.product : price.product.id
  const product = products.get(productId)

  return {
    subscriptionItemId: summary.subscription_item,
    customerId: subscription.customer,
    subscriptionId: subscription.id,
    priceId: price.id,
    productName: product?.name || productId,
    periodStart: summary.period.start ? new Date(summary.period.start * 1000) : new Date(),
    periodEnd: summary.period.end ? new Date(summary.period.end * 1000) : new Date(),
    totalUsage: summary.total_usage,
    metric: product?.unit_label || 'units',
  }
}

// =============================================================================
// FULL SYNC OPERATIONS
// =============================================================================

/**
 * Perform a complete Stripe data sync
 * Fetches all customers, subscriptions, invoices, and usage data
 */
export async function performFullSync(): Promise<StripeSyncResult> {
  const startedAt = new Date()
  const errors: Array<{ type: string; message: string; objectId?: string }> = []

  try {
    // Fetch account info first to validate the API key
    const account = await fetchAccountInfo()

    // Fetch all data in parallel where possible
    const [
      rawCustomers,
      rawSubscriptions,
      rawInvoices,
      rawProducts,
      rawPrices,
    ] = await Promise.all([
      fetchCustomers().catch(err => {
        errors.push({ type: 'customers', message: err.message })
        return [] as StripeApiCustomer[]
      }),
      fetchSubscriptions().catch(err => {
        errors.push({ type: 'subscriptions', message: err.message })
        return [] as StripeApiSubscription[]
      }),
      fetchInvoices().catch(err => {
        errors.push({ type: 'invoices', message: err.message })
        return [] as StripeApiInvoice[]
      }),
      fetchProducts().catch(err => {
        errors.push({ type: 'products', message: err.message })
        return [] as StripeProduct[]
      }),
      fetchPrices().catch(err => {
        errors.push({ type: 'prices', message: err.message })
        return [] as StripePrice[]
      }),
    ])

    // Build product lookup map
    const productMap = new Map<string, StripeProduct>()
    rawProducts.forEach(p => productMap.set(p.id, p))

    // Fetch usage data for metered subscriptions
    const usage: UnifiedStripeUsage[] = []
    for (const subscription of rawSubscriptions) {
      for (const item of subscription.items.data) {
        if (item.price.recurring?.usage_type === 'metered') {
          try {
            const summaries = await fetchUsageSummaries(item.id)
            for (const summary of summaries) {
              usage.push(transformUsage(summary, item, subscription, productMap))
            }
          } catch (err) {
            errors.push({
              type: 'usage',
              message: (err as Error).message,
              objectId: item.id,
            })
          }
        }
      }
    }

    // Transform all data
    const customers = rawCustomers.map(c =>
      transformCustomer(c, rawInvoices, rawSubscriptions)
    )
    const subscriptions = rawSubscriptions.map(s =>
      transformSubscription(s, productMap)
    )
    const invoices = rawInvoices.map(transformInvoice)

    // Calculate summary metrics
    const activeSubscriptions = subscriptions.filter(
      s => s.status === 'active' || s.status === 'trialing'
    )
    const totalMrr = activeSubscriptions.reduce((sum, s) => sum + s.mrr, 0)
    const paidInvoices = invoices.filter(i => i.status === 'paid')
    const totalRevenue = paidInvoices.reduce((sum, i) => sum + i.amountPaid, 0)

    const data: StripeDataExport = {
      exportedAt: new Date(),
      accountId: account.id,
      accountName: account.business_profile?.name || account.id,
      customers,
      subscriptions,
      invoices,
      usage,
      products: rawProducts,
      prices: rawPrices,
      summary: {
        totalCustomers: customers.length,
        activeSubscriptions: activeSubscriptions.length,
        totalMrr,
        totalArr: totalMrr * 12,
        averageRevenuePerCustomer: customers.length > 0 ? totalRevenue / customers.length : 0,
        churnedSubscriptions: subscriptions.filter(s => s.status === 'canceled').length,
        trialingSubscriptions: subscriptions.filter(s => s.status === 'trialing').length,
        totalInvoicesPaid: paidInvoices.length,
        totalRevenue,
      },
    }

    const completedAt = new Date()

    return {
      success: true,
      message: `Successfully synced ${customers.length} customers, ${subscriptions.length} subscriptions, ${invoices.length} invoices`,
      data,
      errors,
      timing: {
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    }
  } catch (error) {
    const completedAt = new Date()
    return {
      success: false,
      message: (error as Error).message,
      data: null,
      errors: [{ type: 'sync', message: (error as Error).message }],
      timing: {
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    }
  }
}

/**
 * Get a summary of available data types in Stripe
 */
export async function getDataSummary(): Promise<{
  customers: number
  subscriptions: number
  invoices: number
  products: number
  hasMeteredBilling: boolean
}> {
  const [customers, subscriptions, invoices, products] = await Promise.all([
    stripeRequest<StripeList<{ id: string }>>({
      endpoint: '/customers',
      params: { limit: 1 },
    }),
    stripeRequest<StripeList<{ id: string }>>({
      endpoint: '/subscriptions',
      params: { limit: 1 },
    }),
    stripeRequest<StripeList<{ id: string }>>({
      endpoint: '/invoices',
      params: { limit: 1 },
    }),
    stripeRequest<StripeList<{ id: string }>>({
      endpoint: '/products',
      params: { limit: 1, active: true },
    }),
  ])

  // Check for metered billing in a sample of prices
  const prices = await stripeRequest<StripeList<StripePrice>>({
    endpoint: '/prices',
    params: { limit: 100, active: true },
  })
  const hasMeteredBilling = prices.data.some(
    p => p.recurring?.usage_type === 'metered'
  )

  return {
    // These counts are estimates since Stripe doesn't give total counts
    customers: customers.has_more ? 100 : customers.data.length,
    subscriptions: subscriptions.has_more ? 100 : subscriptions.data.length,
    invoices: invoices.has_more ? 100 : invoices.data.length,
    products: products.has_more ? 100 : products.data.length,
    hasMeteredBilling,
  }
}
