// Country-specific phone rules. `digits` = required count of NATIONAL digits
// (excludes country code). `cc` = country code (digits, no +). `mobilePrefix`
// is a regex matched against the first national digit(s) to catch obviously
// wrong numbers (e.g. India mobiles must start with 6-9).
export type PhoneRule = {
  country: string;
  cc: string;
  digits: number | [number, number];
  mobilePrefix?: RegExp;
  example: string;
};

export const PHONE_RULES: PhoneRule[] = [
  { country: 'India',          cc: '91',  digits: 10,        mobilePrefix: /^[6-9]/, example: '+91 9876543210' },
  { country: 'United States',  cc: '1',   digits: 10,        mobilePrefix: /^[2-9]/, example: '+1 2125551234' },
  { country: 'Canada',         cc: '1',   digits: 10,        mobilePrefix: /^[2-9]/, example: '+1 4165551234' },
  { country: 'United Kingdom', cc: '44',  digits: 10,                                example: '+44 7911123456' },
  { country: 'UAE',            cc: '971', digits: 9,                                 example: '+971 501234567' },
  { country: 'Singapore',      cc: '65',  digits: 8,                                 example: '+65 81234567' },
  { country: 'Australia',      cc: '61',  digits: 9,                                 example: '+61 412345678' },
  { country: 'Germany',        cc: '49',  digits: [10, 11],                          example: '+49 15123456789' },
  { country: 'France',         cc: '33',  digits: 9,                                 example: '+33 612345678' },
  { country: 'China',          cc: '86',  digits: 11,                                example: '+86 13812345678' },
  { country: 'Japan',          cc: '81',  digits: 10,                                example: '+81 9012345678' },
];

/**
 * Validate a phone number against either a known country's rule or a generic
 * E.164 fallback (7–15 digits). Returns an error string, or '' if valid.
 *
 * @param raw     The user-entered phone (may include +, spaces, hyphens, parens)
 * @param country Country name to look up in PHONE_RULES, or '' for generic
 * @param label   Human-readable label used in the error message ("Phone", "Admin phone", …)
 */
export function validatePhone(raw: string, country: string, label: string): string {
  if (!/^[+\d\s\-()]+$/.test(raw)) {
    return `${label} may only contain digits, spaces, +, -, ( and )`;
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    return `${label} must be 7–15 digits (international E.164 standard)`;
  }
  const rule = PHONE_RULES.find(r => r.country === country);
  if (!rule) return ''; // unknown country → generic check is enough

  // Strip the country code if present (handles +91…, 91…, or bare national)
  let national = digits;
  if (national.startsWith(rule.cc) && national.length > (Array.isArray(rule.digits) ? rule.digits[0] : rule.digits)) {
    national = national.slice(rule.cc.length);
  }

  const [min, max] = Array.isArray(rule.digits) ? rule.digits : [rule.digits, rule.digits];
  if (national.length < min || national.length > max) {
    const want = min === max ? `${min}` : `${min}–${max}`;
    return `${rule.country} ${label.toLowerCase()} must be ${want} digits. Example: ${rule.example}`;
  }
  if (rule.mobilePrefix && !rule.mobilePrefix.test(national)) {
    return `Invalid ${rule.country} number. Example: ${rule.example}`;
  }
  return '';
}
