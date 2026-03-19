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
  const client = await pool.connect()
  try {
    const { records } = req.body
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No records provided' })
    }

    await client.query('BEGIN')
    await client.query('DELETE FROM cost_records WHERE user_id = $1', [req.visitorId])
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'cost'", [req.visitorId])

    for (const record of records) {
      const periodStart = `${record.month}-01`
      const periodEnd = new Date(record.month + '-01')
      periodEnd.setMonth(periodEnd.getMonth() + 1)
      periodEnd.setDate(0)

      await client.query(
        'INSERT INTO cost_records (user_id, customer_id, cost_type, amount, period_start, period_end) VALUES ($1, $2, $3, $4, $5, $6)',
        [req.visitorId, record.customer_id || null, record.provider || 'infrastructure', record.cost, periodStart, periodEnd.toISOString().split('T')[0]]
      )

      // Dual-write to observe_events
      await client.query(
        `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, source, granularity)
         VALUES ($1, $2, $3, 'cost', $4, $5, 'usd', 'csv', 'monthly_aggregate')`,
        [req.visitorId, record.customer_id || '_aggregate', record.provider || 'infrastructure', new Date(`${record.month}-01`).toISOString(), record.cost]
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
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'usage'", [req.visitorId])

    for (const record of records) {
      const periodStart = `${record.month}-01`
      const periodEnd = new Date(record.month + '-01')
      periodEnd.setMonth(periodEnd.getMonth() + 1)
      periodEnd.setDate(0)

      const metricKey = record.metric || record.metric_key
      const metricValue = record.value || record.metric_value

      await client.query(
        'INSERT INTO usage_records (user_id, customer_id, metric_key, metric_value, metric_limit, period_start, period_end) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [req.visitorId, record.customer_id, metricKey, metricValue, record.limit || record.metric_limit || null, periodStart, periodEnd.toISOString().split('T')[0]]
      )

      // Dual-write to observe_events
      await client.query(
        `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, usage_units, source, granularity)
         VALUES ($1, $2, $3, 'usage', $4, $5, 'csv', 'monthly_aggregate')`,
        [req.visitorId, record.customer_id || '_aggregate', metricKey, new Date(`${record.month}-01`).toISOString(), metricValue]
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
    await client.query("DELETE FROM observe_events WHERE user_id = $1 AND source = 'stripe'", [req.visitorId])

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
      await client.query(
        `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity)
         VALUES ($1, $2, 'subscription', 'revenue', NOW(), $3, 'stripe', 'monthly_aggregate')`,
        [req.visitorId, sub.customer as string, mrr]
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
       LEFT JOIN customers c ON oe.user_id::uuid = c.user_id AND oe.customer_id = c.customer_id
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
         LEFT JOIN customers c ON oe.user_id::uuid = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1 AND oe.feature_key = $2 ORDER BY oe.timestamp DESC LIMIT 50`,
        [req.visitorId, key]
      ),
      pool.query(
        `SELECT oe.customer_id, c.name as customer_name,
           COUNT(*) as event_count, COALESCE(SUM(oe.cost_amount), 0) as total_cost,
           COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
         FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id::uuid = c.user_id AND oe.customer_id = c.customer_id
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
  try {
    const { name, scenarios, time_range } = req.body
    if (!name) {
      return res.status(400).json({ error: 'Name is required' })
    }

    const result = await pool.query(
      `INSERT INTO simulations (user_id, name, scenarios, time_range, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING *`,
      [req.visitorId, name, JSON.stringify(scenarios || []), time_range ? JSON.stringify(time_range) : null]
    )

    const row = result.rows[0]
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
         LEFT JOIN customers c ON oe.user_id::uuid = c.user_id AND oe.customer_id = c.customer_id
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
      [req.visitorId, costUsd]
    )

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

startServer()
