// OpenAI Status Edge Function
// Returns the current OpenAI connection status for the authenticated user

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

    // Check for existing OpenAI integration
    const { data: integration, error } = await supabase
      .from('openai_integrations')
      .select('api_key_prefix, has_usage_access, connected_at, last_synced_at')
      .eq('user_id', user.id)
      .single()

    if (error || !integration) {
      // No integration found - not connected
      return jsonResponse({
        connected: false,
        has_usage_access: false,
      })
    }

    // Integration exists
    return jsonResponse({
      connected: true,
      api_key_prefix: integration.api_key_prefix,
      has_usage_access: integration.has_usage_access,
      connected_at: integration.connected_at,
      last_synced_at: integration.last_synced_at,
    })
  } catch (error) {
    console.error('Error in openai-status:', error)
    return errorResponse(error.message || 'Internal server error', 500)
  }
})
