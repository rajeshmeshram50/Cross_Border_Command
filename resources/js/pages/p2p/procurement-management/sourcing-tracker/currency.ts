/* Currencies for International suppliers (Map Supplier → Supplier Master / New Supplier): the
   design's list, a default ₹ rate per unit (the user can change it), and each country's currency.
   Dummy rates until the API supplies live ones. */

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SGD', 'SAR', 'OMR', 'CNY', 'JPY', 'KRW', 'MYR'];
export const CURRENCY_OPTIONS = CURRENCIES.map(c => ({ value: c, label: c }));

/** Default ₹ per one unit of the currency. */
export const FX: Record<string, number> = {
  USD: 83.25, EUR: 90.4, GBP: 105.6, AED: 22.67, SGD: 62.1, SAR: 22.2, OMR: 216.3, CNY: 11.52, JPY: 0.556, KRW: 0.0612, MYR: 18.85,
};

/** Overseas countries a supplier can be in, with the currency it is priced in. */
export const COUNTRY_CURRENCY: Record<string, string> = {
  China: 'CNY', France: 'EUR', Germany: 'EUR', Italy: 'EUR', Japan: 'JPY', Malaysia: 'MYR', Netherlands: 'EUR', Oman: 'OMR',
  'Saudi Arabia': 'SAR', Singapore: 'SGD', 'South Korea': 'KRW', Spain: 'EUR', UAE: 'AED', 'United Kingdom': 'GBP', USA: 'USD', Vietnam: 'USD',
};
export const COUNTRY_OPTIONS = Object.keys(COUNTRY_CURRENCY).sort().map(c => ({ value: c, label: c }));

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', SGD: 'S$', CNY: '¥', JPY: '¥', KRW: '₩', INR: '₹ ' };

/** An amount in a currency: "$1,200.00", "€90.40", "₹ 1,23,456.00" (yen and won have no decimals). */
export const money = (cur: string, n: number) => {
  const d = cur === 'JPY' || cur === 'KRW' ? 0 : 2;
  const num = n.toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${SYMBOL[cur] ?? `${cur} `}${num}`;
};
