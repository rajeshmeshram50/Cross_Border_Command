/**
 * Salary-breakup rules, shared by every screen that edits one.
 *
 * These lived inside HrEmployees.tsx, which was fine while the Add/Edit Employee
 * wizard was the only place a structure could be built. It is not: onboarding
 * Stage 1 edits the same CTC, and the Revise Salary modal writes the same table.
 * A copy per screen is how the figures drift apart — the same reason a hand-typed
 * ESI of ₹20.09 could sit next to a Professional Tax of ₹10 and neither match the
 * slab payroll actually applies.
 *
 * Everything here is PURE: no React, no API. The rules are stated once; each
 * screen owns its own state and markup.
 */

export interface SalBreakComp { code: string; label: string; amount: number }

/** The three components the auto-split owns — everything else in Earnings was
 *  added by HR and survives a re-seed. */
export const SPLIT_CODES = ['basic', 'hra', 'special'];

/** Rows where ₹0 is a real answer rather than an unfilled field: ESI is nil
 *  above the wage ceiling, PF is nil when the employee is out of scope, and
 *  Special Allowance is nil once the other components use up the whole CTC.
 *  HR's own rows still have to carry a positive amount.
 *
 *  'pt' is deliberately NOT here. Professional Tax is typed by hand now (the
 *  slab suggestion that used to sit above these rows has been removed), and a
 *  hand-typed 0 is indistinguishable from a field nobody filled — it saves
 *  silently and the deduction never comes out. Ticking PT Applicable and then
 *  leaving it at 0 is the mistake this catches; untick the box instead, which
 *  removes the row altogether. */
export const ZERO_OK_CODES = ['pf', 'esi', 'special'];

export const MAX_COMP_AMOUNT = 99999999.99;
export const MAX_COMP_LABEL  = 120;

/** 50 / 30 / 20 split of the monthly gross. Basic at 50% is the Code on Wages,
 *  2019 floor; Special carries the remainder so the three always total the CTC. */
export const seedBreakup = (monthlyGross: number): SalBreakComp[] => {
  const g = Math.max(0, Math.round(monthlyGross));
  const basic = Math.round(g * 0.5);
  const hra = Math.round(g * 0.3);
  const special = Math.max(0, g - basic - hra);
  return [
    { code: 'basic',   label: 'Basic Salary',          amount: basic },
    { code: 'hra',     label: 'House Rent Allowance',   amount: hra },
    { code: 'special', label: 'Special Allowance',      amount: special },
  ];
};

/** Special Allowance is the residual of the package, so a component HR adds is
 *  funded OUT of it rather than piled on top of the gross.
 *  Without this a ₹102 custom row pushed the gross ₹102/mo past the CTC and, worse,
 *  left Basic at 50% of the CTC while the gross had grown — so the Code on Wages
 *  floor tripped at 49.99% and blocked the save with an error the form offered no
 *  way to clear. Clamped at 0: a package that genuinely outgrows the CTC still
 *  shows the red "over the salary" line instead of being silently rewritten. */
export const absorbIntoSpecial = (earnings: SalBreakComp[], monthlyGross: number): SalBreakComp[] => {
  const target = Math.max(0, Math.round(monthlyGross));
  if (target <= 0) return earnings;
  const idx = earnings.findIndex(c => c.code === 'special');
  if (idx < 0) return earnings;   // HR deleted the row — nothing left to fund from
  const others = earnings.reduce((s, c, i) => (i === idx ? s : s + (Number(c.amount) || 0)), 0);
  const special = Math.max(0, target - others);
  if (special === (Number(earnings[idx].amount) || 0)) return earnings;
  return earnings.map((c, i) => (i === idx ? { ...c, amount: special } : c));
};

/* Professional Tax opens on its statutory figure, mirroring the slab in
   app/Services/PayrollService.php so the breakup shows the number payroll would
   actually apply. It SEEDS the row and stays editable — payroll honours a manual
   line VERBATIM, so whatever sits here is what gets deducted. Ticking used to
   drop a ₹0 row that failed the "Amount must be greater than 0" check on the
   spot, leaving HR to type a placeholder just to get past it — that is where
   figures like ₹10 came from.
   ESI is deliberately NOT derived: its ₹21,000 wage ceiling has a
   contribution-period carry-over (an employee who crosses it mid-period keeps
   contributing to the end of that period), so eligibility is HR's call and the
   row stays a plain manual entry. */

/** Maharashtra slab. The ₹300 February top-up (₹2,500 annual cap) is applied by
 *  the payroll run, not stored here — this row is the ordinary monthly figure. */
export const statutoryPt = (monthlyGross: number, gender: string): number => {
  if (monthlyGross <= 0) return 0;
  if (gender.trim().toLowerCase().startsWith('f')) return monthlyGross <= 25000 ? 0 : 200;
  if (monthlyGross <= 7500)  return 0;
  if (monthlyGross <= 10000) return 175;
  return 200;
};

/** PF at 12% of basic — Statutory caps the basic at the ₹15,000 EPF wage
 *  ceiling (max ₹1,800/month), Standard uses the full basic.
 *
 *  The type is matched case-INSENSITIVELY so this agrees with payroll, which
 *  reads it as `strtolower($employee->pf_type) === 'standard'`. The old exact
 *  `=== 'Standard'` comparison only lined up because the Employee form happens
 *  to write the value capitalised; a row stored as "standard" by an import, a
 *  seeder or an API client fell through to the capped branch here while payroll
 *  took the uncapped one. On a basic above ₹15,000 that is the screen quoting
 *  ₹1,800 against a payslip deducting 12% of the whole basic — the two
 *  disagreeing about the same employee, with nothing on either to explain it. */
export const pfDeduction = (basic: number, pfType: string, eligible: boolean): number => {
  if (!eligible) return 0;
  const base = String(pfType ?? '').trim().toLowerCase() === 'standard'
    ? basic
    : Math.min(basic, 15000);
  return Math.round(Math.max(0, base) * 0.12);
};

/** Largest annual gap that is pure rounding rather than a real mismatch.
 *
 *  Components are held in whole rupees, so the monthly gross can sit up to 50
 *  paise either side of CTC ÷ 12 — over twelve months, ±₹6. A CTC of
 *  ₹1,40,00,000 divides to ₹11,66,666.67, rounds to ₹11,66,667, and annualises
 *  to ₹1,40,00,004: the panel was flagging "₹4 over the salary" in red on a
 *  perfectly ordinary figure, and warning about it again on save.
 *
 *  6, not 12: the smallest change anyone can actually make is ₹1/month = ₹12/yr,
 *  so this absorbs the rounding without ever hiding a deliberate edit. */
export const CTC_ROUNDING_SLACK = 6;

/** Identity of a breakup, for skipping a POST that would save nothing new. */
export const breakupSignature = (
  earnings: SalBreakComp[],
  deductions: SalBreakComp[],
  pf: boolean, esi: boolean, pt: boolean,
): string => JSON.stringify({
  e: earnings.map(c => [c.code, c.label.trim(), Number(c.amount) || 0]),
  d: deductions.map(c => [c.code, c.label.trim(), Number(c.amount) || 0]),
  pf, esi, pt,
});

export interface BreakupErrors {
  earnings: Record<number, string>;
  deductions: Record<number, string>;
  form: string;
}

/** Per-row and whole-form validation. Returns empty maps when the detailed
 *  breakup is switched off — there is nothing on screen to be wrong. */
export const validateBreakup = (
  earnings: SalBreakComp[],
  deductions: SalBreakComp[],
  enabled = true,
): BreakupErrors => {
  const earnErrs: Record<number, string> = {};
  const dedErrs: Record<number, string> = {};
  let form = '';
  if (!enabled) return { earnings: earnErrs, deductions: dedErrs, form };

  const checkRow = (c: SalBreakComp): string | null => {
    const label = c.label.trim();
    const amt = Number(c.amount);
    // A wholly empty row is someone part-way through adding one, not a mistake.
    if (!label && (!Number.isFinite(amt) || amt === 0)) return null;
    if (!label) return 'Component name is required';
    if (label.length > MAX_COMP_LABEL) return `Name must be ≤ ${MAX_COMP_LABEL} characters`;
    const zeroOk = ZERO_OK_CODES.includes(c.code);
    if (!Number.isFinite(amt) || amt < 0 || (amt === 0 && !zeroOk)) return 'Amount must be greater than 0';
    if (amt > MAX_COMP_AMOUNT) return 'Amount is too large';
    return null;
  };

  const flagDuplicates = (list: SalBreakComp[], errs: Record<number, string>) => {
    const seen = new Map<string, number>();
    list.forEach((c, i) => {
      if (errs[i]) return;
      const key = c.label.trim().toLowerCase();
      if (!key) return;
      if (seen.has(key)) errs[i] = 'Duplicate component name';
      else seen.set(key, i);
    });
  };

  earnings.forEach((c, i) => { const er = checkRow(c); if (er) earnErrs[i] = er; });
  deductions.forEach((c, i) => { const er = checkRow(c); if (er) dedErrs[i] = er; });
  flagDuplicates(earnings, earnErrs);
  flagDuplicates(deductions, dedErrs);

  const gross = earnings.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const ded   = deductions.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const hasValidEarning = earnings.some(c => c.label.trim() && Number(c.amount) > 0);

  if (!hasValidEarning || gross <= 0) {
    form = 'Add at least one earning component with a positive amount';
  } else if (ded > gross) {
    form = 'Total deductions cannot exceed the monthly gross';
  } else {
    // Code on Wages, 2019: "wages" (Basic + DA) must be at least 50% of the
    // total remuneration. The auto-split already seeds Basic at 50%; this only
    // trips if Basic is manually skewed below the legal floor. A ₹1 slack
    // absorbs the rounding on a clean 50% split so it never false-positives.
    const basic = Number(earnings.find(c => c.code === 'basic')?.amount ?? 0) || 0;
    if (basic > 0 && basic + 1 < gross * 0.5) {
      form = 'Basic Salary must be at least 50% of the monthly gross (Code on Wages, 2019).';
    }
  }
  return { earnings: earnErrs, deductions: dedErrs, form };
};
