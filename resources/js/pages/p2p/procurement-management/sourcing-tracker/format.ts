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

/** Up to two initials for an avatar ("Parth Lakare" → "PL"). */
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
