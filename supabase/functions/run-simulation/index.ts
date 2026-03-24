// Supabase Edge Function: run-simulation
// Fetches data from metrics-onboarding tables and runs margin simulation

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { runSimulationEngine } from './engine.ts'
import type {
  EdgeFunctionRequest,
  EdgeFunctionResponse,
  UsageRecord,
  BillingRecord,
  SimulationInput,
  DataSourceSummary,
} from './types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://app.tansohq.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify authorization
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client with auth token
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    })

    // Extract userId from JWT instead of trusting client-provided value
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse request body
    const body: EdgeFunctionRequest = await req.json()
    const { pricingModel } = body
    const userId = user.id

    if (!pricingModel) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'INVALID_REQUEST', message: 'Missing required field (pricingModel)' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch subscriptions, customers, and plans separately (avoids FK constraint issues)
    const { data: subscriptions, error: subsError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)

    if (subsError) {
      console.error('Error fetching subscriptions:', subsError)
      return new Response(
        JSON.stringify({ success: false, error: { code: 'DATABASE_ERROR', message: subsError.message } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch customers separately
    const { data: customers, error: custError } = await supabase
      .from('customers')
      .select('*')
      .eq('user_id', userId)

    if (custError) {
      console.error('Error fetching customers:', custError)
      return new Response(
        JSON.stringify({ success: false, error: { code: 'DATABASE_ERROR', message: custError.message } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch plans separately
    const { data: plans, error: plansError } = await supabase
      .from('plans')
      .select('*')
      .eq('user_id', userId)

    if (plansError) {
      console.error('Error fetching plans:', plansError)
      return new Response(
        JSON.stringify({ success: false, error: { code: 'DATABASE_ERROR', message: plansError.message } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build lookup maps for joining data
    const customerMap = new Map((customers || []).map((c: any) => [c.customer_id, c]))
    const planMap = new Map((plans || []).map((p: any) => [p.plan_id, p]))

    // Fetch cost records
    const { data: costRecords, error: costError } = await supabase
      .from('cost_records')
      .select('*')
      .eq('user_id', userId)

    if (costError) {
      console.error('Error fetching cost records:', costError)
      return new Response(
        JSON.stringify({ success: false, error: { code: 'DATABASE_ERROR', message: costError.message } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch usage records
    const { data: usageRecords, error: usageError } = await supabase
      .from('usage_records')
      .select('*')
      .eq('user_id', userId)

    if (usageError) {
      console.error('Error fetching usage records:', usageError)
      return new Response(
        JSON.stringify({ success: false, error: { code: 'DATABASE_ERROR', message: usageError.message } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if we have any data
    const hasData = (subscriptions && subscriptions.length > 0) ||
                    (customers && customers.length > 0) ||
                    (plans && plans.length > 0) ||
                    (costRecords && costRecords.length > 0) ||
                    (usageRecords && usageRecords.length > 0)

    if (!hasData) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NO_DATA', message: 'No data found. Please load sample data or import your data first.' } }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Transform subscriptions to BillingRecord format using lookup maps
    const billingData: BillingRecord[] = (subscriptions || []).map((sub: any) => {
      const customer = customerMap.get(sub.customer_id) || { customer_id: sub.customer_id, email: null }
      const plan = planMap.get(sub.plan_id) || { name: 'Unknown Plan', price_amount: 0, interval_months: 1 }
      const mrr = sub.mrr_override || (plan.price_amount / plan.interval_months)
      return {
        date: sub.created_at,
        customerId: customer.customer_id,
        customerEmail: customer.email,
        amount: mrr,
        currency: 'USD',
        description: plan.name,
        status: 'paid' as const,
      }
    })

    // Transform cost_records to UsageRecord format (costs as usage)
    const costUsageData: UsageRecord[] = (costRecords || []).map((cost: any) => ({
      date: cost.period_start,
      customerId: cost.customer_id || 'aggregate',
      model: cost.cost_type,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: cost.amount,
    }))

    // Transform usage_records to UsageRecord format
    const usageData: UsageRecord[] = (usageRecords || []).map((usage: any) => ({
      date: usage.period_start,
      customerId: usage.customer_id,
      model: usage.metric_key,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: usage.metric_value,
      costUsd: 0, // Usage records don't have cost in this schema
    }))

    // Combine all usage data
    const allUsageData = [...costUsageData, ...usageData]

    // Determine date range from data
    const allDates = [
      ...allUsageData.map((r) => r.date),
      ...billingData.map((r) => r.date),
    ].filter(Boolean).sort()

    const dateRange = {
      start: allDates[0] || new Date().toISOString().split('T')[0],
      end: allDates[allDates.length - 1] || new Date().toISOString().split('T')[0],
    }

    // Build data sources summary
    const dataSources: DataSourceSummary[] = []
    if (subscriptions && subscriptions.length > 0) {
      dataSources.push({
        id: 'subscriptions',
        name: 'Subscriptions',
        type: 'revenue',
        dataTypes: ['revenue'],
      })
    }
    if (costRecords && costRecords.length > 0) {
      dataSources.push({
        id: 'cost_records',
        name: 'Cost Records',
        type: 'costs',
        dataTypes: ['cost'],
      })
    }
    if (usageRecords && usageRecords.length > 0) {
      dataSources.push({
        id: 'usage_records',
        name: 'Usage Records',
        type: 'usage',
        dataTypes: ['usage'],
      })
    }

    // Prepare simulation input
    const simulationInput: SimulationInput = {
      usageData: allUsageData,
      billingData,
      dateRange,
    }

    // Run simulation engine
    const results = runSimulationEngine(simulationInput, pricingModel, dataSources)

    const response: EdgeFunctionResponse = {
      success: true,
      results,
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Simulation error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'CALCULATION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error during simulation',
        },
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
