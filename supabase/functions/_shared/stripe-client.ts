// Stripe client helpers for Edge Functions
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STRIPE_API_BASE = 'https://api.stripe.com/v1'
const STRIPE_API_VERSION = '2023-10-16'

// Simple encryption/decryption for API keys (MVP - upgrade to Vault for production)
export function encryptApiKey(key: string): string {
  // Base64 encode with a simple prefix for MVP
  // In production, use Supabase Vault or proper AES encryption
  return btoa(`sk:${key}`)
}

export function decryptApiKey(encrypted: string): string {
  const decoded = atob(encrypted)
  if (decoded.startsWith('sk:')) {
    return decoded.slice(3)
  }
  return decoded
}

export async function getStripeApiKey(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('stripe_integrations')
    .select('encrypted_api_key')
    .eq('user_id', userId)
    .single()

  if (error || !data) {
    throw new Error('No Stripe integration found. Please connect your Stripe account first.')
  }

  return decryptApiKey(data.encrypted_api_key)
}

export interface StripeRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: string
  expand?: string[]
}

export async function stripeRequest<T>(
  apiKey: string,
  endpoint: string,
  options: StripeRequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, expand } = options

  let url = `${STRIPE_API_BASE}/${endpoint}`

  // Add expand parameters if provided
  if (expand && expand.length > 0) {
    const params = new URLSearchParams()
    expand.forEach(e => params.append('expand[]', e))
    url += (url.includes('?') ? '&' : '?') + params.toString()
  }

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_API_VERSION,
    },
    body: method !== 'GET' ? body : undefined,
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error?.message || `Stripe API error: ${response.status}`)
  }

  return data as T
}

export interface StripePaginatedResponse<T> {
  object: 'list'
  data: T[]
  has_more: boolean
  url: string
}

export async function fetchAllStripePages<T>(
  apiKey: string,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const results: T[] = []
  let hasMore = true
  let startingAfter: string | undefined

  while (hasMore) {
    const searchParams = new URLSearchParams({ limit: '100', ...params })
    if (startingAfter) {
      searchParams.set('starting_after', startingAfter)
    }

    const url = `${endpoint}?${searchParams.toString()}`
    const response = await stripeRequest<StripePaginatedResponse<T>>(apiKey, url)

    results.push(...response.data)
    hasMore = response.has_more

    if (response.data.length > 0) {
      startingAfter = (response.data[response.data.length - 1] as { id: string }).id
    } else {
      hasMore = false
    }
  }

  return results
}
