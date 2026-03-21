type Tier = { up_to: number | 'inf'; price_per_unit: number; flat_fee?: number }

/**
 * Format a currency amount for display.
 * Compact: $1.2k for large values, $0.05 for small.
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Compact currency for dense displays (tables, cards).
 */
export function formatCurrencyCompact(val: number): string {
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`
  if (val >= 1) return `$${val.toFixed(2)}`
  return `$${val.toFixed(4)}`
}

/**
 * Format a price-per-unit value with proper precision.
 */
export function formatPrice(amount: number): string {
  if (amount === 0) return '$0'
  if (amount < 0.01) return `$${amount.toPrecision(2)}`
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount)
}

/**
 * Format a usage-based price line, e.g. "$0.05 per message".
 */
export function formatUsagePrice(
  pricePerUnit: number | null | undefined,
  unitLabel: string | undefined,
  maxUsage: number | null | undefined,
  _currency = 'USD',
): string {
  if (pricePerUnit == null) return ''
  const unit = unitLabel || 'unit'
  if (pricePerUnit === 0 && maxUsage != null) {
    return `${maxUsage.toLocaleString()} included`
  }
  if (pricePerUnit === 0 && maxUsage == null) {
    return `Prepaid ${unit}`
  }
  const price = formatPrice(pricePerUnit)
  if (maxUsage != null) {
    return `${maxUsage.toLocaleString()} included, then ${price} per ${unit}`
  }
  return `${price} per ${unit}`
}

/**
 * Detect simple 2-tier prepaid graduated pricing:
 * Tier 1: free (price_per_unit === 0), finite up_to
 * Tier 2: up_to === "inf" (overage tier)
 */
export function isSimplePrepaidGraduated(
  tiers: Tier[] | null | undefined,
): { includedAmount: number; overagePrice: number } | null {
  if (!tiers || tiers.length !== 2) return null
  const first = tiers[0]
  const second = tiers[1]
  if (
    first &&
    second &&
    first.price_per_unit === 0 &&
    typeof first.up_to === 'number' &&
    second.up_to === 'inf'
  ) {
    return { includedAmount: first.up_to, overagePrice: second.price_per_unit }
  }
  return null
}

/**
 * Summarize graduated tiers, e.g. "First 10 GB free, then $0.50/GB".
 */
export function formatTieredSummary(
  tiers: Tier[] | null | undefined,
  unitLabel: string | undefined,
  _currency = 'USD',
): string {
  if (!tiers || tiers.length === 0) return ''
  const unit = unitLabel || 'unit'
  const parts: string[] = []

  for (const tier of tiers) {
    const limit =
      tier.up_to === 'inf'
        ? '+'
        : typeof tier.up_to === 'number'
          ? tier.up_to.toLocaleString()
          : String(tier.up_to)
    const price = formatPrice(tier.price_per_unit)
    if (tier.price_per_unit === 0) {
      parts.push(`First ${limit} ${unit} free`)
    } else if (tier.up_to === 'inf') {
      parts.push(`then ${price}/${unit}`)
    } else {
      parts.push(`then ${price}/${unit} up to ${limit}`)
    }
  }

  return parts.join(', ')
}

/**
 * Determine margin health status from a percentage.
 */
export function getMarginStatus(marginPercent: number): {
  color: string
  bg: string
  borderColor: string
  label: string
} {
  if (marginPercent >= 30) {
    return { color: 'text-green-600', bg: 'bg-green-50', borderColor: 'border-green-200', label: 'Healthy' }
  }
  if (marginPercent >= 10) {
    return { color: 'text-yellow-600', bg: 'bg-yellow-50', borderColor: 'border-yellow-200', label: 'Moderate' }
  }
  return { color: 'text-red-600', bg: 'bg-red-50', borderColor: 'border-red-200', label: 'At Risk' }
}
