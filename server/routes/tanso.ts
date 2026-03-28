import { Router, Response } from 'express'
import type { Pool } from 'pg'
import crypto from 'crypto'
import { type AuthRequest } from './auth.js'
import { getUncachableStripeClient } from '../stripe-client.js'
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
  tansoAdminGetFeatureRule,
  isTansoConfigured,
} from '../tanso-client.js'

// ─── Shared helpers ────────────────────────────────────────────────────────

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
    let invoiceId = result?.invoice?.id
    if (!invoiceId) {
      // Invoice may not be nested in the response -- fetch separately
      const invoices = await tansoListCustomerInvoices(customerReferenceId)
      const items = Array.isArray(invoices) ? invoices : (invoices as any)?.items ?? []
      const unpaid = items.find((inv: any) => inv.status !== 'PAID')
      invoiceId = unpaid?.id
    }
    if (invoiceId) {
      await tansoMarkInvoicePaid(invoiceId)
    }
    console.log('Auto-subscribed', customerReferenceId, 'to free plan')
  } catch (err) {
    console.error('Auto-subscribe to free plan failed:', err instanceof Error ? err.message : err)
  }
}

async function getOrCreateTansoCustomer(pool: Pool, visitorId: string, email?: string): Promise<string | null> {
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

async function verifySubscriptionOwnership(visitorId: string, subscriptionId: string): Promise<boolean> {
  try {
    const customer = await tansoGetCustomer(visitorId)
    return customer?.subscriptions?.some((s: any) => s.id === subscriptionId) ?? false
  } catch (_) {
    return false
  }
}

// Exported for use by data routes and other modules
export function createCheckTansoFeatureAccess(pool: Pool) {
  return async function checkTansoFeatureAccess(visitorId: string, featureKey: string, email?: string): Promise<{ allowed: boolean; reason?: string; usage?: number; limit?: number; remaining?: number }> {
    if (!isTansoConfigured()) return { allowed: true }
    try {
      const tansoId = await getOrCreateTansoCustomer(pool, visitorId, email)
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
      } catch (fallbackErr) { console.error('Tanso entitlement fallback also failed:', fallbackErr) }
      return { allowed: false, reason: 'Entitlement service unavailable' }
    }
  }
}

export function createTrackTansoUsage(pool: Pool, getAdminVisitorId: () => Promise<string | null>) {
  return function trackTansoUsage(visitorId: string, featureKey: string, eventName: string) {
    if (!isTansoConfigured()) return
    const occurredAt = new Date().toISOString()
    const idempotencyKey = `${visitorId}-${featureKey}-${Date.now()}`

    // 1. Forward to Tanso billing API
    tansoIngestEvent({
      eventIdempotencyKey: idempotencyKey,
      eventName,
      occurredAt,
      customerReferenceId: visitorId,
      featureKey,
    }).catch((err: unknown) => {
      console.error('Tanso usage tracking error:', err)
    })

    // 2. Also record as an observe_event under the admin account (dogfooding)
    getAdminVisitorId().then(adminId => {
      if (!adminId) return
      pool.query(
        `INSERT INTO observe_events (
          user_id, customer_id, feature_key, event_name, timestamp,
          cost_amount, cost_unit, revenue_amount, usage_units,
          model, model_provider, source, granularity, is_inferred, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, 0, 'usd', 0, 1, NULL, NULL, 'internal', 'event', false, $6)
        ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [adminId, visitorId, featureKey, eventName, occurredAt, idempotencyKey]
      ).catch(err => console.error('Admin observe_event insert error:', err))
    }).catch(err => console.error('Admin observe tracking error:', err))
  }
}

// ─── Route factory ─────────────────────────────────────────────────────────

export function createTansoRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    checkTansoFeatureAccess: ReturnType<typeof createCheckTansoFeatureAccess>,
  }
) {
  const router = Router()

  // Tanso Invoices
  router.get('/tanso/invoices', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      if (!isTansoConfigured()) return res.json({ invoices: [], configured: false })
      const visitorId = req.visitorId!
      await getOrCreateTansoCustomer(pool, visitorId, req.accountEmail)
      const invoices = await tansoListCustomerInvoices(visitorId)
      const items = Array.isArray(invoices) ? invoices : invoices?.items ?? []
      res.json({ invoices: items, configured: true })
    } catch (err) {
      console.error('Tanso invoices error:', err)
      res.json({ invoices: [], configured: false })
    }
  })

  // Tanso Status & Plans
  router.get('/tanso/status', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

    // In Stripe-driven mode, customers are created via Stripe webhook — don't force-create here
    // Only attempt customer/entitlement lookups if user has an account (is logged in)
    if (req.accountEmail) {
      try {
        const ent = await tansoListCustomerEntitlements(visitorId)
        entitlements = flattenEntitlements(ent)
      } catch (err) {
        // Customer may not exist in Tanso yet (will be created when Stripe subscription syncs)
        if (!(err instanceof Error && err.message.includes('404'))) {
          console.error('Tanso status: entitlements fetch failed:', err instanceof Error ? err.message : err)
        }
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
        if (!(err instanceof Error && err.message.includes('404'))) {
          console.error('Tanso status: customer fetch failed:', err instanceof Error ? err.message : err)
        }
      }
    } // end if (req.accountEmail)

    // Fetch feature rules for each plan-feature combo (limits, pricing model, etc.)
    const featureRules: Record<string, Record<string, any>> = {}
    try {
      const rulePromises: Promise<void>[] = []
      for (const planData of plansResult) {
        const plan = planData.plan || planData
        const features = planData.features || plan.features || []
        if (!plan.id) continue
        featureRules[plan.id] = {}
        for (const feature of features) {
          if (!feature.id) continue
          rulePromises.push(
            tansoAdminGetFeatureRule(plan.id, feature.id)
              .then((rule: any) => { featureRules[plan.id][feature.key || feature.id] = rule })
              .catch(() => { /* rule not found — feature is boolean/unlimited */ })
          )
        }
      }
      await Promise.all(rulePromises)
    } catch (err) {
      console.error('Tanso status: feature rules fetch failed:', err instanceof Error ? err.message : err)
    }

    res.json({
      plans: plansResult,
      entitlements,
      customer,
      featureRules,
      configured: true,
      healthy,
    })
  })

  router.get('/tanso/plans', ensureVisitor, async (_req: AuthRequest, res: Response) => {
    try {
      if (!isTansoConfigured()) return res.json({ plans: [], configured: false })
      const plans = await tansoListPlans()
      res.json({ plans: Array.isArray(plans) ? plans : plans?.items || plans?.plans || [], configured: true })
    } catch (err) {
      console.error('Tanso list plans error:', err)
      res.json({ plans: [], configured: false })
    }
  })

  router.get('/tanso/features', ensureVisitor, async (_req: AuthRequest, res: Response) => {
    try {
      if (!isTansoConfigured()) return res.json({ features: [], configured: false })
      const features = await tansoListFeatures()
      res.json({ features: Array.isArray(features) ? features : features?.items || features?.features || [], configured: true })
    } catch (err) {
      console.error('Tanso list features error:', err)
      res.json({ features: [], configured: false })
    }
  })

  router.get('/tanso/entitlements', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      if (!isTansoConfigured()) return res.json({ entitlements: [], configured: false })
      const visitorId = req.visitorId!
      await getOrCreateTansoCustomer(pool, visitorId, req.accountEmail)
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

  router.get('/tanso/subscription', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      if (!isTansoConfigured()) return res.json({ customer: null, configured: false })
      const visitorId = req.visitorId!
      await getOrCreateTansoCustomer(pool, visitorId, req.accountEmail)
      const customer = await tansoGetCustomer(visitorId)
      res.json({ customer, configured: true })
    } catch (err) {
      console.error('Tanso subscription error:', err)
      res.json({ customer: null, configured: false })
    }
  })

  // Subscribe / upgrade / downgrade — matches SaaSSubscriptionSite Checkout.tsx pattern
  router.post('/tanso/subscribe', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      if (!isTansoConfigured()) return res.status(503).json({ error: 'Billing not configured' })
      if (!req.accountEmail) return res.status(401).json({ error: 'Please sign in to subscribe' })
      const visitorId = req.visitorId!
      const { planId } = req.body
      if (!planId) return res.status(400).json({ error: 'planId is required' })
      await getOrCreateTansoCustomer(pool, visitorId, req.accountEmail)

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
        const currentPrice = Number(activeSub.plan?.priceAmount ?? 0)
        const plans = await tansoListPlans()
        const planItems = Array.isArray(plans) ? plans : plans?.items ?? plans?.plans ?? []
        const targetPlan = planItems.find((p: any) => (p.plan?.id ?? p.id) === planId)
        const targetPrice = Number(targetPlan?.plan?.priceAmount ?? targetPlan?.priceAmount ?? 0)

        if (targetPrice > currentPrice) {
          // UPGRADE — Tanso handles plan change, Stripe handles proration via auto-charge
          await tansoChangeSubscriptionPlan(activeSub.id, planId, 'UPGRADE')
          const updated = await tansoGetCustomer(visitorId)
          const newSub = updated?.subscriptions?.find((s: any) => s.isActive)
          return res.json({ success: true, subscription: newSub, changeType: 'upgrade' })
        } else {
          // DOWNGRADE — scheduled for end of billing period
          await tansoChangeSubscriptionPlan(activeSub.id, planId, 'DOWNGRADE')
          const updated = await tansoGetCustomer(visitorId)
          const newSub = updated?.subscriptions?.find((s: any) => s.isActive)
          return res.json({ success: true, subscription: newSub, changeType: 'downgrade' })
        }
      }

      // ── NEW SUBSCRIPTION ──
      const result = await tansoCreateSubscription(visitorId, planId)
      const subscription = result?.subscription ?? result
      const checkoutUrl = result?.checkoutUrl

      // Paid plan — Tanso returns checkoutUrl for Stripe Checkout
      if (checkoutUrl) {
        return res.json({ success: true, subscription, checkoutUrl })
      }

      // Free plan — no payment needed
      res.json({ success: true, subscription })
    } catch (err) {
      console.error('Tanso subscribe error:', err)
      res.status(500).json({ error: 'Failed to create subscription' })
    }
  })

  // Stripe Customer Portal — lets users manage payment methods, invoices, etc.
  router.post('/tanso/portal', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const stripe = await getUncachableStripeClient()
      const email = req.accountEmail
      if (!email) return res.status(400).json({ error: 'Please sign in to manage billing' })

      const customers = await stripe.customers.list({ email, limit: 1 })
      if (customers.data.length === 0) {
        return res.status(404).json({ error: 'No Stripe customer found. Subscribe to a paid plan first.' })
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: customers.data[0].id,
        return_url: `${req.headers.origin || req.headers.referer || 'http://localhost:5173'}/plans`,
      })

      res.json({ url: session.url })
    } catch (err) {
      console.error('Stripe portal error:', err)
      res.status(500).json({ error: 'Failed to create portal session' })
    }
  })

  // Cancel subscription (supports IMMEDIATE or END_OF_PERIOD)
  router.post('/tanso/cancel', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      if (!isTansoConfigured()) return res.status(503).json({ error: 'Billing not configured' })
      const { subscriptionId, cancelMode = 'IMMEDIATE' } = req.body
      if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required' })
      if (cancelMode !== 'IMMEDIATE' && cancelMode !== 'END_OF_PERIOD') {
        return res.status(400).json({ error: 'cancelMode must be IMMEDIATE or END_OF_PERIOD' })
      }

      // Verify ownership
      if (!await verifySubscriptionOwnership(req.visitorId!, subscriptionId)) {
        return res.status(403).json({ error: 'Subscription not found' })
      }

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
  router.post('/tanso/reactivate', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      if (!isTansoConfigured()) return res.status(503).json({ error: 'Billing not configured' })
      const { subscriptionId } = req.body
      if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required' })

      if (!await verifySubscriptionOwnership(req.visitorId!, subscriptionId)) {
        return res.status(403).json({ error: 'Subscription not found' })
      }

      await tansoCancelScheduledCancellation(subscriptionId)
      res.json({ success: true })
    } catch (err) {
      console.error('Tanso reactivate error:', err)
      res.status(500).json({ error: 'Failed to reactivate subscription' })
    }
  })

  // Cancel a pending downgrade
  router.post('/tanso/cancel-scheduled-changes', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      if (!isTansoConfigured()) return res.status(503).json({ error: 'Billing not configured' })
      const { subscriptionId } = req.body
      if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required' })

      if (!await verifySubscriptionOwnership(req.visitorId!, subscriptionId)) {
        return res.status(403).json({ error: 'Subscription not found' })
      }

      await tansoCancelScheduledPlanChanges(subscriptionId)
      res.json({ success: true })
    } catch (err) {
      console.error('Tanso cancel scheduled changes error:', err)
      res.status(500).json({ error: 'Failed to cancel scheduled changes' })
    }
  })

  router.get('/tanso/check/:featureKey', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!
      const { featureKey } = req.params
      const result = await deps.checkTansoFeatureAccess(visitorId, featureKey, req.accountEmail)
      res.json(result)
    } catch (err) {
      console.error('Tanso check error:', err)
      res.json({ allowed: false, reason: 'Entitlement check failed' })
    }
  })

  return router
}
