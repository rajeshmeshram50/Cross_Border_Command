/* A PO carries its own currency, so an AUD order must never print ₹. Screens bind
   a formatter once (const money = moneyIn(row.currency)) and every call stays as-is. */
export const CCY_SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$',
  SGD: 'S$', AED: 'AED ', JPY: '¥', CNY: '¥',
};

export const ccyCode = (ccy?: string | null) => (ccy || 'INR').toUpperCase();

/** The symbol to sit in front of an amount input; an unknown code prints itself. */
export const ccySymbol = (ccy?: string | null) => {
  const code = ccyCode(ccy);
  return CCY_SYMBOL[code] ?? code + ' ';
};

const ccyLocale = (code: string) => (code === 'INR' ? 'en-IN' : 'en-US');

/** Rounded money, e.g. ₹1,20,000 / A$120,000. */
export const moneyIn = (ccy?: string | null) => {
  const code = ccyCode(ccy);
  const sym = ccySymbol(code);
  const locale = ccyLocale(code);
  return (v: number) => sym + Math.round(v || 0).toLocaleString(locale);
};

/** Money with paise/cents, for the Create PO totals. */
export const money2In = (ccy?: string | null) => {
  const code = ccyCode(ccy);
  const sym = ccySymbol(code);
  const locale = ccyLocale(code);
  return (v: number) => sym + (v || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
