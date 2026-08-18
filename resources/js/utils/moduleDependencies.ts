/**
 * HRMS module dependency matrix (frontend mirror).
 *
 * A module can't function on its own: HR Employee needs the Department /
 * Designation / Role masters for its dropdowns, Payroll needs Attendance and
 * Leave to build a payslip, and so on. Granting the headline module without its
 * feeders produced half-broken screens (empty selects, 403s on lookup calls).
 *
 * Rule: granting ANY flag on a module implies can_view on every module it
 * depends on, transitively. Dependencies never inherit action flags.
 *
 * Keyed by module slug. Mirrors app/Support/ModuleDependencies.php — keep the
 * two in sync; the backend re-applies this on save, so the UI is a preview of
 * what will be stored, not the enforcement point.
 *
 * Notes: "Biometric Device" has no module of its own (it rides on
 * hr.attendance), and Holiday is deliberately dependency-free.
 */
export const MODULE_DEPENDENCIES: Record<string, string[]> = {
  // HR core
  'hr.recruitment': [
    'hr.employee', 'hr.onboarding', 'hr.exit',
    'master.departments', 'master.designations', 'master.roles',
  ],
  'hr.employee': [
    'permissions', 'hr.onboarding', 'hr.leave', 'hr.holiday',
    'master.countries', 'master.departments', 'master.designations', 'master.roles',
    'master.leave_plan', 'master.leave_type',
    'master.assets', 'master.asset_categories', 'master.overtime_rates',
  ],
  'hr.onboarding': [
    'hr.employee', 'hr.doc_templates', 'hr.leave', 'hr.holiday',
    'master.countries', 'master.departments', 'master.designations', 'master.roles',
    'master.leave_type', 'master.leave_plan',
    'master.assets', 'master.asset_categories', 'master.overtime_rates',
  ],
  'hr.exit': [
    'hr.employee', 'hr.onboarding', 'hr.payroll', 'hr.doc_templates',
    'hr.attendance', 'hr.expense',
    'master.countries', 'master.departments', 'master.designations', 'master.roles',
    'master.leave_type', 'master.leave_plan', 'master.overtime_rates',
  ],

  // Time & pay
  'hr.payroll': [
    'hr.employee', 'hr.onboarding', 'hr.attendance', 'hr.leave', 'hr.holiday',
    'master.overtime_rates',
  ],
  'hr.attendance': [
    'hr.employee', 'hr.onboarding', 'hr.leave', 'hr.holiday',
    'master.overtime_rates', 'master.leave_type', 'master.leave_plan',
  ],
  'hr.leave': [
    'hr.employee', 'hr.onboarding', 'hr.holiday',
    'master.leave_plan', 'master.leave_type',
  ],
  'hr.holiday': [],
  'hr.expense': [
    'hr.employee', 'hr.onboarding',
    'master.expense_category',
  ],

  // Documents & comms
  'hr.broadcast': ['hr.employee', 'hr.onboarding'],
  'hr.doc_templates': ['hr.employee', 'hr.custom_fields', 'master.trigger_point'],
};

/** Human-readable module names for the "required by" tooltip, filled by callers. */
export type SlugNameMap = Record<string, string>;

/**
 * Transitive closure of the dependencies of `activeSlugs`.
 *
 * Returns a map of required slug → the seed slugs that pulled it in (used for
 * the "Required by Payroll, Attendance" tooltip). Seeds themselves are excluded
 * so a module is never listed as its own dependency. Cycles are safe.
 */
export function resolveDependencies(activeSlugs: Iterable<string>): Record<string, string[]> {
  const seeds = new Set(activeSlugs);
  const required: Record<string, Set<string>> = {};

  seeds.forEach((seed) => {
    const stack: string[] = [seed];
    const visited = new Set<string>([seed]);
    while (stack.length) {
      const current = stack.pop()!;
      for (const dep of MODULE_DEPENDENCIES[current] || []) {
        if (!required[dep]) required[dep] = new Set();
        required[dep].add(seed);
        if (!visited.has(dep)) {
          visited.add(dep);
          stack.push(dep);
        }
      }
    }
  });

  const out: Record<string, string[]> = {};
  Object.entries(required).forEach(([slug, causes]) => {
    if (seeds.has(slug)) return;
    out[slug] = [...causes];
  });
  return out;
}
