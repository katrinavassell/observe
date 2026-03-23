export function formatCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  if (val === 0) return '$0'
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}k`
  if (val >= 0.01) return `$${val.toFixed(2)}`
  return `$${val.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00')}`
}

export function formatPct(val: number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  return `${val.toFixed(0)}%`
}

export function computeMargin(revenue: number, cost: number): number | null {
  if (revenue === 0) return null
  return ((revenue - cost) / revenue) * 100
}
