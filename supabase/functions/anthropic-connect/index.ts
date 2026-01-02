// Anthropic Connect Edge Function
// Validates an Anthropic API key and syncs usage/cost data

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getAuthenticatedUser } from '../_shared/auth.ts'

interface AnthropicUsageResponse {
  data: Array<{
    date: string
    model: string
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }>
  has_more?: boolean
}

// Anthropic pricing per model (USD per million tokens)
const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  // Claude 3.5 Sonnet
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20240620': { input: 3.0, output: 15.0 },
  // Claude 3.5 Haiku
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  // Claude 3 Opus
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  // Claude 3 Sonnet
  'claude-3-sonnet-20240229': { input: 3.0, output: 15.0 },
  // Claude 3 Haiku
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  // Default fallback
  default: { input: 3.0, output: 15.0 },
}

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = ANTHROPIC_PRICING[model] || ANTHROPIC_PRICING.default
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return inputCost + outputCost
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
    if (!apiKey.startsWith('sk-ant-')) {
      return errorResponse('Invalid API key format. Anthropic API keys should start with sk-ant-')
    }

    // Calculate date range (last 30 days)
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 30)

    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    // Fetch usage from Anthropic Admin API
    let usageData: AnthropicUsageResponse | null = null
    let totalCost = 0
    const monthlyAggregates: Record<string, { provider: string; month: string; cost: number }> = {}

    try {
      const response = await fetch(
        `https://api.anthropic.com/v1/organizations/usage?start_date=${startDateStr}&end_date=${endDateStr}`,
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        if (response.status === 401) {
          return errorResponse('Invalid API key. Please check your Anthropic API key.', 401)
        }
        if (response.status === 403) {
          // API key valid but no admin access - try to validate by calling messages API
          const validateResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-3-haiku-20240307',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'test' }],
            }),
          })

          // If we get a response (even an error about content), the key is valid
          if (validateResponse.status !== 401) {
            // Key is valid but no usage API access - store connection without usage data
            await supabase
              .from('anthropic_integrations')
              .upsert({
                user_id: user.id,
                api_key_prefix: apiKey.substring(0, 15) + '...',
                connected_at: new Date().toISOString(),
                has_usage_access: false,
              }, { onConflict: 'user_id' })

            return jsonResponse({
              success: true,
              message: 'Anthropic connected! Usage data not available with this key type.',
              has_usage_access: false,
              cost_synced: 0,
            })
          }

          return errorResponse('Invalid API key', 401)
        }
        throw new Error(`Anthropic API error: ${errorText}`)
      }

      usageData = await response.json()

      // Aggregate usage by month
      if (usageData?.data) {
        for (const record of usageData.data) {
          const month = record.date.substring(0, 7) // YYYY-MM
          const cost = calculateCost(record.model, record.input_tokens, record.output_tokens)
          totalCost += cost

          const key = month
          if (!monthlyAggregates[key]) {
            monthlyAggregates[key] = { provider: 'anthropic', month, cost: 0 }
          }
          monthlyAggregates[key].cost += cost
        }
      }
    } catch (error) {
      console.error('Anthropic API error:', error)
      // If API call fails, still try to validate the key format
      if (error instanceof Error && error.message.includes('401')) {
        return errorResponse('Invalid API key', 401)
      }
      // Continue with connection even if usage fetch fails
    }

    // Store the integration
    await supabase
      .from('anthropic_integrations')
      .upsert({
        user_id: user.id,
        api_key_prefix: apiKey.substring(0, 15) + '...',
        connected_at: new Date().toISOString(),
        has_usage_access: usageData !== null,
        last_synced_at: usageData ? new Date().toISOString() : null,
      }, { onConflict: 'user_id' })

    // Store cost records if we have usage data
    if (Object.keys(monthlyAggregates).length > 0) {
      const costRecords = Object.values(monthlyAggregates).map(agg => ({
        user_id: user.id,
        provider: agg.provider,
        month: agg.month,
        cost: Math.round(agg.cost * 100) / 100, // Round to 2 decimal places
      }))

      // Upsert cost records (update if exists for same user/provider/month)
      for (const record of costRecords) {
        await supabase
          .from('cost_records')
          .upsert(record, { onConflict: 'user_id,provider,month' })
      }

      // Update data status
      await supabase
        .from('user_data_status')
        .upsert({
          user_id: user.id,
          has_costs: true,
          costs_record_count: costRecords.length,
        }, { onConflict: 'user_id' })
    }

    return jsonResponse({
      success: true,
      message: usageData
        ? `Anthropic connected! Synced $${totalCost.toFixed(2)} in costs.`
        : 'Anthropic connected!',
      has_usage_access: usageData !== null,
      cost_synced: Math.round(totalCost * 100) / 100,
      months_synced: Object.keys(monthlyAggregates).length,
    })
  } catch (error) {
    console.error('Error in anthropic-connect:', error)
    return errorResponse(error.message || 'Internal server error', 500)
  }
})
