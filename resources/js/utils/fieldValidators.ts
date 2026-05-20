/**
 * Shared format validators used by the Add Product / Add Vendor forms.
 *
 * Every validator returns an empty string when the input is valid, or a
 * human-readable error message when it isn't. That shape lets the
 * caller stuff the result straight into a fieldErrors map without any
 * extra branching.
 *
 * `value` is always treated as the raw string the user typed; empty
 * inputs are skipped (callers should run a separate required-check
 * BEFORE format-check so the "X is required" message wins for blanks).
 */

/* Email — strict-enough regex, rejects spaces and double dots. */
export function validateEmail(value: string, label = 'Email'): string {
  if (!value.trim()) return '';
  const re = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (value.length > 255) return `${label} is too long (max 255 characters)`;
  if (!re.test(value.trim())) return `Enter a valid ${label.toLowerCase()} (e.g. name@example.com)`;
  return '';
}

/**
 * Phone — generic E.164-ish check (7–15 digits, optional + prefix,
 * spaces/hyphens/parens allowed). For the country-specific rules use
 * the existing `validatePhone` helper in validatePhone.ts.
 */
export function validatePhoneGeneric(value: string, label = 'Phone'): string {
  if (!value.trim()) return '';
  const v = value.trim();
  if (!/^[+\d\s\-()]+$/.test(v)) return `${label} may only contain digits, spaces, +, -, ( and )`;
  const digits = v.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return `${label} must be 7–15 digits`;
  return '';
}

/* Indian pincode — exactly 6 digits, doesn't start with 0. */
export function validatePincode(value: string, label = 'Pincode'): string {
  if (!value.trim()) return '';
  if (!/^[1-9][0-9]{5}$/.test(value.trim())) return `${label} must be 6 digits and cannot start with 0`;
  return '';
}

/**
 * Website — accepts forms like:
 *   www.example.com
 *   example.com
 *   https://www.example.com
 *   http://sub.example.co.in/path?x=1
 * Rejects bare words, missing TLD, spaces, or unsupported schemes.
 */
export function validateWebsite(value: string, label = 'Website'): string {
  if (!value.trim()) return '';
  const v = value.trim();
  if (/\s/.test(v))     return `${label} cannot contain spaces`;
  if (v.length > 500)   return `${label} is too long (max 500 characters)`;
  if (/^(ftp|file|javascript|mailto):/i.test(v)) return `${label} must start with http:// or https://`;
  const stripped = v.replace(/^https?:\/\//i, '');
  const re = /^(www\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(\/[^\s]*)?$/i;
  if (!re.test(stripped)) return `Enter a valid ${label.toLowerCase()} (e.g. www.example.com)`;
  return '';
}

/* Indian GSTIN — 15 characters, well-known regex.
 *   2 digits state code · 10 PAN-like chars · 1 entity code · Z · 1 checksum
 */
export function validateGstin(value: string, label = 'GST Number'): string {
  if (!value.trim()) return '';
  const v = value.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v)) {
    return `${label} must be 15 characters in the standard GSTIN format`;
  }
  return '';
}

/* PAN — 5 letters · 4 digits · 1 letter. */
export function validatePan(value: string, label = 'PAN'): string {
  if (!value.trim()) return '';
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value.trim().toUpperCase())) {
    return `${label} must be 10 characters (e.g. ABCDE1234F)`;
  }
  return '';
}

/* IFSC — 4 letters · 0 · 6 alphanumeric. */
export function validateIfsc(value: string, label = 'IFSC Code'): string {
  if (!value.trim()) return '';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(value.trim().toUpperCase())) {
    return `${label} must be 11 characters (e.g. HDFC0000123)`;
  }
  return '';
}

/* Bank account number — digits only, 9 to 18 long (covers most Indian banks). */
export function validateAccountNumber(value: string, label = 'Account Number'): string {
  if (!value.trim()) return '';
  if (!/^[0-9]{9,18}$/.test(value.trim())) return `${label} must be 9–18 digits`;
  return '';
}

/* Required-positive number — used for "Selling Price" / "Purchase Price" etc.
 * Empty input returns '' so the required-check can fire first if needed.
 */
export function validatePositiveNumber(value: string, label: string): string {
  if (!value.toString().trim()) return '';
  const n = Number(value);
  if (Number.isNaN(n))    return `${label} must be a number`;
  if (n <= 0)             return `${label} must be greater than 0`;
  return '';
}
