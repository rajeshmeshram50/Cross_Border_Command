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
