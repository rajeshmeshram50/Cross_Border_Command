import { memo } from 'react';

/**
 * Which money this is. The names are the Order module's own suffixes, so the
 * tone drops straight into `ord-amt--${tone}` with no mapping in between.
 * ('bal', not 'balance' — matching PO is the point.)
 */
export type MoneyTone = 'net' | 'paid' | 'bal';

/**
 * Indian-format currency, built ONCE.
 *
 * `Intl.NumberFormat` is expensive to construct and cheap to reuse. Calling
 * `toLocaleString` inside the cell would build a fresh formatter for every
 * amount — four per row, 240 across the table, rebuilt on every filter.
 *
 * Two fraction digits, minimum and maximum: a money column where some rows show
 * decimals and others do not cannot be read down.
 */
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(value: number): string {
  return INR.format(value);
}

/**
 * An amount. Styling is the Order module's `.ord-amt` family — the PO list
 * shows the same four money columns, so Invoice defines none of it.
 */
function MoneyCellBase({ value, tone }: { value: number; tone?: MoneyTone }) {
  return (
    <span className={tone ? `ord-amt ord-amt--${tone}` : 'ord-amt'}>
      {formatINR(value)}
    </span>
  );
}

export const MoneyCell = memo(MoneyCellBase);
