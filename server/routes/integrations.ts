import { Router, Response } from 'express'
import type { Pool } from 'pg'
import crypto from 'crypto'
import { type AuthRequest } from './auth.js'
import { getUncachableStripeClient } from '../stripe-client.js'
import { calculateCostFromTokens, getModelPricing } from '../model-pricing.js'

type TrackTansoUsageFn = (visitorId: string, featureKey: string, eventName: string) => void

// Clear sample/demo data when transitioning to real user data
async function clearSampleData(db: { query: (text: string, params: unknown[]) => Promise<unknown> }, userId: string): Promise<void> {
  await db.query("DELETE FROM observe_events WHERE user_id = $1 AND source = 'sample'", [userId])
  await db.query("DELETE FROM cost_records WHERE user_id = $1 AND cost_type = 'ai_inference' AND customer_id IS NULL", [userId])
  await db.query("DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id LIKE 'sub_%'", [userId])
  await db.query("DELETE FROM customers WHERE user_id = $1 AND customer_id LIKE 'cus_%'", [userId])
  await db.query("DELETE FROM plans WHERE user_id = $1 AND plan_id IN ('starter', 'pro', 'enterprise')", [userId])
  await db.query("DELETE FROM simulations WHERE user_id = $1 AND name LIKE '%Sample%'", [userId])
}

export function createIntegrationsRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    trackTansoUsage: TrackTansoUsageFn,
    convertReferralIfPending: (visitorId: string) => Promise<void>,
  }
) {
  const router = Router()
  const { trackTansoUsage, convertReferralIfPending } = deps

  // POST /integrations/openai/connect - Validate OpenAI API key and store connection
  router.post('/integrations/openai/connect', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

          if (usageData.data && Array.isArray(usageData.data)) {
            for (const bucket of usageData.data) {
              const bucketTime = bucket.start_time ? new Date(bucket.start_time * 1000).toISOString() : new Date().toISOString()

              if (bucket.results && Array.isArray(bucket.results)) {
                for (const result of bucket.results) {
                  const modelName = result.snapshot_id || 'unknown'
                  const inputTokens = result.input_tokens || 0
                  const outputTokens = result.output_tokens || 0

                  const cost = await calculateCostFromTokens(pool, modelName, inputTokens, outputTokens)

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
            await clearSampleData(pool, visitorId)
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
  router.get('/integrations/openai/status', ensureVisitor, async (req: AuthRequest, res: Response) => {
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
  router.post('/integrations/openai/disconnect', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      await pool.query('DELETE FROM integrations WHERE user_id = $1 AND provider = $2', [req.visitorId, 'openai'])
      res.json({ success: true })
    } catch (err) {
      console.error('OpenAI disconnect error:', err)
      res.status(500).json({ error: 'Failed to disconnect' })
    }
  })

  // POST /integrations/anthropic/connect - Validate Anthropic API key and store connection
  router.post('/integrations/anthropic/connect', ensureVisitor, async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!
      const { api_key } = req.body

      if (!api_key || typeof api_key !== 'string') {
        return res.status(400).json({ error: 'api_key is required' })
      }

      // Validate key by checking auth against the models endpoint (no token cost)
      const validationResponse = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': api_key,
          'anthropic-version': '2023-06-01',
        },
      })

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

          if (usageData.data && Array.isArray(usageData.data)) {
            for (const entry of usageData.data) {
              const modelName = entry.model || 'unknown'
              const inputTokens = entry.input_tokens || 0
              const outputTokens = entry.output_tokens || 0
              const entryDate = entry.date ? new Date(entry.date).toISOString() : new Date().toISOString()

              const cost = await calculateCostFromTokens(pool, modelName, inputTokens, outputTokens)

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
            await clearSampleData(pool, visitorId)
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
  router.get('/integrations/anthropic/status', ensureVisitor, async (req: AuthRequest, res: Response) => {
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
  router.post('/integrations/anthropic/disconnect', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  // GET /referral/code - Get or create a referral code for the current user
  router.get('/referral/code', ensureVisitor, async (req: AuthRequest, res: Response) => {
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
  router.post('/referral/record', ensureVisitor, async (req: AuthRequest, res: Response) => {
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
  router.get('/referral/stats', ensureVisitor, async (req: AuthRequest, res: Response) => {
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
  router.post('/integration-requests', ensureVisitor, async (req: AuthRequest, res: Response) => {
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

  return router
}

// Exported for use by data routes and other modules that call convertReferralIfPending
export function createConvertReferralIfPending(pool: Pool) {
  return async function convertReferralIfPending(visitorId: string): Promise<void> {
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
          coupon: coupon.id,
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
}
