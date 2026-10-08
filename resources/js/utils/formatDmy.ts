/**
 * App-wide display date format: DD-Mon-YYYY (e.g. 04-Jul-2026).
 *
 * Accepts an ISO string, timestamp, Date, or null. Returns '—' for empty and
 * echoes the raw string back if it can't be parsed (so an already-formatted
 * value never turns into "Invalid Date"). Use everywhere a date is SHOWN so
 * every stage / popup reads consistently.
 */
const DMY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A date with no time part: "2026-06-01", optionally with a trailing time the
 * caller does not care about.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/;

export function formatDmy(input?: string | number | Date | null): string {
  if (input === null || input === undefined || input === '') return '—';

  /* A date-only string is read off the TEXT, not through `new Date()`.
     `new Date('2026-06-01')` is parsed as UTC midnight, so in any timezone
     behind UTC `getDate()` returns the day before — "2026-06-01" renders as
     31-May-2026. The Order module kept its own private copy of this function
     purely to avoid that; now it does not have to. */
  if (typeof input === 'string') {
    const m = DATE_ONLY.exec(input);
    if (m) {
      const [, year, month, day] = m;
      const monthName = DMY_MONTHS[Number(month) - 1];
      if (monthName) return `${day}-${monthName}-${year}`;
    }
  }

  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return typeof input === 'string' ? input : '—';
  return `${String(d.getDate()).padStart(2, '0')}-${DMY_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}
