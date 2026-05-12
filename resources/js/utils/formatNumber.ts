/**
 * Compact number formatter for KPI cards.
 *
 *   999     -> "999"
 *   4000    -> "4K"
 *   4500    -> "4.5K"
 *   50000   -> "50K"
 *   1660000 -> "1.7M"
 *   2000000 -> "2M"
 *
 * Uses Intl.NumberFormat compact notation with 1 fraction digit so cards
 * never overflow ("₹5,898...." -> "₹5.9K").
 */

const COMPACT_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const PLAIN_FMT = new Intl.NumberFormat('en-IN');

export function formatCompact(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n == null || !Number.isFinite(n)) return '0';
  if (Math.abs(n) < 1000) return PLAIN_FMT.format(n);
  return COMPACT_FMT.format(n);
}

export function formatCurrencyCompact(
  value: number | string | null | undefined,
  symbol = '₹',
): string {
  return `${symbol}${formatCompact(value)}`;
}
