// Stripe Status Edge Function
// Returns the current Stripe connection status for the authenticated user

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getAuthenticatedUser } from '../_shared/auth.ts'

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    // Authenticate user
    const { user, supabase } = await getAuthenticatedUser(req)

    // Check for existing Stripe integration
    const { data: integration, error } = await supabase
      .from('stripe_integrations')
      .select('account_id, account_name, is_live_mode, connected_at')
      .eq('user_id', user.id)
      .single()

    if (error || !integration) {
      // No integration found - not connected
      return jsonResponse({
        connected: false,
        account_id: null,
        account_name: null,
      })
    }

    // Integration exists
    return jsonResponse({
      connected: true,
      account_id: integration.account_id,
      account_name: integration.account_name,
      is_live_mode: integration.is_live_mode,
      connected_at: integration.connected_at,
    })
  } catch (error) {
    console.error('Error in stripe-status:', error)
    return errorResponse(error.message || 'Internal server error', 500)
  }
})
