import express, { Request, Response, NextFunction } from 'express'
import session from 'express-session'
import pgSession from 'connect-pg-simple'
import { Pool } from 'pg'
import crypto from 'crypto'

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

startServer()
