/**
 * Shared validation utilities for CSV file uploads.
 *
 * Provides consistent validation across all data import flows:
 * - File size limits
 * - Date format validation
 * - Record-level validation with detailed error reporting
 */

// =============================================================================
// CONSTANTS
// =============================================================================

export const MAX_FILE_SIZE_MB = 10
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

/** Regex for YYYY-MM format */
const MONTH_FORMAT_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/

// =============================================================================
// TYPES
// =============================================================================

export interface FileSizeValidation {
  valid: boolean
  error?: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  validRecords: number
  invalidRecords: number
}

export interface CostRecord {
  customer_id?: string
  month?: string
  cost?: number | string
}

export interface UsageRecord {
  customer_id?: string
  month?: string
  // Support both naming conventions
  metric_key?: string
  metric?: string
  metric_value?: number | string
  value?: number | string
  metric_limit?: number | string
  limit?: number | string
}

// =============================================================================
// FILE VALIDATION
// =============================================================================

/**
 * Validate file size is within limits.
 *
 * @param file - The file to validate
 * @returns Validation result with error message if invalid
 */
export function validateFileSize(file: File): FileSizeValidation {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1)
    return {
      valid: false,
      error: `File too large (${fileSizeMB}MB). Maximum size is ${MAX_FILE_SIZE_MB}MB.`,
    }
  }
  return { valid: true }
}

/**
 * Validate CSV file extension.
 *
 * @param file - The file to validate
 * @returns Validation result with error message if invalid
 */
export function validateCsvExtension(file: File): FileSizeValidation {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    return {
      valid: false,
      error: 'Please upload a CSV file.',
    }
  }
  return { valid: true }
}

// =============================================================================
// DATE VALIDATION
// =============================================================================

/**
 * Validate month format is YYYY-MM.
 *
 * @param value - The date string to validate
 * @returns True if valid YYYY-MM format
 *
 * @example
 * validateMonthFormat('2024-01') // true
 * validateMonthFormat('2024-1')  // false
 * validateMonthFormat('01-2024') // false
 */
export function validateMonthFormat(value: string): boolean {
  if (!value || typeof value !== 'string') return false
  return MONTH_FORMAT_REGEX.test(value.trim())
}

// =============================================================================
// RECORD VALIDATION
// =============================================================================

/**
 * Validate cost records from CSV upload.
 *
 * @param records - Array of parsed cost records
 * @returns Validation result with valid/invalid counts and error messages
 */
export function validateCostRecords(records: CostRecord[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  let validRecords = 0
  let invalidRecords = 0

  records.forEach((record, index) => {
    const rowNum = index + 2 // Account for header row and 1-based indexing
    const rowErrors: string[] = []

    // Validate customer_id
    if (!record.customer_id || String(record.customer_id).trim() === '') {
      rowErrors.push('missing customer_id')
    }

    // Validate month format
    if (!record.month) {
      rowErrors.push('missing month')
    } else if (!validateMonthFormat(String(record.month))) {
      rowErrors.push(`invalid month format "${record.month}" (expected YYYY-MM)`)
    }

    // Validate cost value
    const costValue = parseFloat(String(record.cost ?? ''))
    if (isNaN(costValue)) {
      rowErrors.push('invalid cost value')
    } else if (costValue < 0) {
      rowErrors.push('negative cost value')
    }

    if (rowErrors.length > 0) {
      invalidRecords++
      // Only collect first 5 error messages to avoid overwhelming the user
      if (errors.length < 5) {
        errors.push(`Row ${rowNum}: ${rowErrors.join(', ')}`)
      }
    } else {
      validRecords++
    }
  })

  // Add summary warning if we truncated errors
  if (invalidRecords > 5) {
    warnings.push(`...and ${invalidRecords - 5} more invalid rows`)
  }

  return {
    valid: validRecords > 0,
    errors,
    warnings,
    validRecords,
    invalidRecords,
  }
}

/**
 * Validate usage records from CSV upload.
 * Supports both naming conventions:
 * - metric_key/metric_value/metric_limit (database style)
 * - metric/value/limit (CSV template style)
 *
 * @param records - Array of parsed usage records
 * @returns Validation result with valid/invalid counts and error messages
 */
export function validateUsageRecords(records: UsageRecord[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  let validRecords = 0
  let invalidRecords = 0

  records.forEach((record, index) => {
    const rowNum = index + 2 // Account for header row and 1-based indexing
    const rowErrors: string[] = []

    // Validate customer_id
    if (!record.customer_id || String(record.customer_id).trim() === '') {
      rowErrors.push('missing customer_id')
    }

    // Validate month format
    if (!record.month) {
      rowErrors.push('missing month')
    } else if (!validateMonthFormat(String(record.month))) {
      rowErrors.push(`invalid month format "${record.month}" (expected YYYY-MM)`)
    }

    // Validate metric_key (accept either 'metric_key' or 'metric')
    const metricKey = record.metric_key || record.metric
    if (!metricKey || String(metricKey).trim() === '') {
      rowErrors.push('missing metric')
    }

    // Validate metric_value (accept either 'metric_value' or 'value')
    const rawValue = record.metric_value ?? record.value ?? ''
    const metricValue = parseFloat(String(rawValue))
    if (isNaN(metricValue)) {
      rowErrors.push('invalid value')
    } else if (metricValue < 0) {
      rowErrors.push('negative value')
    }

    // Validate limit (optional, but must be valid if present)
    const rawLimit = record.metric_limit ?? record.limit
    if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
      const limitValue = parseFloat(String(rawLimit))
      if (isNaN(limitValue)) {
        rowErrors.push('invalid limit')
      } else if (limitValue < 0) {
        rowErrors.push('negative limit')
      }
    }

    if (rowErrors.length > 0) {
      invalidRecords++
      // Only collect first 5 error messages to avoid overwhelming the user
      if (errors.length < 5) {
        errors.push(`Row ${rowNum}: ${rowErrors.join(', ')}`)
      }
    } else {
      validRecords++
    }
  })

  // Add summary warning if we truncated errors
  if (invalidRecords > 5) {
    warnings.push(`...and ${invalidRecords - 5} more invalid rows`)
  }

  return {
    valid: validRecords > 0,
    errors,
    warnings,
    validRecords,
    invalidRecords,
  }
}

/**
 * Format validation result for toast display.
 *
 * @param result - The validation result
 * @param entityName - Name of what was validated (e.g., "cost records")
 * @returns Formatted description string
 */
export function formatValidationSummary(result: ValidationResult, entityName: string): string {
  if (result.invalidRecords === 0) {
    return `${result.validRecords} ${entityName} loaded`
  }
  return `${result.validRecords} ${entityName} loaded, ${result.invalidRecords} invalid rows skipped`
}
