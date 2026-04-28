export function formatCurrency(
  val: number | string | null | undefined,
): string {
  if (val === null || val === undefined) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  if (n < 0) return `-${formatCurrency(-n)}`;
  if (n === 0) return "$0";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`;
}

export function formatPct(val: number | string | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "—";
  if (n > 0 && Math.round(n) >= 100) return "99%";
  if (n < -999) return "< -999%";
  return `${n.toFixed(0)}%`;
}

const exactFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
export function fmtExact(n: number): string {
  return exactFmt.format(n);
}

export function computeMargin(revenue: number, cost: number): number | null {
  if (revenue === 0) return null;
  return ((revenue - cost) / revenue) * 100;
}
