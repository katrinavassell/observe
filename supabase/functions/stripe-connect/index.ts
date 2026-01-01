// Stripe Connect Edge Function
// Validates and stores a Stripe API key for the authenticated user

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getAuthenticatedUser } from '../_shared/auth.ts'
import { encryptApiKey, stripeRequest } from '../_shared/stripe-client.ts'

interface StripeAccount {
  id: string
  object: 'account'
  business_profile?: {
    name?: string
    url?: string
  }
  settings?: {
    dashboard?: {
      display_name?: string
    }
  }
  email?: string
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    // Authenticate user
    const { user, supabase } = await getAuthenticatedUser(req)

    // Parse request body
    const body = await req.json()
    const apiKey = body.api_key

    if (!apiKey) {
      return errorResponse('Missing api_key in request body')
    }

    // Validate API key format
    if (!apiKey.startsWith('sk_') && !apiKey.startsWith('rk_')) {
      return errorResponse('Invalid API key format. Use a secret key (sk_) or restricted key (rk_)')
    }

    // Validate the API key by calling Stripe's account endpoint
    let account: StripeAccount
    try {
      account = await stripeRequest<StripeAccount>(apiKey, 'account')
    } catch (error) {
      return errorResponse(`Invalid Stripe API key: ${error.message}`, 401)
    }

    // Determine account name
    const accountName =
      account.business_profile?.name ||
      account.settings?.dashboard?.display_name ||
      account.email ||
      account.id

    // Determine if live mode
    const isLiveMode = apiKey.startsWith('sk_live_') || apiKey.startsWith('rk_live_')

    // Encrypt and store the API key
    const encryptedKey = encryptApiKey(apiKey)

    const { error: upsertError } = await supabase
      .from('stripe_integrations')
      .upsert(
        {
          user_id: user.id,
          encrypted_api_key: encryptedKey,
          account_id: account.id,
          account_name: accountName,
          is_live_mode: isLiveMode,
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )

    if (upsertError) {
      console.error('Database error:', upsertError)
      return errorResponse('Failed to store Stripe integration', 500)
    }

    return jsonResponse({
      success: true,
      message: 'Stripe connected successfully',
      account_name: accountName,
      account_id: account.id,
    })
  } catch (error) {
    console.error('Error in stripe-connect:', error)
    return errorResponse(error.message || 'Internal server error', 500)
  }
})
