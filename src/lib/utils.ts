import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`
  }
  return `$${value.toFixed(0)}`
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatNumber(value: number): string {
  return value.toLocaleString()
}

/**
 * Check if the browser is currently online
 */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

/**
 * Check if an error is a network-related error
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false

  // Check for common network error patterns
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes('network') ||
      message.includes('failed to fetch') ||
      message.includes('net::') ||
      message.includes('timeout') ||
      message.includes('connection')
    )
  }

  return false
}

/**
 * Retry a function with exponential backoff
 * @param fn - The async function to retry
 * @param options - Retry options
 * @returns The result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    baseDelayMs?: number
    maxDelayMs?: number
    onRetry?: (attempt: number, error: unknown) => void
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    onRetry,
  } = options

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Don't retry if we're offline
      if (!isOnline()) {
        throw new Error('You appear to be offline. Please check your connection and try again.')
      }

      // Only retry network errors
      if (!isNetworkError(error)) {
        throw error
      }

      // Don't retry if we've exhausted attempts
      if (attempt === maxRetries) {
        throw error
      }

      // Calculate delay with exponential backoff and jitter
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        maxDelayMs
      )

      onRetry?.(attempt + 1, error)

      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
