/**
 * App-wide display date format: DD-Mon-YYYY (e.g. 04-Jul-2026).
 *
 * Accepts an ISO string, timestamp, Date, or null. Returns '—' for empty and
 * echoes the raw string back if it can't be parsed (so an already-formatted
 * value never turns into "Invalid Date"). Use everywhere a date is SHOWN so
 * every stage / popup reads consistently.
 */
const DMY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDmy(input?: string | number | Date | null): string {
  if (input === null || input === undefined || input === '') return '—';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return typeof input === 'string' ? input : '—';
  return `${String(d.getDate()).padStart(2, '0')}-${DMY_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}
