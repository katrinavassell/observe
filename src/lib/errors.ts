/**
 * Error Handling Utilities
 *
 * Provides standardized error handling patterns for the application.
 * Use these utilities to ensure consistent error handling and user feedback.
 *
 * @module lib/errors
 */

import { toast } from 'vue-sonner'

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Base error class for application-specific errors.
 * Extends the native Error with additional context.
 */
export class AppError extends Error {
  /** HTTP status code if applicable */
  public readonly statusCode?: number
  /** Error code for programmatic handling */
  public readonly code?: string
  /** Additional context data */
  public readonly context?: Record<string, unknown>

  constructor(
    message: string,
    options?: {
      statusCode?: number
      code?: string
      context?: Record<string, unknown>
      cause?: Error
    }
  ) {
    super(message, { cause: options?.cause })
    this.name = 'AppError'
    this.statusCode = options?.statusCode
    this.code = options?.code
    this.context = options?.context
  }
}

/**
 * Error thrown when a network request fails.
 */
export class NetworkError extends AppError {
  constructor(message: string, options?: { cause?: Error; statusCode?: number }) {
    super(message, { ...options, code: 'NETWORK_ERROR' })
    this.name = 'NetworkError'
  }
}

/**
 * Error thrown when authentication fails or session expires.
 */
export class AuthError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, { code: 'AUTH_ERROR', statusCode: 401 })
    this.name = 'AuthError'
  }
}

/**
 * Error thrown when user lacks permission for an action.
 */
export class PermissionError extends AppError {
  constructor(message = 'Permission denied') {
    super(message, { code: 'PERMISSION_ERROR', statusCode: 403 })
    this.name = 'PermissionError'
  }
}

/**
 * Error thrown when validation fails.
 */
export class ValidationError extends AppError {
  /** Field-level validation errors */
  public readonly fieldErrors?: Record<string, string>

  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message, { code: 'VALIDATION_ERROR', statusCode: 400 })
    this.name = 'ValidationError'
    this.fieldErrors = fieldErrors
  }
}

// =============================================================================
// ERROR HANDLING UTILITIES
// =============================================================================

/**
 * Extract a user-friendly message from any error.
 *
 * @param error - The error to extract a message from
 * @param fallback - Fallback message if extraction fails
 * @returns User-friendly error message
 *
 * @example
 * ```ts
 * try {
 *   await fetchData()
 * } catch (error) {
 *   const message = getErrorMessage(error, 'Failed to load data')
 *   toast.error(message)
 * }
 * ```
 */
export function getErrorMessage(error: unknown, fallback = 'An unexpected error occurred'): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return fallback
}

/**
 * Check if an error is a specific type.
 *
 * @param error - The error to check
 * @param code - The error code to match
 * @returns True if the error matches the code
 */
export function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof AppError && error.code === code
}

/**
 * Handle an async operation with standardized error handling.
 * Shows a toast on error and optionally on success.
 *
 * @param operation - The async operation to perform
 * @param options - Configuration options
 * @returns The result of the operation, or null on error
 *
 * @example
 * ```ts
 * const result = await handleAsync(
 *   () => uploadFile(file),
 *   {
 *     errorMessage: 'Failed to upload file',
 *     successMessage: 'File uploaded successfully!',
 *   }
 * )
 * if (result) {
 *   // Handle success
 * }
 * ```
 */
export async function handleAsync<T>(
  operation: () => Promise<T>,
  options: {
    /** Message to show on error */
    errorMessage?: string
    /** Message to show on success */
    successMessage?: string
    /** Additional description for error toast */
    errorDescription?: string
    /** Callback on error (for additional handling) */
    onError?: (error: unknown) => void
    /** Whether to rethrow the error after handling */
    rethrow?: boolean
  } = {}
): Promise<T | null> {
  try {
    const result = await operation()
    if (options.successMessage) {
      toast.success(options.successMessage)
    }
    return result
  } catch (error) {
    const message = options.errorMessage || getErrorMessage(error)
    const description = options.errorDescription || (
      error instanceof Error && error.message !== message
        ? error.message
        : undefined
    )

    toast.error(message, description ? { description } : undefined)

    if (options.onError) {
      options.onError(error)
    }

    if (options.rethrow) {
      throw error
    }

    return null
  }
}

/**
 * Wrap an async function with standardized error handling.
 * Returns a new function that handles errors automatically.
 *
 * @param fn - The async function to wrap
 * @param options - Error handling options
 * @returns Wrapped function with error handling
 *
 * @example
 * ```ts
 * const safeSubmit = withErrorHandling(
 *   async (data: FormData) => await api.submit(data),
 *   { errorMessage: 'Failed to submit form' }
 * )
 *
 * // Later:
 * await safeSubmit(formData)
 * ```
 */
export function withErrorHandling<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: Parameters<typeof handleAsync>[1] = {}
): (...args: TArgs) => Promise<TResult | null> {
  return (...args: TArgs) => handleAsync(() => fn(...args), options)
}

// =============================================================================
// LOGGING UTILITIES
// =============================================================================

/**
 * Log an error with context for debugging.
 * In production, this could be extended to send to an error tracking service.
 *
 * @param error - The error to log
 * @param context - Additional context about where/why the error occurred
 */
export function logError(error: unknown, context?: string): void {
  const message = getErrorMessage(error)
  const prefix = context ? `[${context}]` : '[Error]'

  console.error(`${prefix} ${message}`, error)

  // In production, you might want to send this to a service like Sentry:
  // if (import.meta.env.PROD) {
  //   Sentry.captureException(error, { extra: { context } })
  // }
}
