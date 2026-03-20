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

    await client.query('DELETE FROM simulations WHERE user_id = $1', [req.effectiveUserId!])

    const sampleSimulations = [
      {
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
        ],
        customer_impacts: [
          { customer_id: 'cus_001', customer_name: 'Acme Corp', current_revenue: 1.10, projected_revenue: 1.38, revenue_delta: 0.28, revenue_delta_pct: 25, churn_risk: 'low', segment: 'Enterprise' },
          { customer_id: 'cus_002', customer_name: 'TechStart Inc', current_revenue: 0.45, projected_revenue: 0.56, revenue_delta: 0.11, revenue_delta_pct: 25, churn_risk: 'medium', segment: 'SMB' },
          { customer_id: 'cus_004', customer_name: 'Startup Labs', current_revenue: 0.15, projected_revenue: 0.19, revenue_delta: 0.04, revenue_delta_pct: 25, churn_risk: 'high', segment: 'SMB' },
        ],
        margin_impact: { current_margin_pct: 54, projected_margin_pct: 63, margin_delta_pct: 9, total_current_revenue: 2.80, total_projected_revenue: 3.50, total_cost: 1.29, customers_affected: 3, high_churn_risk_count: 1 },
        confidence_score: 78,
        key_insight: 'A 25% price increase on AI features would improve overall margin from 54% to 63%, with only 1 customer at high churn risk.',
        winning_scenario_id: 'sc-001b',
      },
      {
        name: 'Enterprise Tier Restructure',
        status: 'completed',
        segment_name: 'Enterprise',
        scenarios: [
          { id: 'sc-002a', name: 'Bundle AI features', description: 'Include AI summarization in enterprise tier at flat rate', changes: [{ feature_key: 'ai_summarization', change_type: 'new_price', change_value: 0.40 }], projected_revenue: 2.60, projected_cost: 1.29, projected_margin_pct: 50 },
          { id: 'sc-002b', name: 'Premium image tier', description: 'Increase image generation pricing for enterprise', changes: [{ feature_key: 'image_generation', change_type: 'percentage_increase', change_value: 40 }], projected_revenue: 3.18, projected_cost: 1.29, projected_margin_pct: 59 },
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
        winning_scenario_id: 'sc-002b',
      },
      {
        name: 'Usage-Based Pricing Test',
        status: 'draft',
        scenarios: [
          { id: 'sc-003a', name: 'Per-token pricing', description: 'Charge per 1000 tokens across all AI features', changes: [{ feature_key: 'ai_summarization', change_type: 'new_price', change_value: 0.03 }, { feature_key: 'search', change_type: 'new_price', change_value: 0.005 }] },
        ],
        feature_analysis: [],
        customer_impacts: [],
        margin_impact: null,
        confidence_score: null,
        key_insight: null,
        winning_scenario_id: null,
      },
    ]

    for (const sim of sampleSimulations) {
      await client.query(
        `INSERT INTO simulations (user_id, name, status, segment_name, scenarios, feature_analysis, customer_impacts, margin_impact, confidence_score, key_insight, winning_scenario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          req.effectiveUserId!, sim.name, sim.status, sim.segment_name || null,
          JSON.stringify(sim.scenarios), JSON.stringify(sim.feature_analysis),
          JSON.stringify(sim.customer_impacts), sim.margin_impact ? JSON.stringify(sim.margin_impact) : null,
          sim.confidence_score, sim.key_insight, sim.winning_scenario_id,
        ]
      )
    }

    await client.query(
      'INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()',
      [req.effectiveUserId!, 'sample']
    )

    await client.query('COMMIT')
    await maybeAwardReferralCredit(req.visitorId!)
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
    await client.query('DELETE FROM simulations WHERE user_id = $1', [req.effectiveUserId!])
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
    await maybeAwardReferralCredit(req.visitorId!)
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
    await maybeAwardReferralCredit(req.visitorId!)
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
    await maybeAwardReferralCredit(req.visitorId!)
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

    res.json({ success: true, invite_token: token })
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS simulations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        segment_name TEXT,
        time_range JSONB,
        scenarios JSONB NOT NULL DEFAULT '[]',
        summary_table JSONB,
        customer_impacts JSONB NOT NULL DEFAULT '[]',
        feature_analysis JSONB NOT NULL DEFAULT '[]',
        margin_impact JSONB,
        confidence_score NUMERIC,
        key_insight TEXT,
        winning_scenario_id TEXT,
        rolled_out_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_simulations_user_id ON simulations(user_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_simulations_status ON simulations(status)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_simulations_user_created ON simulations(user_id, created_at DESC)`)
    console.log('Simulations table ready')

    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        credit_type TEXT NOT NULL DEFAULT 'ai_insight',
        amount INTEGER NOT NULL DEFAULT 1,
        source_referral_id UUID REFERENCES referrals(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    console.log('Referral tables ready')

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
    await maybeAwardReferralCredit(req.visitorId!)

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

// =============================================================================
// SIMULATIONS
// =============================================================================

app.get('/simulations', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM simulations WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.effectiveUserId!]
    )
    res.json(result.rows)
  } catch (error) {
    console.error('List simulations error:', error)
    res.status(500).json({ error: 'Failed to list simulations' })
  }
})

app.get('/simulations/opportunities', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const featuresRes = await pool.query(`
      SELECT feature_key,
        SUM(cost_amount) AS total_cost,
        SUM(revenue_amount) AS total_revenue,
        COUNT(*) AS event_count,
        COUNT(DISTINCT customer_id) AS customer_count
      FROM observe_events
      WHERE user_id = $1
      GROUP BY feature_key
    `, [req.effectiveUserId!])

    const opportunities: Array<{
      id: string; title: string; description: string;
      severity: string; suggested_action: string;
      feature_key?: string; estimated_impact?: string
    }> = []

    for (const f of featuresRes.rows) {
      const cost = parseFloat(f.total_cost) || 0
      const rev = parseFloat(f.total_revenue) || 0
      const margin = rev > 0 ? ((rev - cost) / rev) * 100 : 0

      if (margin < 0) {
        opportunities.push({
          id: `opp-neg-${f.feature_key}`,
          title: `${f.feature_key} is losing money`,
          description: `This feature has a negative margin of ${margin.toFixed(0)}%. Consider raising prices or reducing costs.`,
          severity: 'critical',
          suggested_action: 'Increase price or optimize costs',
          feature_key: f.feature_key,
          estimated_impact: `$${Math.abs(rev - cost).toFixed(2)} potential savings`,
        })
      } else if (margin < 30 && rev > 0) {
        opportunities.push({
          id: `opp-low-${f.feature_key}`,
          title: `${f.feature_key} has thin margins`,
          description: `Margin is only ${margin.toFixed(0)}%. A small price increase could improve profitability.`,
          severity: 'warning',
          suggested_action: 'Consider a 10-20% price increase',
          feature_key: f.feature_key,
          estimated_impact: `${(30 - margin).toFixed(0)}pp margin improvement possible`,
        })
      } else if (margin > 85 && parseInt(f.customer_count) < 3) {
        opportunities.push({
          id: `opp-growth-${f.feature_key}`,
          title: `${f.feature_key} has growth potential`,
          description: `High margin (${margin.toFixed(0)}%) but only ${f.customer_count} customers. Consider competitive pricing to grow adoption.`,
          severity: 'info',
          suggested_action: 'Lower price slightly to attract more customers',
          feature_key: f.feature_key,
        })
      }
    }

    res.json(opportunities)
  } catch (error) {
    console.error('Get opportunities error:', error)
    res.status(500).json({ error: 'Failed to get opportunities' })
  }
})

app.get('/simulations/:id', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM simulations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.effectiveUserId!]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Simulation not found' })
    }
    res.json(result.rows[0])
  } catch (error) {
    console.error('Get simulation error:', error)
    res.status(500).json({ error: 'Failed to get simulation' })
  }
})

app.post('/simulations', ensureVisitor, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, scenarios, time_range, segment_name } = req.body
    if (!name) return res.status(400).json({ error: 'Name is required' })

    const result = await pool.query(
      `INSERT INTO simulations (user_id, name, status, segment_name, time_range, scenarios)
       VALUES ($1, $2, 'draft', $3, $4, $5)
       RETURNING *`,
      [req.effectiveUserId!, name, segment_name || null, time_range ? JSON.stringify(time_range) : null, JSON.stringify(scenarios || [])]
    )
    res.json(result.rows[0])
  } catch (error) {
    console.error('Create simulation error:', error)
    res.status(500).json({ error: 'Failed to create simulation' })
  }
})

app.put('/simulations/:id', ensureVisitor, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const simRes = await pool.query(
      'SELECT * FROM simulations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.effectiveUserId!]
    )
    if (simRes.rows.length === 0) {
      return res.status(404).json({ error: 'Simulation not found' })
    }
    const sim = simRes.rows[0]
    const updates = req.body

    if (updates.status === 'running' && sim.status === 'draft') {
      const scenarios = updates.scenarios || sim.scenarios || []
      const featureRes = await pool.query(`
        SELECT feature_key,
          SUM(cost_amount) AS total_cost,
          SUM(revenue_amount) AS total_revenue,
          COUNT(*) AS event_count,
          COUNT(DISTINCT customer_id) AS customer_count
        FROM observe_events
        WHERE user_id = $1
        GROUP BY feature_key
      `, [req.effectiveUserId!])

      const featureData: Record<string, { cost: number; revenue: number; events: number; customers: number }> = {}
      for (const r of featureRes.rows) {
        featureData[r.feature_key] = {
          cost: parseFloat(r.total_cost) || 0,
          revenue: parseFloat(r.total_revenue) || 0,
          events: parseInt(r.event_count) || 0,
          customers: parseInt(r.customer_count) || 0,
        }
      }

      const customerRes = await pool.query(`
        SELECT oe.customer_id, c.name AS customer_name, c.segment,
          SUM(oe.cost_amount) AS total_cost,
          SUM(oe.revenue_amount) AS total_revenue
        FROM observe_events oe
        LEFT JOIN customers c ON oe.user_id::uuid = c.user_id AND oe.customer_id = c.customer_id
        WHERE oe.user_id = $1 AND oe.customer_id != '_aggregate'
        GROUP BY oe.customer_id, c.name, c.segment
      `, [req.effectiveUserId!])

      for (const sc of scenarios) {
        let projectedRevenue = 0
        let projectedCost = 0
        for (const change of (sc.changes || [])) {
          const fd = featureData[change.feature_key]
          if (!fd) continue
          let newRevenue = fd.revenue
          switch (change.change_type) {
            case 'percentage_increase': newRevenue = fd.revenue * (1 + change.change_value / 100); break
            case 'percentage_decrease': newRevenue = fd.revenue * (1 - change.change_value / 100); break
            case 'flat_increase': newRevenue = fd.revenue + change.change_value * fd.events; break
            case 'flat_decrease': newRevenue = fd.revenue - change.change_value * fd.events; break
            case 'new_price': newRevenue = change.change_value * fd.events; break
          }
          projectedRevenue += newRevenue
          projectedCost += fd.cost
        }
        sc.projected_revenue = projectedRevenue
        sc.projected_cost = projectedCost
        sc.projected_margin_pct = projectedRevenue > 0
          ? Math.round(((projectedRevenue - projectedCost) / projectedRevenue) * 100)
          : 0
      }

      const featureAnalysis = Object.entries(featureData).map(([key, fd]) => {
        let bestProjectedRev = fd.revenue
        for (const sc of scenarios) {
          for (const ch of (sc.changes || [])) {
            if (ch.feature_key !== key) continue
            let nr = fd.revenue
            switch (ch.change_type) {
              case 'percentage_increase': nr = fd.revenue * (1 + ch.change_value / 100); break
              case 'percentage_decrease': nr = fd.revenue * (1 - ch.change_value / 100); break
              case 'flat_increase': nr = fd.revenue + ch.change_value * fd.events; break
              case 'flat_decrease': nr = fd.revenue - ch.change_value * fd.events; break
              case 'new_price': nr = ch.change_value * fd.events; break
            }
            if (nr > bestProjectedRev) bestProjectedRev = nr
          }
        }
        const currentMargin = fd.revenue > 0 ? ((fd.revenue - fd.cost) / fd.revenue) * 100 : 0
        const projectedMargin = bestProjectedRev > 0 ? ((bestProjectedRev - fd.cost) / bestProjectedRev) * 100 : 0
        return {
          feature_key: key,
          current_cost: fd.cost,
          current_revenue: fd.revenue,
          current_margin_pct: Math.round(currentMargin),
          projected_revenue: bestProjectedRev,
          projected_margin_pct: Math.round(projectedMargin),
          margin_delta_pct: Math.round(projectedMargin - currentMargin),
        }
      })

      const customerImpacts = customerRes.rows.map((cr: { customer_id: string; customer_name: string; segment: string; total_cost: string; total_revenue: string }) => {
        const currentRev = parseFloat(cr.total_revenue) || 0
        const revDelta = currentRev * 0.1
        const projectedRev = currentRev + revDelta
        const deltaPct = currentRev > 0 ? (revDelta / currentRev) * 100 : 0
        return {
          customer_id: cr.customer_id,
          customer_name: cr.customer_name || cr.customer_id,
          current_revenue: currentRev,
          projected_revenue: projectedRev,
          revenue_delta: revDelta,
          revenue_delta_pct: Math.round(deltaPct),
          churn_risk: deltaPct > 20 ? 'high' : deltaPct > 10 ? 'medium' : 'low' as 'low' | 'medium' | 'high',
          segment: cr.segment,
        }
      })

      const totalCurrentRev = Object.values(featureData).reduce((s, f) => s + f.revenue, 0)
      const totalCost = Object.values(featureData).reduce((s, f) => s + f.cost, 0)
      const bestScenario = scenarios.reduce((best: { projected_revenue?: number; id?: string } | null, sc: { projected_revenue?: number; id?: string }) =>
        !best || (sc.projected_revenue || 0) > (best.projected_revenue || 0) ? sc : best, null as { projected_revenue?: number; id?: string } | null)
      const totalProjectedRev = bestScenario?.projected_revenue || totalCurrentRev
      const currentMarginPct = totalCurrentRev > 0 ? ((totalCurrentRev - totalCost) / totalCurrentRev) * 100 : 0
      const projectedMarginPct = totalProjectedRev > 0 ? ((totalProjectedRev - totalCost) / totalProjectedRev) * 100 : 0

      const marginImpact = {
        current_margin_pct: Math.round(currentMarginPct),
        projected_margin_pct: Math.round(projectedMarginPct),
        margin_delta_pct: Math.round(projectedMarginPct - currentMarginPct),
        total_current_revenue: totalCurrentRev,
        total_projected_revenue: totalProjectedRev,
        total_cost: totalCost,
        customers_affected: customerImpacts.length,
        high_churn_risk_count: customerImpacts.filter((c: { churn_risk: string }) => c.churn_risk === 'high').length,
      }

      const confidenceScore = Math.min(95, 50 + Object.keys(featureData).length * 5 + customerImpacts.length * 2)
      const keyInsight = bestScenario
        ? `Best scenario projects ${projectedMarginPct.toFixed(0)}% margin (${projectedMarginPct > currentMarginPct ? '+' : ''}${(projectedMarginPct - currentMarginPct).toFixed(0)}pp) with $${totalProjectedRev.toFixed(2)} revenue.`
        : 'Not enough data to generate insights.'

      const updateRes = await pool.query(
        `UPDATE simulations SET status = 'completed', scenarios = $1, feature_analysis = $2,
         customer_impacts = $3, margin_impact = $4, confidence_score = $5,
         key_insight = $6, winning_scenario_id = $7, updated_at = NOW()
         WHERE id = $8 AND user_id = $9 RETURNING *`,
        [
          JSON.stringify(scenarios), JSON.stringify(featureAnalysis),
          JSON.stringify(customerImpacts), JSON.stringify(marginImpact),
          confidenceScore, keyInsight, bestScenario?.id || null,
          req.params.id, req.effectiveUserId!
        ]
      )
      return res.json(updateRes.rows[0])
    }

    if (updates.status === 'rolled_out') {
      const updateRes = await pool.query(
        `UPDATE simulations SET status = 'rolled_out', rolled_out_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [req.params.id, req.effectiveUserId!]
      )
      return res.json(updateRes.rows[0])
    }

    const fields: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    if (updates.name !== undefined) { fields.push(`name = $${paramIdx++}`); values.push(updates.name) }
    if (updates.scenarios !== undefined) { fields.push(`scenarios = $${paramIdx++}`); values.push(JSON.stringify(updates.scenarios)) }
    if (updates.segment_name !== undefined) { fields.push(`segment_name = $${paramIdx++}`); values.push(updates.segment_name) }
    if (updates.time_range !== undefined) { fields.push(`time_range = $${paramIdx++}`); values.push(JSON.stringify(updates.time_range)) }
    fields.push(`updated_at = NOW()`)

    values.push(req.params.id)
    values.push(req.effectiveUserId!)

    const updateRes = await pool.query(
      `UPDATE simulations SET ${fields.join(', ')} WHERE id = $${paramIdx++} AND user_id = $${paramIdx} RETURNING *`,
      values
    )
    if (updateRes.rows.length === 0) return res.status(404).json({ error: 'Simulation not found' })
    res.json(updateRes.rows[0])
  } catch (error) {
    console.error('Update simulation error:', error)
    res.status(500).json({ error: 'Failed to update simulation' })
  }
})

app.delete('/simulations/:id', ensureVisitor, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'DELETE FROM simulations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.effectiveUserId!]
    )
    if (result.rowCount === 0) return res.status(404).json({ error: 'Simulation not found' })
    res.json({ success: true })
  } catch (error) {
    console.error('Delete simulation error:', error)
    res.status(500).json({ error: 'Failed to delete simulation' })
  }
})

// =============================================================================
// REFERRAL SYSTEM
// =============================================================================

// Award credit to referrer when a referred user becomes active
async function maybeAwardReferralCredit(referredUserId: string): Promise<void> {
  try {
    const referralResult = await pool.query(
      "SELECT id, referrer_user_id FROM referrals WHERE referred_user_id = $1 AND status = 'pending'",
      [referredUserId]
    )
    if (referralResult.rows.length === 0) return

    const referral = referralResult.rows[0]
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        "UPDATE referrals SET status = 'converted', credited_at = NOW() WHERE id = $1",
        [referral.id]
      )
      await client.query(
        "INSERT INTO referral_credits (user_id, credit_type, amount, source_referral_id) VALUES ($1, 'ai_insight', 1, $2)",
        [referral.referrer_user_id, referral.id]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('maybeAwardReferralCredit error:', err)
  }
}

function generateReferralCode(userId: string): string {
  const hash = crypto.createHash('sha256').update(userId + process.env.SESSION_SECRET).digest('hex')
  return hash.slice(0, 8).toUpperCase()
}

// GET /referral/code — get or create referral code for current user
app.get('/referral/code', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await pool.query(
      'SELECT code FROM referral_codes WHERE user_id = $1',
      [req.visitorId]
    )
    if (existing.rows.length > 0) {
      return res.json({ code: existing.rows[0].code })
    }

    const code = generateReferralCode(req.visitorId!)
    await pool.query(
      'INSERT INTO referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
      [req.visitorId, code]
    )
    res.json({ code })
  } catch (error) {
    console.error('Get referral code error:', error)
    res.status(500).json({ error: 'Failed to get referral code' })
  }
})

// POST /referral/record — record a referral when a new user arrives via referral link
app.post('/referral/record', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const { code } = req.body
    if (!code) return res.status(400).json({ error: 'Referral code required' })

    // Find referrer
    const codeResult = await pool.query(
      'SELECT user_id FROM referral_codes WHERE code = $1',
      [code.toUpperCase()]
    )
    if (codeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid referral code' })
    }

    const referrerUserId = codeResult.rows[0].user_id

    // Don't allow self-referral
    if (referrerUserId === req.visitorId) {
      return res.status(400).json({ error: 'Cannot refer yourself' })
    }

    // Check if this user already has a referral record
    const existingReferral = await pool.query(
      'SELECT id FROM referrals WHERE referred_user_id = $1',
      [req.visitorId]
    )
    if (existingReferral.rows.length > 0) {
      return res.json({ success: true, already_recorded: true })
    }

    await pool.query(
      'INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code, status) VALUES ($1, $2, $3, $4) ON CONFLICT (referred_user_id) DO NOTHING',
      [referrerUserId, req.visitorId, code.toUpperCase(), 'pending']
    )
    res.json({ success: true })
  } catch (error) {
    console.error('Record referral error:', error)
    res.status(500).json({ error: 'Failed to record referral' })
  }
})

// GET /referral/stats — get referral stats for current user
app.get('/referral/stats', ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const [codeResult, referralsResult, creditsResult] = await Promise.all([
      pool.query('SELECT code FROM referral_codes WHERE user_id = $1', [req.visitorId]),
      pool.query(
        'SELECT status, COUNT(*) as count FROM referrals WHERE referrer_user_id = $1 GROUP BY status',
        [req.visitorId]
      ),
      pool.query(
        'SELECT COALESCE(SUM(amount), 0) as total FROM referral_credits WHERE user_id = $1',
        [req.visitorId]
      ),
    ])

    const code = codeResult.rows[0]?.code || null
    const statusCounts: Record<string, number> = {}
    referralsResult.rows.forEach((r: { status: string; count: string }) => {
      statusCounts[r.status] = parseInt(r.count)
    })

    res.json({
      code,
      total_referrals: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      converted_referrals: statusCounts['converted'] || 0,
      pending_referrals: statusCounts['pending'] || 0,
      credits_earned: parseInt(creditsResult.rows[0].total) || 0,
    })
  } catch (error) {
    console.error('Get referral stats error:', error)
    res.status(500).json({ error: 'Failed to get referral stats' })
  }
})

startServer()
