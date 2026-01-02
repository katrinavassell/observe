// OpenAI Connect Edge Function
// Validates an OpenAI API key and syncs usage/cost data

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getAuthenticatedUser } from '../_shared/auth.ts'

interface OpenAIUsageBucket {
  object: string
  start_time: number
  end_time: number
  results: Array<{
    object: string
    input_tokens: number
    output_tokens: number
    num_model_requests: number
    project_id: string | null
    user_id: string | null
    api_key_id: string | null
    model: string | null
    batch: boolean | null
    input_cached_tokens?: number
  }>
}

interface OpenAIUsageResponse {
  object: string
  data: OpenAIUsageBucket[]
  has_more: boolean
  next_page?: string
}

// OpenAI pricing per model (USD per million tokens) - as of late 2024
const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  // GPT-4o
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-2024-11-20': { input: 2.5, output: 10.0 },
  'gpt-4o-2024-08-06': { input: 2.5, output: 10.0 },
  'gpt-4o-2024-05-13': { input: 5.0, output: 15.0 },
  // GPT-4o mini
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.6 },
  // GPT-4 Turbo
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4-turbo-2024-04-09': { input: 10.0, output: 30.0 },
  'gpt-4-turbo-preview': { input: 10.0, output: 30.0 },
  // GPT-4
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-4-0613': { input: 30.0, output: 60.0 },
  'gpt-4-32k': { input: 60.0, output: 120.0 },
  // GPT-3.5 Turbo
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'gpt-3.5-turbo-0125': { input: 0.5, output: 1.5 },
  'gpt-3.5-turbo-1106': { input: 1.0, output: 2.0 },
  'gpt-3.5-turbo-instruct': { input: 1.5, output: 2.0 },
  // o1 models
  'o1': { input: 15.0, output: 60.0 },
  'o1-2024-12-17': { input: 15.0, output: 60.0 },
  'o1-preview': { input: 15.0, output: 60.0 },
  'o1-preview-2024-09-12': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  'o1-mini-2024-09-12': { input: 3.0, output: 12.0 },
  // Embeddings
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  'text-embedding-ada-002': { input: 0.1, output: 0 },
  // Default fallback
  default: { input: 2.5, output: 10.0 },
}

function calculateCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = (model && OPENAI_PRICING[model]) || OPENAI_PRICING.default
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return inputCost + outputCost
}

function getMonthFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
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
    if (!apiKey.startsWith('sk-')) {
      return errorResponse('Invalid API key format. OpenAI API keys should start with sk-')
    }

    // First, validate the API key by calling the models endpoint
    try {
      const validateResponse = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      })

      if (!validateResponse.ok) {
        if (validateResponse.status === 401) {
          return errorResponse('Invalid API key', 401)
        }
        const errorText = await validateResponse.text()
        throw new Error(`OpenAI API error: ${errorText}`)
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid API key')) {
        return errorResponse('Invalid API key', 401)
      }
      throw error
    }

    // Calculate date range (last 30 days)
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 30)

    const startTimestamp = Math.floor(startDate.getTime() / 1000)
    const endTimestamp = Math.floor(endDate.getTime() / 1000)

    // Fetch usage from OpenAI Usage API
    let totalCost = 0
    const monthlyAggregates: Record<string, { provider: string; month: string; cost: number }> = {}
    let hasUsageAccess = false

    try {
      // Try the new usage API endpoint
      const usageUrl = `https://api.openai.com/v1/organization/usage/completions?start_time=${startTimestamp}&end_time=${endTimestamp}&bucket_width=1d`

      const usageResponse = await fetch(usageUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      })

      if (usageResponse.ok) {
        hasUsageAccess = true
        const usageData: OpenAIUsageResponse = await usageResponse.json()

        // Process each bucket
        for (const bucket of usageData.data) {
          const month = getMonthFromTimestamp(bucket.start_time)

          for (const result of bucket.results) {
            const cost = calculateCost(
              result.model,
              result.input_tokens + (result.input_cached_tokens || 0),
              result.output_tokens
            )
            totalCost += cost

            if (!monthlyAggregates[month]) {
              monthlyAggregates[month] = { provider: 'openai', month, cost: 0 }
            }
            monthlyAggregates[month].cost += cost
          }
        }
      } else if (usageResponse.status === 403) {
        // No access to usage API - key is valid but doesn't have org admin access
        console.log('No access to usage API - storing connection without usage data')
      } else {
        console.warn('Usage API error:', await usageResponse.text())
      }
    } catch (error) {
      console.warn('Failed to fetch usage data:', error)
      // Continue - key is valid, just can't access usage
    }

    // Store the integration
    const { error: upsertError } = await supabase
      .from('openai_integrations')
      .upsert({
        user_id: user.id,
        api_key_prefix: apiKey.substring(0, 10) + '...',
        connected_at: new Date().toISOString(),
        has_usage_access: hasUsageAccess,
        last_synced_at: hasUsageAccess ? new Date().toISOString() : null,
      }, { onConflict: 'user_id' })

    // If table doesn't exist, just log and continue
    if (upsertError) {
      console.warn('Could not store integration record:', upsertError.message)
    }

    // Store cost records if we have usage data
    if (Object.keys(monthlyAggregates).length > 0) {
      const costRecords = Object.values(monthlyAggregates).map(agg => ({
        user_id: user.id,
        provider: agg.provider,
        month: agg.month,
        cost: Math.round(agg.cost * 100) / 100, // Round to 2 decimal places
      }))

      // Upsert cost records
      for (const record of costRecords) {
        const { error } = await supabase
          .from('cost_records')
          .upsert(record, { onConflict: 'user_id,provider,month' })

        if (error) {
          console.warn('Failed to upsert cost record:', error.message)
        }
      }

      // Update data status
      await supabase
        .from('user_data_status')
        .upsert({
          user_id: user.id,
          has_costs: true,
        }, { onConflict: 'user_id' })
    }

    return jsonResponse({
      success: true,
      message: hasUsageAccess
        ? `OpenAI connected! Synced $${totalCost.toFixed(2)} in costs.`
        : 'OpenAI connected! Usage data requires organization admin access.',
      has_usage_access: hasUsageAccess,
      cost_synced: Math.round(totalCost * 100) / 100,
      months_synced: Object.keys(monthlyAggregates).length,
    })
  } catch (error) {
    console.error('Error in openai-connect:', error)
    return errorResponse(error.message || 'Internal server error', 500)
  }
})
