/* Display formatters shared by the Sourcing Tracker list and its popups. */

/** yyyy-mm-dd → dd/mm/yyyy (the app's date display). */
export const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** A target price → ₹ with Indian grouping and always two decimals, so every screen shows it the
   same way ("1131" → "₹1,131.00", "1250.5" → "₹1,250.50", "18,500" → "₹18,500.00"). The server keeps
   the price as typed, so commas are dropped first; an empty or non-numeric value reads "—". */
export const inr = (v: string | number | null | undefined) => {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return '—';
  /* Grouped as TEXT, not through Number(): a long typed value (older targets hold 30+ digits) lost
     its digits as a float and printed a run of zeros. Indian grouping: the last three digits, then
     pairs ("12345678" → "1,23,45,678"). Decimals are padded / cut to two. */
  const [rawInt, rawDec = ''] = s.split('.');
  const int = rawInt.replace(/^0+(?=\d)/, '');
  const head = int.slice(0, -3);
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${int.slice(-3)}` : int;
  return `₹${grouped}.${(rawDec + '00').slice(0, 2)}`;
};

/* Typed amounts: the server's limits (App\Support\SupplierPricing) — a price up to 9,999,999,999.99
   and an exchange rate up to 99,999.9999. Typing stops there, so an amount can never run past what
   Save accepts, nor blow the computed tiles out into 30-digit and 1.2e+89% values. Target prices
   take the price limit too: a target no supplier price can reach is meaningless. */
export const PRICE_INT = 10;
export const PRICE_DEC = 2;
export const RATE_INT = 5;
export const RATE_DEC = 4;
/** Digits and one point only, at most `int` digits before it and `dec` after ("12a.3.45" → "12.34"). */
export const limitNum = (raw: string, int = PRICE_INT, dec = PRICE_DEC) => {
  const clean = raw.replace(/[^\d.]/g, '');
  const dot = clean.indexOf('.');
  const whole = (dot < 0 ? clean : clean.slice(0, dot)).slice(0, int);
  return dot < 0 ? whole : `${whole}.${clean.slice(dot + 1).replace(/\./g, '').slice(0, dec)}`;
};

/** Up to two initials for an avatar ("Parth Lakare" → "PL"). */
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
