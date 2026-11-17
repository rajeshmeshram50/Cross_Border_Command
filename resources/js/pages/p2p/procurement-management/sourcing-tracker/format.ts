/* Display formatters shared by the Sourcing Tracker list and its popups. */

/** yyyy-mm-dd → dd/mm/yyyy (the app's date display). */
export const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** A plain number string → ₹ with Indian grouping (e.g. "1131" → "₹1,131"). */
export const inr = (v: string) => `₹${Number(v).toLocaleString('en-IN')}`;

/** Up to two initials for an avatar ("Parth Lakare" → "PL"). */
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
