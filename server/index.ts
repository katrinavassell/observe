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
  effectiveUserId?: string
  myRole?: string
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

    // Determine effective user ID for data isolation:
    // If this visitor is mapped to an org, use the org owner's visitor_id for data queries
    const orgMapping = await pool.query(
      `SELECT vm.org_id, o.owner_visitor_id, om.role
       FROM visitor_org_map vm
       JOIN organizations o ON vm.org_id = o.id
       LEFT JOIN organization_members om ON om.org_id = vm.org_id AND om.visitor_id = $1 AND om.status = 'active'
       WHERE vm.visitor_id = $1`,
      [req.effectiveUserId!]
    )
    if (orgMapping.rows.length > 0) {
      req.effectiveUserId = orgMapping.rows[0].owner_visitor_id
      req.myRole = orgMapping.rows[0].role || 'viewer'
    } else {
      req.effectiveUserId = req.visitorId
      req.myRole = 'admin'
    }

    next()
  } catch (error) {
    console.error('Visitor session error:', error)
    res.status(500).json({ error: 'Session error' })
  }
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.myRole !== 'admin') {
    return res.status(403).json({ error: 'Only admins can perform this action' })
  }
  next()
}

app.get('/session/init', ensureVisitor, async (req: AuthRequest, res: Response) => {
  res.json({ visitorId: req.visitorId, role: req.myRole || 'admin' })
})

app.get('/data/status', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const statusResult = await pool.query('SELECT * FROM user_data_status WHERE user_id = $1', [req.effectiveUserId!])
    const customersResult = await pool.query('SELECT COUNT(*) FROM customers WHERE user_id = $1', [req.effectiveUserId!])
    const costsResult = await pool.query('SELECT COUNT(*) FROM cost_records WHERE user_id = $1', [req.effectiveUserId!])
    const usageResult = await pool.query('SELECT COUNT(*) FROM usage_records WHERE user_id = $1', [req.effectiveUserId!])

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
      [req.effectiveUserId!]
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
      [req.effectiveUserId!]
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
      [req.effectiveUserId!]
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
      [req.effectiveUserId!]
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
      [req.effectiveUserId!]
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
      pool.query('SELECT * FROM plans WHERE user_id = $1', [req.effectiveUserId!]),
      pool.query('SELECT * FROM customers WHERE user_id = $1', [req.effectiveUserId!]),
      pool.query('SELECT * FROM subscriptions WHERE user_id = $1', [req.effectiveUserId!]),
      pool.query('SELECT * FROM usage_records WHERE user_id = $1', [req.effectiveUserId!]),
      pool.query('SELECT * FROM cost_records WHERE user_id = $1', [req.effectiveUserId!]),
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

app.post('/data/sample', ensureVisitor, requireAdmin, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query('DELETE FROM observe_events WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM usage_records WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM cost_records WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM customers WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM plans WHERE user_id = $1', [req.effectiveUserId!])

    const plans = [
      { plan_id: 'starter', name: 'Starter', price_amount: 29, interval_months: 1 },
      { plan_id: 'pro', name: 'Professional', price_amount: 99, interval_months: 1 },
      { plan_id: 'enterprise', name: 'Enterprise', price_amount: 299, interval_months: 1 },
    ]
    for (const plan of plans) {
      await client.query(
        'INSERT INTO plans (user_id, plan_id, name, price_amount, interval_months) VALUES ($1, $2, $3, $4, $5)',
        [req.effectiveUserId!, plan.plan_id, plan.name, plan.price_amount, plan.interval_months]
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
        [req.effectiveUserId!, customer.customer_id, customer.name, customer.email, customer.segment]
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
        [req.effectiveUserId!, sub.subscription_id, sub.customer_id, sub.plan_id, sub.is_active, sub.mrr_override]
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
        [req.effectiveUserId!, ev.customer_id, ev.feature_key, ev.event_name, ev.ts, ev.cost, ev.cost_unit, ev.revenue, ev.usage, ev.model, ev.provider, ev.source]
      )
    }

    await client.query(
      'INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()',
      [req.effectiveUserId!, 'sample']
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

app.delete('/data/clear', ensureVisitor, requireAdmin, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM observe_events WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM usage_records WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM cost_records WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM customers WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM plans WHERE user_id = $1', [req.effectiveUserId!])
    await client.query(
      'UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1',
      [req.effectiveUserId!, 'none']
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

app.delete('/data/clear/revenue', ensureVisitor, requireAdmin, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND source = 'revenue_upload'", [req.effectiveUserId!])
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM customers WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM plans WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('COMMIT')
    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: 'Failed to clear revenue data' })
  } finally {
    client.release()
  }
})

app.delete('/data/clear/costs', ensureVisitor, requireAdmin, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND source = 'cost_upload'", [req.effectiveUserId!])
    await client.query('DELETE FROM cost_records WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('COMMIT')
    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: 'Failed to clear cost data' })
  } finally {
    client.release()
  }
})

app.delete('/data/clear/usage', ensureVisitor, requireAdmin, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND source = 'usage_upload'", [req.effectiveUserId!])
    await client.query('DELETE FROM usage_records WHERE user_id = $1', [req.effectiveUserId!])
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
app.post('/data/upload/costs', ensureVisitor, requireAdmin, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { records } = req.body
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No records provided' })
    }

    await client.query('BEGIN')
    await client.query('DELETE FROM cost_records WHERE user_id = $1', [req.effectiveUserId!])
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND source = 'cost_upload'", [req.effectiveUserId!])

    for (const record of records) {
      const periodStart = `${record.month}-01`
      const periodEnd = new Date(record.month + '-01')
      periodEnd.setMonth(periodEnd.getMonth() + 1)
      periodEnd.setDate(0)

      await client.query(
        'INSERT INTO cost_records (user_id, customer_id, cost_type, amount, period_start, period_end) VALUES ($1, $2, $3, $4, $5, $6)',
        [req.effectiveUserId!, record.customer_id || null, record.provider || 'infrastructure', record.cost, periodStart, periodEnd.toISOString().split('T')[0]]
      )

      // Dual-write to observe_events
      await client.query(
        `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, source, granularity)
         VALUES ($1, $2, $3, $4, $5, $6, 'usd', 'cost_upload', 'monthly')`,
        [req.effectiveUserId!, record.customer_id || null, record.provider || 'infrastructure', 'cost_recorded', new Date(`${record.month}-01`).toISOString(), record.cost]
      )
    }

    await client.query(
      'UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1',
      [req.effectiveUserId!, 'user']
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
app.post('/data/upload/usage', ensureVisitor, requireAdmin, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { records } = req.body
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No records provided' })
    }

    await client.query('BEGIN')
    await client.query('DELETE FROM usage_records WHERE user_id = $1', [req.effectiveUserId!])
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND source = 'usage_upload'", [req.effectiveUserId!])

    for (const record of records) {
      const periodStart = `${record.month}-01`
      const periodEnd = new Date(record.month + '-01')
      periodEnd.setMonth(periodEnd.getMonth() + 1)
      periodEnd.setDate(0)

      const metricKey = record.metric || record.metric_key
      const metricValue = record.value || record.metric_value

      await client.query(
        'INSERT INTO usage_records (user_id, customer_id, metric_key, metric_value, metric_limit, period_start, period_end) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [req.effectiveUserId!, record.customer_id, metricKey, metricValue, record.limit || record.metric_limit || null, periodStart, periodEnd.toISOString().split('T')[0]]
      )

      // Dual-write to observe_events
      await client.query(
        `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, usage_units, source, granularity)
         VALUES ($1, $2, $3, $4, $5, $6, 'usage_upload', 'monthly')`,
        [req.effectiveUserId!, record.customer_id, metricKey, 'usage_recorded', new Date(`${record.month}-01`).toISOString(), metricValue]
      )
    }

    await client.query(
      'UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1',
      [req.effectiveUserId!, 'user']
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
app.post('/data/upload/revenue', ensureVisitor, requireAdmin, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { customers, plans, subscriptions } = req.body

    await client.query('BEGIN')
    
    // Clear existing revenue data
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM customers WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM plans WHERE user_id = $1', [req.effectiveUserId!])
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND source = 'revenue_upload'", [req.effectiveUserId!])

    // Insert plans
    if (Array.isArray(plans)) {
      for (const plan of plans) {
        await client.query(
          'INSERT INTO plans (user_id, plan_id, name, price_amount, interval_months) VALUES ($1, $2, $3, $4, $5)',
          [req.effectiveUserId!, plan.plan_id, plan.name, plan.price_amount, plan.interval_months || 1]
        )
      }
    }

    // Insert customers
    if (Array.isArray(customers)) {
      for (const customer of customers) {
        await client.query(
          'INSERT INTO customers (user_id, customer_id, name, email, segment) VALUES ($1, $2, $3, $4, $5)',
          [req.effectiveUserId!, customer.customer_id, customer.name, customer.email || null, customer.segment || null]
        )
      }
    }

    // Insert subscriptions
    if (Array.isArray(subscriptions)) {
      for (const sub of subscriptions) {
        await client.query(
          'INSERT INTO subscriptions (user_id, subscription_id, customer_id, plan_id, is_active, mrr_override, current_period_start, current_period_end) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [req.effectiveUserId!, sub.subscription_id, sub.customer_id, sub.plan_id, sub.is_active !== false, sub.mrr_override || null, sub.current_period_start || null, sub.current_period_end || null]
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
           VALUES ($1, $2, $3, $4, NOW(), $5, 'revenue_upload', 'monthly')`,
          [req.effectiveUserId!, sub.customer_id, sub.plan_id, 'subscription_recorded', mrr]
        )
      }
    }

    await client.query(
      'UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1',
      [req.effectiveUserId!, 'user']
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
    const customersResult = await pool.query('SELECT COUNT(*) FROM customers WHERE user_id = $1', [req.effectiveUserId!])
    const activeSubs = await pool.query('SELECT COUNT(*) FROM subscriptions WHERE user_id = $1 AND is_active = true', [req.effectiveUserId!])
    const mrrResult = await pool.query(
      'SELECT COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as mrr FROM subscriptions s LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id WHERE s.user_id = $1 AND s.is_active = true',
      [req.effectiveUserId!]
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

// =============================================================================
// TEAM / ORGANIZATION MANAGEMENT
// =============================================================================

// Helper: get or create an org for the current visitor
async function getOrCreateOrg(visitorId: string): Promise<string> {
  // Check if visitor already has an org
  const existing = await pool.query(
    'SELECT org_id FROM visitor_org_map WHERE visitor_id = $1',
    [visitorId]
  )
  if (existing.rows.length > 0) {
    return existing.rows[0].org_id
  }

  // Create a new org for this visitor
  const orgResult = await pool.query(
    'INSERT INTO organizations (name, owner_visitor_id) VALUES ($1, $2) RETURNING id',
    ['My Team', visitorId]
  )
  const orgId = orgResult.rows[0].id

  // Map visitor to org
  await pool.query(
    'INSERT INTO visitor_org_map (visitor_id, org_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [visitorId, orgId]
  )

  // Add visitor as admin member
  await pool.query(
    `INSERT INTO organization_members (org_id, visitor_id, role, status, joined_at)
     VALUES ($1, $2, 'admin', 'active', NOW()) ON CONFLICT DO NOTHING`,
    [orgId, visitorId]
  )

  return orgId
}

// Helper: get the visitor's role in their org
async function getVisitorRole(visitorId: string, orgId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2 AND status = 'active'`,
    [orgId, visitorId]
  )
  return result.rows[0]?.role || null
}

// GET /team — get org info + members list
app.get('/team', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = await getOrCreateOrg(req.visitorId!)
    const org = await pool.query('SELECT * FROM organizations WHERE id = $1', [orgId])
    const members = await pool.query(
      `SELECT id, visitor_id, invited_email, role, status, joined_at, created_at
       FROM organization_members WHERE org_id = $1 ORDER BY created_at ASC`,
      [orgId]
    )
    const role = await getVisitorRole(req.visitorId!, orgId)

    res.json({
      org: org.rows[0],
      members: members.rows,
      my_role: role,
    })
  } catch (error) {
    console.error('Get team error:', error)
    res.status(500).json({ error: 'Failed to get team info' })
  }
})

// PATCH /team/name — update org name (admin only)
app.patch('/team/name', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Name is required' })
    }
    const orgId = await getOrCreateOrg(req.visitorId!)
    const role = await getVisitorRole(req.visitorId!, orgId)
    if (role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can rename the team' })
    }
    await pool.query('UPDATE organizations SET name = $1 WHERE id = $2', [name.trim(), orgId])
    res.json({ success: true })
  } catch (error) {
    console.error('Rename team error:', error)
    res.status(500).json({ error: 'Failed to rename team' })
  }
})

// POST /team/invite — generate an invite link (admin only)
app.post('/team/invite', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const { email, role } = req.body
    const memberRole = role === 'admin' ? 'admin' : 'viewer'

    const orgId = await getOrCreateOrg(req.visitorId!)
    const myRole = await getVisitorRole(req.visitorId!, orgId)
    if (myRole !== 'admin') {
      return res.status(403).json({ error: 'Only admins can invite members' })
    }

    const token = crypto.randomBytes(24).toString('hex')

    await pool.query(
      `INSERT INTO organization_members (org_id, invited_email, invite_token, role, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [orgId, email || null, token, memberRole]
    )

    const inviteLink = `${req.protocol}://${req.get('host')}/join/${token}`
    res.json({ success: true, invite_token: token, invite_link: inviteLink })
  } catch (error) {
    console.error('Create invite error:', error)
    res.status(500).json({ error: 'Failed to create invite' })
  }
})

// GET /team/invite/:token — get invite info (public, no auth needed)
app.get('/team/invite/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params
    const result = await pool.query(
      `SELECT om.id, om.org_id, om.invited_email, om.role, om.status, o.name as org_name
       FROM organization_members om
       JOIN organizations o ON om.org_id = o.id
       WHERE om.invite_token = $1`,
      [token]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid invite link' })
    }
    const invite = result.rows[0]
    if (invite.status === 'active') {
      return res.status(400).json({ error: 'Invite already used' })
    }
    res.json({
      org_name: invite.org_name,
      invited_email: invite.invited_email,
      role: invite.role,
    })
  } catch (error) {
    console.error('Get invite error:', error)
    res.status(500).json({ error: 'Failed to get invite info' })
  }
})

// POST /team/join/:token — accept an invite
app.post('/team/join/:token', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { token } = req.params
    const visitorId = req.visitorId!

    const result = await client.query(
      `SELECT om.id, om.org_id, om.role, om.status, o.owner_visitor_id
       FROM organization_members om
       JOIN organizations o ON om.org_id = o.id
       WHERE om.invite_token = $1`,
      [token]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid invite link' })
    }
    const invite = result.rows[0]
    if (invite.status === 'active') {
      return res.status(400).json({ error: 'Invite already used' })
    }

    await client.query('BEGIN')

    // Mark invite as accepted
    await client.query(
      `UPDATE organization_members SET visitor_id = $1, status = 'active', joined_at = NOW()
       WHERE id = $2`,
      [visitorId, invite.id]
    )

    // Map visitor to the org (this org now owns their session data)
    await client.query(
      `INSERT INTO visitor_org_map (visitor_id, org_id) VALUES ($1, $2)
       ON CONFLICT (visitor_id) DO UPDATE SET org_id = $2`,
      [visitorId, invite.org_id]
    )

    // Transfer any existing data from the joiner's old org to the new org
    // (if they have their own data, merge it by reassigning user_id in data tables)
    // For simplicity, we just update the mapping so their session reads from the new org owner's data

    await client.query('COMMIT')

    res.json({ success: true, org_id: invite.org_id, role: invite.role })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Join team error:', error)
    res.status(500).json({ error: 'Failed to join team' })
  } finally {
    client.release()
  }
})

// PATCH /team/members/:memberId — change role (admin only)
app.patch('/team/members/:memberId', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const { memberId } = req.params
    const { role } = req.body
    if (!role || !['admin', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Valid role required (admin or viewer)' })
    }

    const orgId = await getOrCreateOrg(req.visitorId!)
    const myRole = await getVisitorRole(req.visitorId!, orgId)
    if (myRole !== 'admin') {
      return res.status(403).json({ error: 'Only admins can change roles' })
    }

    // Ensure target member is in the same org
    const member = await pool.query(
      'SELECT id FROM organization_members WHERE id = $1 AND org_id = $2',
      [memberId, orgId]
    )
    if (member.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' })
    }

    await pool.query(
      'UPDATE organization_members SET role = $1 WHERE id = $2',
      [role, memberId]
    )
    res.json({ success: true })
  } catch (error) {
    console.error('Change role error:', error)
    res.status(500).json({ error: 'Failed to change role' })
  }
})

// DELETE /team/members/:memberId — remove member (admin only)
app.delete('/team/members/:memberId', ensureVisitor, async (req: AuthRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { memberId } = req.params
    const orgId = await getOrCreateOrg(req.visitorId!)
    const myRole = await getVisitorRole(req.visitorId!, orgId)
    if (myRole !== 'admin') {
      return res.status(403).json({ error: 'Only admins can remove members' })
    }

    // Get the member's visitor_id before removal
    const member = await client.query(
      'SELECT visitor_id FROM organization_members WHERE id = $1 AND org_id = $2',
      [memberId, orgId]
    )
    if (member.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' })
    }

    // Prevent removing yourself (the owner)
    if (member.rows[0].visitor_id === req.visitorId) {
      return res.status(400).json({ error: 'Cannot remove yourself from the team' })
    }

    await client.query('BEGIN')
    await client.query('DELETE FROM organization_members WHERE id = $1', [memberId])

    // Remove their org mapping so they get their own new org on next visit
    if (member.rows[0].visitor_id) {
      await client.query(
        'DELETE FROM visitor_org_map WHERE visitor_id = $1',
        [member.rows[0].visitor_id]
      )
    }
    await client.query('COMMIT')

    res.json({ success: true })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Remove member error:', error)
    res.status(500).json({ error: 'Failed to remove member' })
  } finally {
    client.release()
  }
})

// GET /team/my-role — get current visitor's role quickly
app.get('/team/my-role', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = await getOrCreateOrg(req.visitorId!)
    const role = await getVisitorRole(req.visitorId!, orgId)
    res.json({ role: role || 'admin', org_id: orgId })
  } catch (error) {
    console.error('Get my role error:', error)
    res.status(500).json({ error: 'Failed to get role' })
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
app.post('/stripe/sync', ensureVisitor, requireAdmin, async (req: AuthRequest, res: Response) => {
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
    await client.query('DELETE FROM subscriptions WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM customers WHERE user_id = $1', [req.effectiveUserId!])
    await client.query('DELETE FROM plans WHERE user_id = $1', [req.effectiveUserId!])
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND source = 'stripe'", [req.effectiveUserId!])

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
        [req.effectiveUserId!, planId, name, amount, intervalMonths, 'recurring']
      )
    }

    // Insert customers
    for (const customer of stripeCustomers.data) {
      if (typeof customer === 'string') continue
      await client.query(
        'INSERT INTO customers (user_id, customer_id, name, email) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [req.effectiveUserId!, customer.id, customer.name || customer.email || customer.id, customer.email || null]
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
        [req.effectiveUserId!, sub.id, sub.customer as string, priceId, sub.status === 'active', mrr]
      )
      await client.query(
        `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity)
         VALUES ($1, $2, 'subscription', 'revenue', NOW(), $3, 'stripe', 'monthly_aggregate')`,
        [req.effectiveUserId!, sub.customer as string, mrr]
      )
      syncedSubs++
    }

    await client.query(
      'INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()',
      [req.effectiveUserId!, 'user']
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
    const params: unknown[] = [req.effectiveUserId!]
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
       LEFT JOIN customers c ON oe.user_id::uuid = c.user_id AND oe.customer_id = c.customer_id
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
      [req.effectiveUserId!]
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
       LEFT JOIN customers c ON oe.user_id::uuid = c.user_id AND oe.customer_id = c.customer_id
       WHERE oe.user_id = $1
       GROUP BY oe.customer_id, c.name ORDER BY total_cost DESC`,
      [req.effectiveUserId!]
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
      [req.effectiveUserId!]
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
      [req.effectiveUserId!]
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
        [req.effectiveUserId!, key]
      ),
      pool.query(
        `SELECT oe.*, c.name as customer_name FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id::uuid = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1 AND oe.feature_key = $2 ORDER BY oe.timestamp DESC LIMIT 50`,
        [req.effectiveUserId!, key]
      ),
      pool.query(
        `SELECT oe.customer_id, c.name as customer_name,
           COUNT(*) as event_count, COALESCE(SUM(oe.cost_amount), 0) as total_cost,
           COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
         FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id::uuid = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1 AND oe.feature_key = $2
         GROUP BY oe.customer_id, c.name ORDER BY total_cost DESC`,
        [req.effectiveUserId!, key]
      ),
      pool.query(
        `SELECT model, model_provider, COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost, COALESCE(SUM(revenue_amount), 0) as total_revenue
         FROM observe_events WHERE user_id = $1 AND feature_key = $2 AND model IS NOT NULL
         GROUP BY model, model_provider ORDER BY total_cost DESC`,
        [req.effectiveUserId!, key]
      ),
      pool.query(
        `SELECT DATE_TRUNC('month', timestamp) as month,
           COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage
         FROM observe_events WHERE user_id = $1 AND feature_key = $2
         GROUP BY month ORDER BY month ASC`,
        [req.effectiveUserId!, key]
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
      [req.effectiveUserId!]
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
      pool.query('SELECT * FROM customers WHERE user_id = $1 AND customer_id = $2', [req.effectiveUserId!, id]),
      pool.query(
        `SELECT s.*, p.name as plan_name, p.price_amount FROM subscriptions s
         LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id
         WHERE s.user_id = $1 AND s.customer_id = $2`,
        [req.effectiveUserId!, id]
      ),
      pool.query(
        `SELECT * FROM observe_events WHERE user_id = $1 AND customer_id = $2 ORDER BY timestamp DESC LIMIT 50`,
        [req.effectiveUserId!, id]
      ),
      pool.query(
        `SELECT feature_key, COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage
         FROM observe_events WHERE user_id = $1 AND customer_id = $2 AND feature_key IS NOT NULL
         GROUP BY feature_key ORDER BY total_cost DESC`,
        [req.effectiveUserId!, id]
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

startServer()
