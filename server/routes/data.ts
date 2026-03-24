import { Router, Response } from 'express'
import type { Pool } from 'pg'
import { z } from 'zod'
import { type AuthRequest } from './auth.js'
import rateLimit from 'express-rate-limit'
import { getUncachableStripeClient } from '../stripe-client.js'

type CheckTansoFeatureAccessFn = (visitorId: string, featureKey: string, email?: string) => Promise<{ allowed: boolean; reason?: string; usage?: number; limit?: number; remaining?: number }>
type TrackTansoUsageFn = (visitorId: string, featureKey: string, eventName: string) => void
type ConvertReferralFn = (visitorId: string) => Promise<void>

// Clear sample/demo data when transitioning to real user data
// Uses exact sample IDs to avoid deleting real Stripe data (sub_*, cus_* prefixes match real Stripe IDs)
const SAMPLE_SUBSCRIPTION_IDS = ['sub_001', 'sub_002', 'sub_003', 'sub_004', 'sub_005']
const SAMPLE_CUSTOMER_IDS = ['cus_001', 'cus_002', 'cus_003', 'cus_004', 'cus_005']
const SAMPLE_PLAN_IDS = ['starter', 'pro', 'enterprise']

async function clearSampleData(db: { query: (text: string, params: unknown[]) => Promise<unknown> }, userId: string): Promise<void> {
  await db.query("DELETE FROM observe_events WHERE user_id = $1 AND source = 'sample'", [userId])
  await db.query("DELETE FROM cost_records WHERE user_id = $1 AND cost_type = 'ai_inference' AND customer_id IS NULL AND period_start IS NOT NULL", [userId])
  await db.query(
    `DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id = ANY($2)`,
    [userId, SAMPLE_SUBSCRIPTION_IDS]
  )
  await db.query(
    `DELETE FROM customers WHERE user_id = $1 AND customer_id = ANY($2)`,
    [userId, SAMPLE_CUSTOMER_IDS]
  )
  await db.query(
    `DELETE FROM plans WHERE user_id = $1 AND plan_id = ANY($2)`,
    [userId, SAMPLE_PLAN_IDS]
  )
  await db.query("DELETE FROM simulations WHERE user_id = $1 AND name LIKE '%Sample%'", [userId])
}

// Upload validation schemas
const costRecordSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM format'),
  cost: z.number({ coerce: true }).nonnegative(),
  customer_id: z.string().optional(),
  provider: z.string().optional(),
})
const usageRecordSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM format'),
  customer_id: z.string().optional(),
  metric: z.string().optional(),
  metric_key: z.string().optional(),
  value: z.number({ coerce: true }).optional(),
  metric_value: z.number({ coerce: true }).optional(),
  limit: z.number({ coerce: true }).optional(),
  metric_limit: z.number({ coerce: true }).optional(),
})
const revenueUploadSchema = z.object({
  customers: z.array(z.object({
    customer_id: z.string(),
    name: z.string(),
    email: z.string().optional(),
    segment: z.string().optional(),
  })).optional(),
  plans: z.array(z.object({
    plan_id: z.string(),
    name: z.string(),
    price_amount: z.number({ coerce: true }),
    interval_months: z.number().optional(),
  })).optional(),
  subscriptions: z.array(z.object({
    subscription_id: z.string(),
    customer_id: z.string(),
    plan_id: z.string(),
    is_active: z.boolean().optional(),
    mrr_override: z.number({ coerce: true }).optional(),
    current_period_start: z.string().optional(),
    current_period_end: z.string().optional(),
  })).optional(),
})

export function createDataRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    checkTansoFeatureAccess: CheckTansoFeatureAccessFn,
    trackTansoUsage: TrackTansoUsageFn,
    convertReferralIfPending: ConvertReferralFn,
  }
) {
  const router = Router()
  const { checkTansoFeatureAccess, trackTansoUsage, convertReferralIfPending } = deps

  const expensiveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again in a minute' },
  })

  // GET /data/status
  router.get('/data/status', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // GET /customers
  router.get('/customers', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // GET /subscriptions
  router.get('/subscriptions', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // GET /plans
  router.get('/plans', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // GET /usage
  router.get('/usage', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // GET /costs
  router.get('/costs', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // GET /data/analyzer
  router.get('/data/analyzer', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // POST /data/sample — load sample data
  router.post('/data/sample', ensureVisitor, async (req: AuthRequest, res: Response) => {
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
        { customer_id: 'cus_001', name: 'Acme Corp', email: 'billing@acme.com', segment: 'Enterprise', created_at: '2025-08-01T00:00:00Z' },
        { customer_id: 'cus_002', name: 'TechStart Inc', email: 'admin@techstart.io', segment: 'SMB', created_at: '2025-11-15T00:00:00Z' },
        { customer_id: 'cus_003', name: 'Global Solutions', email: 'accounts@global.com', segment: 'Mid-Market', created_at: '2025-09-10T00:00:00Z' },
        { customer_id: 'cus_004', name: 'Startup Labs', email: 'hello@startuplabs.co', segment: 'SMB', created_at: '2026-02-01T00:00:00Z' },
        { customer_id: 'cus_005', name: 'Enterprise Co', email: 'procurement@enterprise.com', segment: 'Enterprise', created_at: '2025-06-01T00:00:00Z' },
      ]
      for (const customer of customers) {
        await client.query(
          'INSERT INTO customers (user_id, customer_id, name, email, segment, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [req.visitorId, customer.customer_id, customer.name, customer.email, customer.segment, customer.created_at]
        )
      }

      const subscriptions = [
        { subscription_id: 'sub_001', customer_id: 'cus_001', plan_id: 'enterprise', is_active: true, mrr_override: 299, previous_mrr: 99, created_at: '2025-08-01T00:00:00Z', current_period_start: '2026-03-01T00:00:00Z', current_period_end: '2026-04-01T00:00:00Z' },
        { subscription_id: 'sub_002', customer_id: 'cus_002', plan_id: 'starter', is_active: true, mrr_override: 29, previous_mrr: 0, created_at: '2025-11-15T00:00:00Z', current_period_start: '2026-03-01T00:00:00Z', current_period_end: '2026-04-01T00:00:00Z' },
        { subscription_id: 'sub_003', customer_id: 'cus_003', plan_id: 'pro', is_active: true, mrr_override: 99, previous_mrr: 29, created_at: '2025-09-10T00:00:00Z', current_period_start: '2026-03-01T00:00:00Z', current_period_end: '2026-04-01T00:00:00Z' },
        { subscription_id: 'sub_004', customer_id: 'cus_004', plan_id: 'starter', is_active: true, mrr_override: 29, previous_mrr: 0, created_at: '2026-02-01T00:00:00Z', current_period_start: '2026-03-01T00:00:00Z', current_period_end: '2026-04-01T00:00:00Z' },
        { subscription_id: 'sub_005', customer_id: 'cus_005', plan_id: 'enterprise', is_active: true, mrr_override: 299, previous_mrr: 299, created_at: '2025-06-01T00:00:00Z', current_period_start: '2026-03-01T00:00:00Z', current_period_end: '2026-04-01T00:00:00Z' },
      ]
      for (const sub of subscriptions) {
        await client.query(
          `INSERT INTO subscriptions (user_id, subscription_id, customer_id, plan_id, is_active, mrr_override, previous_mrr, created_at, current_period_start, current_period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [req.visitorId, sub.subscription_id, sub.customer_id, sub.plan_id, sub.is_active, sub.mrr_override, sub.previous_mrr, sub.created_at, sub.current_period_start, sub.current_period_end]
        )
      }

      // Sample cost_records — monthly AI costs for the Overview page
      const now = new Date()
      for (let i = 5; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
        const amount = 3200 + (5 - i) * 600 // growing costs: 3200, 3800, 4400, 5000, 5600, 6200
        await client.query(
          'INSERT INTO cost_records (user_id, cost_type, amount, period_start, period_end) VALUES ($1, $2, $3, $4, $5)',
          [req.visitorId, 'ai_inference', amount, start.toISOString(), end.toISOString()]
        )
      }

      // Sample observe_events — feature-level cost+revenue data
      // Use relative timestamps so demo data is always "fresh"
      function daysAgo(d: number) { return new Date(Date.now() - d * 86400000).toISOString() }
      const sampleEvents = [
        { customer_id: 'cus_001', feature_key: 'ai_summarization', event_name: 'summary_generated', ts: daysAgo(1), cost: 0.24, cost_unit: 'usd', revenue: 0.50, usage: 24, model: 'claude-3-5-sonnet', provider: 'anthropic', source: 'sample' },
        { customer_id: 'cus_002', feature_key: 'ai_summarization', event_name: 'summary_generated', ts: daysAgo(2), cost: 0.08, cost_unit: 'usd', revenue: 0.20, usage: 8, model: 'gpt-4o', provider: 'openai', source: 'sample' },
        { customer_id: 'cus_003', feature_key: 'ai_summarization', event_name: 'summary_generated', ts: daysAgo(5), cost: 0.15, cost_unit: 'usd', revenue: 0.35, usage: 15, model: 'claude-3-5-sonnet', provider: 'anthropic', source: 'sample' },
        { customer_id: 'cus_001', feature_key: 'ai_summarization', event_name: 'summary_generated', ts: daysAgo(10), cost: 0.30, cost_unit: 'usd', revenue: 0.60, usage: 30, model: 'gpt-4o', provider: 'openai', source: 'sample' },
        { customer_id: 'cus_004', feature_key: 'ai_summarization', event_name: 'summary_generated', ts: daysAgo(14), cost: 0.05, cost_unit: 'usd', revenue: 0.15, usage: 5, model: 'claude-3-haiku', provider: 'anthropic', source: 'sample' },
        { customer_id: 'cus_001', feature_key: 'image_generation', event_name: 'image_generated', ts: daysAgo(3), cost: 0.04, cost_unit: 'usd', revenue: 0.25, usage: 1, model: 'dall-e-3', provider: 'openai', source: 'sample' },
        { customer_id: 'cus_003', feature_key: 'image_generation', event_name: 'image_generated', ts: daysAgo(7), cost: 0.04, cost_unit: 'usd', revenue: 0.25, usage: 1, model: 'dall-e-3', provider: 'openai', source: 'sample' },
        { customer_id: 'cus_005', feature_key: 'image_generation', event_name: 'image_generated', ts: daysAgo(18), cost: 0.02, cost_unit: 'usd', revenue: 0.20, usage: 1, model: 'stable-diffusion-xl', provider: 'stability', source: 'sample' },
        { customer_id: 'cus_002', feature_key: 'image_generation', event_name: 'image_generated', ts: daysAgo(20), cost: 0.04, cost_unit: 'usd', revenue: 0.25, usage: 1, model: 'dall-e-3', provider: 'openai', source: 'sample' },
        { customer_id: 'cus_001', feature_key: 'search', event_name: 'search_query', ts: daysAgo(1), cost: 0.002, cost_unit: 'usd', revenue: 0.01, usage: 100, model: 'text-embedding-3-small', provider: 'openai', source: 'sample' },
        { customer_id: 'cus_002', feature_key: 'search', event_name: 'search_query', ts: daysAgo(4), cost: 0.003, cost_unit: 'usd', revenue: 0.01, usage: 150, model: 'text-embedding-3-small', provider: 'openai', source: 'sample' },
        { customer_id: 'cus_003', feature_key: 'search', event_name: 'search_query', ts: daysAgo(12), cost: 0.001, cost_unit: 'usd', revenue: 0.005, usage: 50, model: 'text-embedding-3-small', provider: 'openai', source: 'sample' },
        { customer_id: 'cus_004', feature_key: 'search', event_name: 'search_query', ts: daysAgo(15), cost: 0.004, cost_unit: 'usd', revenue: 0.02, usage: 200, model: 'text-embedding-ada-002', provider: 'openai', source: 'sample' },
        { customer_id: 'cus_001', feature_key: 'pdf_generation', event_name: 'document_generated', ts: daysAgo(6), cost: 0.12, cost_unit: 'usd', revenue: 0.50, usage: 12, model: null, provider: null, source: 'sample' },
        { customer_id: 'cus_005', feature_key: 'pdf_generation', event_name: 'document_generated', ts: daysAgo(16), cost: 0.18, cost_unit: 'usd', revenue: 0.70, usage: 18, model: null, provider: null, source: 'sample' },
        { customer_id: 'cus_002', feature_key: 'email_send', event_name: 'email_sent', ts: daysAgo(8), cost: 0.01, cost_unit: 'usd', revenue: 0.05, usage: 100, model: null, provider: null, source: 'sample' },
        { customer_id: 'cus_004', feature_key: 'email_send', event_name: 'email_sent', ts: daysAgo(22), cost: 0.015, cost_unit: 'usd', revenue: 0.06, usage: 150, model: null, provider: null, source: 'sample' },
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
          `INSERT INTO simulations (user_id, name, status, segment_name, scenarios, feature_analysis, customer_impacts, margin_impact, confidence_score, key_insight, winning_scenario_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
          [
            req.visitorId, sim.name, sim.status,
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

  // DELETE /data/clear
  router.delete('/data/clear', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // DELETE /data/clear/revenue
  router.delete('/data/clear/revenue', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // DELETE /data/clear/costs
  router.delete('/data/clear/costs', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // DELETE /data/clear/usage
  router.delete('/data/clear/usage', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // POST /data/upload/costs
  router.post('/data/upload/costs', ensureVisitor, async (req: AuthRequest, res: Response) => {
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
      const parseResult = z.array(costRecordSchema).safeParse(records)
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid record format', details: parseResult.error.issues.slice(0, 5) })
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

          eventPlaceholders.push(`($${eventIdx++}, $${eventIdx++}, $${eventIdx++}, 'cost', $${eventIdx++}, $${eventIdx++}, 'usd', 'csv', 'monthly_aggregate', $${eventIdx++})`)
          eventValues.push(req.visitorId, record.customer_id || '_aggregate', record.provider || 'infrastructure', new Date(`${record.month}-01`).toISOString(), record.cost, record.provider || null)
        }

        await client.query(
          `INSERT INTO cost_records (user_id, customer_id, cost_type, amount, period_start, period_end) VALUES ${costPlaceholders.join(', ')}`,
          costValues
        )
        await client.query(
          `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, source, granularity, model_provider) VALUES ${eventPlaceholders.join(', ')}`,
          eventValues
        )
      }

      await clearSampleData(client, req.visitorId!)
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

  // POST /data/upload/usage
  router.post('/data/upload/usage', ensureVisitor, async (req: AuthRequest, res: Response) => {
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
      const parseResult = z.array(usageRecordSchema).safeParse(records)
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid record format', details: parseResult.error.issues.slice(0, 5) })
      }

      await client.query('BEGIN')
      await client.query('DELETE FROM usage_records WHERE user_id = $1', [req.visitorId])
      await client.query("DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'usage'", [req.visitorId])

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
          const metricValue = record.value ?? record.metric_value

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

      await clearSampleData(client, req.visitorId!)
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

  // POST /data/upload/revenue
  router.post('/data/upload/revenue', ensureVisitor, async (req: AuthRequest, res: Response) => {
    const access = await checkTansoFeatureAccess(req.visitorId!, 'csv_upload', req.accountEmail)
    if (!access.allowed) return res.status(403).json({ error: access.reason || 'Upload limit reached. Upgrade your plan.' })
    const client = await pool.connect()
    try {
      const parseResult = revenueUploadSchema.safeParse(req.body)
      if (!parseResult.success) {
        return res.status(400).json({ error: 'Invalid revenue data format', details: parseResult.error.issues.slice(0, 5) })
      }
      const { customers, plans, subscriptions } = parseResult.data

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

      await clearSampleData(client, req.visitorId!)
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

  // GET /metrics/summary
  router.get('/metrics/summary', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // GET /metrics/source-breakdown
  router.get('/metrics/source-breakdown', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT source, is_inferred,
                COUNT(*) as event_count,
                COALESCE(SUM(cost_amount), 0) as total_cost,
                COALESCE(SUM(revenue_amount), 0) as total_revenue
         FROM observe_events
         WHERE user_id = $1
         GROUP BY source, is_inferred
         ORDER BY total_cost DESC`,
        [req.visitorId]
      )
      const sources = result.rows.map((r: { source: string; is_inferred: boolean; event_count: string; total_cost: string; total_revenue: string }) => ({
        source: r.is_inferred ? 'inferred' : r.source,
        event_count: parseInt(r.event_count),
        total_cost: parseFloat(r.total_cost) || 0,
        total_revenue: parseFloat(r.total_revenue) || 0,
      }))
      const total_events = sources.reduce((s: number, r: { event_count: number }) => s + r.event_count, 0)
      res.json({ sources, total_events })
    } catch (error) {
      console.error('Get source breakdown error:', error)
      res.status(500).json({ error: 'Failed to get source breakdown' })
    }
  })

  // GET /stripe/status
  router.get('/stripe/status', ensureVisitor, async (_req: AuthRequest, res: Response) => {
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
      console.error('Stripe status check error:', error)
      res.json({ connected: false, error: 'Not connected' })
    }
  })

  // POST /stripe/sync
  router.post('/stripe/sync', ensureVisitor, expensiveLimiter, async (req: AuthRequest, res: Response) => {
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

      await clearSampleData(client, req.visitorId!)
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
      res.status(500).json({ error: 'Stripe sync failed' })
    } finally {
      client.release()
    }
  })

  return router
}
