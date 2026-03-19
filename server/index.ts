import express, { Request, Response, NextFunction } from 'express'
import session from 'express-session'
import pgSession from 'connect-pg-simple'
import { Pool } from 'pg'
import crypto from 'crypto'
import { getUncachableStripeClient } from './stripe-client'

const app = express()
const PORT = 3001

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

const PgStore = pgSession(session)

app.use(express.json())

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required')
}

app.set('trust proxy', 1)

app.use(session({
  store: new PgStore({
    pool,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days for anonymous users
  },
}))

declare module 'express-session' {
  interface SessionData {
    visitorId: string
  }
}

interface AuthRequest extends Request {
  visitorId?: string
}

async function ensureVisitor(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.session.visitorId) {
      const visitorId = crypto.randomUUID()
      req.session.visitorId = visitorId
      
      await pool.query(
        'INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [visitorId, 'none']
      )
    }
    req.visitorId = req.session.visitorId
    next()
  } catch (error) {
    console.error('Visitor session error:', error)
    res.status(500).json({ error: 'Session error' })
  }
}

app.get('/session/init', ensureVisitor, async (req: AuthRequest, res: Response) => {
  res.json({ visitorId: req.visitorId })
})

app.get('/data/status', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const statusResult = await pool.query('SELECT * FROM user_data_status WHERE user_id = $1', [req.visitorId])
    const customersResult = await pool.query('SELECT COUNT(*) FROM customers WHERE user_id = $1', [req.visitorId])
    const costsResult = await pool.query('SELECT COUNT(*) FROM cost_records WHERE user_id = $1', [req.visitorId])
    const usageResult = await pool.query('SELECT COUNT(*) FROM usage_records WHERE user_id = $1', [req.visitorId])

    const status = statusResult.rows[0] || { data_mode: 'none' }
    const customerCount = parseInt(customersResult.rows[0].count)
    const costsCount = parseInt(costsResult.rows[0].count)
    const usageCount = parseInt(usageResult.rows[0].count)

    res.json({
      data_mode: status.data_mode,
      has_data: customerCount > 0,
      customer_count: customerCount,
      has_revenue: customerCount > 0,
      has_costs: costsCount > 0,
      has_usage: usageCount > 0,
      revenue_customer_count: customerCount,
      costs_record_count: costsCount,
      usage_record_count: usageCount,
      last_sync_at: status.updated_at,
    })
  } catch (error) {
    console.error('Get data status error:', error)
    res.status(500).json({ error: 'Failed to get data status' })
  }
})

app.get('/customers', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM customers WHERE user_id = $1 ORDER BY created_at DESC',
      [req.visitorId]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get customers error:', error)
    res.status(500).json({ error: 'Failed to get customers' })
  }
})

app.get('/subscriptions', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT s.*, c.name as customer_name, c.email as customer_email, p.name as plan_name, p.price_amount FROM subscriptions s LEFT JOIN customers c ON s.user_id = c.user_id AND s.customer_id = c.customer_id LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id WHERE s.user_id = $1 ORDER BY s.created_at DESC',
      [req.visitorId]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get subscriptions error:', error)
    res.status(500).json({ error: 'Failed to get subscriptions' })
  }
})

app.get('/plans', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM plans WHERE user_id = $1 ORDER BY price_amount ASC',
      [req.visitorId]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get plans error:', error)
    res.status(500).json({ error: 'Failed to get plans' })
  }
})

app.get('/usage', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM usage_records WHERE user_id = $1 ORDER BY period_start DESC',
      [req.visitorId]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get usage error:', error)
    res.status(500).json({ error: 'Failed to get usage' })
  }
})

app.get('/costs', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM cost_records WHERE user_id = $1 ORDER BY period_start DESC',
      [req.visitorId]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get costs error:', error)
    res.status(500).json({ error: 'Failed to get costs' })
  }
})

app.get('/data/analyzer', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const [plans, customers, subscriptions, usage, costs] = await Promise.all([
      pool.query('SELECT * FROM plans WHERE user_id = $1', [req.visitorId]),
      pool.query('SELECT * FROM customers WHERE user_id = $1', [req.visitorId]),
      pool.query('SELECT * FROM subscriptions WHERE user_id = $1', [req.visitorId]),
      pool.query('SELECT * FROM usage_records WHERE user_id = $1', [req.visitorId]),
      pool.query('SELECT * FROM cost_records WHERE user_id = $1', [req.visitorId]),
    ])

    if (customers.rows.length === 0) {
      res.json(null)
      return
    }

    res.json({
      plans: plans.rows.map(p => ({
        plan_id: p.plan_id,
        name: p.name,
        price_amount: Number(p.price_amount),
        interval_months: p.interval_months || 1,
        billing_model: p.billing_model || 'recurring',
      })),
      customers: customers.rows.map(c => ({
        customer_id: c.customer_id,
        name: c.name,
        email: c.email || undefined,
        segment: c.segment || undefined,
        created_at: c.created_at,
      })),
      subscriptions: subscriptions.rows.map(s => ({
        subscription_id: s.subscription_id,
        customer_id: s.customer_id,
        plan_id: s.plan_id,
        is_active: s.is_active,
        mrr_override: s.mrr_override ? Number(s.mrr_override) : undefined,
        previous_mrr: s.previous_mrr ? Number(s.previous_mrr) : undefined,
        current_period_start: s.current_period_start,
        current_period_end: s.current_period_end,
        cancelled_at: s.cancelled_at,
      })),
      usage: usage.rows.map(u => ({
        customer_id: u.customer_id,
        metric_key: u.metric_key,
        metric_value: Number(u.metric_value),
        metric_limit: u.metric_limit ? Number(u.metric_limit) : undefined,
        period_start: u.period_start,
        period_end: u.period_end,
      })),
      costs: costs.rows.map(c => ({
        customer_id: c.customer_id || undefined,
        cost_type: c.cost_type,
        amount: Number(c.amount),
        period_start: c.period_start,
        period_end: c.period_end,
      })),
    })
  } catch (error) {
    console.error('Get analyzer data error:', error)
    res.status(500).json({ error: 'Failed to get analyzer data' })
  }
})

app.post('/data/sample', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query('DELETE FROM usage_records WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM cost_records WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM customers WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM plans WHERE user_id = $1', [req.visitorId])

    const plans = [
      { plan_id: 'starter', name: 'Starter', price_amount: 29, interval_months: 1 },
      { plan_id: 'pro', name: 'Professional', price_amount: 99, interval_months: 1 },
      { plan_id: 'enterprise', name: 'Enterprise', price_amount: 299, interval_months: 1 },
    ]
    for (const plan of plans) {
      await client.query(
        'INSERT INTO plans (user_id, plan_id, name, price_amount, interval_months) VALUES ($1, $2, $3, $4, $5)',
        [req.visitorId, plan.plan_id, plan.name, plan.price_amount, plan.interval_months]
      )
    }

    const customers = [
      { customer_id: 'cus_001', name: 'Acme Corp', email: 'billing@acme.com', segment: 'Enterprise' },
      { customer_id: 'cus_002', name: 'TechStart Inc', email: 'admin@techstart.io', segment: 'SMB' },
      { customer_id: 'cus_003', name: 'Global Solutions', email: 'accounts@global.com', segment: 'Mid-Market' },
      { customer_id: 'cus_004', name: 'Startup Labs', email: 'hello@startuplabs.co', segment: 'SMB' },
      { customer_id: 'cus_005', name: 'Enterprise Co', email: 'procurement@enterprise.com', segment: 'Enterprise' },
    ]
    for (const customer of customers) {
      await client.query(
        'INSERT INTO customers (user_id, customer_id, name, email, segment) VALUES ($1, $2, $3, $4, $5)',
        [req.visitorId, customer.customer_id, customer.name, customer.email, customer.segment]
      )
    }

    const subscriptions = [
      { subscription_id: 'sub_001', customer_id: 'cus_001', plan_id: 'enterprise', is_active: true, mrr_override: 299 },
      { subscription_id: 'sub_002', customer_id: 'cus_002', plan_id: 'starter', is_active: true, mrr_override: 29 },
      { subscription_id: 'sub_003', customer_id: 'cus_003', plan_id: 'pro', is_active: true, mrr_override: 99 },
      { subscription_id: 'sub_004', customer_id: 'cus_004', plan_id: 'starter', is_active: true, mrr_override: 29 },
      { subscription_id: 'sub_005', customer_id: 'cus_005', plan_id: 'enterprise', is_active: true, mrr_override: 299 },
    ]
    for (const sub of subscriptions) {
      await client.query(
        'INSERT INTO subscriptions (user_id, subscription_id, customer_id, plan_id, is_active, mrr_override) VALUES ($1, $2, $3, $4, $5, $6)',
        [req.visitorId, sub.subscription_id, sub.customer_id, sub.plan_id, sub.is_active, sub.mrr_override]
      )
    }

    await client.query(
      'INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()',
      [req.visitorId, 'sample']
    )

    await client.query('COMMIT')
    res.json({ success: true, message: 'Sample data loaded' })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Load sample data error:', error)
    res.status(500).json({ error: 'Failed to load sample data' })
  } finally {
    client.release()
  }
})

app.delete('/data/clear', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM usage_records WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM cost_records WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM customers WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM plans WHERE user_id = $1', [req.visitorId])
    await client.query(
      'UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1',
      [req.visitorId, 'none']
    )
    await client.query('COMMIT')
    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Clear data error:', error)
    res.status(500).json({ error: 'Failed to clear data' })
  } finally {
    client.release()
  }
})

app.delete('/data/clear/revenue', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM customers WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM plans WHERE user_id = $1', [req.visitorId])
    await client.query('COMMIT')
    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: 'Failed to clear revenue data' })
  } finally {
    client.release()
  }
})

app.delete('/data/clear/costs', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM cost_records WHERE user_id = $1', [req.visitorId])
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear cost data' })
  }
})

app.delete('/data/clear/usage', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM usage_records WHERE user_id = $1', [req.visitorId])
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear usage data' })
  }
})

// Upload cost records
app.post('/data/upload/costs', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { records } = req.body
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No records provided' })
    }

    await client.query('BEGIN')
    await client.query('DELETE FROM cost_records WHERE user_id = $1', [req.visitorId])

    for (const record of records) {
      const periodStart = `${record.month}-01`
      const periodEnd = new Date(record.month + '-01')
      periodEnd.setMonth(periodEnd.getMonth() + 1)
      periodEnd.setDate(0)

      await client.query(
        'INSERT INTO cost_records (user_id, customer_id, cost_type, amount, period_start, period_end) VALUES ($1, $2, $3, $4, $5, $6)',
        [req.visitorId, record.customer_id || null, record.provider || 'infrastructure', record.cost, periodStart, periodEnd.toISOString().split('T')[0]]
      )
    }

    await client.query(
      'UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1',
      [req.visitorId, 'user']
    )

    await client.query('COMMIT')
    res.json({ success: true, count: records.length })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Upload costs error:', error)
    res.status(500).json({ error: 'Failed to upload cost data' })
  } finally {
    client.release()
  }
})

// Upload usage records
app.post('/data/upload/usage', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { records } = req.body
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No records provided' })
    }

    await client.query('BEGIN')
    await client.query('DELETE FROM usage_records WHERE user_id = $1', [req.visitorId])

    for (const record of records) {
      const periodStart = `${record.month}-01`
      const periodEnd = new Date(record.month + '-01')
      periodEnd.setMonth(periodEnd.getMonth() + 1)
      periodEnd.setDate(0)

      await client.query(
        'INSERT INTO usage_records (user_id, customer_id, metric_key, metric_value, metric_limit, period_start, period_end) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [req.visitorId, record.customer_id, record.metric || record.metric_key, record.value || record.metric_value, record.limit || record.metric_limit || null, periodStart, periodEnd.toISOString().split('T')[0]]
      )
    }

    await client.query(
      'UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1',
      [req.visitorId, 'user']
    )

    await client.query('COMMIT')
    res.json({ success: true, count: records.length })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Upload usage error:', error)
    res.status(500).json({ error: 'Failed to upload usage data' })
  } finally {
    client.release()
  }
})

// Upload revenue data (customers, plans, subscriptions)
app.post('/data/upload/revenue', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { customers, plans, subscriptions } = req.body

    await client.query('BEGIN')
    
    // Clear existing revenue data
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM customers WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM plans WHERE user_id = $1', [req.visitorId])

    // Insert plans
    if (Array.isArray(plans)) {
      for (const plan of plans) {
        await client.query(
          'INSERT INTO plans (user_id, plan_id, name, price_amount, interval_months) VALUES ($1, $2, $3, $4, $5)',
          [req.visitorId, plan.plan_id, plan.name, plan.price_amount, plan.interval_months || 1]
        )
      }
    }

    // Insert customers
    if (Array.isArray(customers)) {
      for (const customer of customers) {
        await client.query(
          'INSERT INTO customers (user_id, customer_id, name, email, segment) VALUES ($1, $2, $3, $4, $5)',
          [req.visitorId, customer.customer_id, customer.name, customer.email || null, customer.segment || null]
        )
      }
    }

    // Insert subscriptions
    if (Array.isArray(subscriptions)) {
      for (const sub of subscriptions) {
        await client.query(
          'INSERT INTO subscriptions (user_id, subscription_id, customer_id, plan_id, is_active, mrr_override, current_period_start, current_period_end) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [req.visitorId, sub.subscription_id, sub.customer_id, sub.plan_id, sub.is_active !== false, sub.mrr_override || null, sub.current_period_start || null, sub.current_period_end || null]
        )
      }
    }

    await client.query(
      'UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1',
      [req.visitorId, 'user']
    )

    await client.query('COMMIT')
    res.json({ 
      success: true, 
      counts: {
        customers: customers?.length || 0,
        plans: plans?.length || 0,
        subscriptions: subscriptions?.length || 0
      }
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Upload revenue error:', error)
    res.status(500).json({ error: 'Failed to upload revenue data' })
  } finally {
    client.release()
  }
})

app.get('/metrics/summary', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const customersResult = await pool.query('SELECT COUNT(*) FROM customers WHERE user_id = $1', [req.visitorId])
    const activeSubs = await pool.query('SELECT COUNT(*) FROM subscriptions WHERE user_id = $1 AND is_active = true', [req.visitorId])
    const mrrResult = await pool.query(
      'SELECT COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as mrr FROM subscriptions s LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id WHERE s.user_id = $1 AND s.is_active = true',
      [req.visitorId]
    )

    const mrr = parseFloat(mrrResult.rows[0].mrr) || 0
    const customerCount = parseInt(customersResult.rows[0].count)

    res.json({
      total_customers: customerCount,
      active_subscriptions: parseInt(activeSubs.rows[0].count),
      mrr: mrr,
      arr: mrr * 12,
      arpc: customerCount > 0 ? mrr / customerCount : 0,
    })
  } catch (error) {
    console.error('Get metrics error:', error)
    res.status(500).json({ error: 'Failed to get metrics' })
  }
})

async function startServer() {
  try {
    await pool.query('SELECT 1')
    console.log('Database connection verified')
    
    app.listen(PORT, '127.0.0.1', () => {
      console.log(`Backend server running on http://127.0.0.1:${PORT}`)
    })
  } catch (error) {
    console.error('Failed to connect to database:', error)
    process.exit(1)
  }
}

// =============================================================================
// STRIPE NATIVE INTEGRATION
// =============================================================================

// Check Stripe connection status (via native Replit integration)
app.get('/stripe/status', ensureVisitor, async (_req: AuthRequest, res: Response) => {
  try {
    const stripe = await getUncachableStripeClient()
    const account = await stripe.accounts.retrieve()
    res.json({
      connected: true,
      account_id: account.id,
      account_name: (account as { business_profile?: { name?: string }; display_name?: string }).business_profile?.name
        || (account as { display_name?: string }).display_name
        || account.id,
    })
  } catch (error) {
    res.json({ connected: false, error: error instanceof Error ? error.message : 'Not connected' })
  }
})

// Sync data from Stripe into the user's session
app.post('/stripe/sync', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const stripe = await getUncachableStripeClient()

    // Fetch data from Stripe
    const [stripeCustomers, stripeSubscriptions, stripeProducts] = await Promise.all([
      stripe.customers.list({ limit: 100 }),
      stripe.subscriptions.list({ limit: 100, status: 'all' }),
      stripe.products.list({ limit: 100, active: true }),
    ])

    // Build plan map from products+prices
    const pricesResult = await stripe.prices.list({ limit: 100, active: true })
    const prices = pricesResult.data

    await client.query('BEGIN')

    // Clear existing revenue data
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM customers WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM plans WHERE user_id = $1', [req.visitorId])

    // Insert plans (from Stripe products + prices)
    const planIds = new Set<string>()
    for (const price of prices) {
      const planId = price.id
      if (planIds.has(planId)) continue
      planIds.add(planId)
      const product = stripeProducts.data.find(p => p.id === (typeof price.product === 'string' ? price.product : price.product?.id))
      const name = product?.name || planId
      const amount = (price.unit_amount || 0) / 100
      const intervalMonths = price.recurring?.interval === 'year' ? 12 : 1
      await client.query(
        'INSERT INTO plans (user_id, plan_id, name, price_amount, interval_months, billing_model) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
        [req.visitorId, planId, name, amount, intervalMonths, 'recurring']
      )
    }

    // Insert customers
    for (const customer of stripeCustomers.data) {
      if (typeof customer === 'string') continue
      await client.query(
        'INSERT INTO customers (user_id, customer_id, name, email) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [req.visitorId, customer.id, customer.name || customer.email || customer.id, customer.email || null]
      )
    }

    // Insert subscriptions
    let syncedSubs = 0
    for (const sub of stripeSubscriptions.data) {
      const priceId = sub.items?.data?.[0]?.price?.id
      if (!priceId) continue
      const unitAmount = sub.items.data[0].price.unit_amount || 0
      const mrr = sub.items.data[0].price.recurring?.interval === 'year'
        ? Math.round(unitAmount / 12 / 100)
        : Math.round(unitAmount / 100)
      await client.query(
        'INSERT INTO subscriptions (user_id, subscription_id, customer_id, plan_id, is_active, mrr_override) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING',
        [req.visitorId, sub.id, sub.customer as string, priceId, sub.status === 'active', mrr]
      )
      syncedSubs++
    }

    await client.query(
      'INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()',
      [req.visitorId, 'user']
    )

    await client.query('COMMIT')

    res.json({
      success: true,
      synced: {
        customers: stripeCustomers.data.length,
        subscriptions: syncedSubs,
        plans: planIds.size,
      },
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Stripe sync error:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : 'Stripe sync failed' })
  } finally {
    client.release()
  }
})

startServer()
