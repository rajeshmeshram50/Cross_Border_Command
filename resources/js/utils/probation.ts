// Probation end-date maths shared by the Add/Edit Employee form and the
// Onboarding form. The forms only capture a probation *policy* (e.g.
// "3-Month Probation"); the number of months and the end date are derived
// here, stored on save, and read back by the daily probation-completion email
// job (so nothing is recomputed on the backend each run).

// "Default Probation Policy" carries no explicit number — treat it as 3 months.
export const DEFAULT_PROBATION_MONTHS = 3;

/**
 * Derive the probation length (whole months) from a policy string — the
 * selected option label, or the free text typed for a custom policy. Returns 0
 * for "No Probation" or anything with no month figure (→ no end date).
 */
export const probationMonthsFromPolicy = (policyText: string): number => {
  const text = policyText || '';
  const clamp = (s: string) => Math.max(0, Math.min(60, parseInt(s, 10) || 0));
  if (/no\s*probation/i.test(text)) return 0;
  const monthMatch = text.match(/(\d+)\s*-?\s*month/i);
  if (monthMatch) return clamp(monthMatch[1]);
  if (/default/i.test(text)) return DEFAULT_PROBATION_MONTHS;
  // Bare number with no unit → months; ignore day/week values (not probation).
  if (!/day|week/i.test(text)) {
    const bare = text.match(/(\d+)/);
    if (bare) return clamp(bare[1]);
  }
  return 0;
};

/**
 * Probation end date = joining date + N months, clamped to end-of-month so a
 * 31st joining date lands on the last day of a shorter month (matches the
 * backend's Carbon addMonths behaviour). Returns ISO (for saving) + dd-mm-yyyy
 * (for display). Empty strings when there's no joining date / no probation.
 */
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export const computeProbationEnd = (joinDate: string, months: number): { iso: string; display: string } => {
  if (!joinDate || months <= 0) return { iso: '', display: '' };
  const d = new Date(joinDate);
  if (Number.isNaN(d.getTime())) return { iso: '', display: '' };
  const day = d.getDate();
  const end = new Date(d.getFullYear(), d.getMonth() + months, day);
  if (end.getDate() !== day) end.setDate(0); // rolled over → clamp to month end
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = end.getFullYear(), m = pad(end.getMonth() + 1), dd = pad(end.getDate());
  // Display like the Joining Date picker: "28 Aug 2026". ISO stays YYYY-MM-DD.
  return { iso: `${y}-${m}-${dd}`, display: `${dd} ${MONTHS_SHORT[end.getMonth()]} ${y}` };
};

/** Convenience: resolve months + end date in one call from a policy + join date. */
export const resolveProbation = (policyText: string, joinDate: string) => {
  const months = probationMonthsFromPolicy(policyText);
  const { iso, display } = computeProbationEnd(joinDate, months);
  return { months, endIso: iso, endDisplay: display };
};

/* ── Probation status ─────────────────────────────────────────────────────
   Mirrors app/Support/ProbationGuard.php — keep the two in step. An employee
   is on probation while today is on or before `probation_end_date`; a NULL
   end date means no probation at all ("No Probation" policy, or a legacy row
   saved before the column existed). While on probation the leave policy and
   the notice period both do not apply.                                      */

/** Today in IST as YYYY-MM-DD — the backend compares in the same timezone. */
const todayIstIso = (): string => {
  const d = new Date();
  // en-CA renders as YYYY-MM-DD, which sorts and compares as a plain string.
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
};

export const isOnProbation = (probationEndDate?: string | null): boolean => {
  const end = String(probationEndDate ?? '').slice(0, 10);
  if (!end) return false;
  return todayIstIso() <= end;
};

/** "28 Aug 2026" for messages; empty when there's no end date. */
export const probationEndLabel = (probationEndDate?: string | null): string => {
  const end = String(probationEndDate ?? '').slice(0, 10);
  if (!end) return '';
  const d = new Date(end + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
};

/** The toast shown when someone on probation tries to apply for leave. */
export const probationLeaveMessage = (probationEndDate?: string | null): string => {
  const until = probationEndLabel(probationEndDate);
  return `You are on probation and cannot apply for leave.${until ? ` Leave can be applied from ${until}.` : ''}`;
};

/* ── Early exit ───────────────────────────────────────────────────────────
   Mirrors ProbationGuard::EARLY_EXIT_DAYS / isEarlyResignation — keep the two
   in step. An employee who RESIGNS within 15 days of joining:
     · serves no notice period (nothing recovered, nothing paid in lieu), and
     · is not put through payroll at all (enforced in PayrollService).
   This stands on its own rather than riding on probation: a "No Probation"
   hire has no probation end date, and would otherwise be charged a full
   notice period for quitting on day 8.                                      */

export const EARLY_EXIT_DAYS = 15;

/**
 * Whole days from joining to `endDate`, counting the joining day itself
 * (joined 1st, resigned 15th = 15 days). Null when either date is missing or
 * the end date precedes joining.
 */
export const tenureDays = (joinDate?: string | null, endDate?: string | null): number | null => {
  const join = String(joinDate ?? '').slice(0, 10);
  const end  = String(endDate ?? '').slice(0, 10);
  if (!join || !end) return null;
  const a = new Date(join + 'T00:00:00').getTime();
  const b = new Date(end + 'T00:00:00').getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
};

/** Resigned within EARLY_EXIT_DAYS of joining → the notice period is waived. */
export const isEarlyResignation = (joinDate?: string | null, resignationDate?: string | null): boolean => {
  const t = tenureDays(joinDate, resignationDate);
  return t !== null && t <= EARLY_EXIT_DAYS;
};
