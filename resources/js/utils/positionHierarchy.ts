/**
 * Reporting-manager eligibility, stated once. (CBC #10)
 *
 * Mirrors app/Support/PositionHierarchy.php — the server ranks the same names
 * and ships a `rank` on every manager candidate, so the client only has to rank
 * the HIRE and compare.
 *
 * This lives in a shared file because the drift it prevents already happened:
 * the Employee form moved to "any department, must rank strictly higher"
 * (department scoping was dropped per request), while onboarding Stage 1 kept
 * the older "Branch Users + the hire's own department" rule. The result was a
 * Reporting Manager dropdown that offered a single Branch User on onboarding
 * and a full list of Team Leaders / HODs on the Employee form, for the same
 * employee.
 */

/** Lower number = higher position. Matches PositionHierarchy::DESIGNATION_RANK. */
export const DESIGNATION_RANK: Record<string, number> = {
  'Head of Department (HOD)': 2,
  'Team Leader': 3,
  'Executive': 4,
  'Employee': 5,
  'Intern / Trainee': 6,
};

/** A login-user manager (Branch User etc.) sits at the top of the chart. */
export const TOP_RANK = 1;

/**
 * Rank for a designation NAME.
 *
 * null means "a custom title this map does not know" and is treated leniently
 * downstream, so a tenant's own job titles never empty the dropdown. An absent
 * designation is NOT lenient — the server ranks those at the bottom
 * (PositionHierarchy::UNRANKED), and that gap is how an HOD once ended up
 * reporting to an Employee.
 */
export const rankForDesignationName = (name?: string | null): number | null => {
  const n = (name ?? '').trim();
  return n in DESIGNATION_RANK ? DESIGNATION_RANK[n] : null;
};

/**
 * Is `managerRank` eligible to manage someone at `hireRank`?
 *
 * Strictly higher (lower number). Unknown ranks on either side stay lenient —
 * see the note above.
 */
export const rankOutranks = (
  managerRank?: number | null,
  hireRank?: number | null,
): boolean => hireRank == null || managerRank == null || managerRank < hireRank;
