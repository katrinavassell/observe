export function formatCurrency(
  val: number | string | null | undefined,
): string {
  if (val === null || val === undefined) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  if (n < 0) return `-${formatCurrency(-n)}`;
  if (n === 0) return "$0";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`;
}

export function formatPct(val: number | string | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  return `${n.toFixed(0)}%`;
}

export function computeMargin(revenue: number, cost: number): number | null {
  if (revenue === 0) return null;
  return ((revenue - cost) / revenue) * 100;
}
