/**
 * Stripe API Client
 *
 * Handles all communication with the Stripe API including:
 * - API key validation and connection
 * - Paginated data fetching
 * - Rate limiting with exponential backoff
 * - Error handling and retries
 *
 * @module lib/stripe-api/client
 */

import type {
  StripeKeyMode,
  StripeKeyValidation,
  StripeCustomer,
  StripeSubscription,
  StripeInvoice,
  StripeUsageRecordSummary,
  StripeList,
  StripeApiError,
} from './types'

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Base URL for Stripe API
 */
const STRIPE_API_BASE = 'https://api.stripe.com/v1'

/**
 * Default page size for list operations
 */
const DEFAULT_PAGE_SIZE = 100

/**
 * Maximum number of retry attempts for rate-limited requests
 */
const MAX_RETRIES = 5

/**
 * Base delay for exponential backoff (ms)
 */
const BASE_RETRY_DELAY_MS = 1000

/**
 * Maximum delay between retries (ms)
 */
const MAX_RETRY_DELAY_MS = 32000

// =============================================================================
// ERROR HANDLING
// =============================================================================

/**
 * Custom error class for Stripe API errors
 */
export class StripeError extends Error {
  public readonly type: string
  public readonly code?: string
  public readonly param?: string
  public readonly statusCode: number

  constructor(error: StripeApiError, statusCode: number) {
    super(error.message)
    this.name = 'StripeError'
    this.type = error.type
    this.code = error.code
    this.param = error.param
    this.statusCode = statusCode
  }

  /**
   * Check if this is a rate limit error
   */
  isRateLimited(): boolean {
    return this.type === 'rate_limit_error' || this.statusCode === 429
  }

  /**
   * Check if this is an authentication error
   */
  isAuthError(): boolean {
    return this.type === 'authentication_error' || this.statusCode === 401
  }

  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    return (
      this.isRateLimited() ||
      this.statusCode >= 500 ||
      this.type === 'api_error'
    )
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Detect whether an API key is test or live mode
 */
export function detectKeyMode(apiKey: string): StripeKeyMode | null {
  if (apiKey.startsWith('sk_test_')) return 'test'
  if (apiKey.startsWith('sk_live_')) return 'live'
  if (apiKey.startsWith('rk_test_')) return 'test'
  if (apiKey.startsWith('rk_live_')) return 'live'
  return null
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(attempt: number): number {
  const exponentialDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt)
  const jitter = Math.random() * 0.3 * exponentialDelay // 0-30% jitter
  return Math.min(exponentialDelay + jitter, MAX_RETRY_DELAY_MS)
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Convert Unix timestamp to ISO string
 */
export function unixToIso(timestamp: number | null): string | null {
  if (!timestamp) return null
  return new Date(timestamp * 1000).toISOString()
}

// =============================================================================
// STRIPE API CLIENT CLASS
// =============================================================================

/**
 * Stripe API client for fetching data
 *
 * @example
 * ```ts
 * const client = new StripeApiClient('sk_test_...')
 * const validation = await client.validateKey()
 * if (validation.isValid) {
 *   for await (const customer of client.listCustomers()) {
 *     console.log(customer.email)
 *   }
 * }
 * ```
 */
export class StripeApiClient {
  private readonly apiKey: string
  private readonly mode: StripeKeyMode | null

  constructor(apiKey: string) {
    this.apiKey = apiKey
    this.mode = detectKeyMode(apiKey)
  }

  // ---------------------------------------------------------------------------
  // PRIVATE METHODS
  // ---------------------------------------------------------------------------

  /**
   * Make an authenticated request to the Stripe API
   */
  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'DELETE'
      params?: Record<string, string | number | undefined>
      body?: Record<string, unknown>
    } = {}
  ): Promise<T> {
    const { method = 'GET', params, body } = options
    let attempt = 0

    while (attempt <= MAX_RETRIES) {
      try {
        // Build URL with query params
        const url = new URL(`${STRIPE_API_BASE}${endpoint}`)
        if (params) {
          Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined) {
              url.searchParams.set(key, String(value))
            }
          })
        }

        // Build request options
        const requestOptions: RequestInit = {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }

        if (body && method !== 'GET') {
          const formData = new URLSearchParams()
          Object.entries(body).forEach(([key, value]) => {
            if (value !== undefined) {
              formData.set(key, String(value))
            }
          })
          requestOptions.body = formData.toString()
        }

        const response = await fetch(url.toString(), requestOptions)

        // Handle non-OK responses
        if (!response.ok) {
          const errorData = await response.json() as { error: StripeApiError }
          throw new StripeError(errorData.error, response.status)
        }

        return await response.json() as T
      } catch (error) {
        // Only retry on retryable errors
        if (error instanceof StripeError && error.isRetryable() && attempt < MAX_RETRIES) {
          const delay = calculateBackoffDelay(attempt)
          console.warn(`Stripe API rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
          await sleep(delay)
          attempt++
          continue
        }
        throw error
      }
    }

    // This should never be reached, but TypeScript requires a return
    throw new Error('Max retries exceeded')
  }

  /**
   * Generic paginated list fetcher using async generator
   */
  private async *paginate<T extends { id: string }>(
    endpoint: string,
    params: Record<string, string | number | undefined> = {}
  ): AsyncGenerator<T, void, undefined> {
    let startingAfter: string | undefined
    let hasMore = true

    while (hasMore) {
      const response = await this.request<StripeList<T>>(endpoint, {
        params: {
          limit: DEFAULT_PAGE_SIZE,
          starting_after: startingAfter,
          ...params,
        },
      })

      for (const item of response.data) {
        yield item
      }

      hasMore = response.has_more
      const lastItem = response.data[response.data.length - 1]
      if (hasMore && lastItem) {
        startingAfter = lastItem.id
      }
    }
  }

  // ---------------------------------------------------------------------------
  // PUBLIC METHODS
  // ---------------------------------------------------------------------------

  /**
   * Get the key mode (test or live)
   */
  getMode(): StripeKeyMode | null {
    return this.mode
  }

  /**
   * Validate the API key by fetching account info
   */
  async validateKey(): Promise<StripeKeyValidation> {
    if (!this.mode) {
      return {
        isValid: false,
        mode: null,
        error: 'Invalid API key format. Key must start with sk_test_ or sk_live_',
      }
    }

    try {
      const account = await this.request<{
        id: string
        settings?: {
          dashboard?: {
            display_name?: string
          }
        }
        business_profile?: {
          name?: string
        }
      }>('/account')

      return {
        isValid: true,
        mode: this.mode,
        accountId: account.id,
        accountName:
          account.settings?.dashboard?.display_name ||
          account.business_profile?.name ||
          account.id,
      }
    } catch (error) {
      if (error instanceof StripeError) {
        if (error.isAuthError()) {
          return {
            isValid: false,
            mode: this.mode,
            error: 'Invalid API key. Please check your key and try again.',
          }
        }
        return {
          isValid: false,
          mode: this.mode,
          error: error.message,
        }
      }
      return {
        isValid: false,
        mode: this.mode,
        error: 'Failed to validate API key. Please check your network connection.',
      }
    }
  }

  /**
   * List all customers with pagination
   *
   * @param options - Optional filters
   * @yields Customer objects one at a time
   */
  async *listCustomers(options?: {
    createdAfter?: number
    createdBefore?: number
    email?: string
  }): AsyncGenerator<StripeCustomer, void, undefined> {
    const params: Record<string, string | number | undefined> = {
      expand: 'data.tax_ids',
    }

    if (options?.createdAfter) {
      params['created[gte]'] = options.createdAfter
    }
    if (options?.createdBefore) {
      params['created[lte]'] = options.createdBefore
    }
    if (options?.email) {
      params.email = options.email
    }

    yield* this.paginate<StripeCustomer>('/customers', params)
  }

  /**
   * List all subscriptions with pagination
   *
   * @param options - Optional filters
   * @yields Subscription objects one at a time
   */
  async *listSubscriptions(options?: {
    status?: 'active' | 'all' | 'canceled' | 'ended' | 'incomplete' | 'past_due' | 'trialing' | 'unpaid'
    customerId?: string
    priceId?: string
    createdAfter?: number
    createdBefore?: number
  }): AsyncGenerator<StripeSubscription, void, undefined> {
    const params: Record<string, string | number | undefined> = {
      status: options?.status || 'all',
      expand: 'data.items.data.price.product',
    }

    if (options?.customerId) {
      params.customer = options.customerId
    }
    if (options?.priceId) {
      params.price = options.priceId
    }
    if (options?.createdAfter) {
      params['created[gte]'] = options.createdAfter
    }
    if (options?.createdBefore) {
      params['created[lte]'] = options.createdBefore
    }

    yield* this.paginate<StripeSubscription>('/subscriptions', params)
  }

  /**
   * List all invoices with pagination
   *
   * @param options - Optional filters
   * @yields Invoice objects one at a time
   */
  async *listInvoices(options?: {
    customerId?: string
    subscriptionId?: string
    status?: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void'
    createdAfter?: number
    createdBefore?: number
  }): AsyncGenerator<StripeInvoice, void, undefined> {
    const params: Record<string, string | number | undefined> = {
      expand: 'data.lines.data.price.product',
    }

    if (options?.customerId) {
      params.customer = options.customerId
    }
    if (options?.subscriptionId) {
      params.subscription = options.subscriptionId
    }
    if (options?.status) {
      params.status = options.status
    }
    if (options?.createdAfter) {
      params['created[gte]'] = options.createdAfter
    }
    if (options?.createdBefore) {
      params['created[lte]'] = options.createdBefore
    }

    yield* this.paginate<StripeInvoice>('/invoices', params)
  }

  /**
   * List usage record summaries for a subscription item
   *
   * @param subscriptionItemId - The subscription item ID
   * @yields Usage record summaries
   */
  async *listUsageRecordSummaries(
    subscriptionItemId: string
  ): AsyncGenerator<StripeUsageRecordSummary, void, undefined> {
    yield* this.paginate<StripeUsageRecordSummary>(
      `/subscription_items/${subscriptionItemId}/usage_record_summaries`
    )
  }

  /**
   * Get a single customer by ID
   */
  async getCustomer(customerId: string): Promise<StripeCustomer> {
    return this.request<StripeCustomer>(`/customers/${customerId}`, {
      params: {
        expand: 'tax_ids',
      },
    })
  }

  /**
   * Get a single subscription by ID
   */
  async getSubscription(subscriptionId: string): Promise<StripeSubscription> {
    return this.request<StripeSubscription>(`/subscriptions/${subscriptionId}`, {
      params: {
        expand: 'items.data.price.product',
      },
    })
  }

  /**
   * Get a single invoice by ID
   */
  async getInvoice(invoiceId: string): Promise<StripeInvoice> {
    return this.request<StripeInvoice>(`/invoices/${invoiceId}`, {
      params: {
        expand: 'lines.data.price.product',
      },
    })
  }

  /**
   * Count total items for each data type
   * Used for progress tracking
   */
  async getCounts(): Promise<{
    customers: number
    subscriptions: number
    invoices: number
  }> {
    // Stripe doesn't have a direct count endpoint, but we can get counts
    // by fetching a single item and checking the total_count (not available for all)
    // For now, we'll estimate by fetching first page
    const [customers, subscriptions, invoices] = await Promise.all([
      this.request<StripeList<StripeCustomer>>('/customers', {
        params: { limit: 1 },
      }),
      this.request<StripeList<StripeSubscription>>('/subscriptions', {
        params: { limit: 1, status: 'all' },
      }),
      this.request<StripeList<StripeInvoice>>('/invoices', {
        params: { limit: 1 },
      }),
    ])

    // Note: Stripe doesn't provide total count, so this is best effort
    // Real count will be determined during sync
    return {
      customers: customers.has_more ? 100 : customers.data.length,
      subscriptions: subscriptions.has_more ? 100 : subscriptions.data.length,
      invoices: invoices.has_more ? 100 : invoices.data.length,
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new Stripe API client
 *
 * @param apiKey - Stripe secret API key
 * @returns Configured Stripe API client
 */
export function createStripeClient(apiKey: string): StripeApiClient {
  return new StripeApiClient(apiKey)
}
