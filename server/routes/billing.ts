import { Router, Response } from 'express'
import type { Pool } from 'pg'
import { type AuthRequest } from './auth.js'
import { getUncachableStripeClient } from '../stripe-client.js'

// =============================================================================
// Feature limits by plan (source of truth)
// =============================================================================

const PLAN_LIMITS: Record<string, Record<string, number | null>> = {
  free: { ai_insights: 5 },
  growth: { ai_insights: null }, // null = unlimited
}

const PLAN_FEATURES: Record<string, string[]> = {
  free: ['ai_insights', 'csv_upload', 'saas_metrics', 'sample_data', 'stripe_connection', 'ai_provider_connection'],
  growth: ['ai_insights', 'csv_upload', 'saas_metrics', 'sample_data', 'stripe_connection', 'ai_provider_connection', 'cost_alerts', 'plan_health', 'usage_anomalies', 'negative_margin'],
}

// Stripe price IDs — set via env or hardcode for now
const GROWTH_PRICE_ID = process.env.STRIPE_GROWTH_PRICE_ID || 'price_1TGrdf2SWVrwMtPK9XWZHZAx'

// =============================================================================
// Helpers
// =============================================================================

async function getStripeCustomer(stripe: any, email: string) {
  const customers = await stripe.customers.list({ email, limit: 1 })
  return customers.data[0] || null
}

async function getActiveSubscription(stripe: any, customerId: string) {
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 })
  return subs.data[0] || null
}

function getPlanKey(subscription: any): string {
  if (!subscription) return 'free'
  const priceId = subscription.items?.data?.[0]?.price?.id
  if (priceId === GROWTH_PRICE_ID) return 'growth'
  // Check by amount as fallback
  const amount = subscription.items?.data?.[0]?.price?.unit_amount
  if (amount && amount > 0) return 'growth'
  return 'free'
}

async function getUsageThisMonth(pool: Pool, userId: string, featureKey: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM ai_insights
     WHERE user_id = $1 AND created_at >= date_trunc('month', now())`,
    [userId]
  )
  return parseInt(result.rows[0]?.count || '0', 10)
}

// =============================================================================
// Exported helpers for use by other routes
// =============================================================================

export function createCheckFeatureAccess(pool: Pool) {
  return async function checkFeatureAccess(
    visitorId: string,
    featureKey: string,
    email?: string
  ): Promise<{ allowed: boolean; reason?: string; usage?: number; limit?: number; remaining?: number }> {
    // Determine plan
    let planKey = 'free'
    if (email) {
      try {
        const stripe = await getUncachableStripeClient()
        const customer = await getStripeCustomer(stripe, email)
        if (customer) {
          const sub = await getActiveSubscription(stripe, customer.id)
          planKey = getPlanKey(sub)
        }
      } catch (err) {
        console.error('Stripe plan check error:', err)
        return { allowed: false, reason: 'Billing service unavailable' }
      }
    }

    const features = PLAN_FEATURES[planKey] || PLAN_FEATURES.free
    if (!features.includes(featureKey)) {
      return { allowed: false, reason: 'Feature not available on your plan' }
    }

    const featureLimit = PLAN_LIMITS[planKey]?.[featureKey]
    if (featureLimit === null || featureLimit === undefined) {
      return { allowed: true } // unlimited or boolean feature
    }

    // Metered feature — check usage
    const used = await getUsageThisMonth(pool, visitorId, featureKey)
    const remaining = Math.max(0, featureLimit - used)
    return {
      allowed: remaining > 0,
      usage: used,
      limit: featureLimit,
      remaining,
      reason: remaining === 0 ? 'Monthly limit reached. Upgrade to Growth for unlimited.' : undefined,
    }
  }
}

export function createTrackUsage(pool: Pool) {
  return function trackUsage(visitorId: string, featureKey: string, eventName: string) {
    // Usage is tracked implicitly by inserting into ai_insights table
    // This function exists for compatibility — other features can log to observe_events
    pool.query(
      `INSERT INTO observe_events (
        user_id, customer_id, feature_key, event_name, timestamp,
        cost_amount, cost_unit, revenue_amount, usage_units,
        model, model_provider, source, granularity, is_inferred
      ) VALUES ($1, 'system', $2, $3, NOW(), 0, 'usd', 0, 1, NULL, NULL, 'internal', 'event', false)`,
      [visitorId, featureKey, eventName]
    ).catch(err => console.error('Usage tracking error:', err))
  }
}

// =============================================================================
// Route factory
// =============================================================================

export function createBillingRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: { checkFeatureAccess: ReturnType<typeof createCheckFeatureAccess> }
) {
  const router = Router()

  // GET /billing/status — plans, subscription state, usage
  router.get('/billing/status', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const email = req.accountEmail
      let customer: any = null
      let subscription: any = null
      let planKey = 'free'

      if (email) {
        try {
          const stripe = await getUncachableStripeClient()
          customer = await getStripeCustomer(stripe, email)
          if (customer) {
            subscription = await getActiveSubscription(stripe, customer.id)
            planKey = getPlanKey(subscription)
          }
        } catch (err) {
          console.error('Stripe status error:', err)
        }
      }

      // Build usage/entitlements from DB
      const features = PLAN_FEATURES[planKey] || PLAN_FEATURES.free
      const limits = PLAN_LIMITS[planKey] || PLAN_LIMITS.free
      const insightsUsed = await getUsageThisMonth(pool, req.visitorId!, 'ai_insights')

      const entitlements = features.map(key => {
        const limit = limits[key]
        if (limit === null || limit === undefined) {
          return { featureKey: key, allowed: true }
        }
        const remaining = Math.max(0, limit - insightsUsed)
        return {
          featureKey: key,
          allowed: remaining > 0,
          usageLimit: limit,
          currentUsage: insightsUsed,
          remaining,
        }
      })

      // Build plans response (hardcoded — matches Stripe products)
      const plans = [
        {
          plan: { id: 'free', key: 'free', name: 'Free', description: 'Track AI costs across every model and provider. Includes 5 AI-powered insights per month.', priceAmount: 0 },
          features: PLAN_FEATURES.free.map(k => ({ key: k, name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })),
        },
        {
          plan: { id: 'growth', key: 'growth', name: 'Growth', description: 'Unlimited AI insights, priority support, and everything in Free.', priceAmount: 29 },
          features: PLAN_FEATURES.growth.map(k => ({ key: k, name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })),
        },
      ]

      res.json({
        plans,
        entitlements,
        customer: subscription ? {
          subscriptions: [{
            id: subscription.id,
            isActive: subscription.status === 'active',
            plan: { id: planKey, key: planKey, name: planKey === 'growth' ? 'Growth' : 'Free', priceAmount: planKey === 'growth' ? 29 : 0 },
            currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
            cancelledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
            cancelEffectiveAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
          }],
        } : null,
        configured: true,
        healthy: true,
      })
    } catch (err) {
      console.error('Billing status error:', err)
      res.status(503).json({ plans: [], entitlements: [], customer: null, configured: true, error: 'Billing service temporarily unavailable' })
    }
  })

  // POST /billing/subscribe — create Stripe Checkout session for Growth
  router.post('/billing/subscribe', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      if (!req.accountEmail) return res.status(401).json({ error: 'Please sign in to subscribe' })
      const stripe = await getUncachableStripeClient()
      const email = req.accountEmail
      const { planId } = req.body

      // Free plan — no checkout needed
      if (planId === 'free') {
        return res.json({ success: true })
      }

      // Get or create Stripe customer
      let customer = await getStripeCustomer(stripe, email)
      if (!customer) {
        customer = await stripe.customers.create({ email })
      }

      // Check if already on Growth
      const existingSub = await getActiveSubscription(stripe, customer.id)
      if (existingSub && getPlanKey(existingSub) === 'growth') {
        return res.json({ success: true, subscription: existingSub })
      }

      // Create Checkout session
      const origin = req.headers.origin || req.headers.referer?.replace(/\/+$/, '') || 'http://localhost:5173'
      const session = await stripe.checkout.sessions.create({
        customer: customer.id,
        mode: 'subscription',
        line_items: [{ price: GROWTH_PRICE_ID, quantity: 1 }],
        success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/plans`,
      })

      res.json({ success: true, checkoutUrl: session.url })
    } catch (err) {
      console.error('Billing subscribe error:', err)
      res.status(500).json({ error: 'Failed to create subscription' })
    }
  })

  // POST /billing/portal — Stripe Customer Portal
  router.post('/billing/portal', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const stripe = await getUncachableStripeClient()
      const email = req.accountEmail
      if (!email) return res.status(400).json({ error: 'Please sign in to manage billing' })

      const customer = await getStripeCustomer(stripe, email)
      if (!customer) {
        return res.status(404).json({ error: 'No billing account found. Subscribe to a paid plan first.' })
      }

      const origin = req.headers.origin || req.headers.referer?.replace(/\/+$/, '') || 'http://localhost:5173'
      const session = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: `${origin}/plans`,
      })

      res.json({ url: session.url })
    } catch (err) {
      console.error('Stripe portal error:', err)
      res.status(500).json({ error: 'Failed to create portal session' })
    }
  })

  // POST /billing/cancel — cancel via Stripe directly
  router.post('/billing/cancel', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const stripe = await getUncachableStripeClient()
      const email = req.accountEmail
      if (!email) return res.status(401).json({ error: 'Please sign in' })

      const customer = await getStripeCustomer(stripe, email)
      if (!customer) return res.status(404).json({ error: 'No billing account found' })

      const sub = await getActiveSubscription(stripe, customer.id)
      if (!sub) return res.status(404).json({ error: 'No active subscription found' })

      const { cancelMode = 'END_OF_PERIOD' } = req.body
      if (cancelMode === 'IMMEDIATE') {
        await stripe.subscriptions.cancel(sub.id)
      } else {
        await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true })
      }

      res.json({ success: true })
    } catch (err) {
      console.error('Billing cancel error:', err)
      res.status(500).json({ error: 'Failed to cancel subscription' })
    }
  })

  // POST /billing/reactivate — remove scheduled cancellation
  router.post('/billing/reactivate', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const stripe = await getUncachableStripeClient()
      const email = req.accountEmail
      if (!email) return res.status(401).json({ error: 'Please sign in' })

      const customer = await getStripeCustomer(stripe, email)
      if (!customer) return res.status(404).json({ error: 'No billing account found' })

      const sub = await getActiveSubscription(stripe, customer.id)
      if (!sub) return res.status(404).json({ error: 'No active subscription found' })

      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false })
      res.json({ success: true })
    } catch (err) {
      console.error('Billing reactivate error:', err)
      res.status(500).json({ error: 'Failed to reactivate subscription' })
    }
  })

  // GET /billing/check/:featureKey — check if user can use a feature
  router.get('/billing/check/:featureKey', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const result = await deps.checkFeatureAccess(req.visitorId!, req.params.featureKey, req.accountEmail)
      res.json(result)
    } catch (err) {
      console.error('Feature check error:', err)
      res.json({ allowed: false, reason: 'Feature check failed' })
    }
  })

  // GET /billing/usage — usage stats for metering visualizations
  router.get('/billing/usage', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!

      // Monthly insights count
      const insightsResult = await pool.query(
        `SELECT COUNT(*) as count FROM ai_insights
         WHERE user_id = $1 AND created_at >= date_trunc('month', now())`,
        [visitorId]
      )
      const insightsUsed = parseInt(insightsResult.rows[0]?.count || '0', 10)

      // Daily breakdown for chart
      const dailyResult = await pool.query(
        `SELECT date_trunc('day', created_at)::date as day, COUNT(*) as count
         FROM ai_insights WHERE user_id = $1 AND created_at >= date_trunc('month', now())
         GROUP BY day ORDER BY day`,
        [visitorId]
      )

      // Determine plan
      let planKey = 'free'
      if (req.accountEmail) {
        try {
          const stripe = await getUncachableStripeClient()
          const customer = await getStripeCustomer(stripe, req.accountEmail)
          if (customer) {
            const sub = await getActiveSubscription(stripe, customer.id)
            planKey = getPlanKey(sub)
          }
        } catch (_) {}
      }

      const limit = PLAN_LIMITS[planKey]?.ai_insights ?? 5
      res.json({
        configured: true,
        ai_insights: {
          used: insightsUsed,
          limit,
          remaining: limit === null ? null : Math.max(0, limit - insightsUsed),
          unlimited: limit === null,
          daily: dailyResult.rows,
        },
        plan: planKey,
      })
    } catch (err) {
      console.error('Usage stats error:', err)
      res.status(503).json({ configured: true, error: 'Usage data temporarily unavailable' })
    }
  })

  return router
}
