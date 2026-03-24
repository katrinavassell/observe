import { Router, Response } from 'express'
import type { Pool } from 'pg'
import crypto from 'crypto'
import { type AuthRequest } from './auth.js'
import { apiKeyStore } from '../api-key-store.js'
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
  tansoCreateCheckoutSession,
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
    if (result?.invoice?.id) {
      await tansoMarkInvoicePaid(result.invoice.id)
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

export function createTrackTansoUsage() {
  return function trackTansoUsage(visitorId: string, featureKey: string, eventName: string) {
    if (!isTansoConfigured()) return
    try {
      tansoIngestEvent({
        eventIdempotencyKey: `${visitorId}-${featureKey}-${Date.now()}`,
        eventName,
        occurredAt: new Date().toISOString(),
        customerReferenceId: visitorId,
        featureKey,
      }).catch((err: unknown) => {
        console.error('Tanso usage tracking error:', err)
      })
    } catch (err) {
      console.error('Tanso usage tracking error:', err)
    }
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

  // API Key Management (per-session Tanso API keys)
  router.post('/tanso/key', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      let { apiKey } = req.body
      if (!apiKey || typeof apiKey !== 'string') {
        return res.status(400).json({ error: 'API key is required' })
      }
      // Strip "Bearer " prefix if present
      apiKey = apiKey.replace(/^Bearer\s+/i, '').trim()
      if (!apiKey.startsWith('sk_') && !apiKey.startsWith('ts_')) {
        return res.status(400).json({ error: 'Invalid API key format (must start with sk_ or ts_)' })
      }
      apiKeyStore.set(req.session.id, apiKey)
      res.json({ success: true, message: 'API key set for this session' })
    } catch (err) {
      console.error('Set API key error:', err)
      res.status(500).json({ error: 'Failed to set API key' })
    }
  })

  router.get('/tanso/key/status', ensureVisitor, async (req: AuthRequest, res: Response) => {
    const hasSessionKey = apiKeyStore.has(req.session.id)
    const hasEnvKey = !!process.env.TANSO_API_KEY
    res.json({
      hasApiKey: hasSessionKey || hasEnvKey,
      environment: hasSessionKey ? 'session' : hasEnvKey ? 'environment' : 'none',
    })
  })

  router.delete('/tanso/key', ensureVisitor, async (req: AuthRequest, res: Response) => {
    apiKeyStore.delete(req.session.id)
    res.json({ success: true })
  })

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

    try {
      await getOrCreateTansoCustomer(pool, visitorId, req.accountEmail)
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
          // UPGRADE — apply plan change, then handle payment if needed
          await tansoChangeSubscriptionPlan(activeSub.id, planId, 'UPGRADE')
          const updated = await tansoGetCustomer(visitorId)
          const newSub = updated?.subscriptions?.find((s: any) => s.isActive)

          // If upgrading from free to paid, need Stripe checkout for the price difference
          if (currentPrice === 0 && targetPrice > 0) {
            try {
              const invoices = await tansoListCustomerInvoices(visitorId)
              const items = Array.isArray(invoices) ? invoices : invoices?.items ?? []
              const unpaid = items.find((inv: any) => inv.status !== 'PAID' && inv.amount > 0)
              if (unpaid?.id) {
                const checkout = await tansoCreateCheckoutSession(unpaid.id)
                if (checkout?.url) {
                  return res.json({ success: true, subscription: newSub, checkoutUrl: checkout.url, changeType: 'upgrade' })
                }
              }
            } catch (checkoutErr) {
              console.error('Upgrade checkout error:', checkoutErr)
              return res.status(500).json({ error: 'Plan upgraded but payment setup failed. Please check your billing.' })
            }
          }

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

      // Fetch invoices separately (reference: SaaSSubscriptionSite Checkout.tsx)
      const invoices = await tansoListCustomerInvoices(visitorId)
      const invoiceItems = Array.isArray(invoices) ? invoices : invoices?.items ?? []
      const unpaidInvoice = invoiceItems
        .filter((inv: any) => inv.status !== 'PAID')
        .sort((a: any, b: any) => new Date(b.dueDate || b.createdAt || 0).getTime() - new Date(a.dueDate || a.createdAt || 0).getTime())[0]

      if (!unpaidInvoice?.id) {
        return res.json({ success: true, subscription })
      }

      // Paid plan — must go through Stripe checkout
      if (unpaidInvoice.amount > 0) {
        try {
          const checkout = await tansoCreateCheckoutSession(unpaidInvoice.id)
          if (checkout?.url) {
            return res.json({ success: true, subscription, checkoutUrl: checkout.url })
          }
          // No URL returned — Stripe may not be configured on Tanso side
          console.error('Stripe checkout returned no URL — is Stripe connected in Tanso?')
          return res.status(500).json({ error: 'Payment setup failed. Please ensure Stripe is connected.' })
        } catch (checkoutErr) {
          console.error('Stripe checkout session error:', checkoutErr)
          return res.status(500).json({ error: 'Payment setup failed. Please try again.' })
        }
      }

      // Free plan ($0 invoice) — mark as paid to activate
      try { await tansoMarkInvoicePaid(unpaidInvoice.id) } catch (_) { /* best effort */ }
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
      // Look up Stripe customer by email
      const visitor = await pool.query('SELECT email FROM visitors WHERE id = $1', [req.visitorId])
      const email = visitor.rows[0]?.email
      if (!email) return res.status(400).json({ error: 'No email found for account' })

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

  // Cancel subscription (supports IMMEDIATELY or END_OF_PERIOD)
  router.post('/tanso/cancel', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      if (!isTansoConfigured()) return res.status(503).json({ error: 'Billing not configured' })
      const { subscriptionId, cancelMode = 'IMMEDIATELY' } = req.body
      if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required' })
      if (cancelMode !== 'IMMEDIATELY' && cancelMode !== 'END_OF_PERIOD') {
        return res.status(400).json({ error: 'cancelMode must be IMMEDIATELY or END_OF_PERIOD' })
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
