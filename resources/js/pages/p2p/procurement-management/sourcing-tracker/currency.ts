/* Currency helpers for International suppliers (Map Supplier → Supplier Master / New Supplier).
   The currency list and each currency's default ₹ rate come from GET /p2p/form-masters
   (formMasters.ts). This file keeps only what the masters do not hold: which currency a country
   is usually priced in (a first suggestion the user can change) and money formatting. */

/** Usual pricing currency per country (country names as the Country master spells them). */
export const COUNTRY_CURRENCY: Record<string, string> = {
  Australia: 'AUD', Canada: 'CAD', China: 'CNY', France: 'EUR', Germany: 'EUR', 'Hong Kong': 'HKD', Italy: 'EUR',
  Japan: 'JPY', Malaysia: 'MYR', Netherlands: 'EUR', Oman: 'OMR', Qatar: 'QAR', 'Saudi Arabia': 'SAR', Singapore: 'SGD',
  'South Korea': 'KRW', 'Korea, South': 'KRW', Spain: 'EUR', Switzerland: 'CHF', 'United Arab Emirates': 'AED', UAE: 'AED',
  'United Kingdom': 'GBP', 'United States': 'USD', USA: 'USD', Vietnam: 'USD',
};

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', SGD: 'S$', CNY: '¥', JPY: '¥', KRW: '₩', INR: '₹ ' };

/** An amount in a currency: "$1,200.00", "€90.40", "₹ 1,23,456.00" (yen and won have no decimals). */
export const money = (cur: string, n: number) => {
  const d = cur === 'JPY' || cur === 'KRW' ? 0 : 2;
  const num = n.toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${SYMBOL[cur] ?? `${cur} `}${num}`;
};
