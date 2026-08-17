# Payroll — Test Case Matrix (PAY-01 … PAY-54)

Execution tracker for the payroll module, in the standard QA sheet format
(**Test Case ID · Scenario · Expected Result · Actual Result · Status · Bug
Reference · Tester Remarks · Explanation**).

- **Section 1** is the sheet you fill in during a run — one row per case, short columns.
- **Section 2** is the explanation for every case: what the system actually does,
  *which file and line decides it*, and what a failure looks like on screen.
- **Section 3** covers the four extra areas requested (fine deduction, expense
  reimbursement, regularization lock after payroll, overtime regularization).

Companion docs:
[PAYROLL_MODULE.md](PAYROLL_MODULE.md) (how the module is built) ·
[PAYROLL_QA_RULES.md](PAYROLL_QA_RULES.md) (the 21 payroll rules mapped to code) ·
[PAYROLL_QA_SCENARIOS.md](PAYROLL_QA_SCENARIOS.md) (long-form steps + preconditions) ·
[ATTENDANCE_AUDIT_2026-07-28.md](ATTENDANCE_AUDIT_2026-07-28.md) (attendance inputs).

---

## How to run this sheet

1. **Read the configuration before asserting a number.** Proration basis, cutoff,
   OT multiplier, late-mark threshold, probation length, sandwich policy, weekly-off
   pattern and holiday group are all tenant settings. A number that disagrees with
   *your* assumption but agrees with *the setting* is a config difference, not a bug.
2. **Use a throw-away cycle.** Several cases regenerate, reopen, or disburse.
   Never run them on a month that has been paid.
3. **Record a baseline first** — employee count, total gross, total net. Most
   failures are only visible as a difference from the baseline.
4. **Check every field on every case**, not just the one the case is about:
   Gross · Basic · Allowances · OT · Paid days · LOP days · each deduction line
   separately · Net Pay · Payslip status · PDF · Month/Year/FY · no duplicate payslip.
5. **Where to look for a missing employee:** `HR → Payroll → Run Payroll` preflight
   modal, bottom panel **"Not in this run"** — every deliberate exclusion is listed
   there with its reason. An employee in *neither* the payslip list *nor* that panel
   is a genuine silent drop → log it.

**Severity key:** **S1** money wrong / paid twice / paid to wrong person ·
**S2** money right but run blocked or a valid employee excluded ·
**S3** display, label, export or status only.

**Status values:** `Pass` · `Fail` · `Blocked` · `Config` (behaviour follows a
setting, not the code) · `Not Run`.

---

## Section 1 — Execution sheet

| Test Case ID | Payroll Test Scenario | Expected Result | Sev | Actual Result | Status | Bug Ref | Tester Remarks |
|---|---|---|---|---|---|---|---|
| PAY-01 | Employee is within the probation period | Payroll follows the configured probation rule — probationer is paid normally, probation status shown on the slip | S1 | | | | Payroll is calculated per the configured probation policy |
| PAY-02 | Employee leaves before completing probation | Salary excluded / handled per the probation + exit policy (early exit ≤15 days → not put through payroll) | S1 | | | | Handled per exit **and** probation policy |
| PAY-03 | Employee completes probation mid-cycle | Status reads *completed* (evaluated at period end); pay is unaffected | S3 | | | | Added for completeness — not in original sheet |
| PAY-04 | Employee onboarding is incomplete | Employee not included in payroll, and shown in "Not in this run" with the stage they are stuck on | S2 | | | | Salary should calculate from first day of joining once onboarding completes |
| PAY-05 | Employee joined before the payroll month | Full monthly salary calculated | S1 | | | | |
| PAY-06 | Employee joins in the middle of the month | Salary prorated from the joining date | S1 | | | | |
| PAY-07 | Employee joining date is in the future | Employee does not appear in the current payroll | S2 | | | | |
| PAY-08 | Employee joins after the payroll cutoff date | Included / excluded per the configured cutoff rule | S2 | | | | Verify against the cutoff configuration, not assumption |
| PAY-09 | Employee left before the payroll month | No salary generated for that month | S1 | | | | Based on the first-15-day criteria |
| PAY-10 | Employee leaves during the payroll month | Salary calculated only for eligible days | S1 | | | | |
| PAY-11 | Employee leaves mid-month and has F&F settlement | Paid only once, through F&F | S1 | | | | Overall remaining payment including reimbursement |
| PAY-12 | Employee rejoins after a previous exit | Salary calculated from the new joining date | S1 | | | | Confirmed expected |
| PAY-13 | Employee has approved paid leave | Leave days paid, no salary deduction | S1 | | | | Only paid-type leave |
| PAY-14 | Employee has approved unpaid leave | Unpaid days deducted as LOP | S1 | | | | Also check whether the leave attracts sandwich policy |
| PAY-15 | Employee has unapproved absence | Absence deducted per the configured rule | S1 | | | | |
| PAY-16 | Employee has weekly offs and holidays | Weekly offs and holidays never treated as absent | S1 | | | | Also confirm no sandwich-policy violation |
| PAY-17 | Employee has a half-day attendance | Counted as 0.5 day | S1 | | | | |
| PAY-18 | Employee has multiple late marks | LOP applied only after the configured threshold | S1 | | | | |
| PAY-19 | Employee has missing punch / incomplete attendance | Flagged for correction before payroll approval | S2 | | | | |
| PAY-20 | Employee has no attendance for the entire month | Flagged, LOP applied per policy | S1 | | | | |
| PAY-21 | Employee has overtime on a normal working day | OT calculated at the configured normal OT rate | S1 | | | | |
| PAY-22 | Employee has overtime on a weekly off / holiday | OT priced at the rest-day multiplier, day not double-counted | S1 | | | | Added for completeness |
| PAY-23 | Overtime on a day credited by regularization | Regularized rest day keeps its rest status — punches do not become a full auto-paid OT day | S1 | | | | Added for completeness |
| PAY-24 | Employee has decimal overtime hours | Decimal hours calculated per the rounding rule | S2 | | | | |
| PAY-25 | Employee has no overtime | OT amount stays zero | S3 | | | | |
| PAY-26 | Employee has no active salary structure | Payroll held with a clear reason | S2 | | | | |
| PAY-27 | Salary revised during the month | Old and new salary prorated by effective dates | S1 | | | | Effective date expected to be the 1st of the month |
| PAY-29 | Salary structure has a future effective date | Future structure does not affect the current payroll | S1 | | | | |
| PAY-30 | Employee has multiple deductions | PF, ESIC, PT, TDS, loan and others each calculated separately | S1 | | | | |
| PAY-31 | Employee joins/leaves mid-month with deductions | Deductions computed on the prorated salary | S1 | | | | |
| PAY-32 | Recovery amount exceeds net salary | Net salary never goes negative; excess carries forward | S1 | | | | |
| PAY-34 | Payroll contains decimal salary calculations | Final amounts follow the configured rounding rule | S2 | | | | |
| PAY-35 | Payroll generated twice for the same month | No duplicate payroll / duplicate payslip | S1 | | | | |
| PAY-36 | Payroll generated for a future month | System prevents future payroll generation | S2 | | | | |
| PAY-37 | Payroll generated before attendance finalization | Generation blocked with a clear message | S2 | | | | |
| PAY-38 | Payroll month already finalized / paid | Cannot be edited, regenerated or paid again | S1 | | | | |
| PAY-39 | Payroll run contains no employees | Approval and payment blocked | S2 | | | | |
| PAY-40 | Employee has invalid or missing bank details | Payment held until bank details are corrected | S1 | | | | |
| PAY-42 | Payroll bank / export file generated | Export total matches the approved payroll total | S1 | | | | |
| PAY-43 | Payroll run for a specific branch | Only employees of the selected branch appear | S1 | | | | |
| PAY-45 | Unauthorized user accesses payroll | Payroll data and actions restricted | S1 | | | | |
| PAY-46 | New payroll generated after previous months completed | Earlier payroll records and payslips unchanged | S1 | | | | |
| PAY-47 | Employee becomes inactive in the current month | Not in current payroll, history still available | S2 | | | | |
| PAY-48 | Payslip vs payroll register vs export compared | Salary and deduction details match in all three | S1 | | | | |
| PAY-49 | Payroll generated at the month / year boundary | Correct month, year and financial year shown everywhere | S3 | | | | |
| PAY-50 | Attendance corrected and payroll regenerated | Corrected salary reflected, no duplicate records | S1 | | | | |
| PAY-51 | Fine deduction applied to an employee | Fine appears as its own deduction line and reduces net pay once | S1 | | | | Extra area requested |
| PAY-52 | Expense reimbursement paid through payroll | Reimbursement is an earning, not taxed as salary, never double-paid with F&F | S1 | | | | Extra area requested |
| PAY-53 | Attendance regularization after payroll is locked | Blocked / does not alter a paid cycle | S1 | | | | Extra area requested |
| PAY-54 | Overtime raised via regularization | Not allowed — OT must come from the adjustment flow | S2 | | | | Extra area requested |

> Cases PAY-28, PAY-33, PAY-41 and PAY-44 are intentionally not in this sheet —
> they were dropped from the source scenario list and are not separately testable
> in the current build.

---

## Section 2 — Explanations (what the system does, and where)

Each entry gives the **rule as implemented**, the **code location**, and the
**failure signature** — what you would actually see if it broke.

### Group 1 — Eligibility & probation

**PAY-01 · Probation does not withhold salary.**
A probationer is paid on exactly the same rules as a confirmed employee (joining
proration, LOP, late marks). Probation status is stamped on the slip as an info
line so a reviewer can see the rule was applied deliberately. Probation is
evaluated **at period end**, not at period start.
`app/Services/PayrollService.php:1046` (`computeForEmployee`), `App\Support\ProbationGuard`.
*Fails as:* salary withheld or zeroed for a probationer, or no probation line on the slip.

**PAY-02 · Early exit (≤15 days) is not put through payroll at all.**
`ProbationGuard::isEarlyExit()` drops anyone who resigned or left within
`EARLY_EXIT_DAYS` of joining, even if no last working day has been agreed yet.
They still appear in the preflight exclusion panel with an *On probation* chip.
`PayrollService.php:622` (`eligibleEmployees`), `:791` (`payrollExclusions`).
*Fails as:* a 6-day joiner produces a full payslip, **or** disappears from both lists.

**PAY-03 · Probation completed mid-cycle** reads as *completed* because the check
runs against `period_end`. `PayrollService.php:1056`.

**PAY-04 · Incomplete onboarding excludes from the run.**
Only `onboarding_stage_completed >= 6` employees are picked up — the same
"fully onboarded" gate the manager picker and Exit Management use. Crucially,
`payrollExclusions()` deliberately does **not** apply the onboarding filter, so
these employees still show in "Not in this run" with the stage they are stuck on.
`PayrollService.php:590` and `:661`, `:707`.
*Fails as:* the employee is in neither list (silent drop) — that is the bug this
design exists to prevent.

**PAY-05 / PAY-06 · Joining proration.**
Joined on or before the period start → full month. Joined mid-month → gross and
basic are multiplied by a proration factor, and the payslip carries the exception
line *"Mid-cycle join/exit — salary pro-rated to N% of the month."*
`PayrollService.php:1142`, `:1442-1443`, `:1840`.
*Fails as:* full salary on a mid-month joiner, or proration applied to someone
who joined earlier.

**PAY-07 · Future joining date.**
The eligibility query keeps only `date_of_joining IS NULL OR <= period_end`, and
the exclusion panel's relevance gate skips future hires entirely so they don't
pollute old cycles. `PayrollService.php:600`, `:695`.

**PAY-08 · Cutoff.** This is **configuration-driven** — read the tenant's cutoff
setting first, then assert. Mark the row `Config` if behaviour matches the setting.

**PAY-09 / PAY-10 / PAY-11 · Exit and F&F.**
Anyone whose last working day falls on or before the period end is removed from
regular payroll and settled through **F&F instead** — they are reported in the
exclusion panel so a vanishing leaver doesn't read as a bug. Earned salary up to
the last working day is computed by `earnedSalaryForExitMonth()` (`:455`) and folded
into the F&F statement by `computeFnf()` (`:288`), which also carries leave
encashment, approved bonus, notice recovery and outstanding advances.
`PayrollService.php:622`, `:772`, `:801`.
*Fails as (S1):* the employee gets **both** a regular payslip and an F&F payout.

**PAY-12 · Rejoin.** Computation keys off the current `date_of_joining`, so a
rejoiner prorates from the new date. `PayrollService.php:906`.

### Group 2 — Attendance, leave and LOP

**PAY-13 / PAY-14 · Paid vs unpaid leave.**
`leaveAggregates()` splits approved leave by the leave **type's** paid flag
(`leaveTypePaidMap`). Paid days count toward paid days; unpaid days become LOP.
`PayrollService.php:1280`, `:2478`, `:2629`.
Sandwich policy is applied on top — `sandwichDaysFor()` / `sandwichBreakdown()`
(`:2418`, `:2435`) add sandwiched rest days to LOP, and `GET /payroll/sandwich-review`
lists every leave inflated by the policy so HR can review before approving.
*Check both:* the LOP number **and** the sandwich review list.

**PAY-15 · Unapproved absence** is charged as LOP through the same
`effectiveWorkingDays − paidDays` arithmetic. `PayrollService.php:1376`, `:1447`.

**PAY-16 · Weekly offs and holidays are never absent.**
`restDayKind()` classifies each date as weekly-off / holiday from the branch
pattern and holiday group; those days are excluded from the absent count.
`PayrollService.php:2135`, `:2098`, `:2157`.
*Fails as:* an employee with perfect attendance shows LOP equal to the number of
Sundays in the month.

**PAY-17 · Half day = 0.5.** `PayrollService.php:1262`, `:2302`.

**PAY-18 · Late marks.** Late is measured against the **resolved shift window**
(`Employee::resolveShiftWindow()` from the branch `shifts` JSON — not a fixed
09:30), and LOP is `intdiv(late_marks, threshold) × 0.5` day. Below the threshold
it must be **zero**. `PayrollService.php` late-mark block + branch `late_mark_policy`.

**PAY-19 · Missing punch.** Surfaces as an attendance exception; the payslip is
set `Pending Review` (warning) rather than `Ready`. Status logic:
`PayrollService.php:1833` — `On Hold` (blocking) / `Pending Review` (warning) / `Ready`.

**PAY-20 · Zero attendance for the month.**
`attendanceCoverage()` is shown in the finalize-attendance step precisely so HR
sees that a zero-attendance employee will be **fully LOP'd** before locking it in.
`PayrollService.php:374`, `:1735`.
*Fails as:* a full-LOP employee slipping through finalization unflagged.

### Group 3 — Overtime

**PAY-21 / PAY-24 / PAY-25 · OT pricing.**
Rate is derived, not stored: `hourly = BASIC ÷ working days ÷ shift hours`, then
`rate = hourly × multiplier`, `amount = rate × approved hours`. A `rate` is
persisted on the adjustment **only** when the caller supplies an override —
leaving it NULL is what lets the run re-derive the rate after a salary revision.
Decimal hours are carried at full precision and rounded at the amount
(`round($hours * $rate, 2)`). No OT → amount is 0, no OT line.
Daily OT is capped at `MAX_OT_MINUTES_PER_DAY = 720` (12h).
`PayrollService.php:3224` (`overtimeRate`), `:3271` (`overtimeHoursFromAttendance`),
`:3476` (`overtimeForCycle`), `:1515`; `PayrollAdjustmentController.php:64`.
*Fails as:* OT priced off gross instead of basic, or an override rate surviving a
salary revision.

**PAY-22 / PAY-23 · Rest-day OT.** A regularization approved on a weekly off or
holiday keeps the **rest-day status** rather than being credited On Duty —
otherwise OT detection loses the marker it uses to skip the day and any stray
punches become a full auto-paid OT day.
`AttendanceRegularizationController.php:628`, `PayrollService.php:2127`, `:3298`.

### Group 4 — Salary structure and deductions

**PAY-26 · No active structure → held.** `activeStructure()` returns null,
the payslip is stamped `On Hold` with the reason on the slip.
`PayrollService.php:1890`, `:1199`.
Fallback compensation (annual ÷ 12, 50/30/20 split) exists at `:2008` for legacy
rows without a structure — verify which path your test employee took.

**PAY-27 / PAY-29 · Revision mid-month and future-dated structures.**
`blendCompensation()` walks the structure versions day by day and weights each by
the days it was in force, so an old and a new package prorate by effective date.
A structure whose effective date is **after** the period end is never in force and
cannot affect the run. `PayrollService.php:1932`, `:1957`, `:1150`, `:1913`.
*Fails as:* the newest structure applied to the whole month regardless of date.

**PAY-30 · Deduction lines are computed separately.**
- PF — 12% of basic, wage ceiling ₹15,000, only for PF-eligible employment types (`:1622`, `:2071`).
- ESI — 0.75%, gross limit ₹21,000 (`:1639`).
- PT — state-slab driven via `workState()`; Maharashtra slabs are explicit (`:2657`, `:2836`, `:2852`).
- TDS — slab engine with ₹75,000 standard deduction, ₹12,00,000 rebate ceiling, 4% cess, spread across the FY and net of TDS already paid this FY (`:2707`–`:2814`).
- Advances / loans — `advanceRecovery()` with a scheduled EMI per cycle (`:2924`, `:3077`).
- Structure "other" deductions — scaled by the earned factor (`:1682`).

**PAY-31 · Deductions on prorated salary.** PT, ESI and structure deductions are
multiplied by the earned factor, so a mid-month joiner is not charged a full-month
deduction. `PayrollService.php:1639`, `:1649`, `:1682`.

**PAY-32 · Net never negative.**
Recovery is capped at 70% of net-before-recovery (`$foiCap`), and anything above
the cap is **carried forward** and recorded in the recovery ledger rather than
pushed into a negative net. `PayrollService.php:1698`, `:1705-1706`, `:3130`.
*Fails as:* a negative net pay, or a carried amount silently lost.

**PAY-34 · Rounding.** Every money field is rounded to 2 decimals at the point of
computation, and the run totals are rounded again (`:1027-1029`, `:275-277`).
Confirm the *displayed* rounding rule matches the tenant setting before failing this.

### Group 5 — Run lifecycle

**PAY-35 · No duplicate payroll.** Three separate protections:
1. The period row is **locked for update** before the latest run is read, so a
   double-click or two concurrent HR users cannot each create a run (`:947`).
2. Regenerating wipes prior payslips for the run (`forceDelete`) rather than
   appending (`:963`).
3. Cross-level guard — anyone already carrying a payslip in a **sibling period**
   for the same client + month + year (e.g. a branch run already covered them and
   now a client-wide run is generating) is skipped (`:976-989`).
*Fails as:* doubled run totals, or two payslips for one employee in one month.

**PAY-36 · Future month blocked.** `guardPeriodStarted()` returns 422 —
*"Payroll for {label} cannot be processed before the period begins on {date}."*
`PayrollController.php:119`, called from `run()` (`:523`) and `finalizeAttendance()` (`:327`).

**PAY-37 · Attendance must be finalized first.** `generate()` throws
*"Payroll cannot be processed because attendance is not finalized."* → HTTP 422.
`PayrollService.php:935`, surfaced by `PayrollController::run` (`:527`).

**PAY-38 · Locked / paid period is immutable.** A locked period throws
*"This payroll period is locked. Adjustments must go to the next cycle."*; an
approved/paid run throws *"Payroll for this period is already approved/paid and
cannot be regenerated."* Re-paying a fully-paid run is refused with
*"This payroll run is already fully paid."* — the `paid` status is re-enterable
**only** to clear previously-held slips.
`PayrollService.php:938`, `:955`; `PayrollController.php:632-640`.

**PAY-39 · Empty run.** `total_employees = 0` — approval and payment must refuse.
`PayrollService.php:1026`; `PayrollController::approve` (`:539`), `pay` (`:624`).

**PAY-46 · Prior cycles untouched.** Regeneration is scoped to
`payroll_run_id` of the current run only; sibling periods are read but never
written. `PayrollService.php:963`, `:976`.

**PAY-47 · Employee goes inactive.** `Inactive` / `Resigned` / `Terminated` are
excluded from the current run (`:585`), but history stays readable through
`GET /payroll/employee/{id}/payslips` and `payrollExclusions()` uses
`withTrashed()` so a soft-deleted exit still explains itself (`:670`).

**PAY-50 · Correct attendance, then regenerate.**
Payslips in **draft / generated** runs are recomputed **in place** by
`recomputeEmployeePayslips()` — same row, recomputed columns — so a regularization
approved after generation but before approval reflects the corrected salary
without a second payslip. Approved/paid runs and locked periods are skipped.
`PayrollService.php:153`, `:188`; `AttendanceRegularizationController.php:896`.
*Fails as:* a duplicate payslip row, or the corrected day never reaching the money.

### Group 6 — Disbursement, export, scope and access

**PAY-40 · Bank details.** At disbursement, `disburseRun()` re-reads the
employee's bank account, strips whitespace, and flips the slip to **On Hold**
when it is missing/invalid instead of paying. The run stays `approved` (not `paid`)
while any slip is held, and the response says
*"Paid N; M held for bank/blocking issues — resolve and pay again."*
`PayrollService.php:208`, `:236-251`; `PayrollController.php:645-660`.

**PAY-42 · Export vs approved total.** `GET /payroll/export` streams the payslip
rows of the **latest run of that period**, with columns Emp Code, Employee,
Department, Designation, Employment Type, Working/Paid/LOP Days, Gross, PF, ESI,
PT, TDS, LOP Amt, Advance Rec, Loan Rec, Total Deductions, Net Pay, Status.
Sum the Net Pay column and compare against the run's `total_net`.
Employment type is read from the payslip's own **snapshot**, so an old export stays
reproducible after the employee's type changes. `PayrollController.php:1167`.
Bank file for the payment batch: `PayrollPaymentController::bankFile` (`:167`).

**PAY-43 · Branch scoping.** A requested `branch_id` may narrow the caller's scope
but never widen it — a branch outside the caller's context returns 403. The
payslip stores the **employee's** branch (not the period's), so a client-wide run
still reports correctly per branch.
`PayrollController.php:1185-1189`; `PayrollService.php:1000`.

**PAY-45 · Authorization.** `canManage()` allows `super_admin`, `client_admin`,
`branch_user`, or a user whose `hr.payroll` permission carries `can_edit` /
`can_approve`. `user_type === 'employee'` is always refused. Export has its own
`canExport()` gate. Processing actions additionally require a concrete tenant
scope (`requireScope`) so a super-admin with nothing selected cannot pool every
tenant's employees into one run.
`PayrollController.php:77`, `:89`, `:1169`, `:1176`.
*Test both:* the UI hiding the button **and** the API returning 403 when called
directly — a hidden button with an open endpoint is still an S1.

**PAY-48 · Three-way reconciliation.** Payslip PDF (`PayslipPdfService`),
payroll register (`GET /payroll`, `GET /payroll/history`) and CSV export
(`GET /payroll/export`) all read the same `payslips` rows. Any disagreement is a
rendering bug, not a calculation one — compare field by field, especially the
deduction lines, which are the ones that historically drift.

**PAY-49 · Month / year / FY boundary.** Financial year is derived by
`PayrollPeriod::financialYearFor($month, $year)`, and the export filename carries
both cycle and FY (`payroll_<label>_FY<fy>.csv`) so a January export cannot be
mistaken for the next FY once it is off screen.
`PayrollController.php:1201`; `PayslipPdfService.php:238`;
`resources/js/pages/hrms/HrPayroll.tsx:87`; `resources/js/components/PayslipViewerModal.tsx:107`.

---

## Section 3 — Extra areas requested

### PAY-51 · Fine deduction

Fines are recorded through the **payroll adjustment** flow, type `deduction`
(`PayrollAdjustment::TYPES = ['overtime','bonus','incentive','deduction']`).
Only **approved** adjustments reach the payslip
(`approvedDeductionAdjustments()`, `PayrollService.php:3587`), and each one is
emitted as its own line via `adjustmentLines()` (`:3618`), then subtracted from
the structure's "other" bucket so it is never counted twice (`:1818`).
Approving an adjustment triggers `recomputeEmployeePayslips()` immediately, so a
fine added after generation lands without a re-run —
`PayrollAdjustmentController.php:141`, `:149`.

**Test:** add a fine → leave it *pending* → confirm it does **not** appear on the
slip → approve → confirm one line, correct amount, net reduced exactly once, and
total deductions moved by the same amount.
**Fails as (S1):** the fine counted both as its own line and inside "other
deductions", or a *pending* fine already deducted.

### PAY-52 · Expense management / reimbursement

Reimbursements are **earnings**, not salary — they must not attract PF, ESI, PT
or TDS. Approved expense claims (`ExpenseClaimController`) and advances
(`AdvanceRequestController`) interact with payroll in two places:
- **Advance recovery** — outstanding advances are recovered from the payslip,
  capped at 70% of net, with the remainder carried (`PayrollService.php:2924`, `:1698`).
- **F&F** — `computeFnf()` folds outstanding dues and advance recovery into the
  final settlement (`:288`, `:334`, `:361`).

**Test:** approve an expense claim and an advance in the same cycle → verify the
reimbursement is not in the taxable base, the advance recovery line is separate
from the loan line, and the recovery ledger (`recordRecoveryLedger`, `:3130`)
shows recovered + carried adding up to the scheduled due.
**Fails as (S1):** reimbursement taxed as salary, or an advance recovered in both
the payslip and the F&F.

### PAY-53 · Regularization locked after payroll

`recomputeEmployeePayslips()` deliberately refuses to touch approved/paid runs and
locked periods (`PayrollService.php:153`, `:188`). A regularization approved after
the cycle is paid must therefore **not** change historical money — it may update
the attendance timeline, but the paid payslip stays frozen and any correction
belongs to the next cycle (the same principle as the locked-period message,
*"Adjustments must go to the next cycle."*).

**Test:** pay a cycle → approve a regularization for a date inside it → confirm
(a) the paid payslip's paid/LOP days and net are unchanged, (b) no new payslip
row appears, (c) the change is either rejected up front or visibly deferred.
**Fails as (S1):** a paid month's net silently changing after disbursement.

### PAY-54 · Overtime regularization not allowed

Overtime must be raised through the **adjustment** flow
(`POST /payroll-adjustments` with `type: overtime`, optionally
`from_attendance: true`), not through attendance regularization. The
regularization path only credits a day's *status* (On Duty / WFH), and on a rest
day it preserves the rest status precisely so credited punches cannot be turned
into auto-paid OT (`AttendanceRegularizationController.php:628`,
`PayrollService.php:3298`).

`from_attendance` also enforces two distinct refusals so HR knows what to fix:
- *"Overtime is not applicable to this employee — set 'Overtime Applicable' to Yes
  and pick an Overtime Rate in their Leave & Attendance step first."*
- *"No overtime found in attendance for this cycle — nobody worked past the
  {shift_end} shift end."*

`PayrollAdjustmentController.php:88-97`.

**Test:** attempt to create OT via a regularization → expect no OT on the slip.
Then raise the same hours as an adjustment → expect the OT line, priced from
basic, at the configured multiplier.

---

## Appendix — quick reference

### Endpoints touched by this sheet

| Action | Endpoint |
|---|---|
| Cycle strip (13 months) | `GET /payroll/cycles` |
| Preflight + exclusions | `GET /payroll/preflight` |
| Sandwich review | `GET /payroll/sandwich-review` |
| Finalize attendance | `POST /payroll/finalize-attendance` |
| Generate run | `POST /payroll/run` |
| Reopen | `POST /payroll/reopen` |
| Approve | `POST /payroll/approve` |
| Pay / disburse | `POST /payroll/pay` |
| Payment batch | `POST /payroll/payment/prepare` → `/approve` → `/initiate` → `/bank-file` → `/audit` |
| Payslip + PDF + email | `GET /payroll/payslip/{id}`, `/pdf`, `POST /payroll/payslip/{id}/email` |
| Employee history | `GET /payroll/employee/{id}/payslips` |
| F&F | `GET|POST /payroll/fnf/{employeeId}`, `POST /payroll/fnf/{employeeId}/status` |
| CSV export | `GET /payroll/export` |
| Adjustments (OT / bonus / incentive / fine) | `GET|POST /payroll-adjustments`, `/{id}/approve`, `/{id}/reject`, `DELETE /{id}` |
| OT preview | `GET /payroll-adjustments/overtime-preview` |

### Statutory constants (hardcoded — verify before asserting)

| Constant | Value | Where |
|---|---|---|
| PF wage ceiling | ₹15,000 | `PayrollService.php:38` |
| PF rate | 12% | `:39` |
| ESI gross limit | ₹21,000 | `:41` |
| ESI rate | 0.75% | `:42` |
| TDS standard deduction | ₹75,000 | `:2718` |
| TDS rebate ceiling | ₹12,00,000 | `:2721` |
| TDS cess | 4% | `:2724` |
| Recovery cap | 70% of net | `:1698` |
| Max OT / day | 720 min (12h) | `:56` |
| Default shift | 09:30–18:30, 9.0h | `:50-52` |
| Display timezone | Asia/Kolkata | `:46` |

### Payslip status meanings

| Status | Meaning | Set at |
|---|---|---|
| `Ready` | No exceptions — payable | `PayrollService.php:1833` |
| `Pending Review` | Warning-level exception (e.g. missing punch) | `:1833` |
| `On Hold` | Blocking exception (no structure, bad bank details) | `:1199`, `:251` |
| `Paid` | Disbursed | `disburseRun()` `:208` |

---

*Sheet version 1.0 — 2026-08-14. Line references are against the `saas` branch at
time of writing; re-grep `PAY-` markers in `app/` and `resources/js/` if the code
has moved (`grep -rEno "PAY-[0-9]+" app/ resources/js`).*
