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
    return `${label} must be a valid 15-character GSTIN — e.g. 29ABCDE1234F1Z5`;
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

/* SWIFT / BIC — the international counterpart of IFSC (QA #103).
 *
 * 8 to 11 characters: 6 letters (4 bank + 2 ISO country) followed by 2 to 5
 * alphanumeric (2 location + an optional 3-char branch). The ISO standard
 * allows only 8 or 11, but the spec for this field is a range, so 9 and 10 are
 * accepted rather than rejected — a bank that prints a 9-character code on its
 * own letterhead is not a data-entry error the form should refuse. */
export function validateSwift(value: string, label = 'SWIFT Code'): string {
  if (!value.trim()) return '';
  if (!/^[A-Z]{6}[A-Z0-9]{2,5}$/.test(value.trim().toUpperCase())) {
    return `${label} must be 8–11 characters: 6 letters then alphanumeric (e.g. HDFCINBB or HDFCINBBXXX)`;
  }
  return '';
}

/* Bank account number — the rule depends on where the bank is.
 *
 *   domestic (India)  9–18 DIGITS            (QA #98)
 *   international     8–34 alphanumeric      (QA #103)
 *
 * The two tickets pull in opposite directions and both are right, for their own
 * case. An Indian account number is numeric and bounded, and #98 is precisely
 * about a 36-digit value being accepted. An IBAN opens with two country letters
 * (GB29NWBK…) and runs to 34, so the Indian rule makes a foreign supplier's real
 * account number unenterable. Splitting on the supplier's country satisfies
 * both, and mirrors what the IFSC/SWIFT field beside it already does.
 *
 * Spaces and punctuation are rejected either way, so the stored value stays a
 * single token. */
export function validateAccountNumber(value: string, label = 'Account Number', international = false): string {
  if (!value.trim()) return '';
  if (international) {
    if (!/^[A-Za-z0-9]{8,34}$/.test(value.trim())) return `${label} must be 8–34 letters or digits, with no spaces`;
    return '';
  }
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
