/**
 * Clock-time formatting shared by the attendance screens.
 *
 * Lived inside RegularizationApprovals.tsx, which meant the employee
 * Attendance tab imported a formatter from a page component. It is a util, so
 * it lives with the utils now and both screens import it from one place.
 */

/**
 * Rewrite every HH:MM run in a string to a 12-hour clock ("13:00" → "01:00 PM").
 *
 * Applied to the STRING rather than to parsed fields because the values it
 * handles are prose as often as times: the server's `original_display` summary
 * can read "No punches (absent)". Rewriting only the HH:MM runs inside it
 * leaves that wording alone. The >23 guard keeps a duration, or any other
 * colon-separated pair, from being mistaken for a clock time.
 */
export const to12h = (s?: string | null): string => {
  if (!s) return '—';
  return s.replace(/(\d{1,2}):(\d{2})/g, (m, h: string, mm: string) => {
    const n = Number(h);
    if (n > 23) return m;
    const ampm = n >= 12 ? 'PM' : 'AM';
    const h12  = n % 12 === 0 ? 12 : n % 12;
    return `${String(h12).padStart(2, '0')}:${mm} ${ampm}`;
  });
};

/** One punch pair as "09:38 AM–01:13 PM". */
export const punchPair12h = (inTime?: string | null, outTime?: string | null): string =>
  `${to12h(inTime)}–${to12h(outTime)}`;
