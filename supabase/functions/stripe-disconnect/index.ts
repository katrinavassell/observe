// Stripe Disconnect Edge Function
// Removes the Stripe integration and optionally clears synced data

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getAuthenticatedUser } from '../_shared/auth.ts'

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

    // Parse request body for options
    let clearData = false
    try {
      const body = await req.json()
      clearData = body.clear_data === true
    } catch {
      // No body or invalid JSON - default to not clearing data
    }

    // Delete the Stripe integration record
    const { error: deleteError } = await supabase
      .from('stripe_integrations')
      .delete()
      .eq('user_id', user.id)

    if (deleteError) {
      console.error('Failed to delete integration:', deleteError)
      return errorResponse('Failed to disconnect Stripe', 500)
    }

    // Optionally clear all synced data
    if (clearData) {
      // Delete in order to respect foreign key constraints
      await supabase.from('usage_records').delete().eq('user_id', user.id)
      await supabase.from('subscriptions').delete().eq('user_id', user.id)
      await supabase.from('customers').delete().eq('user_id', user.id)
      await supabase.from('plans').delete().eq('user_id', user.id)

      // Reset data status
      await supabase
        .from('user_data_status')
        .upsert({
          user_id: user.id,
          data_mode: 'none',
          has_revenue: false,
          has_usage: false,
          revenue_customer_count: 0,
          usage_record_count: 0,
        }, { onConflict: 'user_id' })
    }

    return jsonResponse({
      success: true,
      message: clearData
        ? 'Stripe disconnected and data cleared'
        : 'Stripe disconnected',
    })
  } catch (error) {
    console.error('Error in stripe-disconnect:', error)
    return errorResponse(error.message || 'Internal server error', 500)
  }
})
