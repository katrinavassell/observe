/**
 * Logger utility for consistent logging across the application.
 * In production, errors can be sent to a monitoring service.
 * In development, logs are written to console.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  context?: Record<string, unknown>
  timestamp: string
}

const isDev = import.meta.env.DEV

/**
 * Sanitize error for user display - removes technical details
 */
export function sanitizeErrorForUser(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    // Network errors
    if (message.includes('fetch') || message.includes('network') || message.includes('failed to fetch')) {
      return 'Unable to connect to the server. Please check your internet connection and try again.'
    }

    // Auth errors
    if (message.includes('not authenticated') || message.includes('unauthorized') || message.includes('jwt')) {
      return 'Your session has expired. Please sign in again.'
    }

    // Rate limiting
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return 'Too many requests. Please wait a moment and try again.'
    }

    // Database errors - don't expose internal details
    if (message.includes('duplicate') || message.includes('unique constraint')) {
      return 'This record already exists.'
    }

    if (message.includes('foreign key') || message.includes('constraint')) {
      return 'Unable to complete this operation due to related data.'
    }

    // Generic database errors
    if (message.includes('postgres') || message.includes('database')) {
      return 'A database error occurred. Please try again.'
    }

    // If message is reasonably user-friendly (short and no technical jargon), use it
    if (error.message.length < 100 && !message.includes('error:') && !message.includes('exception')) {
      return error.message
    }
  }

  // Fallback for unknown errors
  return 'An unexpected error occurred. Please try again.'
}

/**
 * Format log entry for console output
 */
function formatLogEntry(entry: LogEntry): string {
  const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : ''
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${contextStr}`
}

/**
 * Create a log entry
 */
function createLogEntry(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
  return {
    level,
    message,
    context,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Logger object with methods for each log level
 */
export const logger = {
  debug(message: string, context?: Record<string, unknown>) {
    if (isDev) {
      const entry = createLogEntry('debug', message, context)
      console.warn(formatLogEntry(entry))
    }
  },

  info(message: string, context?: Record<string, unknown>) {
    if (isDev) {
      const entry = createLogEntry('info', message, context)
      console.warn(formatLogEntry(entry))
    }
  },

  warn(message: string, context?: Record<string, unknown>) {
    const entry = createLogEntry('warn', message, context)
    if (isDev) {
      console.warn(formatLogEntry(entry))
    }
    // In production, could send to monitoring service
  },

  error(message: string, error?: unknown, context?: Record<string, unknown>) {
    const errorContext = {
      ...context,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: isDev ? error.stack : undefined,
      } : error,
    }

    const entry = createLogEntry('error', message, errorContext)

    if (isDev) {
      console.error(formatLogEntry(entry))
      if (error instanceof Error && error.stack) {
        console.error(error.stack)
      }
    }

    // In production, could send to monitoring service like Sentry
    // Example: Sentry.captureException(error, { extra: context })
  },
}

export default logger
