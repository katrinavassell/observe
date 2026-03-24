import { Router, Response } from 'express'
import type { Pool } from 'pg'
import { z } from 'zod'
import { type AuthRequest } from './auth.js'

const alertRuleSchema = z.object({
  name: z.string().min(1).max(100),
  metric: z.enum(['daily_cost', 'margin_percent', 'cost_per_event']),
  operator: z.enum(['gt', 'lt', 'gte', 'lte']),
  threshold: z.number({ coerce: true }),
  email: z.string().email(),
  cooldown_minutes: z.number({ coerce: true }).int().min(1).default(60),
})

const METRIC_QUERIES: Record<string, string> = {
  daily_cost: `SELECT COALESCE(SUM(cost_amount), 0) as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'`,
  margin_percent: `SELECT CASE WHEN COALESCE(SUM(revenue_amount), 0) = 0 THEN 0 ELSE ((SUM(revenue_amount) - SUM(cost_amount)) / SUM(revenue_amount) * 100) END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'`,
  cost_per_event: `SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE SUM(cost_amount) / COUNT(*) END as value FROM observe_events WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'`,
}

const OPERATOR_FNS: Record<string, (val: number, threshold: number) => boolean> = {
  gt: (v, t) => v > t,
  lt: (v, t) => v < t,
  gte: (v, t) => v >= t,
  lte: (v, t) => v <= t,
}

const OPERATOR_LABELS: Record<string, string> = {
  gt: 'exceeded',
  lt: 'dropped below',
  gte: 'reached',
  lte: 'dropped to',
}

const METRIC_LABELS: Record<string, string> = {
  daily_cost: 'Daily cost',
  margin_percent: 'Margin',
  cost_per_event: 'Cost per event',
}

function formatValue(metric: string, value: number): string {
  if (metric === 'margin_percent') return `${value.toFixed(1)}%`
  return `$${value.toFixed(4)}`
}

async function sendAlertEmail(to: string, rule: { name: string; metric: string; operator: string; threshold: number }, currentValue: number) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set, skipping alert email')
    return
  }

  const fromEmail = process.env.ALERT_FROM_EMAIL || 'alerts@tansohq.com'
  const metricLabel = METRIC_LABELS[rule.metric] || rule.metric
  const operatorLabel = OPERATOR_LABELS[rule.operator] || rule.operator
  const subject = `Alert: ${rule.name} — ${metricLabel} ${operatorLabel} ${formatValue(rule.metric, rule.threshold)}`

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="font-size: 18px; margin-bottom: 8px;">${rule.name}</h2>
      <p style="color: #666; margin-bottom: 16px;">
        <strong>${metricLabel}</strong> ${operatorLabel} your threshold of <strong>${formatValue(rule.metric, rule.threshold)}</strong>.
      </p>
      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <div style="font-size: 24px; font-weight: 700;">${formatValue(rule.metric, currentValue)}</div>
        <div style="color: #666; font-size: 13px;">Current ${metricLabel.toLowerCase()}</div>
      </div>
      <p style="color: #999; font-size: 12px;">
        Sent by Tanso cost alerts. Manage your alerts in the dashboard.
      </p>
    </div>
  `

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from: fromEmail, to, subject, html }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('Resend email failed:', res.status, err)
    }
  } catch (err) {
    console.error('Failed to send alert email:', err)
  }
}

export async function checkAlerts(pool: Pool, userId: string) {
  try {
    const { rows: rules } = await pool.query(
      `SELECT * FROM alert_rules WHERE user_id = $1 AND enabled = true`,
      [userId]
    )

    for (const rule of rules) {
      // Check cooldown
      if (rule.last_triggered_at) {
        const cooldownMs = (rule.cooldown_minutes || 60) * 60 * 1000
        if (Date.now() - new Date(rule.last_triggered_at).getTime() < cooldownMs) continue
      }

      const query = METRIC_QUERIES[rule.metric]
      if (!query) continue

      const { rows } = await pool.query(query, [userId])
      const currentValue = parseFloat(rows[0]?.value) || 0
      const operatorFn = OPERATOR_FNS[rule.operator]
      if (!operatorFn) continue

      if (operatorFn(currentValue, parseFloat(rule.threshold))) {
        await sendAlertEmail(rule.email, rule, currentValue)
        await pool.query(
          'UPDATE alert_rules SET last_triggered_at = NOW() WHERE id = $1',
          [rule.id]
        )
      }
    }
  } catch (err) {
    console.error('checkAlerts error:', err)
  }
}

export function createAlertRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router()

  // List alert rules
  router.get('/alerts', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM alert_rules WHERE user_id = $1 ORDER BY created_at DESC',
        [req.visitorId]
      )
      res.json({ rules: rows })
    } catch (err) {
      console.error('GET /alerts error:', err)
      res.status(500).json({ error: 'Failed to list alerts' })
    }
  })

  // Create alert rule
  router.post('/alerts', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = alertRuleSchema.parse(req.body)
      const { rows } = await pool.query(
        `INSERT INTO alert_rules (user_id, name, metric, operator, threshold, email, cooldown_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [req.visitorId, parsed.name, parsed.metric, parsed.operator, parsed.threshold, parsed.email, parsed.cooldown_minutes]
      )
      res.json(rows[0])
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors[0]?.message || 'Invalid input' })
      }
      console.error('POST /alerts error:', err)
      res.status(500).json({ error: 'Failed to create alert' })
    }
  })

  // Update alert rule
  router.patch('/alerts/:id', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id)
      // Verify ownership
      const existing = await pool.query('SELECT id FROM alert_rules WHERE id = $1 AND user_id = $2', [id, req.visitorId])
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Alert not found' })

      const updates: string[] = []
      const values: unknown[] = []
      let idx = 1

      for (const field of ['name', 'metric', 'operator', 'threshold', 'email', 'enabled', 'cooldown_minutes'] as const) {
        if (req.body[field] !== undefined) {
          updates.push(`${field} = $${idx++}`)
          values.push(req.body[field])
        }
      }

      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' })

      values.push(id)
      const { rows } = await pool.query(
        `UPDATE alert_rules SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      )
      res.json(rows[0])
    } catch (err) {
      console.error('PATCH /alerts/:id error:', err)
      res.status(500).json({ error: 'Failed to update alert' })
    }
  })

  // Delete alert rule
  router.delete('/alerts/:id', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id)
      const result = await pool.query('DELETE FROM alert_rules WHERE id = $1 AND user_id = $2', [id, req.visitorId])
      if (result.rowCount === 0) return res.status(404).json({ error: 'Alert not found' })
      res.json({ success: true })
    } catch (err) {
      console.error('DELETE /alerts/:id error:', err)
      res.status(500).json({ error: 'Failed to delete alert' })
    }
  })

  return router
}
