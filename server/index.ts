import 'dotenv/config'
import express, { Request, Response, NextFunction } from 'express'
import session from 'express-session'
import pgSession from 'connect-pg-simple'
import { Pool } from '@neondatabase/serverless'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { getUncachableStripeClient } from './stripe-client.js'
import {
  tansoListPlans,
  tansoListFeatures,
  tansoGetCustomer,
  tansoCreateCustomer,
  tansoCheckEntitlement,
  tansoListCustomerEntitlements,
  tansoIngestEvent,
  tansoCreateSubscription,
  tansoChangeSubscriptionPlan,
  tansoCancelSubscription,
  tansoCancelScheduledCancellation,
  tansoCancelScheduledPlanChanges,
  tansoListCustomerInvoices,
  tansoMarkInvoicePaid,
  tansoCreateCheckoutSession,
  isTansoConfigured,
} from './tanso-client.js'

const app = express()

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

const PgStore = pgSession(session)

app.use(express.json({ limit: '2mb' }))

// Ensure DB tables exist before anything else (critical for serverless cold starts)
app.use(async (_req: Request, _res: Response, next: NextFunction) => {
  try {
    await ensureDbInitialized()
    next()
  } catch (error) {
    next(error)
  }
})

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
  saveUninitialized: false,
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
    accountId: number
    accountEmail: string
  }
}

interface AuthRequest extends Request {
  visitorId?: string
  accountId?: number
  accountEmail?: string
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
    if (req.session.accountId) {
      req.accountId = req.session.accountId
      req.accountEmail = req.session.accountEmail
    }
    next()
  } catch (error) {
    console.error('Visitor session error:', error)
    res.status(500).json({ error: 'Session error' })
  }
}

app.get('/session/init', ensureVisitor, async (req: AuthRequest, res: Response) => {
  res.json({
    visitorId: req.visitorId,
    account: req.session.accountId ? {
      id: req.session.accountId,
      email: req.session.accountEmail,
    } : null,
  })
})

function regenerateSession(req: AuthRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const visitorId = req.session.visitorId
    req.session.regenerate((err) => {
      if (err) return reject(err)
      req.session.visitorId = visitorId
      resolve()
    })
  })
}

app.post('/auth/signup', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, name } = req.body
    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required' })
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }
    if (name && typeof name !== 'string') {
      return res.status(400).json({ error: 'Name must be a string' })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const existing = await pool.query('SELECT id FROM accounts WHERE email = $1', [normalizedEmail])
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const result = await pool.query(
      'INSERT INTO accounts (email, password_hash, name, visitor_id) VALUES ($1, $2, $3, $4) RETURNING id, email, name',
      [normalizedEmail, passwordHash, name?.trim() || null, req.visitorId]
    )
    const account = result.rows[0]

    await regenerateSession(req)
    req.session.accountId = account.id
    req.session.accountEmail = account.email

    res.json({ account: { id: account.id, email: account.email, name: account.name } })
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists' })
    }
    console.error('Signup error:', error)
    res.status(500).json({ error: 'Failed to create account' })
  }
})

app.post('/auth/login', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const { email, password } = req.body
    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const result = await pool.query(
      'SELECT id, email, name, password_hash, visitor_id FROM accounts WHERE email = $1',
      [normalizedEmail]
    )
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const account = result.rows[0]
    const passwordValid = await bcrypt.compare(password, account.password_hash)
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const visitorIdToUse = account.visitor_id || req.visitorId
    if (!account.visitor_id) {
      await pool.query('UPDATE accounts SET visitor_id = $1 WHERE id = $2', [req.visitorId, account.id])
    }

    await regenerateSession(req)
    req.session.visitorId = visitorIdToUse
    req.session.accountId = account.id
    req.session.accountEmail = account.email

    res.json({ account: { id: account.id, email: account.email, name: account.name } })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Failed to log in' })
  }
})

app.post('/auth/logout', (req: AuthRequest, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err)
      return res.status(500).json({ error: 'Failed to log out' })
    }
    res.clearCookie('connect.sid')
    res.json({ success: true })
  })
})

app.get('/auth/me', ensureVisitor, async (req: AuthRequest, res: Response) => {
  if (!req.session.accountId) {
    return res.json({ account: null })
  }
  try {
    const result = await pool.query(
      'SELECT id, email, name FROM accounts WHERE id = $1',
      [req.session.accountId]
    )
    if (result.rows.length === 0) {
      req.session.accountId = undefined as any
      req.session.accountEmail = undefined as any
      return res.json({ account: null })
    }
    res.json({ account: result.rows[0] })
  } catch (error) {
    console.error('Auth me error:', error)
    res.status(500).json({ error: 'Failed to get account info' })
  }
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
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
    const offset = parseInt(req.query.offset as string) || 0
    const [result, countResult] = await Promise.all([
      pool.query(
        'SELECT * FROM customers WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [req.visitorId, limit, offset]
      ),
      pool.query('SELECT COUNT(*) FROM customers WHERE user_id = $1', [req.visitorId]),
    ])
    res.json({ data: result.rows, total: parseInt(countResult.rows[0].count), limit, offset })
  } catch (error) {
    console.error('Get customers error:', error)
    res.status(500).json({ error: 'Failed to get customers' })
  }
})

app.get('/subscriptions', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
    const offset = parseInt(req.query.offset as string) || 0
    const [result, countResult] = await Promise.all([
      pool.query(
        'SELECT s.*, c.name as customer_name, c.email as customer_email, p.name as plan_name, p.price_amount FROM subscriptions s LEFT JOIN customers c ON s.user_id = c.user_id AND s.customer_id = c.customer_id LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT $2 OFFSET $3',
        [req.visitorId, limit, offset]
      ),
      pool.query('SELECT COUNT(*) FROM subscriptions WHERE user_id = $1', [req.visitorId]),
    ])
    res.json({ data: result.rows, total: parseInt(countResult.rows[0].count), limit, offset })
  } catch (error) {
    console.error('Get subscriptions error:', error)
    res.status(500).json({ error: 'Failed to get subscriptions' })
  }
})

app.get('/plans', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
    const offset = parseInt(req.query.offset as string) || 0
    const result = await pool.query(
      'SELECT * FROM plans WHERE user_id = $1 ORDER BY price_amount ASC LIMIT $2 OFFSET $3',
      [req.visitorId, limit, offset]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('Get plans error:', error)
    res.status(500).json({ error: 'Failed to get plans' })
  }
})

app.get('/usage', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
    const offset = parseInt(req.query.offset as string) || 0
    const [result, countResult] = await Promise.all([
      pool.query(
        'SELECT * FROM usage_records WHERE user_id = $1 ORDER BY period_start DESC LIMIT $2 OFFSET $3',
        [req.visitorId, limit, offset]
      ),
      pool.query('SELECT COUNT(*) FROM usage_records WHERE user_id = $1', [req.visitorId]),
    ])
    res.json({ data: result.rows, total: parseInt(countResult.rows[0].count), limit, offset })
  } catch (error) {
    console.error('Get usage error:', error)
    res.status(500).json({ error: 'Failed to get usage' })
  }
})

app.get('/costs', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
    const offset = parseInt(req.query.offset as string) || 0
    const [result, countResult] = await Promise.all([
      pool.query(
        'SELECT * FROM cost_records WHERE user_id = $1 ORDER BY period_start DESC LIMIT $2 OFFSET $3',
        [req.visitorId, limit, offset]
      ),
      pool.query('SELECT COUNT(*) FROM cost_records WHERE user_id = $1', [req.visitorId]),
    ])
    res.json({ data: result.rows, total: parseInt(countResult.rows[0].count), limit, offset })
  } catch (error) {
    console.error('Get costs error:', error)
    res.status(500).json({ error: 'Failed to get costs' })
  }
})

app.get('/data/analyzer', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const analyzerLimit = 5000
    const [plans, customers, subscriptions, usage, costs] = await Promise.all([
      pool.query('SELECT * FROM plans WHERE user_id = $1 LIMIT $2', [req.visitorId, analyzerLimit]),
      pool.query('SELECT * FROM customers WHERE user_id = $1 LIMIT $2', [req.visitorId, analyzerLimit]),
      pool.query('SELECT * FROM subscriptions WHERE user_id = $1 LIMIT $2', [req.visitorId, analyzerLimit]),
      pool.query('SELECT * FROM usage_records WHERE user_id = $1 LIMIT $2', [req.visitorId, analyzerLimit]),
      pool.query('SELECT * FROM cost_records WHERE user_id = $1 LIMIT $2', [req.visitorId, analyzerLimit]),
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

    await client.query('DELETE FROM ai_insights WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM simulations WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM observe_events WHERE user_id = $1', [req.visitorId])
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

    // Sample observe_events — feature-level cost+revenue data
    const sampleEvents = [
      // ai_summarization feature — claude + gpt
      { customer_id: 'cus_001', feature_key: 'ai_summarization', event_name: 'summary_generated', ts: '2026-01-15T10:00:00Z', cost: 0.24, cost_unit: 'usd', revenue: 0.50, usage: 24, model: 'claude-3-5-sonnet', provider: 'anthropic', source: 'sample' },
      { customer_id: 'cus_002', feature_key: 'ai_summarization', event_name: 'summary_generated', ts: '2026-01-18T11:30:00Z', cost: 0.08, cost_unit: 'usd', revenue: 0.20, usage: 8, model: 'gpt-4o', provider: 'openai', source: 'sample' },
      { customer_id: 'cus_003', feature_key: 'ai_summarization', event_name: 'summary_generated', ts: '2026-01-22T09:15:00Z', cost: 0.15, cost_unit: 'usd', revenue: 0.35, usage: 15, model: 'claude-3-5-sonnet', provider: 'anthropic', source: 'sample' },
      { customer_id: 'cus_001', feature_key: 'ai_summarization', event_name: 'summary_generated', ts: '2026-02-10T14:00:00Z', cost: 0.30, cost_unit: 'usd', revenue: 0.60, usage: 30, model: 'gpt-4o', provider: 'openai', source: 'sample' },
      { customer_id: 'cus_004', feature_key: 'ai_summarization', event_name: 'summary_generated', ts: '2026-02-12T08:45:00Z', cost: 0.05, cost_unit: 'usd', revenue: 0.15, usage: 5, model: 'claude-3-haiku', provider: 'anthropic', source: 'sample' },
      // image_generation feature — dall-e-3 + stable-diffusion
      { customer_id: 'cus_001', feature_key: 'image_generation', event_name: 'image_generated', ts: '2026-01-20T13:00:00Z', cost: 0.04, cost_unit: 'usd', revenue: 0.25, usage: 1, model: 'dall-e-3', provider: 'openai', source: 'sample' },
      { customer_id: 'cus_003', feature_key: 'image_generation', event_name: 'image_generated', ts: '2026-01-22T15:30:00Z', cost: 0.04, cost_unit: 'usd', revenue: 0.25, usage: 1, model: 'dall-e-3', provider: 'openai', source: 'sample' },
      { customer_id: 'cus_005', feature_key: 'image_generation', event_name: 'image_generated', ts: '2026-02-05T11:00:00Z', cost: 0.02, cost_unit: 'usd', revenue: 0.20, usage: 1, model: 'stable-diffusion-xl', provider: 'stability', source: 'sample' },
      { customer_id: 'cus_002', feature_key: 'image_generation', event_name: 'image_generated', ts: '2026-02-08T09:00:00Z', cost: 0.04, cost_unit: 'usd', revenue: 0.25, usage: 1, model: 'dall-e-3', provider: 'openai', source: 'sample' },
      // search feature — embeddings
      { customer_id: 'cus_001', feature_key: 'search', event_name: 'search_query', ts: '2026-01-25T10:00:00Z', cost: 0.002, cost_unit: 'usd', revenue: 0.01, usage: 100, model: 'text-embedding-3-small', provider: 'openai', source: 'sample' },
      { customer_id: 'cus_002', feature_key: 'search', event_name: 'search_query', ts: '2026-01-28T14:00:00Z', cost: 0.003, cost_unit: 'usd', revenue: 0.01, usage: 150, model: 'text-embedding-3-small', provider: 'openai', source: 'sample' },
      { customer_id: 'cus_003', feature_key: 'search', event_name: 'search_query', ts: '2026-02-03T14:00:00Z', cost: 0.001, cost_unit: 'usd', revenue: 0.005, usage: 50, model: 'text-embedding-3-small', provider: 'openai', source: 'sample' },
      { customer_id: 'cus_004', feature_key: 'search', event_name: 'search_query', ts: '2026-02-11T09:30:00Z', cost: 0.004, cost_unit: 'usd', revenue: 0.02, usage: 200, model: 'text-embedding-ada-002', provider: 'openai', source: 'sample' },
      // pdf_generation feature (no model — deterministic)
      { customer_id: 'cus_001', feature_key: 'pdf_generation', event_name: 'document_generated', ts: '2026-01-19T13:00:00Z', cost: 0.12, cost_unit: 'usd', revenue: 0.50, usage: 12, model: null, provider: null, source: 'sample' },
      { customer_id: 'cus_005', feature_key: 'pdf_generation', event_name: 'document_generated', ts: '2026-02-07T11:00:00Z', cost: 0.18, cost_unit: 'usd', revenue: 0.70, usage: 18, model: null, provider: null, source: 'sample' },
      // email_send feature
      { customer_id: 'cus_002', feature_key: 'email_send', event_name: 'email_sent', ts: '2026-01-18T16:00:00Z', cost: 0.01, cost_unit: 'usd', revenue: 0.05, usage: 100, model: null, provider: null, source: 'sample' },
      { customer_id: 'cus_004', feature_key: 'email_send', event_name: 'email_sent', ts: '2026-02-15T17:30:00Z', cost: 0.015, cost_unit: 'usd', revenue: 0.06, usage: 150, model: null, provider: null, source: 'sample' },
    ]

    for (const ev of sampleEvents) {
      await client.query(
        `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, revenue_amount, usage_units, model, model_provider, source, granularity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'event')`,
        [req.visitorId, ev.customer_id, ev.feature_key, ev.event_name, ev.ts, ev.cost, ev.cost_unit, ev.revenue, ev.usage, ev.model, ev.provider, ev.source]
      )
    }

    // Sample simulations
    const sampleSimulations = [
      {
        id: 'sim-001',
        name: 'API Pricing Optimization',
        status: 'completed',
        segment_name: 'All Segments',
        scenarios: [
          { id: 'sc-001a', name: 'Conservative (+10%)', description: 'Moderate price increase across AI features', changes: [{ feature_key: 'ai_summarization', change_type: 'percentage_increase', change_value: 10 }, { feature_key: 'image_generation', change_type: 'percentage_increase', change_value: 10 }], projected_revenue: 3.08, projected_cost: 1.29, projected_margin_pct: 58 },
          { id: 'sc-001b', name: 'Aggressive (+25%)', description: 'Larger price increase to improve margins', changes: [{ feature_key: 'ai_summarization', change_type: 'percentage_increase', change_value: 25 }, { feature_key: 'image_generation', change_type: 'percentage_increase', change_value: 25 }], projected_revenue: 3.50, projected_cost: 1.29, projected_margin_pct: 63 },
        ],
        feature_analysis: [
          { feature_key: 'ai_summarization', current_cost: 0.82, current_revenue: 1.80, current_margin_pct: 54, projected_revenue: 2.25, projected_margin_pct: 64, margin_delta_pct: 10 },
          { feature_key: 'image_generation', current_cost: 0.14, current_revenue: 0.95, current_margin_pct: 85, projected_revenue: 1.19, projected_margin_pct: 88, margin_delta_pct: 3 },
          { feature_key: 'search', current_cost: 0.01, current_revenue: 0.045, current_margin_pct: 78, projected_revenue: 0.045, projected_margin_pct: 78, margin_delta_pct: 0 },
        ],
        customer_impacts: [
          { customer_id: 'cus_001', customer_name: 'Acme Corp', current_revenue: 1.10, projected_revenue: 1.38, revenue_delta: 0.28, revenue_delta_pct: 25, churn_risk: 'low', segment: 'Enterprise' },
          { customer_id: 'cus_002', customer_name: 'TechStart Inc', current_revenue: 0.45, projected_revenue: 0.56, revenue_delta: 0.11, revenue_delta_pct: 25, churn_risk: 'medium', segment: 'SMB' },
          { customer_id: 'cus_003', customer_name: 'Global Solutions', current_revenue: 0.60, projected_revenue: 0.75, revenue_delta: 0.15, revenue_delta_pct: 25, churn_risk: 'low', segment: 'Mid-Market' },
          { customer_id: 'cus_004', customer_name: 'Startup Labs', current_revenue: 0.15, projected_revenue: 0.19, revenue_delta: 0.04, revenue_delta_pct: 25, churn_risk: 'high', segment: 'SMB' },
          { customer_id: 'cus_005', customer_name: 'Enterprise Co', current_revenue: 0.20, projected_revenue: 0.25, revenue_delta: 0.05, revenue_delta_pct: 25, churn_risk: 'low', segment: 'Enterprise' },
        ],
        margin_impact: { current_margin_pct: 54, projected_margin_pct: 63, margin_delta_pct: 9, total_current_revenue: 2.80, total_projected_revenue: 3.50, total_cost: 1.29, customers_affected: 5, high_churn_risk_count: 1 },
        confidence_score: 78,
        key_insight: 'A 25% price increase on AI features would improve overall margin from 54% to 63%, with only 1 customer at high churn risk (Startup Labs, SMB segment).',
        winning_scenario_id: 'sc-001b',
        created_at: '2026-03-10T09:00:00Z',
      },
      {
        id: 'sim-002',
        name: 'Enterprise Tier Restructure',
        status: 'completed',
        segment_name: 'Enterprise',
        scenarios: [
          { id: 'sc-002a', name: 'Bundle AI features', description: 'Include AI summarization in enterprise tier at flat rate', changes: [{ feature_key: 'ai_summarization', change_type: 'new_price', change_value: 0.40 }], projected_revenue: 2.60, projected_cost: 1.29, projected_margin_pct: 50 },
          { id: 'sc-002b', name: 'Usage-based AI pricing', description: 'Move to per-unit pricing for AI features', changes: [{ feature_key: 'ai_summarization', change_type: 'percentage_increase', change_value: 15 }, { feature_key: 'search', change_type: 'percentage_increase', change_value: 50 }], projected_revenue: 3.15, projected_cost: 1.29, projected_margin_pct: 59 },
          { id: 'sc-002c', name: 'Premium image tier', description: 'Increase image generation pricing for enterprise', changes: [{ feature_key: 'image_generation', change_type: 'percentage_increase', change_value: 40 }], projected_revenue: 3.18, projected_cost: 1.29, projected_margin_pct: 59 },
        ],
        feature_analysis: [
          { feature_key: 'ai_summarization', current_cost: 0.82, current_revenue: 1.80, current_margin_pct: 54, projected_revenue: 2.07, projected_margin_pct: 60, margin_delta_pct: 6 },
          { feature_key: 'image_generation', current_cost: 0.14, current_revenue: 0.95, current_margin_pct: 85, projected_revenue: 1.33, projected_margin_pct: 89, margin_delta_pct: 4 },
        ],
        customer_impacts: [
          { customer_id: 'cus_001', customer_name: 'Acme Corp', current_revenue: 1.10, projected_revenue: 1.32, revenue_delta: 0.22, revenue_delta_pct: 20, churn_risk: 'low', segment: 'Enterprise' },
          { customer_id: 'cus_005', customer_name: 'Enterprise Co', current_revenue: 0.20, projected_revenue: 0.28, revenue_delta: 0.08, revenue_delta_pct: 40, churn_risk: 'medium', segment: 'Enterprise' },
        ],
        margin_impact: { current_margin_pct: 54, projected_margin_pct: 59, margin_delta_pct: 5, total_current_revenue: 2.80, total_projected_revenue: 3.18, total_cost: 1.29, customers_affected: 2, high_churn_risk_count: 0 },
        confidence_score: 65,
        key_insight: 'Restructuring enterprise pricing with a premium image tier yields +5% margin improvement with no high churn risk customers.',
        winning_scenario_id: 'sc-002c',
        created_at: '2026-03-12T14:00:00Z',
      },
      {
        id: 'sim-003',
        name: 'Usage-Based Pricing Test',
        status: 'draft',
        scenarios: [
          { id: 'sc-003a', name: 'Per-token pricing', description: 'Charge per 1000 tokens across all AI features', changes: [{ feature_key: 'ai_summarization', change_type: 'new_price', change_value: 0.03 }, { feature_key: 'search', change_type: 'new_price', change_value: 0.005 }] },
        ],
        feature_analysis: [],
        customer_impacts: [],
        confidence_score: null,
        key_insight: null,
        winning_scenario_id: null,
        created_at: '2026-03-15T11:00:00Z',
      },
    ]

    for (const sim of sampleSimulations) {
      await client.query(
        `INSERT INTO simulations (id, user_id, name, status, segment_name, scenarios, feature_analysis, customer_impacts, margin_impact, confidence_score, key_insight, winning_scenario_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
        [
          sim.id, req.visitorId, sim.name, sim.status,
          (sim as Record<string, unknown>).segment_name || null,
          JSON.stringify(sim.scenarios),
          JSON.stringify(sim.feature_analysis),
          JSON.stringify(sim.customer_impacts),
          (sim as Record<string, unknown>).margin_impact ? JSON.stringify((sim as Record<string, unknown>).margin_impact) : null,
          sim.confidence_score,
          sim.key_insight,
          sim.winning_scenario_id,
          sim.created_at,
        ]
      )
    }

    await client.query(
      'INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()',
      [req.visitorId, 'sample']
    )

    await client.query('COMMIT')
    // Convert referral if this user was referred and just loaded data
    convertReferralIfPending(req.visitorId!)
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
    await client.query('DELETE FROM ai_insights WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM simulations WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM observe_events WHERE user_id = $1', [req.visitorId])
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
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'revenue'", [req.visitorId])
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
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'cost'", [req.visitorId])
    await client.query('DELETE FROM cost_records WHERE user_id = $1', [req.visitorId])
    await client.query('COMMIT')
    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: 'Failed to clear cost data' })
  } finally {
    client.release()
  }
})

app.delete('/data/clear/usage', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'usage'", [req.visitorId])
    await client.query('DELETE FROM usage_records WHERE user_id = $1', [req.visitorId])
    await client.query('COMMIT')
    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: 'Failed to clear usage data' })
  } finally {
    client.release()
  }
})

// Upload cost records
app.post('/data/upload/costs', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const access = await checkTansoFeatureAccess(req.visitorId!, 'csv_upload', req.accountEmail)
  if (!access.allowed) return res.status(403).json({ error: access.reason || 'Upload limit reached. Upgrade your plan.' })
  const client = await pool.connect()
  try {
    const { records } = req.body
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No records provided' })
    }
    if (records.length > 10000) {
      return res.status(400).json({ error: 'Too many records. Maximum 10,000 per upload.' })
    }

    await client.query('BEGIN')
    await client.query('DELETE FROM cost_records WHERE user_id = $1', [req.visitorId])
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'cost'", [req.visitorId])

    // Batch insert cost_records
    const batchSize = 500
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      const costValues: unknown[] = []
      const costPlaceholders: string[] = []
      const eventValues: unknown[] = []
      const eventPlaceholders: string[] = []
      let costIdx = 1
      let eventIdx = 1

      for (const record of batch) {
        const periodStart = `${record.month}-01`
        const periodEnd = new Date(record.month + '-01')
        periodEnd.setMonth(periodEnd.getMonth() + 1)
        periodEnd.setDate(0)
        const periodEndStr = periodEnd.toISOString().split('T')[0]

        costPlaceholders.push(`($${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++})`)
        costValues.push(req.visitorId, record.customer_id || null, record.provider || 'infrastructure', record.cost, periodStart, periodEndStr)

        eventPlaceholders.push(`($${eventIdx++}, $${eventIdx++}, $${eventIdx++}, 'cost', $${eventIdx++}, $${eventIdx++}, 'usd', 'csv', 'monthly_aggregate')`)
        eventValues.push(req.visitorId, record.customer_id || '_aggregate', record.provider || 'infrastructure', new Date(`${record.month}-01`).toISOString(), record.cost)
      }

      await client.query(
        `INSERT INTO cost_records (user_id, customer_id, cost_type, amount, period_start, period_end) VALUES ${costPlaceholders.join(', ')}`,
        costValues
      )
      await client.query(
        `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, source, granularity) VALUES ${eventPlaceholders.join(', ')}`,
        eventValues
      )
    }

    await client.query(
      'UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1',
      [req.visitorId, 'user']
    )

    await client.query('COMMIT')
    convertReferralIfPending(req.visitorId!)
    trackTansoUsage(req.visitorId!, 'csv_upload', 'csv_upload_costs')
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
  const access = await checkTansoFeatureAccess(req.visitorId!, 'csv_upload', req.accountEmail)
  if (!access.allowed) return res.status(403).json({ error: access.reason || 'Upload limit reached. Upgrade your plan.' })
  const client = await pool.connect()
  try {
    const { records } = req.body
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No records provided' })
    }
    if (records.length > 10000) {
      return res.status(400).json({ error: 'Too many records. Maximum 10,000 per upload.' })
    }

    await client.query('BEGIN')
    await client.query('DELETE FROM usage_records WHERE user_id = $1', [req.visitorId])
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'usage'", [req.visitorId])

    // Batch insert usage_records
    const batchSize = 500
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)
      const usageValues: unknown[] = []
      const usagePlaceholders: string[] = []
      const eventValues: unknown[] = []
      const eventPlaceholders: string[] = []
      let usageIdx = 1
      let eventIdx = 1

      for (const record of batch) {
        const periodStart = `${record.month}-01`
        const periodEnd = new Date(record.month + '-01')
        periodEnd.setMonth(periodEnd.getMonth() + 1)
        periodEnd.setDate(0)
        const periodEndStr = periodEnd.toISOString().split('T')[0]
        const metricKey = record.metric || record.metric_key
        const metricValue = record.value || record.metric_value

        usagePlaceholders.push(`($${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++})`)
        usageValues.push(req.visitorId, record.customer_id, metricKey, metricValue, record.limit || record.metric_limit || null, periodStart, periodEndStr)

        eventPlaceholders.push(`($${eventIdx++}, $${eventIdx++}, $${eventIdx++}, 'usage', $${eventIdx++}, $${eventIdx++}, 'csv', 'monthly_aggregate')`)
        eventValues.push(req.visitorId, record.customer_id || '_aggregate', metricKey, new Date(`${record.month}-01`).toISOString(), metricValue)
      }

      await client.query(
        `INSERT INTO usage_records (user_id, customer_id, metric_key, metric_value, metric_limit, period_start, period_end) VALUES ${usagePlaceholders.join(', ')}`,
        usageValues
      )
      await client.query(
        `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, usage_units, source, granularity) VALUES ${eventPlaceholders.join(', ')}`,
        eventValues
      )
    }

    await client.query(
      'UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1',
      [req.visitorId, 'user']
    )

    await client.query('COMMIT')
    convertReferralIfPending(req.visitorId!)
    trackTansoUsage(req.visitorId!, 'csv_upload', 'csv_upload_usage')
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
  const access = await checkTansoFeatureAccess(req.visitorId!, 'csv_upload', req.accountEmail)
  if (!access.allowed) return res.status(403).json({ error: access.reason || 'Upload limit reached. Upgrade your plan.' })
  const client = await pool.connect()
  try {
    const { customers, plans, subscriptions } = req.body

    await client.query('BEGIN')
    
    // Clear existing revenue data
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM customers WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM plans WHERE user_id = $1', [req.visitorId])
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'revenue'", [req.visitorId])

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

    // Dual-write subscriptions to observe_events (use plan price as MRR fallback)
    if (Array.isArray(subscriptions)) {
      const planPriceMap = new Map((plans || []).map((p: { plan_id: string; price_amount: number }) => [p.plan_id, parseFloat(p.price_amount as unknown as string) || 0]))
      for (const sub of subscriptions) {
        const mrr = sub.mrr_override || planPriceMap.get(sub.plan_id) || 0
        await client.query(
          `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity)
           VALUES ($1, $2, 'subscription', 'revenue', NOW(), $3, 'csv', 'monthly_aggregate')`,
          [req.visitorId, sub.customer_id, mrr]
        )
      }
    }

    await client.query(
      'UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1',
      [req.visitorId, 'user']
    )

    await client.query('COMMIT')
    convertReferralIfPending(req.visitorId!)
    trackTansoUsage(req.visitorId!, 'csv_upload', 'csv_upload_revenue')
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

let dbInitialized = false
async function ensureDbInitialized() {
  if (dbInitialized) return
  try {
    await pool.query('SELECT 1')
    console.log('Database connection verified')

    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        visitor_id TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tanso_customers (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT UNIQUE NOT NULL,
        tanso_customer_id TEXT,
        email TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        name TEXT NOT NULL,
        price_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        interval_months INTEGER NOT NULL DEFAULT 1,
        billing_model TEXT NOT NULL DEFAULT 'recurring',
        api_calls_limit INTEGER,
        tokens_limit INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, plan_id)
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        segment TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, customer_id)
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        subscription_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        previous_mrr DECIMAL(10,2),
        mrr_override DECIMAL(10,2),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, subscription_id)
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        metric_key TEXT NOT NULL,
        metric_value DECIMAL(12,2) NOT NULL,
        metric_limit DECIMAL(12,2),
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cost_records (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        customer_id TEXT,
        cost_type TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_data_status (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        data_mode TEXT NOT NULL DEFAULT 'none',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS observe_events (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        customer_id TEXT NOT NULL DEFAULT 'unknown',
        feature_key TEXT NOT NULL DEFAULT 'unknown',
        event_name TEXT NOT NULL DEFAULT 'usage',
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        cost_amount NUMERIC(12, 4) NOT NULL DEFAULT 0,
        cost_unit TEXT DEFAULT 'usd',
        revenue_amount NUMERIC(12, 4) NOT NULL DEFAULT 0,
        usage_units NUMERIC(12, 4) NOT NULL DEFAULT 0,
        model TEXT,
        model_provider TEXT,
        source TEXT NOT NULL DEFAULT 'csv',
        granularity TEXT NOT NULL DEFAULT 'monthly_aggregate',
        properties JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_insights (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        insight_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT DEFAULT 'info',
        feature_key TEXT,
        customer_id TEXT,
        metadata JSONB DEFAULT '{}',
        tokens_used INTEGER,
        cost_usd NUMERIC(10, 6),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS simulations (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        scenarios JSONB DEFAULT '[]',
        time_range JSONB DEFAULT '{}',
        results JSONB,
        status TEXT DEFAULT 'draft',
        segment_name TEXT,
        feature_analysis JSONB,
        customer_impacts JSONB,
        margin_impact JSONB,
        confidence_score NUMERIC(5,2),
        key_insight TEXT,
        winning_scenario_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS integration_requests (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        integration_name TEXT NOT NULL,
        request_type TEXT NOT NULL DEFAULT 'notify',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, integration_name)
      )
    `)

    // Create indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_plans_user_id ON plans(user_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_usage_records_user_id ON usage_records(user_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cost_records_user_id ON cost_records(user_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_observe_events_user_ts ON observe_events(user_id, timestamp DESC)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_observe_events_user_feature ON observe_events(user_id, feature_key)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_insights_user ON ai_insights(user_id, created_at DESC)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_simulations_user_created ON simulations(user_id, created_at DESC)`)

    // Integrations table for API key connections (OpenAI, Anthropic, etc.)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS integrations (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        api_key_prefix TEXT NOT NULL,
        has_usage_access BOOLEAN DEFAULT false,
        connected_at TIMESTAMPTZ DEFAULT NOW(),
        last_synced_at TIMESTAMPTZ,
        UNIQUE(user_id, provider)
      )
    `)

    // Team / Organization tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'My Team',
        owner_visitor_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS organization_members (
        id SERIAL PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        visitor_id TEXT,
        invited_email TEXT,
        invite_token TEXT UNIQUE,
        role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
        joined_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS visitor_org_map (
        visitor_id TEXT PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // Referral system tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_codes (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_user_id TEXT NOT NULL,
        referred_user_id TEXT NOT NULL UNIQUE,
        referral_code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        credited_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_credits (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        credit_type TEXT NOT NULL DEFAULT 'promo_month',
        amount INTEGER NOT NULL DEFAULT 1,
        source_referral_id INTEGER REFERENCES referrals(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        used_at TIMESTAMPTZ,
        promo_code TEXT,
        stripe_promo_id TEXT
      )
    `)

    // Add new columns if missing (migration for existing tables)
    await pool.query(`
      ALTER TABLE referral_credits ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;
      ALTER TABLE referral_credits ADD COLUMN IF NOT EXISTS promo_code TEXT;
      ALTER TABLE referral_credits ADD COLUMN IF NOT EXISTS stripe_promo_id TEXT
    `)

    dbInitialized = true
  } catch (error) {
    console.error('Failed to connect to database:', error)
    throw error
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

    // Fetch all data from Stripe using auto-pagination
    const [stripeCustomersList, stripeSubscriptionsList, stripeProductsList, pricesList] = await Promise.all([
      stripe.customers.list({ limit: 100 }).autoPagingToArray({ limit: 10000 }),
      stripe.subscriptions.list({ limit: 100, status: 'all' }).autoPagingToArray({ limit: 10000 }),
      stripe.products.list({ limit: 100, active: true }).autoPagingToArray({ limit: 10000 }),
      stripe.prices.list({ limit: 100, active: true }).autoPagingToArray({ limit: 10000 }),
    ])
    const stripeCustomers = { data: stripeCustomersList }
    const stripeSubscriptions = { data: stripeSubscriptionsList }
    const stripeProducts = { data: stripeProductsList }
    const prices = pricesList

    await client.query('BEGIN')

    // Clear existing revenue data
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM customers WHERE user_id = $1', [req.visitorId])
    await client.query('DELETE FROM plans WHERE user_id = $1', [req.visitorId])
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND source = 'stripe'", [req.visitorId])

    // Insert plans (from Stripe products + prices) — batched
    const planIds = new Set<string>()
    const planRows: { planId: string; name: string; amount: number; intervalMonths: number }[] = []
    for (const price of prices) {
      const planId = price.id
      if (planIds.has(planId)) continue
      planIds.add(planId)
      const product = stripeProducts.data.find(p => p.id === (typeof price.product === 'string' ? price.product : price.product?.id))
      const name = product?.name || planId
      const amount = (price.unit_amount || 0) / 100
      const intervalMonths = price.recurring?.interval === 'year' ? 12 : 1
      planRows.push({ planId, name, amount, intervalMonths })
    }
    const batchSize = 500
    for (let i = 0; i < planRows.length; i += batchSize) {
      const batch = planRows.slice(i, i + batchSize)
      const values: unknown[] = []
      const placeholders: string[] = []
      let idx = 1
      for (const p of batch) {
        placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`)
        values.push(req.visitorId, p.planId, p.name, p.amount, p.intervalMonths, 'recurring')
      }
      await client.query(
        `INSERT INTO plans (user_id, plan_id, name, price_amount, interval_months, billing_model) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`,
        values
      )
    }

    // Insert customers — batched
    const validCustomers = stripeCustomers.data.filter(c => typeof c !== 'string')
    for (let i = 0; i < validCustomers.length; i += batchSize) {
      const batch = validCustomers.slice(i, i + batchSize)
      const values: unknown[] = []
      const placeholders: string[] = []
      let idx = 1
      for (const customer of batch) {
        placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`)
        values.push(req.visitorId, customer.id, customer.name || customer.email || customer.id, customer.email || null)
      }
      await client.query(
        `INSERT INTO customers (user_id, customer_id, name, email) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`,
        values
      )
    }

    // Insert subscriptions — batched
    let syncedSubs = 0
    const subRows: { id: string; customerId: string; priceId: string; isActive: boolean; mrr: number }[] = []
    for (const sub of stripeSubscriptions.data) {
      const priceId = sub.items?.data?.[0]?.price?.id
      if (!priceId) continue
      const unitAmount = sub.items.data[0].price.unit_amount || 0
      const mrr = sub.items.data[0].price.recurring?.interval === 'year'
        ? Math.round(unitAmount / 12 / 100)
        : Math.round(unitAmount / 100)
      subRows.push({ id: sub.id, customerId: sub.customer as string, priceId, isActive: sub.status === 'active', mrr })
      syncedSubs++
    }
    for (let i = 0; i < subRows.length; i += batchSize) {
      const batch = subRows.slice(i, i + batchSize)
      const subValues: unknown[] = []
      const subPlaceholders: string[] = []
      const eventValues: unknown[] = []
      const eventPlaceholders: string[] = []
      let subIdx = 1
      let eventIdx = 1
      for (const s of batch) {
        subPlaceholders.push(`($${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++})`)
        subValues.push(req.visitorId, s.id, s.customerId, s.priceId, s.isActive, s.mrr)
        eventPlaceholders.push(`($${eventIdx++}, $${eventIdx++}, 'subscription', 'revenue', NOW(), $${eventIdx++}, 'stripe', 'monthly_aggregate')`)
        eventValues.push(req.visitorId, s.customerId, s.mrr)
      }
      await client.query(
        `INSERT INTO subscriptions (user_id, subscription_id, customer_id, plan_id, is_active, mrr_override) VALUES ${subPlaceholders.join(', ')} ON CONFLICT DO NOTHING`,
        subValues
      )
      await client.query(
        `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity) VALUES ${eventPlaceholders.join(', ')}`,
        eventValues
      )
    }

    await client.query(
      'INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()',
      [req.visitorId, 'user']
    )

    await client.query('COMMIT')
    convertReferralIfPending(req.visitorId!)

    // Track Stripe sync usage in Tanso
    trackTansoUsage(req.visitorId!, 'stripe_sync', 'stripe_data_synced')

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

// =============================================================================
// FEATURE ECONOMICS ENDPOINTS
// =============================================================================

function coerceEventRow(row: Record<string, unknown>) {
  return {
    ...row,
    cost_amount: row.cost_amount != null ? parseFloat(row.cost_amount as string) : null,
    revenue_amount: row.revenue_amount != null ? parseFloat(row.revenue_amount as string) : null,
    usage_units: row.usage_units != null ? parseFloat(row.usage_units as string) : null,
  }
}

// GET /events — paginated list of observe_events
app.get('/events', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)
    const offset = parseInt(req.query.offset as string) || 0
    const featureKey = req.query.feature_key as string | undefined
    const customerId = req.query.customer_id as string | undefined
    const model = req.query.model as string | undefined
    const source = req.query.source as string | undefined
    const dateFrom = req.query.date_from as string | undefined
    const dateTo = req.query.date_to as string | undefined

    let where = 'WHERE oe.user_id = $1'
    const params: unknown[] = [req.visitorId]
    let paramIdx = 2

    if (featureKey) {
      where += ` AND oe.feature_key = $${paramIdx++}`
      params.push(featureKey)
    }
    if (customerId) {
      where += ` AND oe.customer_id = $${paramIdx++}`
      params.push(customerId)
    }
    if (model) {
      where += ` AND oe.model = $${paramIdx++}`
      params.push(model)
    }
    if (source) {
      where += ` AND oe.source = $${paramIdx++}`
      params.push(source)
    }
    if (dateFrom) {
      where += ` AND oe.timestamp >= $${paramIdx++}`
      params.push(dateFrom)
    }
    if (dateTo) {
      where += ` AND oe.timestamp <= $${paramIdx++}`
      params.push(dateTo)
    }

    const eventsResult = await pool.query(
      `SELECT oe.*, c.name as customer_name
       FROM observe_events oe
       LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
       ${where}
       ORDER BY oe.timestamp DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    )

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM observe_events oe ${where}`,
      params
    )

    res.json({
      events: eventsResult.rows.map(coerceEventRow),
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    })
  } catch (error) {
    console.error('Get events error:', error)
    res.status(500).json({ error: 'Failed to get events' })
  }
})

// GET /events/by-feature — aggregate events grouped by feature_key
app.get('/events/by-feature', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT feature_key, COUNT(*) as event_count,
         COALESCE(SUM(cost_amount), 0) as total_cost,
         COALESCE(SUM(revenue_amount), 0) as total_revenue,
         COALESCE(SUM(usage_units), 0) as total_usage,
         MAX(timestamp) as last_seen
       FROM observe_events WHERE user_id = $1 AND feature_key IS NOT NULL
       GROUP BY feature_key ORDER BY total_cost DESC`,
      [req.visitorId]
    )
    res.json(result.rows.map(row => {
      const cost = parseFloat(row.total_cost) || 0
      const revenue = parseFloat(row.total_revenue) || 0
      return {
        feature_key: row.feature_key,
        event_count: parseInt(row.event_count),
        total_cost: cost,
        total_revenue: revenue,
        total_usage: parseFloat(row.total_usage) || 0,
        margin_pct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null,
        last_seen: row.last_seen,
      }
    }))
  } catch (error) {
    console.error('Get events/by-feature error:', error)
    res.status(500).json({ error: 'Failed to get feature aggregations' })
  }
})

// GET /events/by-customer — aggregate events grouped by customer_id
app.get('/events/by-customer', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT oe.customer_id, c.name as customer_name, COUNT(*) as event_count,
         COALESCE(SUM(oe.cost_amount), 0) as total_cost,
         COALESCE(SUM(oe.revenue_amount), 0) as total_revenue,
         MAX(oe.timestamp) as last_seen
       FROM observe_events oe
       LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
       WHERE oe.user_id = $1
       GROUP BY oe.customer_id, c.name ORDER BY total_cost DESC`,
      [req.visitorId]
    )
    res.json(result.rows.map(row => {
      const cost = parseFloat(row.total_cost) || 0
      const revenue = parseFloat(row.total_revenue) || 0
      return {
        customer_id: row.customer_id,
        customer_name: row.customer_name || row.customer_id,
        event_count: parseInt(row.event_count),
        total_cost: cost,
        total_revenue: revenue,
        margin_pct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null,
        last_seen: row.last_seen,
      }
    }))
  } catch (error) {
    console.error('Get events/by-customer error:', error)
    res.status(500).json({ error: 'Failed to get customer aggregations' })
  }
})

// GET /events/by-model — aggregate events grouped by model
app.get('/events/by-model', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT model, model_provider, COUNT(*) as event_count,
         COALESCE(SUM(cost_amount), 0) as total_cost,
         COALESCE(SUM(revenue_amount), 0) as total_revenue,
         COALESCE(SUM(usage_units), 0) as total_usage,
         MAX(timestamp) as last_seen
       FROM observe_events WHERE user_id = $1 AND model IS NOT NULL
       GROUP BY model, model_provider ORDER BY total_cost DESC`,
      [req.visitorId]
    )
    res.json(result.rows.map(row => {
      const cost = parseFloat(row.total_cost) || 0
      const revenue = parseFloat(row.total_revenue) || 0
      return {
        model: row.model,
        model_provider: row.model_provider,
        event_count: parseInt(row.event_count),
        total_cost: cost,
        total_revenue: revenue,
        total_usage: parseFloat(row.total_usage) || 0,
        margin_pct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null,
        last_seen: row.last_seen,
      }
    }))
  } catch (error) {
    console.error('Get events/by-model error:', error)
    res.status(500).json({ error: 'Failed to get model aggregations' })
  }
})

// GET /features — aggregated stats per feature_key
app.get('/features', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
         feature_key,
         COUNT(*) as event_count,
         COUNT(DISTINCT customer_id) as customer_count,
         COALESCE(SUM(cost_amount), 0) as total_cost,
         COALESCE(SUM(revenue_amount), 0) as total_revenue,
         COALESCE(SUM(usage_units), 0) as total_usage,
         COALESCE(AVG(cost_amount), 0) as avg_cost_per_event,
         COALESCE(AVG(revenue_amount), 0) as avg_revenue_per_event,
         MAX(timestamp) as last_seen
       FROM observe_events
       WHERE user_id = $1 AND feature_key IS NOT NULL
       GROUP BY feature_key
       ORDER BY total_cost DESC`,
      [req.visitorId]
    )

    const features = result.rows.map(row => {
      const cost = parseFloat(row.total_cost) || 0
      const revenue = parseFloat(row.total_revenue) || 0
      const margin = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null
      return {
        feature_key: row.feature_key,
        event_count: parseInt(row.event_count),
        customer_count: parseInt(row.customer_count),
        total_cost: cost,
        total_revenue: revenue,
        total_usage: parseFloat(row.total_usage) || 0,
        avg_cost_per_event: parseFloat(row.avg_cost_per_event) || 0,
        avg_revenue_per_event: parseFloat(row.avg_revenue_per_event) || 0,
        margin_pct: margin,
        last_seen: row.last_seen,
      }
    })

    res.json(features)
  } catch (error) {
    console.error('Get features error:', error)
    res.status(500).json({ error: 'Failed to get features' })
  }
})

// GET /features/:key — detail for a single feature
app.get('/features/:key', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const { key } = req.params

    const [summaryRes, eventsRes, customerRes, modelRes, timeseriesRes] = await Promise.all([
      pool.query(
        `SELECT feature_key, COUNT(*) as event_count, COUNT(DISTINCT customer_id) as customer_count,
           COALESCE(SUM(cost_amount), 0) as total_cost, COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage, MAX(timestamp) as last_seen
         FROM observe_events WHERE user_id = $1 AND feature_key = $2
         GROUP BY feature_key`,
        [req.visitorId, key]
      ),
      pool.query(
        `SELECT oe.*, c.name as customer_name FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1 AND oe.feature_key = $2 ORDER BY oe.timestamp DESC LIMIT 50`,
        [req.visitorId, key]
      ),
      pool.query(
        `SELECT oe.customer_id, c.name as customer_name,
           COUNT(*) as event_count, COALESCE(SUM(oe.cost_amount), 0) as total_cost,
           COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
         FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1 AND oe.feature_key = $2
         GROUP BY oe.customer_id, c.name ORDER BY total_cost DESC`,
        [req.visitorId, key]
      ),
      pool.query(
        `SELECT model, model_provider, COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost, COALESCE(SUM(revenue_amount), 0) as total_revenue
         FROM observe_events WHERE user_id = $1 AND feature_key = $2 AND model IS NOT NULL
         GROUP BY model, model_provider ORDER BY total_cost DESC`,
        [req.visitorId, key]
      ),
      pool.query(
        `SELECT DATE_TRUNC('month', timestamp) as month,
           COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage
         FROM observe_events WHERE user_id = $1 AND feature_key = $2
         GROUP BY month ORDER BY month ASC`,
        [req.visitorId, key]
      ),
    ])

    const s = summaryRes.rows[0]
    if (!s || !s.feature_key) {
      return res.status(404).json({ error: 'Feature not found' })
    }

    const cost = parseFloat(s.total_cost) || 0
    const revenue = parseFloat(s.total_revenue) || 0
    const margin = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null

    res.json({
      feature_key: s.feature_key,
      event_count: parseInt(s.event_count),
      customer_count: parseInt(s.customer_count),
      total_cost: cost,
      total_revenue: revenue,
      total_usage: parseFloat(s.total_usage) || 0,
      margin_pct: margin,
      last_seen: s.last_seen,
      recent_events: eventsRes.rows.map(coerceEventRow),
      by_customer: customerRes.rows.map((r: { customer_id: string; customer_name: string; event_count: string; total_cost: string; total_revenue: string }) => ({
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        event_count: parseInt(r.event_count),
        total_cost: parseFloat(r.total_cost) || 0,
        total_revenue: parseFloat(r.total_revenue) || 0,
      })),
      by_model: modelRes.rows.map((r: { model: string; model_provider: string; event_count: string; total_cost: string; total_revenue: string }) => ({
        model: r.model,
        model_provider: r.model_provider,
        event_count: parseInt(r.event_count),
        total_cost: parseFloat(r.total_cost) || 0,
        total_revenue: parseFloat(r.total_revenue) || 0,
      })),
      timeseries: timeseriesRes.rows.map((r: { month: string; event_count: string; total_cost: string; total_revenue: string; total_usage: string }) => ({
        month: r.month,
        event_count: parseInt(r.event_count),
        total_cost: parseFloat(r.total_cost) || 0,
        total_revenue: parseFloat(r.total_revenue) || 0,
        total_usage: parseFloat(r.total_usage) || 0,
      })),
    })
  } catch (error) {
    console.error('Get feature detail error:', error)
    res.status(500).json({ error: 'Failed to get feature detail' })
  }
})

// GET /models — aggregated stats per model
app.get('/models', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT model, model_provider, COUNT(*) as event_count,
         COUNT(DISTINCT customer_id) as customer_count, COUNT(DISTINCT feature_key) as feature_count,
         COALESCE(SUM(cost_amount), 0) as total_cost, COALESCE(SUM(revenue_amount), 0) as total_revenue,
         COALESCE(SUM(usage_units), 0) as total_usage, COALESCE(AVG(cost_amount), 0) as avg_cost_per_event,
         MAX(timestamp) as last_seen
       FROM observe_events WHERE user_id = $1 AND model IS NOT NULL
       GROUP BY model, model_provider ORDER BY total_cost DESC`,
      [req.visitorId]
    )

    res.json(result.rows.map(row => {
      const cost = parseFloat(row.total_cost) || 0
      const revenue = parseFloat(row.total_revenue) || 0
      return {
        model: row.model,
        model_provider: row.model_provider,
        event_count: parseInt(row.event_count),
        customer_count: parseInt(row.customer_count),
        feature_count: parseInt(row.feature_count),
        total_cost: cost,
        total_revenue: revenue,
        total_usage: parseFloat(row.total_usage) || 0,
        avg_cost_per_event: parseFloat(row.avg_cost_per_event) || 0,
        margin_pct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null,
        last_seen: row.last_seen,
      }
    }))
  } catch (error) {
    console.error('Get models error:', error)
    res.status(500).json({ error: 'Failed to get models' })
  }
})

// GET /customers/:id — enriched customer detail with events
app.get('/customers/:id', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const [customerRes, subRes, eventsRes, featureRes] = await Promise.all([
      pool.query('SELECT * FROM customers WHERE user_id = $1 AND customer_id = $2', [req.visitorId, id]),
      pool.query(
        `SELECT s.*, p.name as plan_name, p.price_amount FROM subscriptions s
         LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id
         WHERE s.user_id = $1 AND s.customer_id = $2`,
        [req.visitorId, id]
      ),
      pool.query(
        `SELECT * FROM observe_events WHERE user_id = $1 AND customer_id = $2 ORDER BY timestamp DESC LIMIT 50`,
        [req.visitorId, id]
      ),
      pool.query(
        `SELECT feature_key, COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage
         FROM observe_events WHERE user_id = $1 AND customer_id = $2 AND feature_key IS NOT NULL
         GROUP BY feature_key ORDER BY total_cost DESC`,
        [req.visitorId, id]
      ),
    ])

    if (customerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' })
    }

    const c = customerRes.rows[0]
    const totalCost = featureRes.rows.reduce((sum: number, r: { total_cost: string }) => sum + (parseFloat(r.total_cost) || 0), 0)
    const totalRevenue = featureRes.rows.reduce((sum: number, r: { total_revenue: string }) => sum + (parseFloat(r.total_revenue) || 0), 0)
    const marginPct = totalRevenue > 0 ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100) : null

    res.json({
      customer: { customer_id: c.customer_id, name: c.name, email: c.email, segment: c.segment, created_at: c.created_at },
      subscriptions: subRes.rows,
      total_cost: totalCost,
      total_revenue: totalRevenue,
      margin_pct: marginPct,
      recent_events: eventsRes.rows.map(coerceEventRow),
      by_feature: featureRes.rows.map((r: { feature_key: string; event_count: string; total_cost: string; total_revenue: string; total_usage: string }) => ({
        feature_key: r.feature_key,
        event_count: parseInt(r.event_count),
        total_cost: parseFloat(r.total_cost) || 0,
        total_revenue: parseFloat(r.total_revenue) || 0,
        total_usage: parseFloat(r.total_usage) || 0,
      })),
    })
  } catch (error) {
    console.error('Get customer detail error:', error)
    res.status(500).json({ error: 'Failed to get customer detail' })
  }
})

// =============================================================================
// SIMULATIONS
// =============================================================================

// GET /simulations/opportunities — auto-detect pricing issues
// NOTE: Must come BEFORE /simulations/:id to avoid matching 'opportunities' as an :id
app.get('/simulations/opportunities', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT feature_key,
         COALESCE(SUM(cost_amount), 0) as total_cost,
         COALESCE(SUM(revenue_amount), 0) as total_revenue,
         COUNT(*) as event_count
       FROM observe_events
       WHERE user_id = $1 AND feature_key IS NOT NULL
       GROUP BY feature_key`,
      [req.visitorId]
    )

    const opportunities: Array<{
      id: string; title: string; description: string;
      severity: string; suggested_action: string;
      feature_key?: string; estimated_impact?: string;
    }> = []

    let idx = 0
    for (const row of result.rows) {
      const cost = parseFloat(row.total_cost) || 0
      const revenue = parseFloat(row.total_revenue) || 0
      const margin = revenue > 0 ? ((revenue - cost) / revenue) * 100 : -100

      if (margin < 0) {
        idx++
        opportunities.push({
          id: `opp-${idx}`,
          title: `Negative margin on ${row.feature_key}`,
          description: `Feature "${row.feature_key}" is losing money: margin is ${Math.round(margin)}%. Cost ($${cost.toFixed(2)}) exceeds revenue ($${revenue.toFixed(2)}).`,
          severity: 'critical',
          suggested_action: `Increase pricing for ${row.feature_key} or reduce cost by switching models.`,
          feature_key: row.feature_key,
          estimated_impact: `$${(cost - revenue).toFixed(2)} loss`,
        })
      } else if (margin < 20) {
        idx++
        opportunities.push({
          id: `opp-${idx}`,
          title: `Low margin on ${row.feature_key}`,
          description: `Feature "${row.feature_key}" has only ${Math.round(margin)}% margin. Consider adjusting pricing to improve sustainability.`,
          severity: 'warning',
          suggested_action: `Increase pricing for ${row.feature_key} by at least ${Math.round(20 - margin)}% to reach 20% margin.`,
          feature_key: row.feature_key,
          estimated_impact: `+$${((revenue * 0.2 / (1 - 0.2)) - revenue + revenue - cost).toFixed(2)} potential improvement`,
        })
      }
    }

    res.json(opportunities)
  } catch (error) {
    console.error('Get opportunities error:', error)
    res.status(500).json({ error: 'Failed to get opportunities' })
  }
})

// GET /simulations — list all simulations
app.get('/simulations', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM simulations WHERE user_id = $1 ORDER BY created_at DESC',
      [req.visitorId]
    )
    res.json(result.rows.map((row: Record<string, unknown>) => ({
      ...row,
      scenarios: row.scenarios || [],
      customer_impacts: row.customer_impacts || [],
      feature_analysis: row.feature_analysis || [],
    })))
  } catch (error) {
    console.error('List simulations error:', error)
    res.status(500).json({ error: 'Failed to list simulations' })
  }
})

// POST /simulations — create a new simulation
app.post('/simulations', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const visitorId = req.visitorId!

  // Tanso entitlement check (fail open)
  if (isTansoConfigured()) {
    try {
      const entitlement = await tansoCheckEntitlement(visitorId, 'simulations')
      if (entitlement && entitlement.allowed === false) {
        return res.status(403).json({ error: 'Simulation limit reached', usage: entitlement.usage })
      }
    } catch (err) {
      console.error('Tanso entitlement check error (simulations):', err)
    }
  }

  try {
    const { name, scenarios, time_range } = req.body
    if (!name) {
      return res.status(400).json({ error: 'Name is required' })
    }

    const result = await pool.query(
      `INSERT INTO simulations (user_id, name, scenarios, time_range, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING *`,
      [visitorId, name, JSON.stringify(scenarios || []), time_range ? JSON.stringify(time_range) : null]
    )

    const row = result.rows[0]

    // Track usage in Tanso (fail open)
    if (isTansoConfigured()) {
      try {
        await tansoIngestEvent({
          eventIdempotencyKey: crypto.randomUUID(),
          eventName: 'simulation_created',
          occurredAt: new Date().toISOString(),
          customerReferenceId: visitorId,
          featureKey: 'simulations',
          usageUnits: 1,
        })
      } catch (err) {
        console.error('Tanso usage tracking error (simulations):', err)
      }
    }

    res.json({
      ...row,
      scenarios: row.scenarios || [],
      customer_impacts: row.customer_impacts || [],
      feature_analysis: row.feature_analysis || [],
    })
  } catch (error) {
    console.error('Create simulation error:', error)
    res.status(500).json({ error: 'Failed to create simulation' })
  }
})

// GET /simulations/:id — get a single simulation
app.get('/simulations/:id', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const result = await pool.query(
      'SELECT * FROM simulations WHERE id = $1 AND user_id = $2',
      [id, req.visitorId]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Simulation not found' })
    }
    const row = result.rows[0]
    res.json({
      ...row,
      scenarios: row.scenarios || [],
      customer_impacts: row.customer_impacts || [],
      feature_analysis: row.feature_analysis || [],
    })
  } catch (error) {
    console.error('Get simulation error:', error)
    res.status(500).json({ error: 'Failed to get simulation' })
  }
})

// PUT /simulations/:id — update a simulation (including running it)
app.put('/simulations/:id', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { id } = req.params
    const updates = req.body

    // Check ownership
    const existing = await client.query(
      'SELECT * FROM simulations WHERE id = $1 AND user_id = $2',
      [id, req.visitorId]
    )
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Simulation not found' })
    }

    const sim = existing.rows[0]

    // If status is changing to 'running', compute results
    if (updates.status === 'running') {
      await client.query('BEGIN')

      // Update status to running
      await client.query(
        "UPDATE simulations SET status = 'running', updated_at = NOW() WHERE id = $1",
        [id]
      )

      const scenarios = updates.scenarios || sim.scenarios || []

      // Query feature data
      const featureResult = await client.query(
        `SELECT feature_key,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage,
           COUNT(*) as event_count
         FROM observe_events
         WHERE user_id = $1 AND feature_key IS NOT NULL
         GROUP BY feature_key`,
        [req.visitorId]
      )

      // Query customer data
      const customerResult = await client.query(
        `SELECT oe.customer_id, c.name as customer_name, c.segment,
           COALESCE(SUM(oe.cost_amount), 0) as total_cost,
           COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
         FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1
         GROUP BY oe.customer_id, c.name, c.segment`,
        [req.visitorId]
      )

      // Build feature data map
      const featureMap = new Map<string, { cost: number; revenue: number; usage: number }>()
      for (const row of featureResult.rows) {
        featureMap.set(row.feature_key, {
          cost: parseFloat(row.total_cost) || 0,
          revenue: parseFloat(row.total_revenue) || 0,
          usage: parseFloat(row.total_usage) || 0,
        })
      }

      // Helper: apply a scenario's changes to compute projected revenue per feature
      function computeScenarioProjections(changes: Array<{ feature_key: string; change_type: string; change_value: number }>) {
        const projections = new Map<string, number>()
        for (const [key, data] of featureMap.entries()) {
          let projectedRevenue = data.revenue
          const change = changes.find(c => c.feature_key === key)
          if (change) {
            switch (change.change_type) {
              case 'percentage_increase':
                projectedRevenue = data.revenue * (1 + change.change_value / 100)
                break
              case 'percentage_decrease':
                projectedRevenue = data.revenue * (1 - change.change_value / 100)
                break
              case 'flat_increase':
                projectedRevenue = data.revenue + change.change_value
                break
              case 'flat_decrease':
                projectedRevenue = data.revenue - change.change_value
                break
              case 'new_price':
                projectedRevenue = change.change_value * (data.usage || 1)
                break
            }
          }
          projections.set(key, projectedRevenue)
        }
        return projections
      }

      const totalCurrentRevenue = Array.from(featureMap.values()).reduce((s, d) => s + d.revenue, 0)
      const totalCost = Array.from(featureMap.values()).reduce((s, d) => s + d.cost, 0)
      const currentMarginPct = totalCurrentRevenue > 0 ? Math.round(((totalCurrentRevenue - totalCost) / totalCurrentRevenue) * 100) : 0

      // Compute projections for EACH scenario independently
      const updatedScenarios = scenarios.map((s: Record<string, unknown>) => {
        const changes = (s.changes as Array<{ feature_key: string; change_type: string; change_value: number }>) || []
        const projections = computeScenarioProjections(changes)
        const scenarioRevenue = Array.from(projections.values()).reduce((sum, v) => sum + v, 0)
        const scenarioMarginPct = scenarioRevenue > 0 ? Math.round(((scenarioRevenue - totalCost) / scenarioRevenue) * 100) : 0
        return {
          ...s,
          projected_revenue: scenarioRevenue,
          projected_cost: totalCost,
          projected_margin_pct: scenarioMarginPct,
        }
      })

      // Use the best scenario (highest margin) for feature analysis and customer impacts
      let bestScenario = updatedScenarios[0]
      for (const s of updatedScenarios) {
        if ((s.projected_margin_pct || 0) > (bestScenario.projected_margin_pct || 0)) {
          bestScenario = s
        }
      }

      const bestChanges = (bestScenario.changes as Array<{ feature_key: string; change_type: string; change_value: number }>) || []
      const featureProjections = computeScenarioProjections(bestChanges)
      const totalProjectedRevenue = Array.from(featureProjections.values()).reduce((s, v) => s + v, 0)
      const projectedMarginPct = totalProjectedRevenue > 0 ? Math.round(((totalProjectedRevenue - totalCost) / totalProjectedRevenue) * 100) : 0

      // Feature analysis (based on best scenario)
      const featureAnalysis = Array.from(featureMap.entries()).map(([key, data]) => {
        const projectedRevenue = featureProjections.get(key) || data.revenue
        const currentMargin = data.revenue > 0 ? Math.round(((data.revenue - data.cost) / data.revenue) * 100) : 0
        const projectedMargin = projectedRevenue > 0 ? Math.round(((projectedRevenue - data.cost) / projectedRevenue) * 100) : 0
        return {
          feature_key: key,
          current_cost: data.cost,
          current_revenue: data.revenue,
          current_margin_pct: currentMargin,
          projected_revenue: projectedRevenue,
          projected_margin_pct: projectedMargin,
          margin_delta_pct: projectedMargin - currentMargin,
        }
      })

      // Customer impacts (based on best scenario)
      const revenueRatio = totalCurrentRevenue > 0 ? totalProjectedRevenue / totalCurrentRevenue : 1
      const customerImpacts = customerResult.rows.map((row: Record<string, unknown>) => {
        const currentRevenue = parseFloat(row.total_revenue as string) || 0
        const projectedRevenue = currentRevenue * revenueRatio
        const delta = projectedRevenue - currentRevenue
        const deltaPct = currentRevenue > 0 ? Math.round((delta / currentRevenue) * 100) : 0

        let churnRisk: 'low' | 'medium' | 'high' = 'low'
        if (deltaPct > 30) churnRisk = 'high'
        else if (deltaPct > 15) churnRisk = 'medium'
        if (delta < 0) churnRisk = 'low'

        return {
          customer_id: row.customer_id as string,
          customer_name: (row.customer_name as string) || (row.customer_id as string),
          current_revenue: currentRevenue,
          projected_revenue: projectedRevenue,
          revenue_delta: delta,
          revenue_delta_pct: deltaPct,
          churn_risk: churnRisk,
          segment: (row.segment as string) || undefined,
        }
      })

      // Margin impact summary (based on best scenario)
      const marginImpact = {
        current_margin_pct: currentMarginPct,
        projected_margin_pct: projectedMarginPct,
        margin_delta_pct: projectedMarginPct - currentMarginPct,
        total_current_revenue: totalCurrentRevenue,
        total_projected_revenue: totalProjectedRevenue,
        total_cost: totalCost,
        customers_affected: customerImpacts.length,
        high_churn_risk_count: customerImpacts.filter((c: { churn_risk: string }) => c.churn_risk === 'high').length,
      }

      // Confidence score: based on data volume
      const totalEvents = featureResult.rows.reduce((s: number, r: { event_count: string }) => s + parseInt(r.event_count), 0)
      const confidenceScore = Math.min(95, Math.max(30, Math.round(40 + Math.log2(totalEvents + 1) * 10)))

      // Key insight
      const marginDelta = projectedMarginPct - currentMarginPct
      const highChurnCount = customerImpacts.filter((c: { churn_risk: string }) => c.churn_risk === 'high').length
      let keyInsight = ''
      if (marginDelta > 0) {
        keyInsight = `This pricing change would improve overall margin from ${currentMarginPct}% to ${projectedMarginPct}% (+${marginDelta}pp).`
      } else if (marginDelta < 0) {
        keyInsight = `This pricing change would reduce margin from ${currentMarginPct}% to ${projectedMarginPct}% (${marginDelta}pp).`
      } else {
        keyInsight = `This pricing change has minimal impact on overall margin (${currentMarginPct}%).`
      }
      if (highChurnCount > 0) {
        keyInsight += ` ${highChurnCount} customer${highChurnCount > 1 ? 's' : ''} at high churn risk.`
      }

      // Determine winning scenario (highest projected margin — already computed per-scenario)
      const winningScenarioId = bestScenario.id as string || null

      await client.query(
        `UPDATE simulations SET
           status = 'completed',
           scenarios = $2,
           feature_analysis = $3,
           customer_impacts = $4,
           margin_impact = $5,
           confidence_score = $6,
           key_insight = $7,
           winning_scenario_id = $8,
           updated_at = NOW()
         WHERE id = $1`,
        [
          id,
          JSON.stringify(updatedScenarios),
          JSON.stringify(featureAnalysis),
          JSON.stringify(customerImpacts),
          JSON.stringify(marginImpact),
          confidenceScore,
          keyInsight,
          winningScenarioId,
        ]
      )

      await client.query('COMMIT')

      const updated = await client.query('SELECT * FROM simulations WHERE id = $1', [id])
      const row = updated.rows[0]
      return res.json({
        ...row,
        scenarios: row.scenarios || [],
        customer_impacts: row.customer_impacts || [],
        feature_analysis: row.feature_analysis || [],
      })
    }

    // Handle roll-out
    if (updates.status === 'rolled_out') {
      await client.query(
        "UPDATE simulations SET status = 'rolled_out', rolled_out_at = NOW(), updated_at = NOW() WHERE id = $1",
        [id]
      )
      const updated = await client.query('SELECT * FROM simulations WHERE id = $1', [id])
      const row = updated.rows[0]
      return res.json({
        ...row,
        scenarios: row.scenarios || [],
        customer_impacts: row.customer_impacts || [],
        feature_analysis: row.feature_analysis || [],
      })
    }

    // Generic update
    const setClauses: string[] = ['updated_at = NOW()']
    const params: unknown[] = []
    let paramIdx = 1

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIdx++}`)
      params.push(updates.name)
    }
    if (updates.scenarios !== undefined) {
      setClauses.push(`scenarios = $${paramIdx++}`)
      params.push(JSON.stringify(updates.scenarios))
    }
    if (updates.segment_name !== undefined) {
      setClauses.push(`segment_name = $${paramIdx++}`)
      params.push(updates.segment_name)
    }
    if (updates.time_range !== undefined) {
      setClauses.push(`time_range = $${paramIdx++}`)
      params.push(JSON.stringify(updates.time_range))
    }

    params.push(id)
    await client.query(
      `UPDATE simulations SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      params
    )

    const updated = await client.query('SELECT * FROM simulations WHERE id = $1', [id])
    const row = updated.rows[0]
    res.json({
      ...row,
      scenarios: row.scenarios || [],
      customer_impacts: row.customer_impacts || [],
      feature_analysis: row.feature_analysis || [],
    })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Update simulation error:', error)
    res.status(500).json({ error: 'Failed to update simulation' })
  } finally {
    client.release()
  }
})

// DELETE /simulations/:id — delete a simulation
app.delete('/simulations/:id', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const result = await pool.query(
      'DELETE FROM simulations WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.visitorId]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Simulation not found' })
    }
    res.json({ success: true })
  } catch (error) {
    console.error('Delete simulation error:', error)
    res.status(500).json({ error: 'Failed to delete simulation' })
  }
})

// =============================================================================
// AI INSIGHTS
// =============================================================================

// GET /insights — list all insights for the session
app.get('/insights', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM ai_insights WHERE user_id = $1 ORDER BY created_at DESC',
      [req.visitorId]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('List insights error:', error)
    res.status(500).json({ error: 'Failed to list insights' })
  }
})

// POST /insights/generate — generate AI insights from observe_events data
app.post('/insights/generate', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const visitorId = req.visitorId!

  // Tanso entitlement check (fail open)
  if (isTansoConfigured()) {
    try {
      const entitlement = await tansoCheckEntitlement(visitorId, 'ai_insights')
      if (entitlement && entitlement.allowed === false) {
        return res.status(403).json({ error: 'AI insights limit reached', usage: entitlement.usage })
      }
    } catch (err) {
      console.error('Tanso entitlement check error (ai_insights):', err)
    }
  }

  try {
    // Gather summary data from observe_events
    const [featureRes, customerRes, modelRes, overallRes] = await Promise.all([
      pool.query(
        `SELECT feature_key,
           COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage
         FROM observe_events WHERE user_id = $1 AND feature_key IS NOT NULL
         GROUP BY feature_key ORDER BY total_cost DESC`,
        [req.visitorId]
      ),
      pool.query(
        `SELECT oe.customer_id, c.name as customer_name,
           COALESCE(SUM(oe.cost_amount), 0) as total_cost,
           COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
         FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1
         GROUP BY oe.customer_id, c.name ORDER BY total_cost DESC LIMIT 10`,
        [req.visitorId]
      ),
      pool.query(
        `SELECT model, model_provider,
           COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost
         FROM observe_events WHERE user_id = $1 AND model IS NOT NULL
         GROUP BY model, model_provider ORDER BY total_cost DESC`,
        [req.visitorId]
      ),
      pool.query(
        `SELECT
           COUNT(*) as total_events,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue
         FROM observe_events WHERE user_id = $1`,
        [req.visitorId]
      ),
    ])

    if (featureRes.rows.length === 0) {
      return res.status(400).json({ error: 'No data available to analyze. Load sample data or import your own first.' })
    }

    const overall = overallRes.rows[0]
    const totalCost = parseFloat(overall.total_cost) || 0
    const totalRevenue = parseFloat(overall.total_revenue) || 0
    const overallMargin = totalRevenue > 0 ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100) : 0

    // Build summary for the AI prompt
    const featureSummary = featureRes.rows.map((r: Record<string, string>) => {
      const cost = parseFloat(r.total_cost) || 0
      const revenue = parseFloat(r.total_revenue) || 0
      const margin = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0
      return `- ${r.feature_key}: cost=$${cost.toFixed(2)}, revenue=$${revenue.toFixed(2)}, margin=${margin}%, ${r.event_count} events`
    }).join('\n')

    const customerSummary = customerRes.rows.map((r: Record<string, string>) => {
      const cost = parseFloat(r.total_cost) || 0
      const revenue = parseFloat(r.total_revenue) || 0
      return `- ${r.customer_name || r.customer_id}: cost=$${cost.toFixed(2)}, revenue=$${revenue.toFixed(2)}`
    }).join('\n')

    const modelSummary = modelRes.rows.map((r: Record<string, string>) => {
      const cost = parseFloat(r.total_cost) || 0
      return `- ${r.model} (${r.model_provider || 'unknown'}): cost=$${cost.toFixed(2)}, ${r.event_count} calls`
    }).join('\n')

    const prompt = `You are an AI SaaS pricing analyst. Analyze this data and return exactly 3-5 actionable insights as a JSON array.

Overall: ${parseInt(overall.total_events)} events, total cost $${totalCost.toFixed(2)}, total revenue $${totalRevenue.toFixed(2)}, overall margin ${overallMargin}%

Features:
${featureSummary}

Top Customers:
${customerSummary}

AI Models Used:
${modelSummary}

Return a JSON array where each insight has these fields:
- insight_type: one of "margin_alert", "pricing_opportunity", "cost_optimization", "customer_risk"
- title: short headline (under 60 chars)
- description: 1-2 sentence explanation with specific numbers
- severity: one of "critical", "warning", "info", "positive"
- feature_key: the relevant feature key if applicable, or null
- customer_id: the relevant customer id if applicable, or null

Focus on: negative/low margins, cost optimization opportunities, pricing misalignment, customer concentration risk. Be specific with numbers from the data.

Return ONLY the JSON array, no markdown or explanation.`

    // Check for OpenAI API key
    const openaiKey = process.env.OPENAI_API_KEY
    let insights: Array<{
      insight_type: string
      title: string
      description: string
      severity: string
      feature_key?: string
      customer_id?: string
    }>
    let tokensUsed = 0
    let costUsd = 0

    if (openaiKey) {
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1500,
        }),
      })

      if (!openaiResponse.ok) {
        const errBody = await openaiResponse.text()
        console.error('OpenAI API error:', errBody)
        return res.status(502).json({ error: 'AI service unavailable. Check your OpenAI API key.' })
      }

      const completion = await openaiResponse.json() as {
        choices: Array<{ message: { content: string } }>
        usage?: { total_tokens: number }
      }
      const content = completion.choices[0]?.message?.content || '[]'
      tokensUsed = completion.usage?.total_tokens || 0
      const promptTokens = (completion.usage as Record<string, number>)?.prompt_tokens || 0
      const completionTokens = (completion.usage as Record<string, number>)?.completion_tokens || 0
      costUsd = promptTokens * 0.00000015 + completionTokens * 0.0000006

      try {
        const cleaned = content.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim()
        let parsed = JSON.parse(cleaned)
        // Handle wrapped responses like { "insights": [...] }
        if (!Array.isArray(parsed) && parsed.insights && Array.isArray(parsed.insights)) {
          parsed = parsed.insights
        }
        if (!Array.isArray(parsed)) {
          throw new Error('Expected JSON array from AI')
        }
        insights = parsed
      } catch {
        console.error('Failed to parse OpenAI response:', content)
        return res.status(502).json({ error: 'AI returned invalid response. Try again.' })
      }
    } else {
      // Fallback: generate insights locally without OpenAI
      insights = []

      for (const row of featureRes.rows) {
        const cost = parseFloat(row.total_cost) || 0
        const revenue = parseFloat(row.total_revenue) || 0
        const margin = revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0

        if (margin < 0) {
          insights.push({
            insight_type: 'margin_alert',
            title: `${row.feature_key} has negative margin (${margin}%)`,
            description: `This feature costs $${cost.toFixed(2)} but only generates $${revenue.toFixed(2)} in revenue. Consider raising prices or optimizing the underlying AI model costs.`,
            severity: 'critical',
            feature_key: row.feature_key,
          })
        } else if (margin < 20) {
          insights.push({
            insight_type: 'pricing_opportunity',
            title: `${row.feature_key} has low margin (${margin}%)`,
            description: `At ${margin}% margin, this feature is barely profitable. A price increase would bring it to a healthier 30%+ margin.`,
            severity: 'warning',
            feature_key: row.feature_key,
          })
        }
      }

      if (overallMargin < 30) {
        insights.push({
          insight_type: 'margin_alert',
          title: `Overall margin is ${overallMargin}% — below healthy threshold`,
          description: `Total costs ($${totalCost.toFixed(2)}) consume ${100 - overallMargin}% of revenue ($${totalRevenue.toFixed(2)}). Target 50%+ margin for SaaS sustainability.`,
          severity: overallMargin < 0 ? 'critical' : 'warning',
        })
      } else {
        insights.push({
          insight_type: 'margin_alert',
          title: `Overall margin is healthy at ${overallMargin}%`,
          description: `Revenue ($${totalRevenue.toFixed(2)}) comfortably covers costs ($${totalCost.toFixed(2)}). Focus on maintaining this margin as you scale.`,
          severity: 'positive',
        })
      }

      if (modelRes.rows.length > 1) {
        const mostExpensive = modelRes.rows[0]
        const cheapest = modelRes.rows[modelRes.rows.length - 1]
        if (parseFloat(mostExpensive.total_cost) > parseFloat(cheapest.total_cost) * 3) {
          insights.push({
            insight_type: 'cost_optimization',
            title: `${mostExpensive.model} costs ${Math.round(parseFloat(mostExpensive.total_cost) / (parseFloat(cheapest.total_cost) || 0.01))}x more than ${cheapest.model}`,
            description: `Consider routing simpler requests to ${cheapest.model} ($${parseFloat(cheapest.total_cost).toFixed(2)}) instead of ${mostExpensive.model} ($${parseFloat(mostExpensive.total_cost).toFixed(2)}) where quality permits.`,
            severity: 'info',
          })
        }
      }

      if (customerRes.rows.length >= 2) {
        const topCustomerRevenue = parseFloat(customerRes.rows[0].total_revenue) || 0
        const concentration = totalRevenue > 0 ? Math.round((topCustomerRevenue / totalRevenue) * 100) : 0
        if (concentration > 40) {
          insights.push({
            insight_type: 'customer_risk',
            title: `${customerRes.rows[0].customer_name || customerRes.rows[0].customer_id} is ${concentration}% of revenue`,
            description: `High customer concentration risk. If this customer churns, you lose $${topCustomerRevenue.toFixed(2)} (${concentration}% of total). Diversify your customer base.`,
            severity: 'warning',
            customer_id: customerRes.rows[0].customer_id,
          })
        }
      }

      insights = insights.slice(0, 5)
    }

    // Store insights
    const storedInsights = []
    for (const insight of insights) {
      const result = await pool.query(
        `INSERT INTO ai_insights (user_id, insight_type, title, description, severity, feature_key, customer_id, tokens_used, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          req.visitorId,
          insight.insight_type,
          insight.title,
          insight.description,
          insight.severity || 'info',
          insight.feature_key || null,
          insight.customer_id || null,
          tokensUsed,
          costUsd,
        ]
      )
      storedInsights.push(result.rows[0])
    }

    // Log the generation as an observe_event
    await pool.query(
      `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, cost_amount, cost_unit, source, granularity)
       VALUES ($1, 'system', 'ai_insights', 'insight_generated', $2, 'usd', 'system', 'event')`,
      [visitorId, costUsd]
    )

    // Track usage in Tanso (fail open)
    if (isTansoConfigured()) {
      try {
        await tansoIngestEvent({
          eventIdempotencyKey: crypto.randomUUID(),
          eventName: 'insights_generated',
          occurredAt: new Date().toISOString(),
          customerReferenceId: visitorId,
          featureKey: 'ai_insights',
          usageUnits: 1,
        })
      } catch (err) {
        console.error('Tanso usage tracking error (ai_insights):', err)
      }
    }

    res.json({
      insights: storedInsights,
      tokens_used: tokensUsed,
      cost_usd: costUsd,
      source: openaiKey ? 'openai' : 'local',
    })
  } catch (error) {
    console.error('Generate insights error:', error)
    res.status(500).json({ error: 'Failed to generate insights' })
  }
})

// DELETE /insights — clear all insights
app.delete('/insights', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM ai_insights WHERE user_id = $1', [req.visitorId])
    res.json({ success: true })
  } catch (error) {
    console.error('Clear insights error:', error)
    res.status(500).json({ error: 'Failed to clear insights' })
  }
})

// GET /usage/limits — return current usage for simulations and ai_insights
app.get('/usage/limits', ensureVisitor, async (req: AuthRequest, res: Response) => {
  if (!isTansoConfigured()) return res.json({ configured: false })
  const visitorId = req.visitorId!
  try {
    const [sims, insights] = await Promise.all([
      tansoCheckEntitlement(visitorId, 'simulations'),
      tansoCheckEntitlement(visitorId, 'ai_insights'),
    ])
    res.json({
      configured: true,
      simulations: { allowed: sims.allowed !== false, usage: sims.usage },
      ai_insights: { allowed: insights.allowed !== false, usage: insights.usage },
    })
  } catch {
    res.json({ configured: false })
  }
})

// =============================================================================
// TANSO MONETIZATION
// =============================================================================

function flattenEntitlements(raw: any): any[] {
  if (Array.isArray(raw)) {
    // Could be [{ subscriptionId, entitlements: [...] }] or already flat [{ featureKey, allowed }]
    if (raw.length > 0 && raw[0]?.entitlements) {
      return raw.flatMap((sub: any) => sub.entitlements || [])
    }
    return raw
  }
  const items = raw?.items || raw?.entitlements || []
  if (Array.isArray(items) && items.length > 0 && items[0]?.entitlements) {
    return items.flatMap((sub: any) => sub.entitlements || [])
  }
  return items
}

async function autoSubscribeToFreePlan(customerReferenceId: string): Promise<void> {
  try {
    // Check if already subscribed
    const customer = await tansoGetCustomer(customerReferenceId)
    if (customer?.subscriptions?.some((s: any) => s.isActive)) return

    // Find the free plan
    const plans = await tansoListPlans()
    const planItems = Array.isArray(plans) ? plans : plans?.items ?? plans?.plans ?? []
    const freePlan = planItems.find((p: any) => (p.plan?.key ?? p.key) === 'free')
    const freePlanId = freePlan?.plan?.id ?? freePlan?.id
    if (!freePlanId) {
      console.warn('No free plan found for auto-subscription')
      return
    }

    const result = await tansoCreateSubscription(customerReferenceId, freePlanId)
    // Mark the $0 invoice as paid to activate the subscription
    const invoiceId = result?.invoice?.id
    if (invoiceId) {
      await tansoMarkInvoicePaid(invoiceId)
    } else {
      // Invoice not in create response — fetch the latest unpaid one
      try {
        const invoices = await tansoListCustomerInvoices(customerReferenceId)
        const items = Array.isArray(invoices) ? invoices : invoices?.items ?? []
        const unpaid = items.find((inv: any) => inv.status !== 'PAID')
        if (unpaid?.id) await tansoMarkInvoicePaid(unpaid.id)
      } catch (invErr) {
        console.error('Failed to fetch/mark invoice for free plan:', invErr instanceof Error ? invErr.message : invErr)
      }
    }
    console.log('Auto-subscribed', customerReferenceId, 'to free plan')
  } catch (err) {
    console.error('Auto-subscribe to free plan failed:', err instanceof Error ? err.message : err)
  }
}

async function getOrCreateTansoCustomer(visitorId: string, email?: string): Promise<string | null> {
  if (!isTansoConfigured()) return null
  try {
    const existing = await pool.query('SELECT tanso_customer_id FROM tanso_customers WHERE visitor_id = $1', [visitorId])
    if (existing.rows[0]?.tanso_customer_id) return existing.rows[0].tanso_customer_id

    try {
      const customer = await tansoGetCustomer(visitorId)
      const customerId = customer?.id || customer?.subscriptions?.[0]?.customer?.id || customer?.externalClientCustomerId
      if (customerId) {
        await pool.query(
          'INSERT INTO tanso_customers (visitor_id, tanso_customer_id, email) VALUES ($1, $2, $3) ON CONFLICT (visitor_id) DO UPDATE SET tanso_customer_id = $2',
          [visitorId, customerId, email || customer?.email || null]
        )
        // Auto-subscribe if no active subscription
        if (!customer?.subscriptions?.some((s: any) => s.isActive)) {
          await autoSubscribeToFreePlan(visitorId)
        }
        return customerId
      }
    } catch (fetchErr) {
      console.warn('Tanso customer fetch failed for', visitorId, fetchErr instanceof Error ? fetchErr.message : fetchErr)
    }

    if (!email) {
      console.error('Tanso customer creation skipped: no email provided for visitor', visitorId)
      return null
    }
    try {
      const created = await tansoCreateCustomer(visitorId, email, undefined)
      const tansoId = created?.id || created?.customer?.id || null
      if (tansoId) {
        await pool.query(
          'INSERT INTO tanso_customers (visitor_id, tanso_customer_id, email) VALUES ($1, $2, $3) ON CONFLICT (visitor_id) DO UPDATE SET tanso_customer_id = $2',
          [visitorId, tansoId, email || null]
        )
        // New customer — auto-subscribe to free plan
        await autoSubscribeToFreePlan(visitorId)
      }
      return tansoId
    } catch (createErr: any) {
      // 409 = customer already exists in Tanso — retry fetch
      if (createErr?.message?.includes('409')) {
        const retryCustomer = await tansoGetCustomer(visitorId)
        const retryId = retryCustomer?.id || retryCustomer?.subscriptions?.[0]?.customer?.id || retryCustomer?.externalClientCustomerId
        if (retryId) {
          await pool.query(
            'INSERT INTO tanso_customers (visitor_id, tanso_customer_id, email) VALUES ($1, $2, $3) ON CONFLICT (visitor_id) DO UPDATE SET tanso_customer_id = $2, email = $3',
            [visitorId, retryId, email]
          )
          await autoSubscribeToFreePlan(visitorId)
          return retryId
        }
      }
      throw createErr
    }
  } catch (err) {
    console.error('Tanso customer lookup/create error:', err)
    return null
  }
}

async function checkTansoFeatureAccess(visitorId: string, featureKey: string, email?: string): Promise<{ allowed: boolean; reason?: string; usage?: number; limit?: number; remaining?: number }> {
  if (!isTansoConfigured()) return { allowed: true }
  try {
    const tansoId = await getOrCreateTansoCustomer(visitorId, email)
    if (!tansoId) return { allowed: true }
    const result = await tansoCheckEntitlement(visitorId, featureKey)
    const usageData = result?.usage
    return {
      allowed: result?.allowed !== false,
      reason: result?.reason,
      usage: usageData?.used ?? usageData?.currentUsage ?? 0,
      limit: usageData?.limit ?? usageData?.usageLimit ?? 0,
      remaining: usageData?.remaining ?? usageData?.remainingQuota ?? null,
    }
  } catch (err) {
    console.error('Tanso entitlement check error:', err)
    // Fallback: check if feature exists in customer's plan (matches SaaSSubscriptionSite pattern)
    try {
      const customer = await tansoGetCustomer(visitorId)
      const activeSub = customer?.subscriptions?.find((s: any) => s.isActive)
      if (activeSub?.plan?.id) {
        const plans = await tansoListPlans()
        const planItems = Array.isArray(plans) ? plans : plans?.items ?? plans?.plans ?? []
        const plan = planItems.find((p: any) => (p.plan?.id ?? p.id) === activeSub.plan.id)
        const features = plan?.features || []
        const hasFeature = features.some((f: any) => f.key === featureKey)
        return { allowed: hasFeature, reason: hasFeature ? undefined : 'Feature not in plan (fallback)' }
      }
    } catch (_) { /* fallback also failed — fail open */ }
    return { allowed: true }
  }
}

async function trackTansoUsage(visitorId: string, featureKey: string, eventName: string) {
  if (!isTansoConfigured()) return
  try {
    await tansoIngestEvent({
      eventIdempotencyKey: `${visitorId}-${featureKey}-${Date.now()}`,
      eventName,
      occurredAt: new Date().toISOString(),
      customerReferenceId: visitorId,
      featureKey,
    })
  } catch (err) {
    console.error('Tanso usage tracking error:', err)
  }
}

app.get('/tanso/status', ensureVisitor, async (req: AuthRequest, res: Response) => {
  if (!isTansoConfigured()) return res.json({ plans: [], entitlements: [], customer: null, configured: false })

  const visitorId = req.visitorId!
  let plansResult: any[] = []
  let entitlements: any[] = []
  let customer: any = null
  let healthy = true

  try {
    const plans = await tansoListPlans()
    plansResult = Array.isArray(plans) ? plans : plans?.items || plans?.plans || []
  } catch (err) {
    console.error('Tanso status: plans fetch failed:', err instanceof Error ? err.message : err)
    healthy = false
  }

  try {
    await getOrCreateTansoCustomer(visitorId, req.accountEmail)
  } catch (err) {
    console.error('Tanso status: customer setup failed:', err instanceof Error ? err.message : err)
  }

  try {
    const ent = await tansoListCustomerEntitlements(visitorId)
    entitlements = flattenEntitlements(ent)
  } catch (err) {
    console.error('Tanso status: entitlements fetch failed:', err instanceof Error ? err.message : err)
  }

  try {
    customer = await tansoGetCustomer(visitorId)
    // Normalize scheduledChanges on subscriptions (matches SaaSSubscriptionSite pattern)
    if (customer?.subscriptions) {
      for (const sub of customer.subscriptions) {
        // Tanso may return scheduledChange (singular) or scheduledChanges (array) or metadata.SubscriptionScheduledChanges
        if (!Array.isArray(sub.scheduledChanges) || sub.scheduledChanges.length === 0) {
          if (sub.scheduledChange) {
            sub.scheduledChanges = [{
              ...sub.scheduledChange,
              toPlanId: sub.scheduledChange.toPlanId || sub.scheduledChange.toPlan?.id,
            }]
          } else if (sub.metadata?.SubscriptionScheduledChanges) {
            sub.scheduledChanges = sub.metadata.SubscriptionScheduledChanges.flat()
          }
        }
      }
    }
  } catch (err) {
    console.error('Tanso status: customer fetch failed:', err instanceof Error ? err.message : err)
  }

  res.json({
    plans: plansResult,
    entitlements,
    customer,
    configured: true,
    healthy,
  })
})

app.get('/tanso/plans', ensureVisitor, async (_req: AuthRequest, res: Response) => {
  try {
    if (!isTansoConfigured()) return res.json({ plans: [], configured: false })
    const plans = await tansoListPlans()
    res.json({ plans: Array.isArray(plans) ? plans : plans?.items || plans?.plans || [], configured: true })
  } catch (err) {
    console.error('Tanso list plans error:', err)
    res.json({ plans: [], configured: false })
  }
})

app.get('/tanso/features', ensureVisitor, async (_req: AuthRequest, res: Response) => {
  try {
    if (!isTansoConfigured()) return res.json({ features: [], configured: false })
    const features = await tansoListFeatures()
    res.json({ features: Array.isArray(features) ? features : features?.items || features?.features || [], configured: true })
  } catch (err) {
    console.error('Tanso list features error:', err)
    res.json({ features: [], configured: false })
  }
})

app.get('/tanso/entitlements', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    if (!isTansoConfigured()) return res.json({ entitlements: [], configured: false })
    const visitorId = req.visitorId!
    await getOrCreateTansoCustomer(visitorId, req.accountEmail)
    const entitlements = await tansoListCustomerEntitlements(visitorId)
    res.json({
      entitlements: flattenEntitlements(entitlements),
      configured: true,
    })
  } catch (err) {
    console.error('Tanso entitlements error:', err)
    res.json({ entitlements: [], configured: false })
  }
})

app.get('/tanso/subscription', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    if (!isTansoConfigured()) return res.json({ customer: null, configured: false })
    const visitorId = req.visitorId!
    await getOrCreateTansoCustomer(visitorId, req.accountEmail)
    const customer = await tansoGetCustomer(visitorId)
    res.json({ customer, configured: true })
  } catch (err) {
    console.error('Tanso subscription error:', err)
    res.json({ customer: null, configured: false })
  }
})

// Subscribe / upgrade / downgrade — matches SaaSSubscriptionSite Checkout.tsx pattern
app.post('/tanso/subscribe', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    if (!isTansoConfigured()) return res.status(503).json({ error: 'Billing not configured' })
    const visitorId = req.visitorId!
    const { planId } = req.body
    if (!planId) return res.status(400).json({ error: 'planId is required' })
    await getOrCreateTansoCustomer(visitorId, req.accountEmail)

    // Get current subscription state
    let activeSub: any = null
    try {
      const customer = await tansoGetCustomer(visitorId)
      activeSub = customer?.subscriptions?.find((s: any) => s.isActive)
    } catch (_) { /* no existing customer — will create new subscription */ }

    // Same plan — no-op
    if (activeSub?.plan?.id === planId) {
      return res.json({ success: true, subscription: activeSub })
    }

    // ── PLAN CHANGE (upgrade or downgrade) ──
    if (activeSub) {
      const currentPrice = activeSub.plan?.priceAmount ?? 0
      const plans = await tansoListPlans()
      const planItems = Array.isArray(plans) ? plans : plans?.items ?? plans?.plans ?? []
      const targetPlan = planItems.find((p: any) => (p.plan?.id ?? p.id) === planId)
      const targetPrice = targetPlan?.plan?.priceAmount ?? targetPlan?.priceAmount ?? 0

      if (targetPrice > currentPrice) {
        // UPGRADE — immediate, skip invoice payment (reference: Checkout.tsx line 112-115)
        await tansoChangeSubscriptionPlan(activeSub.id, planId, 'UPGRADE')
        const updated = await tansoGetCustomer(visitorId)
        const newSub = updated?.subscriptions?.find((s: any) => s.isActive)
        return res.json({ success: true, subscription: newSub, changeType: 'upgrade' })
      } else {
        // DOWNGRADE — scheduled for end of billing period (reference: Pricing.tsx line 205-236)
        await tansoChangeSubscriptionPlan(activeSub.id, planId, 'DOWNGRADE')
        const updated = await tansoGetCustomer(visitorId)
        const newSub = updated?.subscriptions?.find((s: any) => s.isActive)
        return res.json({ success: true, subscription: newSub, changeType: 'downgrade' })
      }
    }

    // ── NEW SUBSCRIPTION ──
    const result = await tansoCreateSubscription(visitorId, planId)
    const subscription = result?.subscription ?? result

    // Find unpaid invoice (reference: Checkout.tsx lines 147-167)
    let invoice: any = null
    try {
      const invoices = await tansoListCustomerInvoices(visitorId)
      const items = Array.isArray(invoices) ? invoices : invoices?.items ?? []
      invoice = items
        .filter((inv: any) => inv.status !== 'PAID')
        .sort((a: any, b: any) => new Date(b.dueDate || b.createdAt || 0).getTime() - new Date(a.dueDate || a.createdAt || 0).getTime())[0]
    } catch (invErr) {
      console.error('Failed to fetch invoices:', invErr)
    }

    if (!invoice?.id) {
      return res.json({ success: true, subscription })
    }

    // Paid plan — try Stripe checkout, fall back to mark-paid (reference: Checkout.tsx lines 173-206)
    if (invoice.amount > 0) {
      try {
        const checkout = await tansoCreateCheckoutSession(invoice.id)
        if (checkout?.url) {
          return res.json({ success: true, subscription, checkoutUrl: checkout.url })
        }
      } catch (checkoutErr) {
        console.error('Stripe checkout session error:', checkoutErr)
      }
      // Stripe not configured — demo mode: mark invoice as paid
      try { await tansoMarkInvoicePaid(invoice.id) } catch (_) { /* best effort */ }
      return res.json({ success: true, subscription })
    }

    // Free plan ($0 invoice) — mark as paid to activate
    try { await tansoMarkInvoicePaid(invoice.id) } catch (_) { /* best effort */ }
    res.json({ success: true, subscription })
  } catch (err) {
    console.error('Tanso subscribe error:', err)
    res.status(500).json({ error: 'Failed to create subscription' })
  }
})

// Cancel subscription (supports IMMEDIATELY or END_OF_PERIOD)
app.post('/tanso/cancel', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    if (!isTansoConfigured()) return res.status(503).json({ error: 'Billing not configured' })
    const { subscriptionId, cancelMode = 'IMMEDIATELY' } = req.body
    if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required' })

    // Cancel any scheduled plan changes first to avoid conflicting states
    try {
      await tansoCancelScheduledPlanChanges(subscriptionId)
    } catch (_) { /* may not have scheduled changes */ }

    const result = await tansoCancelSubscription(subscriptionId, cancelMode)
    res.json({ success: true, subscription: result })
  } catch (err) {
    console.error('Tanso cancel error:', err)
    res.status(500).json({ error: 'Failed to cancel subscription' })
  }
})

// Reactivate — cancel a scheduled cancellation (keep subscription active)
app.post('/tanso/reactivate', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    if (!isTansoConfigured()) return res.status(503).json({ error: 'Billing not configured' })
    const { subscriptionId } = req.body
    if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required' })

    await tansoCancelScheduledCancellation(subscriptionId)
    res.json({ success: true })
  } catch (err) {
    console.error('Tanso reactivate error:', err)
    res.status(500).json({ error: 'Failed to reactivate subscription' })
  }
})

// Cancel a pending downgrade
app.post('/tanso/cancel-scheduled-changes', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    if (!isTansoConfigured()) return res.status(503).json({ error: 'Billing not configured' })
    const { subscriptionId } = req.body
    if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required' })

    await tansoCancelScheduledPlanChanges(subscriptionId)
    res.json({ success: true })
  } catch (err) {
    console.error('Tanso cancel scheduled changes error:', err)
    res.status(500).json({ error: 'Failed to cancel scheduled changes' })
  }
})

app.get('/tanso/check/:featureKey', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    const { featureKey } = req.params
    const result = await checkTansoFeatureAccess(visitorId, featureKey, req.accountEmail)
    res.json(result)
  } catch (err) {
    console.error('Tanso check error:', err)
    res.json({ allowed: true })
  }
})

// =============================================================================
// OPENAI & ANTHROPIC INTEGRATION ROUTES
// =============================================================================

// POST /integrations/openai/connect - Validate OpenAI API key and store connection
app.post('/integrations/openai/connect', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    const { api_key } = req.body

    if (!api_key || typeof api_key !== 'string') {
      return res.status(400).json({ error: 'api_key is required' })
    }

    // Validate key by calling OpenAI models endpoint
    const validationResponse = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${api_key}` },
    })

    if (!validationResponse.ok) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OpenAI API key. Please check your key and try again.',
      })
    }

    // Store the connection
    const keyPrefix = api_key.substring(0, 8) + '...'

    // Try to fetch and sync usage data
    let hasUsageAccess = false
    let totalCostSynced = 0
    let eventsSynced = 0

    try {
      const now = Math.floor(Date.now() / 1000)
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60

      const usageResponse = await fetch(
        `https://api.openai.com/v1/organization/usage/completions?start_time=${thirtyDaysAgo}&end_time=${now}&bucket_width=1d`,
        { headers: { 'Authorization': `Bearer ${api_key}` } }
      )

      if (usageResponse.ok) {
        hasUsageAccess = true
        const usageData = await usageResponse.json() as {
          data?: Array<{
            results?: Array<{
              snapshot_id?: string;
              input_tokens?: number;
              output_tokens?: number;
            }>;
            start_time?: number;
          }>;
        }

        const openaiPricing: Record<string, { input: number; output: number }> = {
          'gpt-4o': { input: 2.5, output: 10.0 },
          'gpt-4o-mini': { input: 0.15, output: 0.6 },
          'gpt-4': { input: 30.0, output: 60.0 },
          'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
          'o1': { input: 15.0, output: 60.0 },
          'o1-mini': { input: 3.0, output: 12.0 },
          'text-embedding-3-small': { input: 0.02, output: 0 },
        }
        const defaultPricing = { input: 2.5, output: 10.0 }

        if (usageData.data && Array.isArray(usageData.data)) {
          for (const bucket of usageData.data) {
            const bucketTime = bucket.start_time ? new Date(bucket.start_time * 1000).toISOString() : new Date().toISOString()

            if (bucket.results && Array.isArray(bucket.results)) {
              for (const result of bucket.results) {
                const modelName = result.snapshot_id || 'unknown'
                const inputTokens = result.input_tokens || 0
                const outputTokens = result.output_tokens || 0

                // Find matching pricing by checking if model name starts with a known prefix
                let pricing = defaultPricing
                for (const [key, value] of Object.entries(openaiPricing)) {
                  if (modelName.startsWith(key)) {
                    pricing = value
                    break
                  }
                }

                const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000

                if (cost > 0) {
                  await pool.query(
                    `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, revenue_amount, usage_units, model, model_provider, source, granularity)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                    [visitorId, 'system', 'openai_usage', 'cost', bucketTime, cost, 'usd', 0, inputTokens + outputTokens, modelName, 'openai', 'openai', 'daily']
                  )
                  totalCostSynced += cost
                  eventsSynced++
                }
              }
            }
          }
        }

        // Update has_usage_access and last_synced_at
        if (eventsSynced > 0) {
          await pool.query(
            `INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()`,
            [visitorId, 'user']
          )
        }
      } else if (usageResponse.status === 403) {
        // No admin access - skip usage sync, still store the connection
        console.log(`OpenAI usage API returned 403 for user ${visitorId} - no admin access`)
      }
    } catch (syncErr) {
      console.error('OpenAI usage sync error (connection will still succeed):', syncErr)
    }

    await pool.query(
      `INSERT INTO integrations (user_id, provider, api_key_prefix, has_usage_access, connected_at)
       VALUES ($1, 'openai', $2, $3, NOW())
       ON CONFLICT (user_id, provider)
       DO UPDATE SET api_key_prefix = $2, has_usage_access = $3, connected_at = NOW()`,
      [visitorId, keyPrefix, hasUsageAccess]
    )

    // Track OpenAI sync usage in Tanso
    trackTansoUsage(visitorId, 'openai_sync', 'openai_connected')

    res.json({
      success: true,
      message: 'OpenAI connected successfully',
      has_usage_access: hasUsageAccess,
      cost_synced: Math.round(totalCostSynced * 100) / 100,
      months_synced: eventsSynced > 0 ? 1 : 0,
    })
  } catch (err) {
    console.error('OpenAI connect error:', err)
    res.status(500).json({ error: 'Failed to connect OpenAI' })
  }
})

// GET /integrations/openai/status - Check OpenAI connection status
app.get('/integrations/openai/status', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    const result = await pool.query(
      `SELECT api_key_prefix, has_usage_access, connected_at, last_synced_at
       FROM integrations WHERE user_id = $1 AND provider = 'openai'`,
      [visitorId]
    )

    if (result.rows.length === 0) {
      return res.json({ connected: false, has_usage_access: false })
    }

    const row = result.rows[0]
    res.json({
      connected: true,
      has_usage_access: row.has_usage_access,
      api_key_prefix: row.api_key_prefix,
      connected_at: row.connected_at,
      last_synced_at: row.last_synced_at,
    })
  } catch (err) {
    console.error('OpenAI status error:', err)
    res.status(500).json({ error: 'Failed to check OpenAI status' })
  }
})

// POST /integrations/openai/disconnect - Disconnect OpenAI
app.post('/integrations/openai/disconnect', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM integrations WHERE user_id = $1 AND provider = $2', [req.visitorId, 'openai'])
    res.json({ success: true })
  } catch (err) {
    console.error('OpenAI disconnect error:', err)
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

// POST /integrations/anthropic/connect - Validate Anthropic API key and store connection
app.post('/integrations/anthropic/connect', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    const { api_key } = req.body

    if (!api_key || typeof api_key !== 'string') {
      return res.status(400).json({ error: 'api_key is required' })
    }

    // Validate key by calling Anthropic messages endpoint with minimal body
    const validationResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': api_key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })

    // A valid key will return 200 or a non-401 status
    if (validationResponse.status === 401 || validationResponse.status === 403) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Anthropic API key. Please check your key and try again.',
      })
    }

    // Store the connection
    const keyPrefix = api_key.substring(0, 10) + '...'

    // Try to fetch and sync usage data
    let hasUsageAccess = false
    let totalCostSynced = 0
    let eventsSynced = 0

    try {
      const today = new Date()
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
      const todayISO = today.toISOString().split('T')[0]
      const thirtyDaysAgoISO = thirtyDaysAgo.toISOString().split('T')[0]

      const usageResponse = await fetch(
        `https://api.anthropic.com/v1/organizations/usage?start_date=${thirtyDaysAgoISO}&end_date=${todayISO}`,
        {
          headers: {
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
          },
        }
      )

      if (usageResponse.ok) {
        hasUsageAccess = true
        const usageData = await usageResponse.json() as {
          data?: Array<{
            model?: string;
            input_tokens?: number;
            output_tokens?: number;
            date?: string;
          }>;
        }

        const anthropicPricing: Record<string, { input: number; output: number }> = {
          'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
          'claude-3-5-haiku': { input: 0.8, output: 4.0 },
          'claude-3-opus': { input: 15.0, output: 75.0 },
          'claude-3-haiku': { input: 0.25, output: 1.25 },
        }
        const defaultPricing = { input: 3.0, output: 15.0 }

        if (usageData.data && Array.isArray(usageData.data)) {
          for (const entry of usageData.data) {
            const modelName = entry.model || 'unknown'
            const inputTokens = entry.input_tokens || 0
            const outputTokens = entry.output_tokens || 0
            const entryDate = entry.date ? new Date(entry.date).toISOString() : new Date().toISOString()

            // Find matching pricing by checking if model name starts with a known prefix
            let pricing = defaultPricing
            for (const [key, value] of Object.entries(anthropicPricing)) {
              if (modelName.startsWith(key)) {
                pricing = value
                break
              }
            }

            const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000

            if (cost > 0) {
              await pool.query(
                `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, revenue_amount, usage_units, model, model_provider, source, granularity)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [visitorId, 'system', 'anthropic_usage', 'cost', entryDate, cost, 'usd', 0, inputTokens + outputTokens, modelName, 'anthropic', 'anthropic', 'daily']
              )
              totalCostSynced += cost
              eventsSynced++
            }
          }
        }

        // Update data_mode to 'user' if we synced any data
        if (eventsSynced > 0) {
          await pool.query(
            `INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()`,
            [visitorId, 'user']
          )
        }
      } else if (usageResponse.status === 403) {
        // No admin access - skip usage sync, still store the connection
        console.log(`Anthropic usage API returned 403 for user ${visitorId} - no admin access`)
      }
    } catch (syncErr) {
      console.error('Anthropic usage sync error (connection will still succeed):', syncErr)
    }

    await pool.query(
      `INSERT INTO integrations (user_id, provider, api_key_prefix, has_usage_access, connected_at)
       VALUES ($1, 'anthropic', $2, $3, NOW())
       ON CONFLICT (user_id, provider)
       DO UPDATE SET api_key_prefix = $2, has_usage_access = $3, connected_at = NOW()`,
      [visitorId, keyPrefix, hasUsageAccess]
    )

    // Track Anthropic sync usage in Tanso
    trackTansoUsage(visitorId, 'anthropic_sync', 'anthropic_connected')

    res.json({
      success: true,
      message: 'Anthropic connected successfully',
      has_usage_access: hasUsageAccess,
      cost_synced: Math.round(totalCostSynced * 100) / 100,
      months_synced: eventsSynced > 0 ? 1 : 0,
    })
  } catch (err) {
    console.error('Anthropic connect error:', err)
    res.status(500).json({ error: 'Failed to connect Anthropic' })
  }
})

// GET /integrations/anthropic/status - Check Anthropic connection status
app.get('/integrations/anthropic/status', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    const result = await pool.query(
      `SELECT api_key_prefix, has_usage_access, connected_at, last_synced_at
       FROM integrations WHERE user_id = $1 AND provider = 'anthropic'`,
      [visitorId]
    )

    if (result.rows.length === 0) {
      return res.json({ connected: false, has_usage_access: false })
    }

    const row = result.rows[0]
    res.json({
      connected: true,
      has_usage_access: row.has_usage_access,
      api_key_prefix: row.api_key_prefix,
      connected_at: row.connected_at,
      last_synced_at: row.last_synced_at,
    })
  } catch (err) {
    console.error('Anthropic status error:', err)
    res.status(500).json({ error: 'Failed to check Anthropic status' })
  }
})

// POST /integrations/anthropic/disconnect - Disconnect Anthropic
app.post('/integrations/anthropic/disconnect', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM integrations WHERE user_id = $1 AND provider = $2', [req.visitorId, 'anthropic'])
    res.json({ success: true })
  } catch (err) {
    console.error('Anthropic disconnect error:', err)
    res.status(500).json({ error: 'Failed to disconnect' })
  }
})

// =============================================================================
// REFERRAL SYSTEM
// =============================================================================

// Helper: convert a pending referral to 'converted' and grant a Stripe promo code to the referrer
async function convertReferralIfPending(visitorId: string): Promise<void> {
  try {
    // Find the pending referral where this user is the referred party
    const result = await pool.query(
      `UPDATE referrals SET status = 'converted', credited_at = NOW()
       WHERE referred_user_id = $1 AND status = 'pending'
       RETURNING id, referrer_user_id`,
      [visitorId]
    )
    if (result.rows.length === 0) return

    const { id: referralId, referrer_user_id } = result.rows[0]

    // Create a Stripe promo code for 1 free month of Pro
    try {
      const stripe = await getUncachableStripeClient()

      // Create a one-time 100% off coupon for 1 month
      const coupon = await stripe.coupons.create({
        percent_off: 100,
        duration: 'once',
        name: `Referral reward — 1 month free Pro`,
        metadata: { referral_id: String(referralId), referrer_user_id },
      })

      // Create a unique promo code from this coupon
      const promoCode = await stripe.promotionCodes.create({
        promotion: { type: 'coupon', coupon: coupon.id },
        max_redemptions: 1,
        metadata: { referral_id: String(referralId), referrer_user_id },
      })

      // Store the promo code for the referrer
      await pool.query(
        `INSERT INTO referral_credits (user_id, credit_type, amount, source_referral_id, promo_code, stripe_promo_id)
         VALUES ($1, 'promo_month', 1, $2, $3, $4)`,
        [referrer_user_id, referralId, promoCode.code, promoCode.id]
      )
    } catch (stripeErr) {
      console.error('Failed to create Stripe promo code for referral:', stripeErr)
      // Fallback: still record the credit without a promo code
      await pool.query(
        `INSERT INTO referral_credits (user_id, credit_type, amount, source_referral_id)
         VALUES ($1, 'promo_month', 1, $2)`,
        [referrer_user_id, referralId]
      )
    }
  } catch (err) {
    // Non-critical — don't fail the data load
    console.error('Referral conversion error:', err)
  }
}

// GET /referral/code - Get or create a referral code for the current user
app.get('/referral/code', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    // Check if user already has a code
    const existing = await pool.query(
      `SELECT code FROM referral_codes WHERE user_id = $1`,
      [visitorId]
    )
    if (existing.rows.length > 0) {
      return res.json({ code: existing.rows[0].code })
    }
    // Generate a unique code
    const code = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
    await pool.query(
      `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)`,
      [visitorId, code]
    )
    res.json({ code })
  } catch (err) {
    console.error('Referral code error:', err)
    res.status(500).json({ error: 'Failed to get referral code' })
  }
})

// POST /referral/record - Record that the current user was referred by a code
app.post('/referral/record', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    const { code } = req.body
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Referral code is required' })
    }
    // Check if this user was already referred
    const existingReferral = await pool.query(
      `SELECT id FROM referrals WHERE referred_user_id = $1`,
      [visitorId]
    )
    if (existingReferral.rows.length > 0) {
      return res.json({ success: true, already_recorded: true })
    }
    // Look up the referral code
    const codeResult = await pool.query(
      `SELECT user_id FROM referral_codes WHERE code = $1`,
      [code]
    )
    if (codeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid referral code' })
    }
    const referrerUserId = codeResult.rows[0].user_id
    // Don't allow self-referral
    if (referrerUserId === visitorId) {
      return res.status(400).json({ error: 'Cannot use your own referral code' })
    }
    // Record the referral
    await pool.query(
      `INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code, status)
       VALUES ($1, $2, $3, 'pending')`,
      [referrerUserId, visitorId, code]
    )

    // Track referral usage in Tanso for both referrer and referred user
    trackTansoUsage(referrerUserId, 'referrals', 'referral_shared')

    res.json({ success: true })
  } catch (err) {
    console.error('Record referral error:', err)
    res.status(500).json({ error: 'Failed to record referral' })
  }
})

// GET /referral/stats - Get referral statistics for the current user
app.get('/referral/stats', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!

    // Get or create referral code
    let codeResult = await pool.query(
      `SELECT code FROM referral_codes WHERE user_id = $1`,
      [visitorId]
    )
    if (codeResult.rows.length === 0) {
      const code = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
      await pool.query(
        `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)`,
        [visitorId, code]
      )
      codeResult = { rows: [{ code }] } as any
    }
    const code = codeResult.rows[0].code

    // Count referrals by status
    const statsResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total_referrals,
         COUNT(*) FILTER (WHERE status = 'converted')::int AS converted_referrals,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_referrals
       FROM referrals WHERE referrer_user_id = $1`,
      [visitorId]
    )

    // Get promo codes earned from referrals
    const promosResult = await pool.query(
      `SELECT promo_code, used_at, created_at
       FROM referral_credits WHERE user_id = $1 ORDER BY created_at DESC`,
      [visitorId]
    )

    const stats = statsResult.rows[0]
    res.json({
      code,
      total_referrals: stats.total_referrals,
      converted_referrals: stats.converted_referrals,
      pending_referrals: stats.pending_referrals,
      promos: promosResult.rows.map((r: any) => ({
        code: r.promo_code,
        used: !!r.used_at,
        created_at: r.created_at,
      })),
    })
  } catch (err) {
    console.error('Referral stats error:', err)
    res.status(500).json({ error: 'Failed to get referral stats' })
  }
})

// Integration requests (notify me / request integration)
app.post('/integration-requests', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const { integration_name, request_type } = req.body
    if (!integration_name) {
      return res.status(400).json({ error: 'integration_name is required' })
    }
    await pool.query(
      `INSERT INTO integration_requests (user_id, integration_name, request_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, integration_name) DO NOTHING`,
      [req.visitorId, integration_name, request_type || 'notify']
    )
    res.json({ success: true })
  } catch (error) {
    console.error('Integration request error:', error)
    res.status(500).json({ error: 'Failed to save request' })
  }
})

// =============================================================================
// TEAM / ORGANIZATION
// =============================================================================

// Helper: get or create org for a visitor
async function getOrCreateOrg(visitorId: string) {
  // Check if visitor already has an org
  const mapResult = await pool.query(
    'SELECT org_id FROM visitor_org_map WHERE visitor_id = $1',
    [visitorId]
  )
  if (mapResult.rows.length > 0) {
    const orgId = mapResult.rows[0].org_id
    const orgResult = await pool.query('SELECT * FROM organizations WHERE id = $1', [orgId])
    return orgResult.rows[0]
  }

  // Create new org
  const orgResult = await pool.query(
    'INSERT INTO organizations (name, owner_visitor_id) VALUES ($1, $2) RETURNING *',
    ['My Team', visitorId]
  )
  const org = orgResult.rows[0]

  // Map visitor to org
  await pool.query(
    'INSERT INTO visitor_org_map (visitor_id, org_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [visitorId, org.id]
  )

  // Add visitor as admin member
  await pool.query(
    `INSERT INTO organization_members (org_id, visitor_id, role, status, joined_at)
     VALUES ($1, $2, 'admin', 'active', NOW())`,
    [org.id, visitorId]
  )

  return org
}

// GET /team - get current user's org info and members
app.get('/team', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    const org = await getOrCreateOrg(visitorId)

    const membersResult = await pool.query(
      `SELECT om.*, a.email AS account_email, a.name AS account_name
       FROM organization_members om
       LEFT JOIN accounts a ON a.visitor_id = om.visitor_id
       WHERE om.org_id = $1
       ORDER BY om.created_at ASC`,
      [org.id]
    )

    // Merge account email into invited_email for display if not already set
    const members = membersResult.rows.map((m: any) => ({
      ...m,
      invited_email: m.invited_email || m.account_email || null,
      account_name: undefined,
      account_email: undefined,
    }))

    // Find current user's role
    const myMember = members.find((m: any) => m.visitor_id === visitorId)
    const myRole = myMember?.role || 'viewer'

    res.json({
      org,
      members,
      my_role: myRole,
    })
  } catch (err) {
    console.error('GET /team error:', err)
    res.status(500).json({ error: 'Failed to load team info' })
  }
})

// PATCH /team/name - rename the org
app.patch('/team/name', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    const { name } = req.body
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Name is required' })
    }
    if (name.trim().length > 100) {
      return res.status(400).json({ error: 'Name must be 100 characters or fewer' })
    }

    const org = await getOrCreateOrg(visitorId)

    // Check admin
    const memberResult = await pool.query(
      'SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2',
      [org.id, visitorId]
    )
    if (!memberResult.rows.length || memberResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can rename the team' })
    }

    await pool.query('UPDATE organizations SET name = $1 WHERE id = $2', [name, org.id])
    res.json({ success: true })
  } catch (err) {
    console.error('PATCH /team/name error:', err)
    res.status(500).json({ error: 'Failed to rename team' })
  }
})

// POST /team/invite - create an invite
app.post('/team/invite', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    const { email, role } = req.body

    const org = await getOrCreateOrg(visitorId)

    // Check admin
    const memberResult = await pool.query(
      'SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2',
      [org.id, visitorId]
    )
    if (!memberResult.rows.length || memberResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can invite members' })
    }

    const validRole = role === 'admin' ? 'admin' : 'viewer'
    const normalizedEmail = email ? email.trim().toLowerCase() : null

    // Prevent duplicate invites for the same email
    if (normalizedEmail) {
      const existing = await pool.query(
        `SELECT id, status FROM organization_members WHERE org_id = $1 AND LOWER(invited_email) = $2`,
        [org.id, normalizedEmail]
      )
      if (existing.rows.length > 0) {
        const match = existing.rows[0]
        if (match.status === 'active') {
          return res.status(409).json({ error: 'This person is already a team member' })
        }
        // Replace the stale pending invite
        await pool.query('DELETE FROM organization_members WHERE id = $1', [match.id])
      }
    }

    const inviteToken = crypto.randomUUID()

    await pool.query(
      `INSERT INTO organization_members (org_id, invited_email, invite_token, role, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [org.id, normalizedEmail, inviteToken, validRole]
    )

    res.json({ success: true, invite_token: inviteToken })
  } catch (err) {
    console.error('POST /team/invite error:', err)
    res.status(500).json({ error: 'Failed to create invite' })
  }
})

// GET /team/invite/:token - get invite info (no auth required)
app.get('/team/invite/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params
    const result = await pool.query(
      `SELECT om.invited_email, om.role, o.name AS org_name
       FROM organization_members om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.invite_token = $1 AND om.status = 'pending'`,
      [token]
    )

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Invite not found or already used' })
    }

    const row = result.rows[0]
    res.json({
      org_name: row.org_name,
      invited_email: row.invited_email,
      role: row.role,
    })
  } catch (err) {
    console.error('GET /team/invite/:token error:', err)
    res.status(500).json({ error: 'Failed to get invite info' })
  }
})

// POST /team/join/:token - accept an invite
app.post('/team/join/:token', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    const { token } = req.params

    const result = await pool.query(
      `SELECT om.*, o.id AS organization_id
       FROM organization_members om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.invite_token = $1 AND om.status = 'pending'`,
      [token]
    )

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Invite not found or already used' })
    }

    const invite = result.rows[0]

    // Update invite to active
    await pool.query(
      `UPDATE organization_members
       SET visitor_id = $1, status = 'active', joined_at = NOW(), invite_token = NULL
       WHERE id = $2`,
      [visitorId, invite.id]
    )

    // Map visitor to org (overwrite any existing mapping)
    await pool.query(
      `INSERT INTO visitor_org_map (visitor_id, org_id) VALUES ($1, $2)
       ON CONFLICT (visitor_id) DO UPDATE SET org_id = $2`,
      [visitorId, invite.organization_id]
    )

    res.json({ success: true, org_id: String(invite.organization_id), role: invite.role })
  } catch (err) {
    console.error('POST /team/join/:token error:', err)
    res.status(500).json({ error: 'Failed to accept invite' })
  }
})

// PATCH /team/members/:id - update member role
app.patch('/team/members/:id', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    const memberId = req.params.id
    const { role } = req.body

    if (!role || !['admin', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' })
    }

    const org = await getOrCreateOrg(visitorId)

    // Check admin
    const adminCheck = await pool.query(
      'SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2',
      [org.id, visitorId]
    )
    if (!adminCheck.rows.length || adminCheck.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can change roles' })
    }

    // Prevent demoting yourself if you're the last admin
    const targetMember = await pool.query(
      'SELECT * FROM organization_members WHERE id = $1 AND org_id = $2',
      [memberId, org.id]
    )
    if (!targetMember.rows.length) {
      return res.status(404).json({ error: 'Member not found' })
    }

    if (targetMember.rows[0].visitor_id === visitorId && role !== 'admin') {
      const adminCount = await pool.query(
        "SELECT COUNT(*) FROM organization_members WHERE org_id = $1 AND role = 'admin' AND status = 'active'",
        [org.id]
      )
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return res.status(400).json({ error: 'Cannot demote yourself — you are the only admin' })
      }
    }

    // Update the target member (must be in same org)
    const updateResult = await pool.query(
      'UPDATE organization_members SET role = $1 WHERE id = $2 AND org_id = $3 RETURNING id',
      [role, memberId, org.id]
    )

    if (!updateResult.rows.length) {
      return res.status(404).json({ error: 'Member not found' })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('PATCH /team/members/:id error:', err)
    res.status(500).json({ error: 'Failed to update role' })
  }
})

// DELETE /team/members/:id - remove a member
app.delete('/team/members/:id', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!
    const memberId = req.params.id

    const org = await getOrCreateOrg(visitorId)

    // Check admin
    const adminCheck = await pool.query(
      'SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2',
      [org.id, visitorId]
    )
    if (!adminCheck.rows.length || adminCheck.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can remove members' })
    }

    // Get the member to remove
    const memberResult = await pool.query(
      'SELECT * FROM organization_members WHERE id = $1 AND org_id = $2',
      [memberId, org.id]
    )
    if (!memberResult.rows.length) {
      return res.status(404).json({ error: 'Member not found' })
    }

    const member = memberResult.rows[0]

    // Don't allow removing yourself
    if (member.visitor_id === visitorId) {
      return res.status(400).json({ error: 'Cannot remove yourself' })
    }

    // Remove visitor-org mapping if they have one
    if (member.visitor_id) {
      await pool.query(
        'DELETE FROM visitor_org_map WHERE visitor_id = $1 AND org_id = $2',
        [member.visitor_id, org.id]
      )
    }

    await pool.query('DELETE FROM organization_members WHERE id = $1', [memberId])
    res.json({ success: true })
  } catch (err) {
    console.error('DELETE /team/members/:id error:', err)
    res.status(500).json({ error: 'Failed to remove member' })
  }
})

// GET /team/my-role - get current user's role
app.get('/team/my-role', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!

    const mapResult = await pool.query(
      'SELECT org_id FROM visitor_org_map WHERE visitor_id = $1',
      [visitorId]
    )

    if (!mapResult.rows.length) {
      return res.json({ role: 'admin', org_id: '' })
    }

    const orgId = mapResult.rows[0].org_id
    const memberResult = await pool.query(
      'SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2',
      [orgId, visitorId]
    )

    res.json({
      role: memberResult.rows.length ? memberResult.rows[0].role : 'viewer',
      org_id: String(orgId),
    })
  } catch (err) {
    console.error('GET /team/my-role error:', err)
    res.status(500).json({ error: 'Failed to get role' })
  }
})

// Local dev: start server directly
if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT) || 5000
  ensureDbInitialized().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Backend server running on http://0.0.0.0:${PORT}`)
    })
  }).catch((error) => {
    console.error('Failed to start server:', error)
    process.exit(1)
  })
}

// Vercel serverless export
export default app
