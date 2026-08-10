# Payroll Module — Complete QA Rules & Validation Sheet

> **Single source of truth for QA.** Every rule, sub-rule, constant, status string, message, regex, formula, column and edge case is captured below and mapped to the **actual code** (file:line), the **API endpoint**, and **step-by-step verification**.
>
> **Status legend:** ✅ Implemented · ⚠️ Partial / has a gap · ❌ Not built.

---

## 0. Orientation (read first)

### 0.1 Where the module lives
| Layer | Location |
|---|---|
| Calculation engine (all math) | [PayrollService.php](../app/Services/PayrollService.php) |
| Lifecycle / endpoints | [PayrollController.php](../app/Http/Controllers/Api/PayrollController.php) |
| Disbursement / bank file | [PayrollPaymentController.php](../app/Http/Controllers/Api/PayrollPaymentController.php) |
| Adjustments (OT/bonus/incentive/deduction) | [PayrollAdjustmentController.php](../app/Http/Controllers/Api/PayrollAdjustmentController.php) |
| Salary structures (versioned) | [SalaryStructureController.php](../app/Http/Controllers/Api/SalaryStructureController.php) |
| Frontend screen | HR → Payroll — [HrPayroll.tsx](../resources/js/pages/hrms/HrPayroll.tsx) |
| Models | `PayrollPeriod`, `PayrollRun`, `Payslip`, `PayrollAdjustment`, `SalaryStructure`, `Employee`, `EmployeeExit`, `LeaveRequest`, `Masters\LeaveTypes`, `Holiday`/`HolidayGroup`, `Attendance`/`AttendancePunch`, `ActivityLog` |

### 0.2 Full endpoint list (all under `auth:sanctum` + `user.active`)
```
GET   /payroll/cycles                         list payroll cycles/periods
GET   /payroll/history                        past runs
GET   /payroll/preflight                      pre-run readiness check
GET   /payroll                                current period + slips
POST  /payroll/finalize-attendance            lock attendance for the month   (Rule 1)
POST  /payroll/run                            generate payroll                 (Rules 2-13)
POST  /payroll/reopen                         revert non-paid run to draft     (Rule 14)
POST  /payroll/approve                        Generated → Approved             (Rule 14)
POST  /payroll/pay                            Approved → Paid (disburse)       (Rules 12,14)
GET   /payroll/export                         CSV export (filtered)            (Rule 17)
GET   /payroll/payslip/{id}                   one payslip
GET   /payroll/payslip/{id}/pdf               payslip PDF                      (Rule 16)
POST  /payroll/payslip/{id}/email             email one payslip
GET   /payroll/payslips/bulk                  bulk payslip download
POST  /payroll/payslips/email                 bulk payslip email
GET   /payroll/employee/{employeeId}/payslips employee payslip history
GET   /payroll/fnf/{employeeId}               full & final settlement          (Rule 21)
POST  /payroll/payment/prepare                build a disbursement batch
GET   /payroll/payment/{id}                   batch detail
POST  /payroll/payment/{id}/approve           approve batch
POST  /payroll/payment/{id}/initiate          initiate payment
GET   /payroll/payment/{id}/bank-file         download bank file
GET   /payroll/payment/{id}/audit             disbursement audit trail         (Rule 18)
GET/POST/.. /payroll-adjustments[/{id}/approve|reject]   adjustments           (Rules 4,10)
GET/POST/.. /salary-structures[/{id}]         versioned salary structures      (Rules 5,19)
```

### 0.3 Happy-path test order
`Finalize Attendance → Run (generate) → Approve → Pay → Payslip/Export`

### 0.4 Status flows (memorise)
- **Run** (`PayrollRun.status`): `draft → generated → approved → paid`
  - `isEditable()` = `draft` | `generated` · `isLocked()` = `approved` | `paid`
- **Payslip** (`Payslip.status`): `Ready` (clean) · `Pending Review` (warnings) · `On Hold` (blocking) · `Paid` (after disburse)
- **Period** (`PayrollPeriod.status`): becomes `locked` only when all slips paid.
- **Adjustment** (`PayrollAdjustment.status`): `pending → approved | rejected` (only `approved` affects payroll).
- **Salary structure** (`SalaryStructure.status`): `draft | active | superseded` (+ `approval_status: draft | approved`).

### 0.5 Key constants (in PayrollService)
| Constant | Value | Used for |
|---|---|---|
| `PF_WAGE_CEILING` | ₹15,000 | PF cap |
| `PF_RATE` | 0.12 (12%) | PF employee share |
| ESI rate | 0.0075 (0.75%) | ESI employee share |
| ESI gross limit | ₹21,000 | ESI eligibility |
| Late-mark divisor | 3 | 3 late = 1 LOP |
| Advance total cap | EMI ≤ net before recovery | Rule 11 |
| PT annual cap | ₹2,500 (Feb top-up ₹300) | Rule 9 (MH) |

---

## RULE 1 — Attendance Finalization ✅

**Rule:** Payroll generate tabhi ho jab us month ki attendance **finalized** ho.

**Code:** [PayrollService.php:427-429](../app/Services/PayrollService.php#L427)
```php
if (!$period->attendance_finalized) {
    throw new RuntimeException('Payroll cannot be processed because attendance is not finalized.');
}
```
**Small points:**
- Finalize flag is on **`payroll_periods`**: `attendance_finalized` (bool), `attendance_finalized_at`, `attendance_finalized_by`. **Not** on the `attendances` table.
- Finalize action: `POST /payroll/finalize-attendance` → `PayrollController::finalizeAttendance()` (line 266-296) → `PayrollService::finalizeAttendance()` (line 365-373).
- Finalizing writes an audit row `action = finalize_attendance`, *"Attendance finalized for {period label}"*.
- Reopening a run (Rule 14) does **not** automatically un-finalize attendance.

**QA cases:**
1. Period not finalized → click **Run** → ❌ blocked, exact message *"Payroll cannot be processed because attendance is not finalized."*
2. Click **Finalize Attendance** → finalize succeeds, `attendance_finalized_at`/`_by` set → **Run** now works.
3. Check audit log shows the finalize event.

---

## RULE 2 — Late Mark Deduction ⚠️ (auto-adds LOP + warning; NO auto-hold, NO auto hours-waiver)

**Rule:** 3 late marks = 1 day LOP. Exception: late-sitting se hours cover hue to deduction hold / HR-review.

**Code:** [PayrollService.php:634-639](../app/Services/PayrollService.php#L634)
```php
$lateLopDays = intdiv($lateMarks, 3);   // integer division
if ($lateLopDays > 0) {
    $lopDays += $lateLopDays;
    $exceptions = $this->withException($exceptions, 'warning',
        "{$lateMarks} late marks → {$lateLopDays} day LOP (verify hours covered before approving).");
}
```
**Small points:**
- Threshold: `floor(lateMarks / 3)` → 0,1,2 marks = 0 LOP · 3,4,5 = 1 · 6,7,8 = 2 …
- Late count comes from `Attendance.status = 'Late'` rows for the month (`late_marks` snapshot on the payslip).
- The LOP day **is added** to `lop_days` automatically.
- Exception severity = **`warning`** (not blocking) → payslip stays `Ready`/`Pending Review`, **not** `On Hold`.
- **No automatic working-hours check** — the system never auto-waives the LOP; the warning text just tells HR to verify before Approve.

**QA cases (single employee, vary late marks):**
| Late marks | Expected LOP days | Slip status |
|---|---|---|
| 2 | 0 | Ready |
| 3 | 1 | warning (Pending Review) |
| 4 | 1 | warning |
| 6 | 2 | warning |
- Verify the warning line text and that it does **not** move the slip to On Hold.
- ⚠️ Log a ticket if the spec needs an automatic "hours covered → waive LOP / move to Hold" behaviour — not implemented.

---

## RULE 3 — Leave Salary Impact ✅

**Rule:** Approved paid leave → no cut · unapproved/unpaid absent → deduct · half-day → 0.5 day cut.

**Code:**
- Paid vs unpaid — [PayrollService.php:1012-1016](../app/Services/PayrollService.php#L1012):
```php
$flag = strtolower($paidMap[$r->leave_type_id] ?? 'paid');
if (in_array($flag, ['unpaid','lwp','loss of pay','loss_of_pay'], true)) $unpaid += $span;
else $paid += $span;
```
- Half-day — [PayrollService.php:1005-1006](../app/Services/PayrollService.php#L1005): `if ($r->day_type !== 'full' && $from->isSameDay($to)) $span = 0.5;`
- Paid days / LOP — [PayrollService.php:619-629](../app/Services/PayrollService.php#L619):
```php
$paidDays = min($effectiveWorkingDays, $presentDays + $paidLeaveDays + $holidayDays);
$lopDays  = max(0, round($effectiveWorkingDays - $paidDays, 2));
```
**Small points:**
- "Paid vs unpaid" is driven by **`master_leave_types.paid_unpaid`** (`'Paid'` | `'Unpaid'`). Default when unset = **paid**.
- Unpaid keywords matched (case-insensitive): `unpaid`, `lwp`, `loss of pay`, `loss_of_pay`.
- Only **Approved** leave (`leave_requests.status = 'Approved'`) protects salary; `Pending`/`Rejected`/`Cancelled` do not.
- `day_type` values: `full`, `first_half`, `second_half`. Half = 0.5 only on a **single-day** request.
- **Per-day salary basis = monthly gross ÷ working days** (via earnedFactor = `paidDays / effectiveWorkingDays`); LOP amount = prorated gross − earned gross ([:651-655](../app/Services/PayrollService.php#L651)).
- Payslip columns affected: `paid_leave_days`, `unpaid_leave_days`, `lop_days`, `lop_amount`, `paid_days`, `present_days`.

**QA cases:**
1. Approve a **paid**-type leave for 2 days → no LOP, `paid_leave_days = 2`.
2. **Unpaid**-type leave (or plain absent) → `unpaid_leave_days`/`lop_days` increase, `lop_amount > 0`.
3. Half-day (`first_half`) single day → 0.5 deduction.
4. Leave still **Pending** at run time → not counted as paid (becomes LOP/absent).

---

## RULE 4 — Overtime (Approved only, priced from the OT Master) ✅

**Rule:** Overtime tabhi add ho jab request **approved**. Pending/rejected exclude.
Amount is **derived**, not typed:

```
Hourly Salary = BASIC Salary ÷ Total Working Days in Payroll Month ÷ Shift Working Hours
OT Amount     = Hourly Salary × Multiplier × Approved OT Hours
```

> **Changed 2026-08-10:** the hourly used to be derived from the **gross**. It is
> now the **basic**. Allowances (HRA, conveyance, special) cover costs that don't
> scale with an extra hour worked, so pricing OT off the gross paid every
> allowance a second time per OT hour. On the standard 50/30/20 split this
> halves the OT rate. Payslips already generated in an OPEN run recompute on the
> next save/recompute; locked and paid runs keep the figure they were paid at.

**Code:**
- `overtimeForCycle()` — [PayrollService.php](../app/Services/PayrollService.php) — prices every approved OT row, returns hours + amount + earning lines + exceptions.
- `overtimeRate()` — the breakdown (`hourly`, `multiplier`, `effective_rate`, `shift_hours`, `working_days`).
- `overtimeMultiplier()` — resolves `employees.overtime` (a rate NAME) against `master_overtime_rates`.
- `shiftHours()` — `Employee::resolveShiftWindow()` end − start.
- Called from `computeForEmployee()` before the earnings JSON is built.

**Inputs — where each term comes from:**

| Term | Source | Notes |
|---|---|---|
| Basic Salary | active `SalaryStructure::basicAmount()`, else `annual_salary ÷ 12 × 50%` | **FULL monthly basic** — never the join/exit pro-rated figure, and never the gross. No basic component + OT hours = **blocking exception** |
| Total Working Days | `payroll_periods.working_days` | resolved per payroll month, **never a fixed 26**; month-level, not the pro-rated `effectiveWorkingDays`. See the caveat below |
| Shift Working Hours | employee's shift window (end − start) | night shift wraps midnight; unparseable shift → **9h** default (09:30–18:30) |
| Multiplier | `master_overtime_rates.multiplier` matched by name to `employees.overtime` | Active rows only; tenant row beats a same-named global; unassigned/unknown/Inactive → **1.0 + warning** |
| Approved OT Hours | `payroll_adjustments.hours` where `type='overtime'` AND `status='approved'` | pending/rejected contribute 0 |

An hour of OT is deliberately worth the same whether the employee joined on the 1st or the 20th — pro-ration and absence do not move the hourly rate.

### ⚠️ Dynamic working days — partially met

The divisor is read from `payroll_periods.working_days`, resolved **per payroll month** — so it is genuinely dynamic (26 in a 31-day month with 5 Sundays, 27 otherwise) and **no fixed 26 exists anywhere in the code**. That satisfies "shall not use a fixed value".

**What it does NOT yet account for**, contrary to *"working days may vary … depending on weekends, holidays, and company configuration"*:

| Factor | Status |
|---|---|
| Month length / number of Sundays | ✅ handled by `PayrollService::defaultWorkingDays()` |
| **Saturdays** (companies on a Sat+Sun week-off) | ❌ only Sunday is excluded, regardless of the employee's `weekly_off` |
| **Public holidays** (employee's holiday group) | ❌ not deducted from the divisor |
| HR override of a month's working days | ❌ `working_days` is set at period creation and has no update endpoint |

`working_days` is the divisor for **the whole payroll module**, not just overtime — changing how it is derived also moves LOP and paid-days for every employee. Deliberately **not** changed as part of the overtime work; it needs a decision on whether the divisor should be per-company or per-employee (an employee on a Sat+Sun week-off has fewer working days than a colleague on Sunday-only in the same month).

### Where OT hours come from — the shift END

**Overtime starts at the end of the employee's shift.** That end time comes from the **branch form → Work Shifts** (`branches.shifts` = `{name, start, end}`), matched by name via `Employee::resolveShiftWindow()`. No shift timing on file → the 18:30 office default.

`overtimeHoursFromAttendance()` walks each attendance day in the window and measures the last punch-out against that shift end:

| Situation | Result |
|---|---|
| Punched out at/before shift end | 0 OT |
| Punched out after shift end | the difference, to the minute |
| Punched out after midnight (out lands on the next date) | measured as a real instant, so 18:30 → 01:00 = **6.5h**, not a negative |
| Overnight shift (`22:00–06:00`) | the shift END belongs to the next calendar day |
| No punch-out (missing punch) | skipped — already flagged as a missing punch |
| Day is Absent / Leave / Weekly Off / Holiday | ignored; a stray punch on an off day is a data issue, not automatic OT |
| More than **12 h** past shift end | capped at 12h + a **warning** (assumed forgotten punch-out) |

**Detection is not payment.** Rule 4 still pays only APPROVED hours. Detected-vs-approved is reported on the payslip as an `info` line (`"Attendance shows 6.5 OT hr past the 18:30 shift end across 3 day(s); 4 hr approved and paid."`) — `info` so a few minutes of late sitting can't push every payslip to *Pending Review*.

**API:**
- `GET /payroll-adjustments/overtime-preview?employee_id=&month=&year=` → detected hours, per-day detail, the rate breakdown and the amount. Read-only.
- `POST /payroll-adjustments` with `type=overtime` + `from_attendance=true` and no `hours` → server fills the hours from detection (422s if attendance shows none).

> ⚠️ **Open policy question to confirm with the business:** work on a **weekly off or holiday** currently yields OT only for time past the shift end, not for the whole day. If the intent is "any hours worked on an off day are overtime", that's a separate rule and is **not** implemented.

**Small points:**
- Overtime is a **`PayrollAdjustment`** with `type='overtime'`. Add via `POST /payroll-adjustments` (send `hours`), approve via `POST /payroll-adjustments/{id}/approve`.
- Adjustment query is **tenant-scoped** (client_id, and branch_id for branch-scoped runs).
- Approving/rejecting an adjustment calls `recomputeEmployeePayslips()` (only draft/generated slips) so figures refresh without a full re-run.
- Shows as a separate earning line in `earnings` JSON + `overtime_amount`; **`overtime_hours` now carries the real hours** (it was hardcoded 0 before this rule).
- `hourly` is rounded to paise **before** the multiplier, so `hours × effective_rate` on the payslip reproduces the amount exactly.
- Every priced row emits an **`info`** exception spelling out the arithmetic (info never changes slip status) — use it to verify without recomputing by hand.
- **Manual override:** a `rate` on the adjustment row is treated as a final ₹/hour and wins over the derived rate. `POST` only persists `rate` when the caller sent one, so leaving it out is what lets a later salary revision reprice the hours.
- **Legacy rows** with no `hours` keep paying their stored flat `amount` and add 0 hours.

**QA cases:**
1. Add OT, leave **Pending** → Run → `overtime_amount = 0`.
2. Approve OT → recompute → OT appears as its own earning line.
3. Reject a previously-approved OT → recompute removes it from draft/generated slips.
4. **Worked example** — Gross ₹30,000 → **Basic ₹15,000** (50% split) · 26 working days · 9h shift · "Time and a Half" (1.5) · **2 hrs**
   → hourly `15000 ÷ 26 ÷ 9 = ₹64.10` → **amount `64.10 × 1.5 × 2 = ₹192.30`**.
   ⚠️ Rounding: the amount is rounded **once, at the end**. Pricing off the rounded ₹96.15/hr rate would give ₹192.30 too, but at other inputs it drifts a paisa — the `effective_rate` field is display-only; `effective_rate_exact` is the math input.
   Same inputs at **10 hrs** → `64.10 × 1.5 × 10 = ₹961.50`, `overtime_hours = 10`.
   *(Pre-2026-08-10 this priced off gross and gave ₹384.63 / ₹1,923.15 — exactly double. Old locked payslips still show those figures; that is not a regression.)*
5. Same employee with **no** OT rate assigned → paid at 1× (`₹641.00` for 10 hrs) **plus a warning**, slip → Pending Review.
6. Employee's rate set to an **Inactive** master row → same 1× fallback + warning.
7. Change the shift to an 8h window → rate rises (`15000/26/8 = ₹72.12`); change working days on the period → rate moves inversely.
9. **Structure with gross but no Basic component** + OT hours → OT prices to ₹0 and the slip gets a **blocking** exception ("no Basic component"). Fix the structure, don't pay through it.
8. Night shift `22:00–06:00` → 8h, not a negative/zero rate.

---

## RULE 5 — Salary Structure Mandatory ✅

**Rule:** Active salary structure mandatory; missing → employee skip/block + exception list.

**Code:** [PayrollService.php:571-582](../app/Services/PayrollService.php#L571)
```php
$structure = $this->activeStructure($employee, $period->period_end);
[...] = $this->resolveCompensation($employee, $structure, $exceptions);
if ($gross <= 0) {
    $base['exceptions'] = $this->withException($exceptions,'blocking',
        'No active salary structure or salary on file — employee skipped.');
    $base['status'] = 'On Hold';
    $base['hold_reason'] = 'Missing salary structure';
    return $base;
}
```
**Small points:**
- The structure used is the one **active as of `period_end`** (so historical runs stay correct).
- **Fallback chain:** active SalaryStructure → else `employee.annual_salary` auto-split (Basic/HRA/Special) with a **warning** ([:828-866](../app/Services/PayrollService.php#L828)). Only when **both** are absent → **blocking → On Hold**.
- `hold_reason = "Missing salary structure"`; slip counts in the on-hold/exception total.
- Manage structures: `GET /salary-structures/employees` (roster), `GET/POST /salary-structures`, `DELETE /salary-structures/{id}`.

**QA cases:**
1. Employee with **no structure + no `annual_salary`** → Run → slip `On Hold`, `hold_reason = "Missing salary structure"`, blocking exception text exact.
2. Employee with only `annual_salary` (no structure) → slip generated with a **warning** about auto-derived components.
3. Employee with active structure → clean slip.

---

## RULE 6 — Joining / Exit Pro-rata ✅

**Rule:** Mid-month join/exit par salary pro-rata.

**Code:** [PayrollService.php:585-605](../app/Services/PayrollService.php#L585)
```php
$winStart = max(period_start, date_of_joining)
$winEnd   = min(period_end, last_working_day)   // from employee_exits
$calDays    = period_start..period_end inclusive
$activeDays = winStart..winEnd inclusive
$proration  = min(1, activeDays / calDays)
$effectiveWorkingDays = round(period.working_days * proration, 2)
```
**Small points:**
- **Basis = calendar days** (not working days), inclusive of both endpoints (`+1`).
- Join mid-month → window starts at `date_of_joining`. Exit mid-month → window ends at exit `last_working_day`.
- Proration capped at `1.0` (full-month employee unaffected).
- Gross, basic, **and statutory deductions (PF/PT/ESI)** are all computed on the pro-rated/earned figures.
- Warning raised when proration < 1: *"Mid-cycle join/exit — salary pro-rated to {X}% of the month."*

**QA cases:**
1. `date_of_joining` = 16th of a 30-day month → proration ≈ 15/30 = 0.5; gross ≈ half; warning present.
2. Exit `last_working_day` = 10th → only 10 days paid.
3. Full-month employee → proration = 1, no warning.

---

## RULE 7 — Inactive / Terminated Exclusion ✅

**Rule:** Inactive/terminated regular payroll mein na aaye; exited → FnF.

**Code:** [PayrollService.php:380-405](../app/Services/PayrollService.php#L380)
```php
->whereNotIn('status', ['Inactive','Resigned','Terminated'])
->where(fn => date_of_joining IS NULL OR date_of_joining <= period_end)
// then drop anyone whose exit last_working_day < period_start
```
**Small points:**
- Excluded `Employee.status`: **`Inactive`, `Resigned`, `Terminated`**.
- Also excluded: future joiners (`date_of_joining > period_end`) and anyone whose exit LWD is **before** the period starts.
- Employees with no exit record are **included** (unless status-excluded).
- Eligibility query also respects `client_id`/`branch_id` and `enable_payroll`.

**QA cases:**
1. Mark employee `Inactive`/`Terminated` → Run → not in `total_employees`, no slip.
2. Exit LWD before period start → excluded.
3. Exit LWD inside the period → included but pro-rated (Rule 6) — then handled by FnF for the remainder.

### RULE 7a — Early exit (resigned within 15 days of joining) ✅

**Rule:** An employee who **resigns within 15 days of joining** is not put through payroll at all — no payslip, not counted in the run. The same 15-day window also waives their **notice period** entirely (see the Exit module).

**Code:** `PayrollService::eligibleEmployees()` → `ProbationGuard::isEarlyExit()`; reported by `PayrollService::payrollExclusions()`. The notice half is `ProbationGuard::noticePeriodApplies()`.

- Triggered by **either** date: the **resignation (notice) date** — the policy's own trigger, so an exit still *in progress* with no last working day agreed is already excluded — or the **last working day**, kept as a fallback for terminations and legacy cases with no notice date.
- Tenure counts the **joining day itself**: joined 1 Aug, resigned 15 Aug = **15 days → skipped**; 16 Aug = 16 days → **paid normally**.
- Threshold is `ProbationGuard::EARLY_EXIT_DAYS` (15).
- Neither date on file, or a date *before* joining → rule does not apply.
- The status filter does **not** hide them from `payrollExclusions()` — an early leaver is normally already stamped `Resigned`, and one mid-exit is still `Notice Period`/`Active`.
- Skipped employees are surfaced on `GET /payroll/preflight` under `excluded[]` (employee, joining date, resignation date, LWD, tenure, reason) so HR sees a deliberate skip rather than a missing person. `last_working_day` is **null** when the early exit is still in progress.
- **A run generated before the exit was recorded still holds the old payslip** — regenerate the draft run to drop them (a locked period is not rewritten).
- **Pending leave is never touched.** Resigning, being excluded from payroll, completing the exit and having the login disabled all leave a `Pending` leave request exactly as it is — it is not auto-approved, auto-rejected or auto-cancelled. Every write to `leave_requests.status` lives in `LeaveRequestController` (raise / cancel / approve / reject); `ExitController` and `PayrollService` never write it, and `LeaveRequest` has no model observers. Payroll only ever *reads* `status = 'Approved'` leave (`PayrollService::leaveDays()`), so a pending row cannot affect a payslip either.

| TC | Input | Expected | Result |
|---|---|---|---|
| G1 | Join 1 Aug, exit LWD 10 Aug | no payslip; listed in preflight `excluded[]` with "10 day(s)" | ☐ |
| G2 | Join 1 Aug, exit LWD **15 Aug** (boundary) | **skipped** | ☐ |
| G3 | Join 1 Aug, exit LWD **16 Aug** (boundary) | **paid** (pro-rated per Rule 6), not in `excluded[]` | ☐ |
| G4 | Join 1 Aug, resigned 8 Aug, exit **in progress**, no LWD set | **skipped**; in `excluded[]` with "8 day(s)", `last_working_day: null` | ☐ |
| G5 | Join 1 Aug, resigned 8 Aug, LWD set to 20 Aug | **skipped** — the resignation date is inside the window even though the LWD is not | ☐ |
| G6 | Join 1 Aug, resigned **16 Aug** (boundary), LWD 20 Aug | **paid**; notice period applies normally | ☐ |
| G7 | Join 24 Jul, resigned 7 Aug → open/reopen the **January** cycle | **not** in `excluded[]` — they had not joined by 31 Jan, so January never expected them | ☐ |
| G8 | Same employee, open the **July** and **August** cycles | **is** in `excluded[]` on both — joined in July, exited in August | ☐ |
| G9 | LWD before the period start (left in June, open August) | **not** in `excluded[]` — belongs to an earlier cycle | ☐ |
| G10 | Employee has a **Pending** leave, then resigns within 15 days | leave stays **Pending** — visible unchanged in HR Leave + the RM's approval queue | ☐ |
| G11 | G10, then run payroll for that cycle | employee excluded from the run; leave **still Pending**, no payslip impact | ☐ |
| G12 | G10, then complete the exit (login disabled, status → Resigned) | leave **still Pending** — not auto-rejected or auto-cancelled by closing the case | ☐ |
| G13 | Join 1 Aug, no exit record | paid normally | ☐ |
| G5 | Exit LWD earlier than the joining date (bad data) | rule does not fire; employee still processed | ☐ |

---

## RULE 8 — Provident Fund (PF) ✅

**Rule:** PF sirf eligible employees ko auto-calc; payslip mein alag dikhe.

**Code:** [PayrollService.php:673-676](../app/Services/PayrollService.php#L673)
```php
if ($pfApplicable && $employee->pf_eligible && $this->isPfEligibleType($employee) && $earnedBasic > 0) {
    $pf = round(min($earnedBasic, 15000) * 0.12, 2);
}
```
**Small points (three eligibility gates, all must pass):**
1. Structure flag `pf_applicable = true`.
2. `employee.pf_eligible = true`.
3. `isPfEligibleType()` — [:878-883](../app/Services/PayrollService.php#L878): `work_type` contains "full" **or is blank** (blank treated as eligible).
4. Plus `earnedBasic > 0` (no pay → no PF).
- Computed on **earned** basic (after pro-rata/LOP), capped at the ₹15,000 wage ceiling, rate 12%.
- Separate deduction line: *"Provident Fund (12%)"* → `pf_employee` column.
- ⚠️ There is **no `employee_type` column**; "full-time" is inferred from free-text `work_type`.

**QA cases:**
1. `pf_eligible=true` + structure `pf_applicable=true`, basic ₹20,000 → PF = 12% × 15,000 = **₹1,800**.
2. Basic ₹12,000 → PF = 12% × 12,000 = ₹1,440.
3. Toggle either flag off → PF = ₹0, no PF line.
4. `work_type='Part-time'` → not PF-eligible.

---

## RULE 9 — Professional Tax (PT) ⚠️ (Maharashtra slab hardcoded; work-state IGNORED)

**Rule:** PT state-wise slab; consider work state, gender, gross, state slab.

**Code:** [PayrollService.php:1043-1056](../app/Services/PayrollService.php#L1043)
```php
$isFemale = str_starts_with(strtolower($employee->gender), 'f');
if ($isFemale) return $gross <= 25000 ? 0 : 200;   // MH female slab
if ($gross <= 7500)  return 0;
if ($gross <= 10000) return 175;
return $month === 2 ? 300 : 200;                    // Feb top-up → ₹2,500/yr cap
```
**Small points / the gap:**
- **Only the Maharashtra slab exists, hardcoded.** Every employee gets MH regardless of `state_id`.
- **Used:** `employee.gender` (female if starts with "f"), earned `gross`, and `month` (Feb top-up).
- **Ignored:** work state / `state_id`. **No** state-wise PT master table.
- Applied only if structure `pt_applicable = true` and `earnedGross > 0` ([:681-683](../app/Services/PayrollService.php#L681)).
- PT computed on **earned** gross. → `pt` column.

**QA cases:**
| Gender | Gross | Month | Expected PT |
|---|---|---|---|
| Female | 24,000 | any | ₹0 |
| Female | 26,000 | any | ₹200 |
| Male | 7,000 | any | ₹0 |
| Male | 9,000 | any | ₹175 |
| Male | 12,000 | Jan | ₹200 |
| Male | 12,000 | Feb | ₹300 |
- Change work state and re-run → PT does **not** change (known limitation; ticket if state-wise PT required).

---

## RULE 10 — Bonus / Incentive (Approved only) ✅

**Rule:** Bonus/incentive tabhi jab approved.

**Code:** [PayrollService.php:1102-1106](../app/Services/PayrollService.php#L1102) → `approvedAdjustments(..., ['bonus','incentive'])`, filtered `status='approved'`.

**Small points:**
- Same `PayrollAdjustment` mechanism as overtime; `type` ∈ `bonus`, `incentive`.
- Pending/rejected excluded by the query.
- Shows as a separate earning line + `bonus_amount`.

**QA cases:**
1. Add bonus Pending → not included.
2. Approve → appears in `bonus_amount`.
3. Reject after approve → removed on recompute (draft/generated only).

---

## RULE 11 — Loan / Advance Recovery ⚠️ (Advance only; loan_recovery always 0)

**Rule:** Loan EMI / advance recovery net se deduct; EMI net se zyada na ho.

**Code:** [PayrollService.php:1063-1094](../app/Services/PayrollService.php#L1063) (reads `advance_requests`, `hr_status='approved'`, `recovery_start <= period_end`).
- Cap — [PayrollService.php:703-712](../app/Services/PayrollService.php#L703):
```php
$netBeforeRecovery = $earnedGross - ($pf + $esi + $pt + $tds + $other);
if ($advanceRec > max(0,$netBeforeRecovery)) {
    $advanceRec = round(max(0,$netBeforeRecovery), 2);
    $exceptions = withException('warning','Advance EMI exceeded net salary — capped to available net this cycle.');
}
```
- `loan_recovery` — [PayrollService.php:793](../app/Services/PayrollService.php#L793): **always `0`**.

**Small points:**
- **EMI mode:** deducts `monthly_emi` (or `amount / recovery_months`) each month while the cycle is inside the schedule.
- **Lumpsum mode:** full `amount` only in the `recovery_start` month.
- Eligibility: `advance_requests.hr_status = 'approved'`.
- **Cap rule (Rule 11 validation):** recovery ≤ `earnedGross − (PF+ESI+PT+TDS+other)`. If exceeded → capped + warning.
- ⚠️ **No loan-EMI engine** — only advances. `loan_recovery` column is always 0.
- Shows as *"Advance Recovery"* deduction line → `advance_recovery` column.

**QA cases:**
1. Approved advance, EMI ₹2,500 < net → full ₹2,500 deducted.
2. EMI larger than available net → capped to available net + warning text exact.
3. Lumpsum advance → full deduction only in start month; nothing in other months.
4. Confirm `loan_recovery` is always 0.

---

## RULE 12 — Bank Details Gate ✅

**Rule:** Calc bank ke bina bhi ho, par payment/export block agar account no / IFSC missing/invalid.

**Code:**
- Generate-time snapshot — [PayrollService.php:566-568](../app/Services/PayrollService.php#L566): `bank_verified = (bank_account_number && ifsc_code)`.
- Generate-time blocking exception — [PayrollService.php:754-758](../app/Services/PayrollService.php#L754): *"Bank details missing/invalid — payment blocked until corrected."*
- Pay-time live re-check — [PayrollService.php:196-219](../app/Services/PayrollService.php#L196):
```php
$ifsc = strtoupper(trim($emp->ifsc_code));
$acct = preg_replace('/\s+/','', $emp->bank_account_number);
$bankOk = preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/', $ifsc) && preg_match('/^\d{6,18}$/', $acct);
// valid & no other block → status='Paid'; else 'On Hold', hold_reason='Bank details missing/invalid'
```
**Small points:**
- **IFSC regex:** `^[A-Z]{4}0[A-Z0-9]{6}$` (4 letters + `0` + 6 alphanumerics, e.g. `HDFC0001234`).
- **Account regex:** `^\d{6,18}$` (6–18 digits, no spaces).
- Calculation is **never** blocked by bank issues — only the **Pay/disburse** step holds the slip.
- Bank fields snapshotted onto the payslip (`bank_account_number`, `ifsc_code`, `bank_verified`) for audit.
- Employee has a **single** salary bank — no `is_primary` flag on employee bank (the "primary account" wording doesn't apply here; validation = presence + format).

**QA cases:**
1. Blank IFSC or account → Run still creates slip (blocking exception) → **Pay** leaves it `On Hold`, not Paid.
2. Invalid IFSC `HDFC000123` (only 9 chars) → On Hold.
3. Non-numeric / too-short account → On Hold.
4. Valid both → Pay sets `Paid`, `hold_reason = null`.

---

## RULE 13 — Duplicate Payroll Prevention ✅

**Rule:** Same employee + same month duplicate na bane.

**Code / 4 layers:**
1. DB unique on period: `(client_id, branch_id, month, year)` — `create_payroll_periods_table`.
2. DB unique on slip: `(payroll_run_id, employee_id)` — `create_payslips_table`.
3. Cross-run dedup — [PayrollService.php:467-478](../app/Services/PayrollService.php#L467): skip employees already paid in a **sibling period** for same client+month+year.
4. Row lock — [PayrollService.php:440](../app/Services/PayrollService.php#L440): `PayrollPeriod::whereKey()->lockForUpdate()` serialises concurrent generate.

**Small points:**
- Protects the cross-branch same-month overlap.
- Row lock prevents the double-click / two-HR-user race that previously created duplicate slip sets.

**QA cases:**
1. Generate the same month twice → no duplicate slips (re-run updates the existing run when not locked).
2. Double-click **Run** / two users simultaneously → only one slip set.

---

## RULE 14 — Status & Locking ✅

**Rule:** `Draft → Generated → Approved → Paid`. Draft editable, Generated recompute-able, Approved edit-locked, Paid fully locked.

**Code:**
- `PayrollRun::isEditable()` = draft/generated; `isLocked()` = approved/paid (model 51-59).
- Approve blocked when locked — [PayrollController.php:408](../app/Http/Controllers/Api/PayrollController.php#L408).
- Regenerate blocked on locked — [PayrollService.php:443-444](../app/Services/PayrollService.php#L443).
- Period-locked guard — [PayrollService.php:430-431](../app/Services/PayrollService.php#L430).

**Small points / messages:**
- *"This payroll period is locked. Adjustments must go to the next cycle."*
- *"Run is already approved/paid."*
- *"Paid payroll cannot be reopened — post an adjustment in the next cycle."*
- Approve sets `approved_by/at`; Pay sets `paid_by/at`; Reopen reverts a non-paid run to `draft`.
- Period flips to `locked` only when all slips are `Paid` ([:221-226](../app/Services/PayrollService.php#L221)).

**QA cases:**
1. Re-run after **Approve** → 422 locked message.
2. Edit/regenerate after **Pay** → blocked.
3. **Reopen** a generated/approved (not paid) run → reverts to draft; reopen on **paid** → blocked with message.

---

## RULE 15 — Approved Payroll Change (next cycle only) ✅

**Rule:** Approved payroll direct edit na ho; change next cycle adjustment se.

**Code:** `recomputeEmployeePayslips()` — [PayrollService.php:125-163](../app/Services/PayrollService.php#L125): only touches slips whose run is `draft`/`generated`; approved/paid frozen. Adjustments flow into the next open cycle.

**Small points:**
- Adjustment store message: *"Adjustment added & approved."* (auto-approve) / *"Adjustment recorded (pending approval)."*
- Salary-structure revision and leave-approval also trigger recompute — but only on non-locked runs.

**QA cases:**
1. Add an adjustment after Approve → current approved run unchanged; next draft run reflects it.
2. Revise salary after Approve → approved figures stay; only future draft slips change.

---

## RULE 16 — Payslip ✅

**Rule:** Payslip approved/paid ke baad; show earnings, deductions, gross, net, month, employee.

**Code / endpoints:** `GET /payroll/payslip/{id}/pdf`, `POST /payroll/payslip/{id}/email`, bulk `GET /payroll/payslips/bulk`, `POST /payroll/payslips/email`.

**Payslip content (every field):**
- Identity: `employee_code`, `employee_name`, `department`, `designation`.
- Attendance: `working_days`, `present_days`, `paid_days`, `lop_days`, `paid_leave_days`, `unpaid_leave_days`, `late_marks`, `missing_punches`.
- Earnings: `earnings` (JSON line items), `gross_earnings`, `basic`, `overtime_amount`, `bonus_amount`.
- Deductions: `pf_employee`, `esi`, `pt`, `tds`, `lop_amount`, `advance_recovery`, `loan_recovery`, `other_deductions`, `total_deductions`.
- Net: `net_pay`.
- Meta: `status`, `hold_reason`, `exceptions` (JSON), `bank_account_number`, `ifsc_code`, `bank_verified`, `payroll_run_id`, `payroll_period_id`, `created_by`.

**Small points:**
- Figures freeze at **Approved** (Rule 14); QA should distribute payslips only after Approve/Pay per process.
- Each PDF/email/bulk action writes an audit row (Rule 18).

**QA cases:**
1. After Approve, open payslip PDF → all sections render; `net_pay = gross_earnings − total_deductions`.
2. Email a payslip → audit `email_payslip` logged with recipient.

---

## RULE 17 — Export ⚠️ (only month/department/status; branch & employee-type missing)

**Rule:** Export applied filters ke according; unauthorized user ko na mile.

**Code:** `GET /payroll/export` — [PayrollController.php:750-796](../app/Http/Controllers/Api/PayrollController.php#L750).
- Filters honoured: **month/year** (period), **department**, **status**.
- Auth gate `canExport()` — [PayrollController.php:827-836](../app/Http/Controllers/Api/PayrollController.php#L827): super_admin / client_admin / branch_user, or `hr.payroll` permission with `can_export` or `can_edit`.
- Scope guard: must select client or branch first, else 422 *"Select a client or branch before exporting payroll."*

**CSV columns:** Emp Code · Employee · Department · Designation · Working Days · Paid Days · LOP Days · Gross · PF · ESI · PT · TDS · LOP Amt · Advance Rec · Total Deductions · Net Pay · Status.

**Small points / gap:**
- ⚠️ **branch** and **employee_type** filters are **not** implemented.
- Export reads `Payslip` rows of the selected period/run.

**QA cases:**
1. Export with department + status filters → CSV matches.
2. Export as a user lacking `hr.payroll` export permission → blocked.
3. Super-admin with no client/branch selected → 422.

---

## RULE 18 — Audit Trail ✅

**Rule:** Har payroll action ka audit — action, old/new value, changed by, datetime, reason.

**Code:** `activity_logs` table + `ActivityLog` model; `PayrollController::audit()` — [line 954-977](../app/Http/Controllers/Api/PayrollController.php#L954).

**Captured fields:** `user_id`, `client_id`, `branch_id`, `action`, `module='hr.payroll'`, polymorphic `target_type/target_id`, `description`, `old_values` (JSON), `new_values` (JSON), `ip_address`, `user_agent`, `url`, `method`, `created_at`.

**Logged actions:** `finalize_attendance`, `run`, `approve`, `pay`, `reopen`, `payslip_pdf`, `email_payslip`, `payslips_bulk`, `email_payslips_bulk`. Disbursement has its own trail: `GET /payroll/payment/{id}/audit`.

**Small points:**
- Audit is **best-effort** — never blocks the payroll action if logging fails.
- approve/pay store before→after status in `old_values`/`new_values`.
- "Reason/comment" captured where the action carries one (not every event).

**QA cases:**
1. Run a full cycle → verify each of the 9 action types appears in `activity_logs`.
2. On approve & pay, confirm old/new status recorded.

---

## RULE 19 — Salary Structure Versioning ✅

**Rule:** Structure change par overwrite na ho; new version with effective_from, revised components, created_by, approval status.

**Code:** [SalaryStructureController.php:145-176](../app/Http/Controllers/Api/SalaryStructureController.php#L145):
```php
$prev = active structure (highest version)
$version = $prev ? $prev->version + 1 : 1
if ($prev) $prev->update(['status'=>'superseded'])
SalaryStructure::create([... version, effective_from, status='active',
   approval_status='approved', approved_by, approved_at, revision_note, created_by ...])
```
**Columns:** `version`, `effective_from`, `status (draft|active|superseded)`, `earnings` (JSON), `deductions` (JSON), `monthly_gross`, `monthly_ctc`, `pf_applicable`, `esi_applicable`, `pt_applicable`, `approval_status (draft|approved)`, `approved_by/at`, `revision_note`, `created_by`. Unique `(client_id, employee_id, status)`.

**Small points:**
- Old version is **superseded, never overwritten**.
- Active structure **cannot be deleted** — message *"Cannot delete the active structure — revise it instead."* (only draft/superseded deletable).
- Saving a revision returns *"Salary structure saved (version N). {x} draft payslip(s) updated."* and recomputes only draft/generated slips.
- Payslips reconstruct the structure **active as of `period_end`** ([PayrollService.php:572](../app/Services/PayrollService.php#L572)) → old payslips stay reproducible.

**QA cases:**
1. Revise salary twice → versions 1→2→3, only latest `active`, others `superseded`.
2. Try to delete the active structure → 422.
3. Old payslips keep their original figures after a revision.

---

## RULE 20 — Tenant / Branch Isolation ✅

**Rule:** Ek client ka payroll doosre ko visible na ho; branch-level RBAC.

**Code:**
- Context + branch pinning — [PayrollController.php:41-79](../app/Http/Controllers/Api/PayrollController.php#L41) (`effectiveBranchId` pins branch_user to own branch, can't widen).
- Scope guard — [PayrollController.php:101-107](../app/Http/Controllers/Api/PayrollController.php#L101): *"Select a client or branch before processing payroll."*
- Row guards: `findRun()` (800-815) & `ownsRow()` (817-825) require matching `client_id` (+branch); FnF tenant check (481-483) → *"Employee belongs to another tenant."* (403).
- `findScoped()` for adjustments (156-165) and salary structures (216-225) re-scope by client.

**Small points:**
- A `null` `client_id` on a row must **not** pass for a scoped user (fail-closed).
- super_admin sees across tenants; client_admin/client_user scoped to client; branch_user pinned to branch.

**QA cases:**
1. As a scoped user, fetch another client's payslip/run/adjustment id → 403/404, no data leak.
2. Branch user only sees own branch's slips.
3. Super-admin with no scope selected can't pool all tenants (422 guard on process/export).

---

## RULE 21 — Full & Final Settlement (FnF) ✅ (computed live, not persisted)

**Rule:** Exited employee regular payroll mein nahi; FnF mein salary-till-LWD, leave encashment, bonus, loan recovery, notice recovery.

**Code:** `GET /payroll/fnf/{employeeId}` — [PayrollController.php:469-511](../app/Http/Controllers/Api/PayrollController.php#L469) → `PayrollService::computeFnf()`.

**Inputs (query params — NOT stored):** `leave_encashment_days` (0-365), `notice_recovery_amount` (0-100M), `other_dues`, `other_deductions`.

**Small points:**
- Requires an **exit record** (`employee_exits`) with `last_working_day` — else error.
- HR-only (manage-payroll permission); cross-tenant blocked (403).
- `perDay = monthly_gross / working_days`; salary computed up to LWD.
- FnF can include: salary till last working day, leave encashment, bonus/incentive, loan/advance recovery, notice-period recovery.
- ⚠️ **No FnF model/table** — purely computed on demand; result not persisted unless separately recorded.
- Exit completion (`ExitController::complete()`) sets `employee.status = Resigned|Terminated`, deactivates the login, revokes tokens.

**QA cases:**
1. Employee **without** an exit record → FnF errors / not allowed.
2. Employee **with** exit record → FnF returns settlement; vary `leave_encashment_days`, `notice_recovery_amount`, `other_dues`, `other_deductions` and verify the totals.
3. Exited employee absent from the regular run (Rule 7).

---

## Extra components the engine also computes (not in the original 21)

| Item | Status | Code | Logic |
|---|---|---|---|
| **ESI** | ✅ | [:677-680](../app/Services/PayrollService.php#L677) | 0.75% of earned gross if `esi_applicable` & gross ≤ ₹21,000 → `esi` column |
| **TDS** | ⚠️ | [:687](../app/Services/PayrollService.php#L687) | No slab engine — only honours a `tds` line on the structure |
| **Holiday credit** | ✅ | [:893-927](../app/Services/PayrollService.php#L893) | Holidays from employee `holiday_group` falling on working days (not Sundays) count as paid; recurring anchored to window year; never inflates beyond working-day ceiling |
| **Other structure deductions** | ✅ | [:690-697](../app/Services/PayrollService.php#L690) | Fixed deductions scaled by earnedFactor (unpaid months don't collect full amounts) |
| **One-off adjustment deduction** | ✅ | [:700](../app/Services/PayrollService.php#L700) | `type='deduction'` adjustments applied at full amount (not pro-rated) |

---

## Data-model quick reference (columns QA may need to set)

**Employee (`employees`)** — `status` (Active/Inactive/On Leave/Probation/Notice Period/Resigned/Terminated), `employee_type` ❌ none, `work_type` (free text, PF "full" check), `date_of_joining`, `gender` (Male/Female/Other), `enable_payroll`, `annual_salary`, `salary_structure`, `pf_eligible`, `esi_applicable`, `salary_payment_mode` (bank/cheque/cash), `bank_name`, `bank_account_number`, `ifsc_code`, `account_holder_name`, `bank_account_type`, `uan_number`, `pan_number`, `holiday_group_id`, `department_id`, `designation_id`, `branch_id`, `client_id`.

**Attendance (`attendances`)** — `attendance_date`, `status` (Present/Late/Half Day/Missing In/Missing Out/Weekly Off/Holiday/On Duty/Work From Home/Absent/Leave/Corrected), `check_in_at`, `check_out_at`. Punches in `attendance_punches` (`direction` in/out strictly alternating, `label`). **No finalize column here** — finalize is on `payroll_periods`.

**LeaveRequest (`leave_requests`)** — `from_date`, `to_date`, `days`, `day_type` (full/first_half/second_half), `status` (Pending/Approved/Rejected/Cancelled), `leave_type_id`, `approved_by/at`.
**LeaveTypes (`master_leave_types`)** — `paid_unpaid` (Paid/Unpaid), `type`, `gender_restriction`, `is_sick_medical`, `status`.

**Holiday (`holidays`)** — `date`, `name`, `type` (Public/Restricted/Company/Regional), `is_recurring`, `holiday_group_id`. **HolidayGroup** assigned to employees via `holiday_group_id`.

**SalaryStructure (`salary_structures`)** — see Rule 19.
**EmployeeExit (`employee_exits`)** — `exit_type`, `notice_date`, `last_working_day`, stage fields, `completed_at`.

---

## Consolidated status table

| # | Rule | Status | Primary code |
|---|---|---|---|
| 1 | Attendance finalization | ✅ | PayrollService:427 |
| 2 | Late mark deduction | ⚠️ warning, no auto-hold/waiver | PayrollService:634 |
| 3 | Leave salary impact | ✅ | PayrollService:1012, 1005, 619 |
| 4 | Overtime approved-only, priced `hourly × multiplier × hours` | ✅ | `PayrollService::overtimeForCycle()` |
| 5 | Salary structure mandatory | ✅ | PayrollService:571 |
| 6 | Joining/exit pro-rata | ✅ | PayrollService:585 |
| 7 | Inactive/terminated exclusion | ✅ | PayrollService:380 |
| 8 | PF eligibility/calc | ✅ (no employee_type field) | PayrollService:673 |
| 9 | Professional Tax | ⚠️ MH hardcoded, state ignored | PayrollService:1043 |
| 10 | Bonus/incentive approved-only | ✅ | PayrollService:1102 |
| 11 | Loan/advance recovery | ⚠️ advance only, loan=0 | PayrollService:1063, 703 |
| 12 | Bank details gate | ✅ | PayrollService:196, 754 |
| 13 | Duplicate prevention | ✅ | PayrollService:467, 440 |
| 14 | Status & locking | ✅ | PayrollController:408 |
| 15 | Approved-change next cycle | ✅ | PayrollService:125 |
| 16 | Payslip | ✅ | PayrollController:payslip* |
| 17 | Export | ⚠️ branch/emp-type filters missing | PayrollController:750 |
| 18 | Audit trail | ✅ | PayrollController:954 |
| 19 | Salary structure versioning | ✅ | SalaryStructureController:145 |
| 20 | Tenant/branch isolation | ✅ | PayrollController:800,817 |
| 21 | Full & Final settlement | ✅ live (not persisted) | PayrollController:469 |

---

## TEST CASE CATALOG (QA-runnable, step-by-step)

> Concrete, numbered cases QA can execute directly. **Tick the Result column.**
> Numbers assume the baseline employees below; if your tenant uses different `working_days`/salary, scale proportionally (per-day = **monthly gross ÷ working days**).

### Baseline test employees (set these up once on IGC GROUP, client 12)

| Code | Gender | Monthly Gross | Basic (50%) | Working Days | PF eligible | ESI applicable | Bank | Notes |
|---|---|---|---|---|---|---|---|---|
| **EMP-M** | Male | ₹30,000 | ₹15,000 | 30 | Yes | No (gross > 21k) | valid | per-day ₹1,000 |
| **EMP-F** | Female | ₹26,000 | ₹13,000 | 30 | Yes | No | valid | per-day ₹866.67 |
| **EMP-L** | Male | ₹18,000 | ₹9,000 | 30 | Yes | **Yes** (≤ 21k) | valid | for ESI/PT-low tests, per-day ₹600 |

Clean full-month expected (no leave/LOP/OT):
- **EMP-M:** PF = 12%×15,000 = **₹1,800**; PT (male, >10k) = **₹200** (₹300 in Feb); ESI = 0; **Net = 30,000 − 1,800 − 200 = ₹28,000**.
- **EMP-F:** PF = 12%×13,000 = **₹1,560**; PT (female, >25k) = **₹200**; ESI = 0; **Net = 26,000 − 1,560 − 200 = ₹24,280**.
- **EMP-L:** PF = 12%×9,000 = **₹1,080**; PT (male, 10–17.5k.. here ₹18k) = **₹200**; ESI = 0.75%×18,000 = **₹135**; **Net = 18,000 − 1,080 − 200 − 135 = ₹16,585**.

---

### A. Lifecycle & Gating (Rules 1, 14, 15)

| TC | Pre-condition / Input | Steps | Expected Result | Result |
|---|---|---|---|---|
| A1 | Period NOT finalized | Click **Run** | ❌ Blocked: *"Payroll cannot be processed because attendance is not finalized."* | ☐ |
| A2 | Period finalized | Finalize → **Run** | ✅ Run created, status `generated`, payslips produced | ☐ |
| A3 | Run `generated` | **Approve** | Status → `approved`; `approved_by/at` set | ☐ |
| A4 | Run `approved` | Try **Run/edit** again | ❌ 422 *"Run is already approved/paid."* | ☐ |
| A5 | Run `approved` | **Pay** | Slips with valid bank → `Paid`; period → `locked` when all paid | ☐ |
| A6 | Run `paid` | **Reopen** | ❌ *"Paid payroll cannot be reopened — post an adjustment in the next cycle."* | ☐ |
| A7 | Run `generated` (not paid) | **Reopen** | ✅ Reverts to `draft` | ☐ |
| A8 | Run `approved` | Add adjustment, re-check current run | Current run unchanged; adjustment hits **next** draft cycle | ☐ |

---

### B. Attendance, Late Marks & Working Hours (Rule 2)

> Late count = number of `Attendance.status = 'Late'` days in the month. LOP days = `floor(late ÷ 3)`. The LOP is **auto-added** and shown as a **warning** — there is **no automatic working-hours waiver** and the slip stays `Pending Review`, **not** `On Hold`.

| TC | Input (EMP-M, per-day ₹1,000) | Expected LOP days | Expected LOP amount | Slip status | Warning text | Result |
|---|---|---|---|---|---|---|
| B1 | 0 late marks | 0 | ₹0 | Ready | — | ☐ |
| B2 | 2 late marks | 0 | ₹0 | Ready | — | ☐ |
| B3 | 3 late marks | 1 | ₹1,000 | Pending Review | *"3 late marks → 1 day LOP (verify hours covered before approving)."* | ☐ |
| B4 | 4 late marks | 1 | ₹1,000 | Pending Review | *"4 late marks → 1 day LOP …"* | ☐ |
| B5 | 6 late marks | 2 | ₹2,000 | Pending Review | *"6 late marks → 2 day LOP …"* | ☐ |

**Working-hours scenarios (important — documents the actual behaviour):**

| TC | Scenario | Expected Result | Result |
|---|---|---|---|
| B6 | EMP-M: 3 late marks **but worked full/extra hours each day** (late sitting covered hours) | System **still** adds 1 LOP day + warning. **No auto-waiver.** HR must review and, if hours covered, manually adjust before Approve. Slip = Pending Review (not On Hold). | ☐ |
| B7 | EMP-F: 3 late marks, hours covered | Same as B6 — behaviour is gender-independent (Rule 2 has no gender logic). 1 LOP day + warning. | ☐ |
| B8 | EMP-M: Half-day attendance (worked < required hours, `status='Half Day'`) | 0.5 day not counted as full present; reflected in paid/LOP days (see Rule 3 half-day). | ☐ |
| B9 | Missing punch (in without out) | `missing_punches` increments on the payslip; HR reviews. | ☐ |

> ⚠️ **Gap to log:** if the spec requires "late but hours-covered → auto-waive LOP / move to HR-Hold status", that automation does **not** exist. Today it's a manual HR warning only.

---

### C. Leave & Half-Day (Rule 3)

| TC | Input (EMP-M, per-day ₹1,000) | Expected Result | Result |
|---|---|---|---|
| C1 | 2 days **Approved Paid** leave (`paid_unpaid=Paid`) | No deduction; `paid_leave_days=2`, `lop_amount=0` | ☐ |
| C2 | 2 days **Unpaid** leave (`paid_unpaid=Unpaid`/LWP) | `unpaid_leave_days=2`, `lop_days=2`, `lop_amount=₹2,000` | ☐ |
| C3 | 1 day **plain absent** (no leave) | `lop_days=1`, `lop_amount=₹1,000` | ☐ |
| C4 | Half-day leave (`day_type=first_half`, single day) | 0.5 day impact → ₹500 if unpaid; if paid, 0.5 paid leave | ☐ |
| C5 | Leave still **Pending** at run time | Not treated as paid → counts as LOP/absent | ☐ |
| C6 | Leave **Rejected/Cancelled** | No salary protection | ☐ |

---

### D. Overtime / Bonus / Incentive (Rules 4, 10)

| TC | Input | Steps | Expected Result | Result |
|---|---|---|---|---|
Baseline for D1–D2 and D7–D12: gross **₹30,000** → **basic ₹15,000**, period **26 working days**, shift **09:30–18:30 (9h)** → hourly **₹64.10** (basic ÷ 26 ÷ 9 — **not** gross).

| TC | Input | Steps | Expected Result | Result |
|---|---|---|---|---|
| D1 | OT `hours=10`, **Pending** | Run | `overtime_amount=0`, `overtime_hours=0` (excluded) | ☐ |
| D2 | Same OT, **Approved**, rate "Time and a Half" (1.5) | Approve → recompute | `64.10 × 1.5 × 10` → OT line **₹961.50**, `overtime_hours=10` | ☐ |
| D2a | 2 approved hrs, rate 1.5 | Run | **₹192.30** (rounded once at the end) | ☐ |
| D2b | **Basis check** — read the OT info exception on the slip | Run | Reads "₹15,000.00 **basic** ÷ 26 …" — never the ₹30,000 gross | ☐ |
| D2c | Structure with gross but **Basic = 0** + OT hours | Run | OT = ₹0 **and** a **blocking** exception naming the missing Basic | ☐ |
| D3 | Bonus ₹5,000, **Pending** | Run | `bonus_amount=0` | ☐ |
| D4 | Incentive ₹3,000, **Approved** | Approve | Added to `bonus_amount` line | ☐ |
| D5 | Approved OT then **Rejected** | Reject → recompute | Removed from draft/generated slips | ☐ |
| D6 | One-off **deduction** adjustment ₹1,000, approved | Run | Full ₹1,000 deducted (not pro-rated) | ☐ |
| D7 | OT `hours=10`, employee has **no OT rate** assigned | Approve → Run | 1× fallback **₹641.00** + warning; slip **Pending Review** | ☐ |
| D8 | Employee's OT rate row set to **Inactive** in the master | Run | Same 1× fallback + warning | ☐ |
| D9 | Rate "Double Time" (2.0), `hours=10` | Run | rate ₹128.20/hr → **₹1,282.00** | ☐ |
| D10 | Shift changed to **10:00–18:00** (8h), rate 1.5, `hours=10` | Run | hourly ₹72.12 → `72.12 × 1.5 × 10` = **₹1,081.80** | ☐ |
| D10a | Same month in a 27-working-day calendar instead of 26 | Run | divisor follows the payroll month — rate drops, no fixed 26 anywhere | ☐ |
| D11 | Adjustment posted with an explicit `rate=500`, `hours=2` | Run | Override honoured → **₹1,000** regardless of package/multiplier | ☐ |
| D12 | Legacy row: `hours` **null**, `amount=1500`, approved | Run | Pays **₹1,500**, contributes **0** to `overtime_hours` | ☐ |
| D13 | Approve OT, then **revise the salary** upward, re-run | Run | OT re-priced at the new basic (rate is not frozen at entry time) | ☐ |

**Shift-end detection (shift 09:30–18:30 → OT starts 18:30):**

| TC | Input | Expected Result | Result |
|---|---|---|---|
| D14 | Punch out **18:30** exactly | 0 detected OT | ☐ |
| D15 | Punch out **20:30** | 2.0 h detected | ☐ |
| D16 | Punch out **01:00 next day** | 6.5 h — not negative, and the preview shows the out-punch date-stamped | ☐ |
| D17 | Punch out missing (no `check_out_at`) | day skipped, no OT | ☐ |
| D18 | Punch out 21:00 on a **Weekly Off / Leave / Absent** day | ignored — 0 OT | ☐ |
| D19 | Punch out on a **Late** day at 19:30 | 1.0 h — Late days still earn OT | ☐ |
| D20 | Punch out ~23 h after shift end (forgotten punch) | capped at **12 h** + warning "likely a missed punch-out" | ☐ |
| D21 | Change branch shift to **10:00–19:00**, same 19:00 punch-out | 0 OT — the boundary follows the branch form | ☐ |
| D22 | Overnight shift **22:00–06:00**, punch out 07:30 next day | 1.5 h (shift end is next-day 06:00) | ☐ |
| D23 | Employee's shift has no timing (e.g. "General Shift") | falls back to the 18:30 default | ☐ |
| D24 | `GET /payroll-adjustments/overtime-preview` | detected hours + per-day detail + rate + amount; **writes nothing** | ☐ |
| D25 | `POST /payroll-adjustments` with `from_attendance=true`, no `hours` | hours auto-filled from detection; 422 when attendance shows none | ☐ |
| D26 | Detected 6.5 h but only 4 h approved | payslip carries an **info** line stating both; status **not** forced to Pending Review | ☐ |

**Overtime Master + dropdown:**

| TC | Input | Expected Result | Result |
|---|---|---|---|
| D27 | Master → Overtime (OT): add a rate | rate_name / multiplier / description / status all persist; unique name per tenant | ☐ |
| D28 | Employee form → Overtime Applicable = Yes | Rate dropdown lists **only Active** master rows; no hardcoded entries anywhere | ☐ |
| D29 | Add a new rate in the master, reopen the employee dropdown | new rate appears **without a page reload** (`onOpen` refetch) | ☐ |
| D30 | Set a rate to **Inactive**, open the dropdown | it disappears from the list | ☐ |
| D31 | Employee already saved on a rate that is then set Inactive | value stays **visible but disabled** ("… (inactive)") so save doesn't blank it; cannot be re-selected | ☐ |
| D32 | Master is empty | placeholder reads "No rates — add in Master › Overtime (OT)" | ☐ |
| D33 | Overtime Applicable = No | Rate picker hidden and `employees.overtime` cleared | ☐ |

---

### E. Salary Structure (Rules 5, 19)

| TC | Input | Expected Result | Result |
|---|---|---|---|
| E1 | Employee with **no structure + no annual_salary** | Slip `On Hold`, `hold_reason="Missing salary structure"`, blocking exception *"No active salary structure or salary on file — employee skipped."* | ☐ |
| E2 | Employee with only `annual_salary` (no structure) | Slip generated with **warning** about auto-derived Basic/HRA/Special | ☐ |
| E3 | Revise salary once | New `version=2`, old `superseded`, only one `active` | ☐ |
| E4 | Revise twice | versions 1→2→3 | ☐ |
| E5 | Try **delete active** structure | ❌ 422 *"Cannot delete the active structure — revise it instead."* | ☐ |
| E6 | Old payslip after a revision | Old figures unchanged (reconstructs structure active at `period_end`) | ☐ |

---

### F. Pro-rata Join / Exit (Rule 6)

| TC | Input (EMP-M, gross ₹30,000, 30-day month) | Expected Result | Result |
|---|---|---|---|
| F1 | `date_of_joining` = 16th | active 15 days → proration 0.5 → gross ≈ ₹15,000; PF/PT on pro-rated; warning *"Mid-cycle join/exit — salary pro-rated to 50% …"* | ☐ |
| F2 | Exit `last_working_day` = 10th | active 10 days → gross ≈ ₹10,000 | ☐ |
| F3 | Full-month employee | proration 1.0, no warning | ☐ |

---

### G. Inactive / Terminated & FnF (Rules 7, 21)

| TC | Input | Expected Result | Result |
|---|---|---|---|
| G1 | Employee `status=Inactive` | Excluded from run, no slip, not in `total_employees` | ☐ |
| G2 | Employee `status=Terminated`/`Resigned` | Excluded from regular run | ☐ |
| G3 | Exit LWD before period start | Excluded | ☐ |
| G4 | Employee **without** exit record → call FnF | ❌ Not allowed / errors (needs exit record) | ☐ |
| G5 | Employee **with** exit record → FnF with `leave_encashment_days=5`, `notice_recovery_amount=10000`, `other_dues`, `other_deductions` | Settlement = salary-till-LWD + encashment + bonus − recoveries; values reflect inputs | ☐ |

---

### H. Provident Fund (Rule 8) — Male & Female

| TC | Employee | Earned Basic | Eligibility | Expected PF | Result |
|---|---|---|---|---|---|
| H1 | EMP-M (Male) | ₹15,000 | all gates pass | 12%×15,000 = **₹1,800** | ☐ |
| H2 | EMP-F (Female) | ₹13,000 | all gates pass | 12%×13,000 = **₹1,560** | ☐ |
| H3 | EMP-M, basic ₹20,000 | ₹20,000 | pass | 12%×**15,000** (ceiling) = ₹1,800 | ☐ |
| H4 | EMP-M, 1 LOP day (earned basic 29/30) | ₹14,500 | pass | 12%×14,500 = **₹1,740** (PF on earned) | ☐ |
| H5 | `pf_eligible=false` OR structure `pf_applicable=false` | — | fails | **₹0**, no PF line | ☐ |
| H6 | `work_type='Part-time'` | — | fails type gate | **₹0** | ☐ |

> PF logic is **gender-independent** — H1/H2 differ only because basic differs.

---

### I. Professional Tax (Rule 9) — full Male/Female slab (Maharashtra, hardcoded)

| TC | Gender | Gross | Month | Expected PT | Result |
|---|---|---|---|---|---|
| I1 | Female | ₹24,000 | any | **₹0** | ☐ |
| I2 | Female | ₹25,000 | any | **₹0** (≤ 25,000) | ☐ |
| I3 | Female | ₹26,000 | any | **₹200** | ☐ |
| I4 | Male | ₹7,000 | any | **₹0** | ☐ |
| I5 | Male | ₹7,500 | any | **₹0** (≤ 7,500) | ☐ |
| I6 | Male | ₹9,000 | any | **₹175** | ☐ |
| I7 | Male | ₹10,000 | any | **₹175** (≤ 10,000) | ☐ |
| I8 | Male | ₹12,000 | Jan–Jan (non-Feb) | **₹200** | ☐ |
| I9 | Male | ₹12,000 | **February** | **₹300** (annual ₹2,500 top-up) | ☐ |
| I10 | Any | any | structure `pt_applicable=false` | **₹0** | ☐ |
| I11 | Male, **work state = Gujarat/other** | any | PT **still uses Maharashtra slab** (state ignored) — ⚠️ known gap | ☐ |

> Gender source: `employee.gender` (female if it starts with "f"). The female slab has only two bands (≤25k → 0, >25k → 200). The Feb ₹300 top-up applies to the **male** >10k band.

---

### J. Loan / Advance Recovery (Rule 11)

| TC | Input (EMP-M, available net ~₹28,000) | Expected Result | Result |
|---|---|---|---|
| J1 | Approved advance, EMI mode, `monthly_emi=2,500`, schedule covers month | `advance_recovery=₹2,500` | ☐ |
| J2 | Approved advance, EMI ₹40,000 (> net) | Capped to available net + warning *"Advance EMI exceeded net salary — capped to available net this cycle."* | ☐ |
| J3 | Lumpsum advance, `recovery_start` = this month | Full amount deducted this month only | ☐ |
| J4 | Lumpsum advance, recovery_start = other month | ₹0 this month | ☐ |
| J5 | Advance with `hr_status=pending` | Not recovered (only approved) | ☐ |
| J6 | Any | `loan_recovery` field | **always ₹0** (loan engine not built — ⚠️ gap) | ☐ |

---

### K. Bank Details Gate (Rule 12)

| TC | Input | Steps | Expected Result | Result |
|---|---|---|---|---|
| K1 | Valid IFSC `HDFC0001234` + account `123456789012` | Run → Pay | Slip → `Paid` | ☐ |
| K2 | Blank IFSC or account | Run | Slip generated, **blocking** exception *"Bank details missing/invalid — payment blocked until corrected."* | ☐ |
| K3 | K2 then **Pay** | Pay | Slip stays **On Hold**, `hold_reason="Bank details missing/invalid"` (not Paid) | ☐ |
| K4 | Invalid IFSC `HDFC000123` (9 chars) | Pay | On Hold (fails regex `^[A-Z]{4}0[A-Z0-9]{6}$`) | ☐ |
| K5 | Account `12345` (5 digits) or with letters | Pay | On Hold (fails `^\d{6,18}$`) | ☐ |
| K6 | Lowercase IFSC `hdfc0001234` | Pay | ✅ Passes (upper-cased before check) | ☐ |

---

### L. Duplicate Prevention (Rule 13)

| TC | Input | Expected Result | Result |
|---|---|---|---|
| L1 | Generate same month twice | No duplicate slips (re-run updates existing run when not locked) | ☐ |
| L2 | Double-click **Run** / two HR users simultaneously | Only one slip set (row lock serialises) | ☐ |
| L3 | Employee already paid in a sibling period (same client+month+year) | Skipped in the second run | ☐ |

---

### M. Payslip / Export / Audit (Rules 16, 17, 18)

| TC | Input | Expected Result | Result |
|---|---|---|---|
| M1 | Open payslip PDF after Approve | All sections present; `net_pay = gross_earnings − total_deductions` | ☐ |
| M2 | Email a payslip | Sent (if mail ON); audit `email_payslip` logged with recipient | ☐ |
| M3 | Export with department + status filters | CSV reflects filters; columns per spec | ☐ |
| M4 | Export as user **without** `hr.payroll` export permission | ❌ Blocked | ☐ |
| M5 | Export as super-admin with **no** client/branch selected | ❌ 422 *"Select a client or branch before exporting payroll."* | ☐ |
| M6 | Export with **branch** or **employee_type** filter | Filter has no effect — ⚠️ not implemented | ☐ |
| M7 | Run full cycle, check `activity_logs` | All 9 actions logged (finalize/run/approve/pay/reopen/pdf/email/bulk×2); approve & pay store old→new status | ☐ |

---

### N. Tenant / Branch Isolation (Rule 20)

| TC | Input | Expected Result | Result |
|---|---|---|---|
| N1 | Scoped user fetches another client's payslip id | 403/404, no data | ☐ |
| N2 | Scoped user hits another client's run / adjustment / salary-structure id | Not found / blocked | ☐ |
| N3 | Branch user lists payroll | Sees only own branch's slips (pinned, can't widen) | ☐ |
| N4 | FnF for employee of another tenant | ❌ 403 *"Employee belongs to another tenant."* | ☐ |
| N5 | Super-admin with no scope tries to process/export | ❌ 422 scope guard | ☐ |

---

## Known limitations — log as separate tickets if the spec requires

1. **PT Maharashtra-only & hardcoded** — work state ignored; no state-wise PT master (Rule 9).
2. **Loan recovery not implemented** — `loan_recovery` always 0; only advance recovery works (Rule 11).
3. **Export filters incomplete** — branch & employee_type not built (Rule 17).
4. **No `employee_type` field** — full-time/part-time/contract unmodelled; PF uses free-text `work_type` (Rule 8).
5. **Late-mark = warning, not auto-hold** — LOP added with an HR-review warning; no automatic hours-covered waiver (Rule 2).
6. **TDS has no slab engine** — relies on a manual structure line (extra).
7. **FnF & leave-encashment not persisted** — computed live from query params each call (Rule 21).

---

## QA prerequisites / test data

- Tenant: **IGC GROUP (client 12)** — logins & branches in `docs/IGC_CLIENT.md` (multi-branch, has salary data).
- Per employee for a clean run: active **salary structure** (or `annual_salary`), valid **bank account_number + IFSC**, `status = Active`, `date_of_joining`, optional `holiday_group_id`, `pf_eligible`, correct `gender` (for PT).
- Masters: at least one **paid** and one **unpaid** `master_leave_types` (`paid_unpaid`), an approvable **LeaveRequest**, and **PayrollAdjustment** rows (overtime/bonus) for approved-only tests.
- An **advance_request** (`hr_status=approved`, with EMI/lumpsum) to test Rule 11.
- An **employee_exit** with `last_working_day` to test Rule 21.
- Email sending gated by Settings → Notifications (`shouldSendMail`) — turn ON for payslip-email tests.
- Permissions: a user with and without `hr.payroll` `can_export` to test Rule 17.
