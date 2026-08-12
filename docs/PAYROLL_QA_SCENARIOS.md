# Payroll QA — Test Scenario Pack

Manual test pack for the payroll module: eligibility, attendance, probation,
joining/exit, salary calculation, overtime, deductions, run lifecycle,
disbursement, scoping and reconciliation.

**40 scenarios in 10 groups.** Each one gives you: preconditions, steps, the
expected result, and **"Fails as"** — what the bug actually looks like on screen,
so you can recognise it without re-deriving the maths.

---

## How to use this pack

### Before you start

1. **Confirm the configuration first.** Several expected results below depend on
   settings, not on code: proration basis, payroll cutoff date, OT rate and
   multiplier, late-mark threshold, rounding rule, probation policy, weekly-off
   pattern, holiday group. **Read the setting, then test against it.** Testing a
   policy-dependent number against your own assumption produces config-as-bug
   reports, which get closed and waste a cycle.
2. **Use a dedicated test cycle.** Never run these against a month that has been
   paid — several scenarios are destructive (regenerate, reopen, disburse).
3. **Record the baseline.** Before the first run, note employee count, expected
   gross and expected net. Most failures below are only visible as a *difference*.

### Severity guide

| Sev | Meaning |
|---|---|
| **S1** | Money is wrong, paid twice, or paid to the wrong person. Stop-ship. |
| **S2** | Money is right but the run can be blocked, or a legitimate employee is excluded. |
| **S3** | Display, label, export or status inconsistency. Number is correct. |

### Field checklist — verify on **every** scenario

> Gross · Basic · Allowances · Overtime · Paid leave days · Unpaid leave days ·
> Present / absent days · Each deduction line separately · Tax · **Net pay** ·
> Payroll status · Payslip PDF · Employee payroll history · Month/year on the
> record · No duplicate payslip row.

A scenario only passes when **all** of these are right — not just the one number
the scenario is about. Most payroll regressions are found in a field the tester
wasn't looking at.

---

## Group 1 — Eligibility & probation

### PAY-01 · Employee still within probation — **S1**
- **Precondition:** Employee joined recently, probation period not yet complete.
- **Steps:** Generate payroll for the current cycle.
- **Expected:** Handled per the configured probation policy — either paid
  normally, or held/excluded with a stated reason. The policy decides; the
  system must apply it consistently.
- **Fails as:** Employee silently absent from the run with no entry in any
  "excluded / on hold" panel, so nobody notices they weren't paid.

### PAY-02 · Employee left before completing probation — **S1**
- **Precondition:** Employee resigned or was released inside the probation window.
- **Steps:** Generate payroll for the cycle covering their exit.
- **Expected:** Treated per the early-exit rule; if excluded, the exclusion is
  **visible and reasoned**, not a silent drop.
- **Fails as:** Full month's salary paid to someone who worked a few days.

### PAY-03 · Employee completes probation mid-cycle — **S2**
- **Precondition:** Probation end date falls inside the cycle.
- **Steps:** Generate payroll.
- **Expected:** Becomes eligible from the correct date; any pre/post-probation
  rate difference applies from the right day.
- **Fails as:** Eligibility flips on the 1st or the 31st instead of the actual date.

### PAY-04 · Half-onboarded employee — **S2**
- **Precondition:** Employee record exists but onboarding is incomplete.
- **Steps:** Generate payroll.
- **Expected:** Excluded from payroll, and the reason is discoverable.
- **Fails as:** Appears in the run with blank department/designation and a ₹0 or
  garbage salary line.

---

## Group 2 — Joining, exit & proration

### PAY-05 · Joined before the cycle, active throughout — **S1**
- **Steps:** Generate payroll for a month fully after the joining date.
- **Expected:** Appears with a **full** month's salary; no proration.
- **Fails as:** Salary quietly pro-rated because the joining date is being
  compared against the wrong boundary.

### PAY-06 · Joined mid-cycle — **S1**
- **Precondition:** Joining date inside the cycle (e.g. 10-Aug for an Aug run).
- **Steps:** Generate payroll.
- **Expected:** Pro-rated from the joining date per the configured basis
  (calendar days vs working days — **check which**). Working days and paid days
  both reflect the shortened window.
- **Fails as:** Full month paid; or pro-rated on calendar days while LOP is
  computed on working days, so the two disagree.

### PAY-07 · Joining date in a future month — **S1**
- **Precondition:** Joining date in September; generate the August run.
- **Expected:** **Not present at all** in the August run.
- **Fails as:** Appears with a full salary, or with a negative/zero paid-day count.

### PAY-08 · Joined after the payroll cutoff — **S2**
- **Precondition:** Joining date after the configured cutoff for the cycle.
- **Expected:** Excluded from this cycle, or carried into it — **whichever the
  cutoff rule states** — and applied the same way for every such employee.
- **Fails as:** Inconsistent: some post-cutoff joiners in, some out.

### PAY-09 · Exited before the cycle started — **S1**
- **Precondition:** Last working day 31-Jul; generate the August run.
- **Expected:** No August salary. No payslip row.
- **Fails as:** Full August salary paid to someone who left in July.

### PAY-10 · Exits mid-cycle — **S1**
- **Precondition:** Last working day 15-Aug.
- **Expected:** Paid only for the eligible worked days, per the full/partial
  month rule. Deductions pro-rate consistently with earnings.
- **Fails as:** Earnings pro-rated but PF/PT deducted at the full-month figure.

### PAY-11 · Mid-cycle exit also settled through F&F — **S1**
- **Precondition:** Employee exits in the cycle **and** has an F&F settlement.
- **Steps:** Generate payroll, then open the F&F for the same employee.
- **Expected:** Paid **once**. Either the regular run covers them or F&F does —
  never both. If excluded from the run, that exclusion is visible.
- **Fails as:** Both a payslip and an F&F payout exist for the same period.
  *This is the single highest-value test in the pack — both artefacts look
  perfectly correct in isolation.*

### PAY-12 · Rejoining employee — **S2**
- **Precondition:** Employee previously exited, now rehired with a new joining date.
- **Expected:** Paid from the new joining date; the old exit does not suppress them.
- **Fails as:** Stale exit record keeps excluding them from every future run.

---

## Group 3 — Attendance & leave

### PAY-13 · Approved paid leave — **S1**
- **Precondition:** Approved paid leave inside the cycle.
- **Expected:** Counted as **paid**; no deduction. Shows under paid leave days,
  not under absent.
- **Fails as:** Deducted as LOP, or double-counted as both paid leave and present.

### PAY-14 · Unpaid leave — **S1**
- **Precondition:** 3 days approved unpaid leave.
- **Expected:** Exactly 3 days LOP, valued on the configured per-day basis.
- **Fails as:** 2 or 4 days deducted (boundary/inclusive-date error), or the
  per-day rate derived from a different base than the policy states.

### PAY-15 · Unapproved absence — **S1**
- **Expected:** Deducted per the absent-day policy, and distinguishable from
  approved unpaid leave on the payslip.
- **Fails as:** Absent and unpaid-leave days collapse into one figure, so the
  employee can't be told why they were docked.

### PAY-16 · Weekly offs and holidays — **S1**
- **Precondition:** Cycle contains weekly offs and at least one holiday from the
  employee's holiday group.
- **Expected:** Both are **paid** and never counted as absent or LOP. Employees
  on different weekly-off patterns get different working-day denominators.
- **Fails as:** Everyone measured against the same working-day count, inflating
  LOP for anyone not on the default pattern.

### PAY-17 · Half-day / short hours — **S2**
- **Expected:** Counted as **0.5** — not rounded to 0 or 1.
- **Fails as:** Half-days silently promoted to full present.

### PAY-18 · Late marks crossing the threshold — **S2**
- **Precondition:** Employee has late marks either side of the configured threshold.
- **Expected:** LOP accrues **only** on completed blocks (e.g. every 3 late marks
  = half day). Under the threshold, no deduction — and the payslip still explains
  why nothing was deducted.
- **Fails as:** Deduction on the very first late mark, or a non-zero late count
  with no explanation anywhere on the slip.

### PAY-19 · Missing punch / incomplete attendance — **S2**
- **Precondition:** A day with an in-punch but no out-punch.
- **Expected:** Flagged for review before approval; not silently treated as a
  full present day **or** a full absence.
- **Fails as:** Day counted as fully present, so the error never surfaces.

### PAY-20 · Zero attendance for the whole cycle — **S1**
- **Precondition:** An eligible employee with no attendance rows at all.
- **Expected:** Full LOP **and** prominently flagged — this is nearly always a
  data problem, not a genuinely absent employee.
- **Fails as:** Quietly paid a full month, or quietly paid ₹0 with no warning.

---

## Group 4 — Overtime

### PAY-21 · OT on a normal working day — **S1**
- **Precondition:** 3 approved OT hours on an ordinary working day.
- **Expected:** OT amount = configured rate × 3.
- **Fails as:** Rate applied per day instead of per hour, or OT added to gross
  but omitted from net.

### PAY-22 · OT base is the eligible/overall amount — **S1**
- **Precondition:** Employee has Basic + allowances + other eligible components.
- **Expected:** OT computed on the **configured base**, not on Basic alone.
- **Fails as:** OT visibly low because only Basic fed the hourly rate.
  *Verify by hand for at least one employee — this one is invisible unless you
  recompute it yourself.*

### PAY-23 · OT on a holiday or weekly off — **S2**
- **Expected:** Holiday/weekend multiplier applied instead of the normal rate,
  if configured.
- **Fails as:** Normal rate applied on a holiday, or the holiday is treated as a
  non-working day so the OT is dropped entirely.

### PAY-24 · Decimal OT hours — **S2**
- **Precondition:** 2.5 OT hours.
- **Expected:** Calculated as 2.5 per the rounding rule.
- **Fails as:** Truncated to 2, or floating-point noise (2.4999…) reaching the payslip.

### PAY-25 · Zero overtime — **S3**
- **Expected:** OT = 0, and **no** OT line, ₹0 row, or stray amount anywhere.
- **Fails as:** An empty OT row on every payslip, or a ₹0 that shifts totals.

---

## Group 5 — Salary structure & revision

### PAY-26 · No active salary structure — **S1**
- **Precondition:** Eligible employee with no structure and no fallback salary.
- **Expected:** **Held** with a clear reason ("missing salary structure").
- **Fails as:** A ₹0 payslip generated and marked Ready — it reconciles fine in
  totals and is very easy to miss.

### PAY-27 · Salary revision mid-cycle — **S1**
- **Precondition:** ₹40,000 → ₹50,000 effective 15-Aug.
- **Expected:** Old rate for the days before, new rate from the effective date,
  correctly pro-rated. Sum of both parts = expected blended gross.
- **Fails as:** Whole month at one rate (usually the newer), or both structures
  applied in full so gross nearly doubles.

### PAY-28 · Backdated revision after a run — **S2**
- **Precondition:** Revision dated inside a cycle that is already generated.
- **Expected:** Handled per the arrears rule — either the cycle recomputes, or
  the difference carries to the next cycle as arrears. Not silently ignored.
- **Fails as:** Revision saved, payroll unchanged, no arrears anywhere.

### PAY-29 · Structure with an effective date in the future — **S2**
- **Expected:** Not applied to the current cycle; the currently-active structure is.
- **Fails as:** Future structure applied early.

---

## Group 6 — Deductions & net pay

### PAY-30 · Statutory and other deductions — **S1**
- **Precondition:** Employee with PF / ESIC / PT / TDS / loan / advance recovery.
- **Expected:** Each computed per its own rule and shown as a **separate line**.
  Eligibility respected (e.g. ESIC only under the wage ceiling; PT per the
  applicable state slab).
- **Fails as:** Deductions lumped into one "Other" figure; or a state-specific
  slab applied to every branch regardless of location.

### PAY-31 · Deductions on a pro-rated month — **S1**
- **Precondition:** Mid-cycle joiner or leaver with statutory deductions.
- **Expected:** Deductions consistent with the pro-rated earnings.
- **Fails as:** Earnings pro-rated, deductions taken at full-month value — net
  pay lands well below what the employee expects.

### PAY-32 · Recovery exceeds net pay — **S1**
- **Precondition:** Loan/advance recovery larger than the month's net.
- **Expected:** Net floors at 0 or the balance carries forward, per policy.
  **Never negative.**
- **Fails as:** Negative net pay, which then flows into the batch total and the
  bank file.

### PAY-33 · LOP exceeds working days — **S1**
- **Precondition:** Absence plus late-mark LOP together exceeding the month.
- **Expected:** Capped at the working-day count; paid days never negative.
- **Fails as:** Negative paid days, or a deduction larger than gross.

### PAY-34 · Rounding across the whole run — **S2**
- **Steps:** Sum every payslip's net; compare to the run/batch total.
- **Expected:** Equal to the paisa.
- **Fails as:** A few rupees' drift — small, but it makes the bank file
  irreconcilable and is a genuine finance defect.

---

## Group 7 — Run lifecycle & duplicates

### PAY-35 · Duplicate generation for the same month — **S1**
- **Steps:** Generate the cycle, then generate it again. Also try a rapid
  **double-click** on the run action.
- **Expected:** Either blocked, or a clean regenerate that **replaces** the prior
  payslips. Employee count and totals stay the same.
- **Fails as:** Totals double; two payslip rows per employee.

### PAY-36 · Run for a future cycle — **S2**
- **Steps:** Attempt to generate next month's payroll.
- **Expected:** Blocked — there is no attendance to draw from.
- **Fails as:** Generates a fully-LOP'd run that looks like mass absence.

### PAY-37 · Run before attendance is finalized — **S2**
- **Expected:** Blocked with a clear message naming what is missing.
- **Fails as:** Runs anyway against partial attendance, producing plausible but
  wrong LOP.

### PAY-38 · Locked / already-paid cycle — **S1**
- **Steps:** Try to regenerate, edit or re-pay a paid cycle.
- **Expected:** Refused; corrections routed to the next cycle as adjustments.
- **Fails as:** A settled month is rewritten, breaking already-issued payslips.

### PAY-39 · Approve or pay an empty run — **S2**
- **Precondition:** A run with zero employees.
- **Expected:** Blocked — nothing to approve or disburse.
- **Fails as:** Cycle marked Paid with ₹0, which then reads as "done" forever.

---

## Group 8 — Disbursement & bank details

### PAY-40 · Missing or malformed bank details — **S1**
- **Precondition:** Employees with a blank account, a short account number, and a
  malformed IFSC.
- **Expected:** **Held** at disbursement, not filed with the bank. Fixing the
  details and re-paying clears the hold without a full regenerate.
- **Fails as:** Row filed with an empty/invalid field; the bank rejects the whole
  batch, not just that row.

### PAY-41 · Partial disbursement, then pay again — **S1**
- **Precondition:** A run where some employees paid and some were held.
- **Steps:** Fix the held employees, then pay again.
- **Expected:** Only the previously-held employees are paid. Already-paid
  employees are **not** re-paid, and the cycle only locks once nothing is outstanding.
- **Fails as:** Everyone paid a second time.

### PAY-42 · Bank/export sheet reconciles to the run — **S2**
- **Steps:** Export the advice/bank sheet; sum it.
- **Expected:** Matches the run's net total and the on-screen employee count.
  Held employees are excluded from the payable file.
- **Fails as:** Export contains held or ₹0 rows, so the filed total exceeds the
  approved total.

---

## Group 9 — Access, scoping & permissions

### PAY-43 · Branch / tenant isolation — **S1**
- **Steps:** Run payroll as a user scoped to one branch.
- **Expected:** Only that branch's employees appear. No employee from another
  branch or another client, ever.
- **Fails as:** A cross-branch employee in the run — worst case, cross-client.

### PAY-44 · Same employee in two overlapping runs — **S1**
- **Precondition:** A branch-level run and a client-wide run for the same month.
- **Expected:** Paid once. The second run must skip anyone already covered.
- **Fails as:** Two payslips for one employee in one month.

### PAY-45 · Unauthorised access — **S1**
- **Steps:** As a plain employee, attempt to run payroll, approve it, and open
  another employee's payslip (including by guessing the URL/id).
- **Expected:** Refused. An employee sees **only** their own payslip.
- **Fails as:** Salary data for the whole company readable by anyone logged in.

---

## Group 10 — History & reporting

### PAY-46 · Historical cycles are immutable — **S1**
- **Steps:** Note June/July figures, generate August, re-check June/July.
- **Expected:** Unchanged.
- **Fails as:** Prior months shift because a report recomputes from *current*
  employee data instead of the stored payslip.

### PAY-47 · Employee active earlier, inactive now — **S2**
- **Precondition:** Worked June and July, inactive in August.
- **Expected:** Absent from the August run; June/July payslips still viewable in
  their history.
- **Fails as:** Deactivating an employee erases their payroll history.

### PAY-48 · Payslip vs register vs export — **S2**
- **Steps:** Compare one employee across payslip PDF, the on-screen row, and the
  Excel/CSV export.
- **Expected:** Identical in every field.
- **Fails as:** Export reads live employee data while the payslip reads the
  stored snapshot, so the two diverge after any master-data edit.

### PAY-49 · Correct month/year stamping — **S3**
- **Expected:** Payslip, register and export all carry the same cycle label; the
  financial year is right at the year boundary.
- **Fails as:** March/April runs stamped into the wrong financial year.

### PAY-50 · Re-run after correction, before payment — **S1**
- **Steps:** Generate, correct attendance, re-run, re-check.
- **Expected:** Figures refresh; no orphaned payslip rows; counts unchanged.
- **Fails as:** Old payslips linger alongside new ones and the totals include both.

---

## Execution tracker

| ID | Scenario | Sev | Result | Bug ref | Notes |
|---|---|---|---|---|---|
| PAY-01 | Within probation | S1 | | | |
| PAY-02 | Left during probation | S1 | | | |
| PAY-03 | Probation completes mid-cycle | S2 | | | |
| PAY-04 | Half-onboarded employee | S2 | | | |
| PAY-05 | Joined before cycle | S1 | | | |
| PAY-06 | Joined mid-cycle | S1 | | | |
| PAY-07 | Future joining date | S1 | | | |
| PAY-08 | Joined after cutoff | S2 | | | |
| PAY-09 | Exited before cycle | S1 | | | |
| PAY-10 | Exits mid-cycle | S1 | | | |
| PAY-11 | Mid-cycle exit + F&F | S1 | | | |
| PAY-12 | Rejoining employee | S2 | | | |
| PAY-13 | Approved paid leave | S1 | | | |
| PAY-14 | Unpaid leave | S1 | | | |
| PAY-15 | Unapproved absence | S1 | | | |
| PAY-16 | Weekly offs + holidays | S1 | | | |
| PAY-17 | Half-day | S2 | | | |
| PAY-18 | Late-mark threshold | S2 | | | |
| PAY-19 | Missing punch | S2 | | | |
| PAY-20 | Zero attendance | S1 | | | |
| PAY-21 | OT normal day | S1 | | | |
| PAY-22 | OT base amount | S1 | | | |
| PAY-23 | OT holiday rate | S2 | | | |
| PAY-24 | Decimal OT | S2 | | | |
| PAY-25 | Zero OT | S3 | | | |
| PAY-26 | No salary structure | S1 | | | |
| PAY-27 | Mid-cycle revision | S1 | | | |
| PAY-28 | Backdated revision | S2 | | | |
| PAY-29 | Future-dated structure | S2 | | | |
| PAY-30 | Deduction lines | S1 | | | |
| PAY-31 | Deductions when pro-rated | S1 | | | |
| PAY-32 | Recovery > net | S1 | | | |
| PAY-33 | LOP > working days | S1 | | | |
| PAY-34 | Rounding drift | S2 | | | |
| PAY-35 | Duplicate generation | S1 | | | |
| PAY-36 | Future cycle run | S2 | | | |
| PAY-37 | Attendance not finalized | S2 | | | |
| PAY-38 | Locked / paid cycle | S1 | | | |
| PAY-39 | Empty run approve/pay | S2 | | | |
| PAY-40 | Bad bank details | S1 | | | |
| PAY-41 | Partial disbursement | S1 | | | |
| PAY-42 | Export reconciles | S2 | | | |
| PAY-43 | Branch/tenant isolation | S1 | | | |
| PAY-44 | Overlapping runs | S1 | | | |
| PAY-45 | Unauthorised access | S1 | | | |
| PAY-46 | Historical immutability | S1 | | | |
| PAY-47 | Inactive employee history | S2 | | | |
| PAY-48 | Payslip vs register vs export | S2 | | | |
| PAY-49 | Month/year stamping | S3 | | | |
| PAY-50 | Re-run after correction | S1 | | | |

---

## Suggested run order

1. **Setup & config** — record every policy setting first.
2. **Groups 1–2** (eligibility, joining/exit) — these decide *who* is in the run.
   Everything downstream is meaningless if the population is wrong.
3. **Groups 3–6** (attendance, OT, structure, deductions) — the maths.
4. **Group 7** (lifecycle) — destructive; run after the maths is confirmed.
5. **Groups 8–9** (disbursement, access) — run on a cycle you are willing to pay.
6. **Group 10** (history) — needs at least two completed cycles to be meaningful.

### If you only have time for five

**PAY-11** (exit + F&F double pay) · **PAY-35** (duplicate generation) ·
**PAY-41** (partial re-pay) · **PAY-43** (branch isolation) · **PAY-26**
(missing structure → ₹0 Ready). These are the four ways to pay the wrong amount
to the wrong person, plus the one silent-₹0 case that reconciles perfectly and
still ships a bug.
