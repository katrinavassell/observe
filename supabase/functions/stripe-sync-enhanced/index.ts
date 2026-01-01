// Stripe Sync Enhanced Edge Function
// Fetches all Stripe data with metadata, usage, and full details

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getAuthenticatedUser } from '../_shared/auth.ts'
import { getStripeApiKey, fetchAllStripePages, stripeRequest } from '../_shared/stripe-client.ts'

// Stripe API Types
interface StripeCustomer {
  id: string
  email: string | null
  name: string | null
  description: string | null
  created: number
  metadata: Record<string, string>
  address?: {
    country?: string
    city?: string
  }
  tax_exempt: string
  balance: number
  delinquent: boolean
}

interface StripeSubscriptionItem {
  id: string
  price: {
    id: string
    product: string | { id: string; name: string; metadata: Record<string, string> }
    unit_amount: number | null
    recurring?: {
      interval: 'day' | 'week' | 'month' | 'year'
      interval_count: number
      usage_type: 'metered' | 'licensed'
    }
    metadata: Record<string, string>
  }
  quantity: number
  metadata: Record<string, string>
}

interface StripeSubscription {
  id: string
  customer: string
  status: string
  created: number
  current_period_start: number
  current_period_end: number
  canceled_at: number | null
  ended_at: number | null
  trial_end: number | null
  metadata: Record<string, string>
  currency: string
  items: {
    data: StripeSubscriptionItem[]
  }
  discount?: {
    coupon: {
      percent_off: number | null
      amount_off: number | null
    }
  }
}

interface StripeInvoiceLineItem {
  id: string
  description: string | null
  amount: number
  quantity: number
  price?: {
    id: string
    product: string
  }
}

interface StripeInvoice {
  id: string
  customer: string
  subscription: string | null
  status: string
  amount_paid: number
  amount_due: number
  currency: string
  created: number
  period_start: number
  period_end: number
  lines: {
    data: StripeInvoiceLineItem[]
  }
  tax: number
  metadata: Record<string, string>
}

interface StripeProduct {
  id: string
  name: string
  description: string | null
  active: boolean
  metadata: Record<string, string>
  unit_label: string | null
  type: 'good' | 'service'
}

interface StripePrice {
  id: string
  product: string
  active: boolean
  currency: string
  unit_amount: number | null
  billing_scheme: 'per_unit' | 'tiered'
  recurring?: {
    interval: 'day' | 'week' | 'month' | 'year'
    interval_count: number
    usage_type: 'metered' | 'licensed'
  }
  nickname: string | null
  metadata: Record<string, string>
}

interface StripeUsageSummary {
  id: string
  subscription_item: string
  total_usage: number
  period: {
    start: number
    end: number
  }
}

// Helper functions
function timestampToISO(ts: number | null): string | null {
  return ts ? new Date(ts * 1000).toISOString() : null
}

function calculateMrr(subscription: StripeSubscription): number {
  let total = 0
  for (const item of subscription.items.data) {
    const price = item.price
    const quantity = item.quantity || 1
    const unitAmount = (price.unit_amount || 0) / 100 // Convert from cents

    if (!price.recurring) continue

    const { interval, interval_count } = price.recurring

    // Normalize to monthly
    let monthlyAmount = unitAmount * quantity
    switch (interval) {
      case 'day':
        monthlyAmount = (monthlyAmount / interval_count) * 30
        break
      case 'week':
        monthlyAmount = (monthlyAmount / interval_count) * 4.33
        break
      case 'month':
        monthlyAmount = monthlyAmount / interval_count
        break
      case 'year':
        monthlyAmount = monthlyAmount / (interval_count * 12)
        break
    }

    total += monthlyAmount
  }

  // Apply discount if present
  if (subscription.discount?.coupon) {
    const { percent_off, amount_off } = subscription.discount.coupon
    if (percent_off) {
      total = total * (1 - percent_off / 100)
    } else if (amount_off) {
      total = Math.max(0, total - amount_off / 100)
    }
  }

  return Math.round(total * 100) / 100
}

function calculateSegment(mrr: number): 'SMB' | 'Mid-Market' | 'Enterprise' {
  if (mrr >= 1000) return 'Enterprise'
  if (mrr >= 200) return 'Mid-Market'
  return 'SMB'
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  const startedAt = new Date().toISOString()
  const errors: Array<{ type: string; message: string; object_id?: string }> = []

  try {
    const { user, supabase } = await getAuthenticatedUser(req)
    const apiKey = await getStripeApiKey(supabase, user.id)

    // Get account info
    const account = await stripeRequest<{ id: string; business_profile?: { name?: string } }>(apiKey, 'account')
    const accountName = account.business_profile?.name || account.id

    // Fetch all data in parallel
    const [
      rawCustomers,
      rawSubscriptions,
      rawInvoices,
      rawProducts,
      rawPrices,
    ] = await Promise.all([
      fetchAllStripePages<StripeCustomer>(apiKey, 'customers'),
      fetchAllStripePages<StripeSubscription>(apiKey, 'subscriptions', {
        status: 'all',
        'expand[]': 'data.items.data.price.product',
      }),
      fetchAllStripePages<StripeInvoice>(apiKey, 'invoices', {
        'expand[]': 'data.lines',
      }),
      fetchAllStripePages<StripeProduct>(apiKey, 'products', { active: 'true' }),
      fetchAllStripePages<StripePrice>(apiKey, 'prices', { active: 'true' }),
    ])

    // Calculate customer spend
    const customerSpend = new Map<string, number>()
    const customerSubscriptionCount = new Map<string, number>()

    for (const invoice of rawInvoices) {
      if (invoice.status === 'paid') {
        const current = customerSpend.get(invoice.customer) || 0
        customerSpend.set(invoice.customer, current + invoice.amount_paid / 100)
      }
    }

    for (const sub of rawSubscriptions) {
      if (sub.status === 'active' || sub.status === 'trialing') {
        const current = customerSubscriptionCount.get(sub.customer) || 0
        customerSubscriptionCount.set(sub.customer, current + 1)
      }
    }

    // Transform customers
    const customers = rawCustomers.map(c => {
      const totalSpend = customerSpend.get(c.id) || 0
      return {
        id: c.id,
        email: c.email,
        name: c.name,
        description: c.description,
        created: timestampToISO(c.created)!,
        metadata: c.metadata || {},
        total_spend: totalSpend,
        subscription_count: customerSubscriptionCount.get(c.id) || 0,
        segment: calculateSegment(totalSpend / 12), // Rough MRR estimate
        country: c.address?.country || null,
        city: c.address?.city || null,
        tax_exempt: c.tax_exempt !== 'none',
        balance: (c.balance || 0) / 100,
        delinquent: c.delinquent || false,
      }
    })

    // Transform subscriptions
    const subscriptions = rawSubscriptions.map(s => {
      const mrr = calculateMrr(s)
      const interval = s.items.data[0]?.price?.recurring?.interval || 'month'
      const intervalCount = s.items.data[0]?.price?.recurring?.interval_count || 1

      return {
        id: s.id,
        customer_id: s.customer,
        status: s.status,
        created: timestampToISO(s.created)!,
        current_period_start: timestampToISO(s.current_period_start)!,
        current_period_end: timestampToISO(s.current_period_end)!,
        canceled_at: timestampToISO(s.canceled_at),
        ended_at: timestampToISO(s.ended_at),
        trial_end: timestampToISO(s.trial_end),
        metadata: s.metadata || {},
        mrr,
        currency: s.currency,
        billing_interval: interval,
        interval_count: intervalCount,
        items: s.items.data.map(item => {
          const product = typeof item.price.product === 'string'
            ? { id: item.price.product, name: item.price.product, metadata: {} }
            : item.price.product

          return {
            id: item.id,
            price_id: item.price.id,
            product_id: product.id,
            product_name: product.name || product.id,
            quantity: item.quantity || 1,
            unit_amount: (item.price.unit_amount || 0) / 100,
            usage_type: item.price.recurring?.usage_type || 'licensed',
            metadata: item.metadata || {},
          }
        }),
        discount_percent: s.discount?.coupon?.percent_off || null,
      }
    })

    // Transform invoices
    const invoices = rawInvoices.map(i => ({
      id: i.id,
      customer_id: i.customer,
      subscription_id: i.subscription,
      status: i.status,
      amount_paid: i.amount_paid / 100,
      amount_due: i.amount_due / 100,
      currency: i.currency,
      created: timestampToISO(i.created)!,
      period_start: timestampToISO(i.period_start)!,
      period_end: timestampToISO(i.period_end)!,
      line_items: i.lines?.data?.map(line => ({
        id: line.id,
        description: line.description,
        amount: line.amount / 100,
        quantity: line.quantity || 1,
        price_id: line.price?.id || null,
        product_id: line.price?.product || null,
      })) || [],
      tax: (i.tax || 0) / 100,
      metadata: i.metadata || {},
    }))

    // Fetch usage records for metered subscriptions
    const usage: Array<{
      id: string
      subscription_item_id: string
      customer_id: string
      period_start: string
      period_end: string
      total_usage: number
      metric: string
    }> = []

    const meteredItems = subscriptions.flatMap(sub =>
      sub.items
        .filter(item => item.usage_type === 'metered')
        .map(item => ({ item, customerId: sub.customer_id }))
    )

    for (const { item, customerId } of meteredItems) {
      try {
        const summaries = await stripeRequest<{ data: StripeUsageSummary[] }>(
          apiKey,
          `subscription_items/${item.id}/usage_record_summaries?limit=12`
        )

        for (const summary of summaries.data) {
          usage.push({
            id: summary.id,
            subscription_item_id: item.id,
            customer_id: customerId,
            period_start: timestampToISO(summary.period.start)!,
            period_end: timestampToISO(summary.period.end)!,
            total_usage: summary.total_usage,
            metric: item.product_name,
          })
        }
      } catch (error) {
        errors.push({
          type: 'usage_fetch_error',
          message: error.message,
          object_id: item.id,
        })
      }
    }

    // Transform products
    const products = rawProducts.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      active: p.active,
      metadata: p.metadata || {},
      unit_label: p.unit_label,
      type: p.type,
    }))

    // Transform prices
    const prices = rawPrices.map(p => ({
      id: p.id,
      product_id: p.product,
      active: p.active,
      currency: p.currency,
      unit_amount: p.unit_amount ? p.unit_amount / 100 : null,
      billing_scheme: p.billing_scheme,
      recurring_interval: p.recurring?.interval || null,
      recurring_interval_count: p.recurring?.interval_count || null,
      usage_type: p.recurring?.usage_type || null,
      nickname: p.nickname,
      metadata: p.metadata || {},
    }))

    // Calculate summary
    const activeSubscriptions = subscriptions.filter(s => s.status === 'active')
    const totalMrr = activeSubscriptions.reduce((sum, s) => sum + s.mrr, 0)
    const paidInvoices = invoices.filter(i => i.status === 'paid')

    const summary = {
      total_customers: customers.length,
      active_subscriptions: activeSubscriptions.length,
      total_mrr: Math.round(totalMrr * 100) / 100,
      total_arr: Math.round(totalMrr * 12 * 100) / 100,
      average_revenue_per_customer: customers.length > 0
        ? Math.round((totalMrr / customers.length) * 100) / 100
        : 0,
      churned_subscriptions: subscriptions.filter(s => s.status === 'canceled').length,
      trialing_subscriptions: subscriptions.filter(s => s.status === 'trialing').length,
      total_invoices_paid: paidInvoices.length,
      total_revenue: Math.round(paidInvoices.reduce((sum, i) => sum + i.amount_paid, 0) * 100) / 100,
    }

    // Update last_sync_at
    await supabase
      .from('stripe_integrations')
      .update({ last_sync_at: new Date().toISOString(), sync_status: 'completed' })
      .eq('user_id', user.id)

    const completedAt = new Date().toISOString()

    return jsonResponse({
      success: true,
      message: `Synced ${customers.length} customers, ${subscriptions.length} subscriptions, ${invoices.length} invoices`,
      exported_at: completedAt,
      account_id: account.id,
      account_name: accountName,
      customers,
      subscriptions,
      invoices,
      usage,
      products,
      prices,
      summary,
      errors,
      timing: {
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      },
    })
  } catch (error) {
    console.error('Error in stripe-sync-enhanced:', error)
    return errorResponse(error.message || 'Internal server error', 500)
  }
})
