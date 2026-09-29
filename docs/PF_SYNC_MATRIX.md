# PF / statutory-flag sync sheet — Bug #36 (Employee >> Stage 4 vs Revise Salary)

Verified 29 Sep 2026 against `saas`. Covers every switch, checkbox and dropdown that
touches PF / ESI / PT on the three screens that can change them.

Screens:
- **COMP** — Edit Employee → Step 4 Compensation (`resources/js/pages/hrms/HrEmployees.tsx`)
- **ONB** — Onboarding wizard → Stage 1 Compensation (`resources/js/pages/employee-onboarding/HrEmployeeOnboarding.tsx`)
- **REV** — Revise Salary modal (`resources/js/components/SalaryStructureModal.tsx`)

## 1. Control → column map

| Control (as labelled on screen) | Screen | Reads from | Writes to | Present on REV? |
|---|---|---|---|---|
| "PF Applicable for this Employee" (banner toggle) | COMP, ONB | `employees.enable_payroll` | `employees.enable_payroll` | **NO** |
| "PF Applicable" (Yes/No dropdown) | COMP, ONB | active `salary_structures.pf_applicable`, falling back to `employees.pf_eligible` | `employees.pf_eligible` + new structure `pf_applicable` | yes ("PF" checkbox) |
| "PF Type" (Statutory / Standard) | COMP, ONB, REV | `employees.pf_type` | `employees.pf_type` only — no structure column exists | yes |
| "ESI" checkbox | COMP, ONB, REV | active structure `esi_applicable` | `employees.esi_applicable` + structure | yes |
| "Professional Tax" checkbox | COMP, ONB, REV | active structure `pt_applicable` | structure only (no employee column) | yes |
| Annual CTC | COMP, ONB, REV | `employees.annual_salary` | `employees.annual_salary` + structure gross | yes |

Payroll reads: `pf_applicable` (structure) **AND** `pf_eligible` (employee) **AND**
`enable_payroll` (employee) — all three must be true for a PF deduction to appear.

## 2. Findings

### F1 — Two different columns are both labelled "PF Applicable"; REV cannot see one of them  — HIGH
`HrEmployees.tsx:5400` / `HrEmployeeOnboarding.tsx:5299`. The banner toggle is
`enable_payroll`, not `pf_eligible`. `SalaryStructureModal.tsx` never reads or writes
`enable_payroll` (zero references).

Repro: Employee → Stage 4 → turn the banner **off** → Save. Reopen Revise Salary for the
same employee: PF is still ticked, PF Type still shows, and the PF ₹1,800 deduction is still
listed. Payroll meanwhile excludes the employee entirely (`PayrollService.php:738`).
Two screens show opposite answers to the same question, and neither matches the payslip.
This is the state in the attached screenshots (banner off, REV v43 PF ✓).

Also: the banner's own note says turning it off "removes CTC, salary effective date and the
salary breakup", but the CTC, the effective date and the v43 breakup all stay on screen and
in the database. Nothing is removed.

### F2 — A PF Type change alone never creates a revision  — MEDIUM
`HrEmployees.tsx:2044` guards the revision POST with
`breakupSignature(earnings, deductions, pf, esi, pt) | ctc`, and `breakupSignature`
(`utils/salaryBreakup.ts:195`) does **not** include `pf_type`. The PF row is also excluded
from `deductions` by design (`SalaryStructureModal.tsx:519`), so switching
Statutory → Standard changes nothing in the signature.

Repro: COMP → PF Type Statutory → Standard → Save. `employees.pf_type` changes, no new
structure version is created, Salary History shows no revision, and REV still opens on the
old version. The payslip does change (payroll reads `pf_type` off the employee), so the
deduction moves with no audit trail behind it.

### F3 — Toggling PF off then on silently resets PF Type to Statutory  — MEDIUM
`EmployeeController.php:2229` (`normalisePfType`) and `HrEmployees.tsx:2062` both send
`pf_type = null` when PF is off, then `?: 'statutory'` when it comes back on.
A "Standard" basis chosen in Revise Salary is lost with no message. For an employee on full
basic this changes the deduction (e.g. ₹3,000 → ₹1,800) with nothing on screen saying so.

### F4 — Revise Salary's PF checkbox is seeded with an OR, so it can only ever drift ON  — MEDIUM
`SalaryStructureModal.tsx:160`: `setPfApplicable(!!d.pf_applicable || !!employee.pf_eligible)`.
If the two sources disagree the modal shows PF **on**, and saving writes that back to the
employee. The modal can therefore never display, or correct, a "PF off" state that one
source still holds — it resolves the disagreement in one direction only.

### F5 — Opening COMP on an employee with no salary structure clears ESI  — LOW
`HrEmployees.tsx:1547` (`seedFresh`) forces `esi_applicable`/`pt_applicable` to false when
no structure exists, while PF keeps the employee value. Saving that step writes
`esi_applicable: false` to the employee — an ESI flag set during onboarding is cleared by
merely opening and saving Step 4.

### F6 — A future-dated revision is written back to the employee immediately  — LOW/MEDIUM
`SalaryStructureController.php:616-631` applies `pf_eligible`, `esi_applicable`,
`annual_salary`, `pf_type` to the employee as soon as the revision is saved, whatever
`effective_from` says. `PayrollService::activeStructure()` picks the version in force on the
period date. So a revision effective 02 Sep 2026 makes COMP show the future PF/CTC as
current while payroll keeps pricing on the old version. The two are correct-but-different,
which reads as the screens disagreeing.

## 3. Current data state
Checked all 48 salary structures on the local DB: **0 rows** where
`employees.pf_eligible` disagrees with any `active`/`superseded` structure's `pf_applicable`.
The stored data is consistent (migration `2026_08_21_000001_resync_pf_esi_flags_...` did that).
The divergence in this ticket is produced by the screens, not sitting in the tables — so it
will not reproduce by reading records, only by following the steps above.

## 4. Fixes applied — 29 Sep 2026

| # | Status | Change |
|---|---|---|
| F1 | **fixed** | Banner renamed "Include this Employee in Payroll" on COMP + ONB; its note rewritten to say the employee is excluded from every run and that PF is switched separately. `enable_payroll` added to the Revise Salary roster payload and to EmployeeProfile's modal shape; REV now shows an amber "this employee is off payroll" notice above the statutory boxes. |
| F2 | **fixed** | `breakupSignature()` takes `pfType` (hashed only while PF is on); all four call sites pass it. A PF-Type-only change now creates a revision. |
| F3 | **fixed** | `pf_type` is no longer nulled when PF is switched off — `EmployeeController::normalisePfType()`, `SalaryStructureController::store()`, and all three screens' payloads. Standard survives an off/on round trip. |
| F4 | **fixed** | `SalaryStructureModal` seeds PF/ESI from the structure alone; the `\|\| employee.*` OR is gone. |
| F5 | **fixed** | `seedFresh()` keeps the employee's ESI flag (new `eEsiFromEmployeeRef`) instead of forcing false. PT still starts off — it is state-levied and has no employee column. |
| F6 | **open, deliberately** | A future-dated revision still writes back to the employee immediately. Both sides are internally correct (COMP shows the agreed terms, payroll prices the version in force on the period date); suppressing the write-back would make COMP stop reflecting an accepted revision, which is the opposite of what this ticket asks for. Ticket separately if the effective date should be shown beside the COMP figures. |

### F7 — bug #217: the version never moved (fixed 29 Sep 2026)
Reported separately as "PF configuration changed in the Employee Form under Payment Details
is not reflected in Revise Salary, and the version remains unchanged".

Cause is the **order of the two saves**, not the PF logic. Saving the Employee form fires
`PUT /employees/{id}` first, which (a) mirrors `pf_eligible`/`esi_applicable` onto every
active and superseded structure and (b) writes the new `pf_type` onto the employee.
`POST /salary-structures` runs second, and `SalaryStructureController::isNoOp()` decides
whether the post is a real revision by comparing it against *those same two records* — which
the PUT had already moved to the submitted values. Every PF change therefore looked like a
no-op: the flag landed (the mirror wrote it), but no version was cut, Salary History stayed
empty and Revise Salary kept showing v43. Applied and unrecorded at the same time.

Fix: post the breakup **before** the employee PUT for an existing employee, in both
`HrEmployees.tsx` (Employee form) and `HrEmployeeOnboarding.tsx` (`saveStage1`). A create
keeps the original order — there is no id to hang a structure off until the POST returns.

Proven against the real controller (transaction rolled back, employee with an active v43,
PF Type Statutory → Standard, same effective date):

| Order | Result |
|---|---|
| PUT first (old) | `200 Nothing changed — version 43 already holds exactly these terms` — versions: 43 |
| Breakup first (new) | `201 Salary structure saved (version 44)` — versions: 43,44 |

An identical re-save still correctly creates nothing (`200 Nothing changed`), so the fix does
not turn every save into a new version.

### Retest steps
1. COMP → turn "Include this Employee in Payroll" off → save → open Revise Salary: the amber
   off-payroll notice appears; the PF tick no longer contradicts the toggle.
2. COMP → PF Type Statutory → Standard → save → Salary History: a new version exists, and
   Revise Salary opens on it.
3. COMP → PF Applicable No → save → PF Applicable Yes → save: PF Type is still Standard.
4. REV → untick PF → save → COMP: PF Applicable reads No.
5. Open COMP Step 4 for an employee with no salary structure, save without editing: their
   ESI flag is unchanged.
6. (#217) COMP → change any PF setting → Update Employee → Employee Profile → Payroll →
   Payment Details: the structure version has incremented and Revise Salary opens on the new
   version carrying the new PF config. Saving again with nothing changed adds no version.
