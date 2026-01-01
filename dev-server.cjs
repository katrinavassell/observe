/**
 * Local Development Server for Stripe API Integration
 *
 * This server handles Stripe API calls during local development.
 * For production, use the Supabase Edge Functions.
 *
 * Usage: node dev-server.js
 * Then run: npm run dev (in another terminal)
 */

const express = require('express')
const cors = require('cors')
const Stripe = require('stripe')

const app = express()
const PORT = 8000

// Store API keys in memory (per-session, not persistent)
const apiKeys = new Map()

app.use(cors())
app.use(express.json())

// Helper to get Stripe client for a user
function getStripeClient(userId) {
  const apiKey = apiKeys.get(userId)
  if (!apiKey) {
    throw new Error('No Stripe API key found. Please connect your Stripe account first.')
  }
  return new Stripe(apiKey)
}

// For dev, we'll use a simple token from the Authorization header
function getUserId(req) {
  // In dev, just use a fixed user ID or extract from token
  const auth = req.headers.authorization
  if (auth && auth.startsWith('Bearer ')) {
    // Just hash the token to get a consistent user ID
    return 'dev-user-' + auth.slice(7, 20)
  }
  return 'dev-user-default'
}

// Connect Stripe with API key
app.post('/integrations/stripe/connect', async (req, res) => {
  try {
    const { api_key } = req.body
    const userId = getUserId(req)

    if (!api_key) {
      return res.status(400).json({ error: 'Missing api_key in request body' })
    }

    if (!api_key.startsWith('sk_') && !api_key.startsWith('rk_')) {
      return res.status(400).json({ error: 'Invalid API key format' })
    }

    // Validate by calling Stripe account endpoint
    const stripe = new Stripe(api_key)
    const account = await stripe.accounts.retrieve()

    // Store the API key
    apiKeys.set(userId, api_key)

    const accountName = account.business_profile?.name ||
                       account.settings?.dashboard?.display_name ||
                       account.email ||
                       account.id

    res.json({
      success: true,
      message: 'Stripe connected successfully',
      account_name: accountName,
      account_id: account.id,
    })
  } catch (error) {
    console.error('Connect error:', error.message)
    res.status(400).json({ error: error.message })
  }
})

// Basic sync endpoint
app.post('/integrations/stripe/sync', async (req, res) => {
  res.redirect(307, '/integrations/stripe/sync-enhanced')
})

// Enhanced sync with all data
app.post('/integrations/stripe/sync-enhanced', async (req, res) => {
  const startedAt = new Date().toISOString()
  const errors = []

  try {
    const userId = getUserId(req)
    const stripe = getStripeClient(userId)
    const account = await stripe.accounts.retrieve()

    console.log('Starting enhanced sync...')

    // Fetch all data
    const [customers, subscriptions, invoices, products, prices] = await Promise.all([
      stripe.customers.list({ limit: 100 }).autoPagingToArray({ limit: 10000 }),
      stripe.subscriptions.list({
        limit: 100,
        status: 'all',
        expand: ['data.items.data.price.product']
      }).autoPagingToArray({ limit: 10000 }),
      stripe.invoices.list({
        limit: 100,
        expand: ['data.lines']
      }).autoPagingToArray({ limit: 10000 }),
      stripe.products.list({ limit: 100, active: true }).autoPagingToArray({ limit: 10000 }),
      stripe.prices.list({ limit: 100, active: true }).autoPagingToArray({ limit: 10000 }),
    ])

    console.log(`Fetched: ${customers.length} customers, ${subscriptions.length} subs, ${invoices.length} invoices`)

    // Calculate customer metrics
    const customerSpend = new Map()
    const customerSubCount = new Map()

    for (const inv of invoices) {
      if (inv.status === 'paid') {
        const current = customerSpend.get(inv.customer) || 0
        customerSpend.set(inv.customer, current + inv.amount_paid / 100)
      }
    }

    for (const sub of subscriptions) {
      if (sub.status === 'active' || sub.status === 'trialing') {
        const current = customerSubCount.get(sub.customer) || 0
        customerSubCount.set(sub.customer, current + 1)
      }
    }

    // Transform customers
    const transformedCustomers = customers.map(c => {
      const totalSpend = customerSpend.get(c.id) || 0
      const segment = totalSpend >= 12000 ? 'Enterprise' : totalSpend >= 2400 ? 'Mid-Market' : 'SMB'
      return {
        id: c.id,
        email: c.email,
        name: c.name,
        description: c.description,
        created: new Date(c.created * 1000).toISOString(),
        metadata: c.metadata || {},
        total_spend: totalSpend,
        subscription_count: customerSubCount.get(c.id) || 0,
        segment,
        country: c.address?.country || null,
        city: c.address?.city || null,
        tax_exempt: c.tax_exempt !== 'none',
        balance: (c.balance || 0) / 100,
        delinquent: c.delinquent || false,
      }
    })

    // Transform subscriptions
    const transformedSubscriptions = subscriptions.map(s => {
      const mrr = calculateMrr(s)
      const interval = s.items.data[0]?.price?.recurring?.interval || 'month'
      const intervalCount = s.items.data[0]?.price?.recurring?.interval_count || 1

      return {
        id: s.id,
        customer_id: s.customer,
        status: s.status,
        created: new Date(s.created * 1000).toISOString(),
        current_period_start: new Date(s.current_period_start * 1000).toISOString(),
        current_period_end: new Date(s.current_period_end * 1000).toISOString(),
        canceled_at: s.canceled_at ? new Date(s.canceled_at * 1000).toISOString() : null,
        ended_at: s.ended_at ? new Date(s.ended_at * 1000).toISOString() : null,
        trial_end: s.trial_end ? new Date(s.trial_end * 1000).toISOString() : null,
        metadata: s.metadata || {},
        mrr,
        currency: s.currency,
        billing_interval: interval,
        interval_count: intervalCount,
        items: s.items.data.map(item => ({
          id: item.id,
          price_id: item.price.id,
          product_id: typeof item.price.product === 'string' ? item.price.product : item.price.product.id,
          product_name: typeof item.price.product === 'string' ? item.price.product : item.price.product.name,
          quantity: item.quantity || 1,
          unit_amount: (item.price.unit_amount || 0) / 100,
          usage_type: item.price.recurring?.usage_type || 'licensed',
          metadata: item.metadata || {},
        })),
        discount_percent: s.discount?.coupon?.percent_off || null,
      }
    })

    // Transform invoices
    const transformedInvoices = invoices.map(i => ({
      id: i.id,
      customer_id: i.customer,
      subscription_id: i.subscription,
      status: i.status,
      amount_paid: i.amount_paid / 100,
      amount_due: i.amount_due / 100,
      currency: i.currency,
      created: new Date(i.created * 1000).toISOString(),
      period_start: new Date(i.period_start * 1000).toISOString(),
      period_end: new Date(i.period_end * 1000).toISOString(),
      line_items: (i.lines?.data || []).map(line => ({
        id: line.id,
        description: line.description,
        amount: line.amount / 100,
        quantity: line.quantity || 1,
        price_id: line.price?.id || null,
        product_id: line.price?.product || null,
      })),
      tax: (i.tax || 0) / 100,
      metadata: i.metadata || {},
    }))

    // Fetch usage for metered subscriptions
    const usage = []
    const meteredItems = transformedSubscriptions.flatMap(sub =>
      sub.items
        .filter(item => item.usage_type === 'metered')
        .map(item => ({ item, customerId: sub.customer_id }))
    )

    for (const { item, customerId } of meteredItems.slice(0, 10)) { // Limit to 10 for dev
      try {
        const summaries = await stripe.subscriptionItems.listUsageRecordSummaries(item.id, { limit: 12 })
        for (const summary of summaries.data) {
          usage.push({
            id: summary.id,
            subscription_item_id: item.id,
            customer_id: customerId,
            period_start: new Date(summary.period.start * 1000).toISOString(),
            period_end: new Date(summary.period.end * 1000).toISOString(),
            total_usage: summary.total_usage,
            metric: item.product_name,
          })
        }
      } catch (err) {
        errors.push({ type: 'usage_fetch_error', message: err.message, object_id: item.id })
      }
    }

    // Transform products
    const transformedProducts = products.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      active: p.active,
      metadata: p.metadata || {},
      unit_label: p.unit_label,
      type: p.type,
    }))

    // Transform prices
    const transformedPrices = prices.map(p => ({
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
    const activeSubscriptions = transformedSubscriptions.filter(s => s.status === 'active')
    const totalMrr = activeSubscriptions.reduce((sum, s) => sum + s.mrr, 0)
    const paidInvoices = transformedInvoices.filter(i => i.status === 'paid')

    const summary = {
      total_customers: transformedCustomers.length,
      active_subscriptions: activeSubscriptions.length,
      total_mrr: Math.round(totalMrr * 100) / 100,
      total_arr: Math.round(totalMrr * 12 * 100) / 100,
      average_revenue_per_customer: transformedCustomers.length > 0
        ? Math.round((totalMrr / transformedCustomers.length) * 100) / 100
        : 0,
      churned_subscriptions: transformedSubscriptions.filter(s => s.status === 'canceled').length,
      trialing_subscriptions: transformedSubscriptions.filter(s => s.status === 'trialing').length,
      total_invoices_paid: paidInvoices.length,
      total_revenue: Math.round(paidInvoices.reduce((sum, i) => sum + i.amount_paid, 0) * 100) / 100,
    }

    const completedAt = new Date().toISOString()

    res.json({
      success: true,
      message: `Synced ${transformedCustomers.length} customers, ${transformedSubscriptions.length} subscriptions, ${transformedInvoices.length} invoices`,
      exported_at: completedAt,
      account_id: account.id,
      account_name: account.business_profile?.name || account.id,
      customers: transformedCustomers,
      subscriptions: transformedSubscriptions,
      invoices: transformedInvoices,
      usage,
      products: transformedProducts,
      prices: transformedPrices,
      summary,
      errors,
      timing: {
        started_at: startedAt,
        completed_at: completedAt,
        duration_ms: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      },
    })
  } catch (error) {
    console.error('Sync error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// Helper function
function calculateMrr(subscription) {
  let total = 0
  for (const item of subscription.items.data) {
    const price = item.price
    const quantity = item.quantity || 1
    const unitAmount = (price.unit_amount || 0) / 100

    if (!price.recurring) continue

    const { interval, interval_count } = price.recurring
    let monthlyAmount = unitAmount * quantity

    switch (interval) {
      case 'day': monthlyAmount = (monthlyAmount / interval_count) * 30; break
      case 'week': monthlyAmount = (monthlyAmount / interval_count) * 4.33; break
      case 'month': monthlyAmount = monthlyAmount / interval_count; break
      case 'year': monthlyAmount = monthlyAmount / (interval_count * 12); break
    }

    total += monthlyAmount
  }

  if (subscription.discount?.coupon) {
    const { percent_off, amount_off } = subscription.discount.coupon
    if (percent_off) total = total * (1 - percent_off / 100)
    else if (amount_off) total = Math.max(0, total - amount_off / 100)
  }

  return Math.round(total * 100) / 100
}

app.listen(PORT, () => {
  console.log(`\n🚀 Stripe Dev Server running at http://localhost:${PORT}`)
  console.log(`\nEndpoints:`)
  console.log(`  POST /integrations/stripe/connect`)
  console.log(`  POST /integrations/stripe/sync-enhanced`)
  console.log(`\nNow run 'npm run dev' in another terminal.\n`)
})
