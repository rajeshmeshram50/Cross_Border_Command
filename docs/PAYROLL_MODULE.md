# Payroll Module — Complete Flow & Logic (Start → End)

> Single source of truth for the Payroll module as **actually implemented** in
> Cross_Border_Command. Covers architecture, data model, the calculation
> engine step-by-step, all 21 rules with real thresholds/formulas, the
> lifecycle, APIs, frontend, security, and testing.
>
> Stack: **Laravel 12 API + React 19 SPA**, multi-tenant (Client → Branch →
> Employee), PostgreSQL. Last updated: 2026-06-05.

---

## 0. Big Picture — what the module does

A monthly salary engine that turns **attendance + leave + salary structure +
adjustments** into **payslips**, then locks and disburses them — branch- and
client-scoped, with a full approval/locking lifecycle and reproducible PDFs.

```
Salary Setup ─┐
Attendance ───┤
Leave ────────┼──►  PAYROLL ENGINE  ──►  Payslips  ──►  Approve  ──►  Pay
Adjustments ──┤      (per employee,        (per run)                  (lock)
Advances ─────┘       per cycle)                │
                                                └──►  PDF · Excel · CSV · Email · History
Exited employee ───────────────────────────────────►  Full & Final Settlement (FNF)
```

---

## 1. Data Model (tables, models, relationships)

| Table | Model | Purpose |
|---|---|---|
| `payroll_periods` | `PayrollPeriod` | One cycle per (client, branch, month, year). Holds the attendance-finalized gate + period lock. |
| `salary_structures` | `SalaryStructure` | **Versioned** compensation per employee (earnings/deductions JSON, PF/ESI/PT flags). |
| `payroll_runs` | `PayrollRun` | One execution of the engine against a period. Status ladder = the lock. |
| `payslips` | `Payslip` | Per-employee, per-run snapshot (fully reproducible — never recomputed on read once locked). |
| `payroll_adjustments` | `PayrollAdjustment` | Overtime / bonus / incentive / one-off deduction, **approved-gated**. |

**Reverse relationships on `Employee`** (so the whole graph is traversable):
`attendances()`, `leaveRequests()`, `salaryStructures()`, `activeSalaryStructure()`, `payslips()`, `exit()`.

**Inputs the engine reads (existing tables):** `attendances`, `attendance_punches`, `leave_requests` (+ `master_leave_types.paid_unpaid`), `advance_requests`, `employee_exits`, `employees` (salary fallback, PF eligibility, gender, state, bank).

Key backend files:
- Engine: `app/Services/PayrollService.php`
- PDF: `app/Services/PayslipPdfService.php` + `resources/views/pdf/payslip.blade.php`
- Email: `app/Mail/PayslipMail.php` + `resources/views/emails/payslip.blade.php`
- Controllers: `PayrollController`, `SalaryStructureController`, `PayrollAdjustmentController`
- Frontend: `resources/js/pages/hrms/HrPayroll.tsx`, `components/PayslipViewerModal.tsx`, `components/PayrollRunModal.tsx`, `components/SalaryStructureModal.tsx`, `pages/employee/EmployeeProfile.tsx`

---

## 2. The Lifecycle (state machine)

**Period status:** `open → processing → locked`
**Run status:** `draft → generated → approved → paid`

```
Cycle opened (open)
   │  finalize attendance (Rule 1)
   ▼
Generate run  ──────────────►  run = generated, period = processing
   │  (regenerate allowed — replaces payslips, no duplicates)
   ▼
Approve  ───────────────────►  run = approved (edit locked, Rule 15)
   │
   ▼
Pay  ──► all clear?  ── yes ─►  run = paid, period = locked (fully frozen)
         │ some held?         held employees stay unpaid; run stays approved,
         └──────────────────► period stays processing → fix & pay again
```

Corrections (Rule 15): a **non-paid** run can be **Reopened** (reverts to draft,
un-finalizes attendance, wipes payslips). Reopen is **blocked** once any payslip
is `Paid` (prevents double payment) or the period is `locked`.

---

## 3. The Calculation Engine (per employee, step-by-step)

`PayrollService::computeForEmployee($employee, $period)` runs in this order:

1. **Resolve salary structure** — the version *in force* on the period end
   (latest non-draft with `effective_from ≤ period_end`). If none → fall back to
   `employees.annual_salary` (with a warning); if neither → **block** (Rule 5).
2. **Proration window (Rule 6)** — `winStart = max(period_start, date_of_joining)`,
   `winEnd = min(period_end, last_working_day)`. `proration = activeDays / calendarDays`.
   `effectiveWorkingDays = working_days × proration`.
3. **Attendance aggregates** — count Present/On-Duty/WFH/Corrected (=1), Late (=1 + late mark),
   Half Day (=0.5), Missing In/Out (=1 + missing punch). Absent/Leave/Off = not present.
4. **Leave aggregates (Rule 3)** — approved leaves in window, split **paid vs unpaid**
   by `master_leave_types.paid_unpaid`. Counts **only working days** (excludes Sundays),
   capped by the recorded `days`; half-day single-day = 0.5.
5. **Paid days & LOP** — `paid_days = min(effectiveWorkingDays, present + paid_leave)`;
   `lop_days = effectiveWorkingDays − paid_days`.
6. **Late-mark LOP (Rule 2)** — `floor(lateMarks / 3)` extra LOP days, **flagged for HR
   review** (status → Pending Review) rather than silently docked.
7. **Earned figures** — `earnedFactor = paid_days / effectiveWorkingDays`;
   `earnedGross = proratedGross × earnedFactor`; `earnedBasic = proratedBasic × earnedFactor`;
   `lopAmount = proratedGross − earnedGross`.
8. **Statutory deductions (on EARNED pay):**
   - **PF (Rule 8):** `min(earnedBasic, 15000) × 12%` — only if PF-eligible + full-time + applicable.
   - **ESI:** `earnedGross × 0.75%` — only if applicable and `earnedGross ≤ 21000`.
   - **PT (Rule 9):** state + gender slab on `earnedGross` (see §5).
   - **TDS:** from a structure `tds` deduction line if present, else 0 (slab engine pending).
9. **Other deductions** — structure "other" lines (scaled to earned) + **approved one-off
   deduction adjustments**.
10. **Advance recovery (Rule 11)** — approved advance EMI/lumpsum due this cycle, **capped to
    net-before-recovery** so it never exceeds available pay.
11. **Overtime + Bonus/Incentive (Rules 4 & 10)** — sum of **approved** `payroll_adjustments`
    only (pending/rejected ignored).
12. **Totals:**
    - `total_deductions = pf + esi + pt + tds + lop + advance + other`
    - `net_pay = earnedGross + overtime + bonus − (pf + esi + pt + tds + advance + other)`
    - Net is **floored at ₹0** (deductions can't push it negative — flagged for next-cycle carry).
    - `gross_earnings = proratedGross + overtime + bonus` (so payslip **Total Earnings = Σ line items**).
13. **Bank gate (Rule 12)** — missing account/IFSC → **blocking** (calc still runs; payment blocked).
14. **Status:** any blocking → `On Hold`; any warning → `Pending Review`; else `Ready`.
    Zero net on a paid structure → warning (never silent "Ready").

**Invariant (verified):** for every payslip, `gross_earnings = Σ earnings`,
`total_deductions = Σ deductions`, and `net_pay = gross_earnings − total_deductions`.

---

## 4. Statutory Formulas (as implemented)

**Provident Fund (PF):** `12%` of basic, **wage ceiling ₹15,000** → max ₹1,800/month.
Only when `employee.pf_eligible` + structure `pf_applicable` + work type full-time.

**ESI (employee share):** `0.75%` of gross, only when gross ≤ **₹21,000** and applicable.

**Professional Tax (PT) — Maharashtra slab (default), by gender + month:**

| Gender | Monthly (PT-applicable) salary | PT |
|---|---|---|
| Female | ≤ ₹25,000 | **₹0** (exempt) |
| Female | > ₹25,000 | ₹200 |
| Male | ≤ ₹7,500 | ₹0 |
| Male | ₹7,501 – ₹10,000 | ₹175 |
| Male | > ₹10,000 | ₹200 (**₹300 in February** — ₹2,500 annual cap) |

Gender `Other`/unset → male slab. Unknown state → Maharashtra slab (documented default).

---

## 5. Payroll Rules — As Implemented

> Same numbering as the spec; this section states **exactly how each rule behaves in code**.

### 1. Attendance Finalization
Generate is blocked until the cycle's attendance is finalized. Error message (exact):
`Payroll cannot be processed because attendance is not finalized.`
Finalizing also reports **coverage** ("X of Y employees have no attendance").

### 2. Late Mark Deduction
Every **3 late marks = 1 LOP day**. Applied to LOP **and flagged as a warning** ("verify
hours covered") so the record goes to **Pending Review** instead of a silent deduction.

### 3. Leave Salary
Approved **paid** leave → no cut. **Unpaid** leave / unauthorised absence → LOP.
**Half day = 0.5 day** deduction. Leave days count **working days only** (weekend-safe).

### 4. Overtime
Only **approved** overtime adjustments are added. Pending/rejected are ignored.
Source: `payroll_adjustments` (type `overtime`, optionally `hours × rate`).

### 5. Salary Structure
An active structure is required. Missing → employee **blocked / On Hold** and listed in the
exception list. (Fallback to `annual_salary` with a warning if present.)

### 6. Joining / Exit
Mid-month join/exit → salary **pro-rated** to the active days (join date → month end, or
month start → last working day).

### 7. Inactive / Terminated
`Inactive / Resigned / Terminated`, and anyone whose last working day is before the period,
are **excluded** from regular payroll → routed to **FNF** (Rule 21).

### 8. PF
Eligibility-based (full-time + PF applicable). 12% of basic, ₹15k ceiling. Shown as a
**separate** deduction line on the payslip.

### 9. Professional Tax
**State + gender + salary-slab** based (see §4). Female exemption ≤ ₹25,000, Feb top-up for males.

### 10. Bonus / Incentive
Only **approved** bonus/incentive adjustments are added; pending/rejected ignored.
Shown as separate earning lines.

### 11. Loan / Advance
Approved advance EMI/lumpsum recovered from net. **EMI is capped** so it never exceeds the
net available this cycle (capping raises a warning).

### 12. Bank Details
Payroll **calculates** even if bank details are missing, but the row is **held** and
**payment/export is blocked** when account number or IFSC is missing/invalid.

### 13. Duplicate Payroll
One period per (client, branch, month, year) — DB unique constraint + race-safe create.
One run per period; regenerate **replaces** the draft's payslips (no duplicates), allowed
**only before approval**. **Cross-level guard:** an employee already covered by a run for the
month (e.g. a branch-level run) is **skipped** when a client-wide run is generated (and vice
versa), so nobody is paid twice. Payslips store the **employee's real branch** for accurate
per-branch reporting even in a client-wide run.

### 14. Status & Locking
`Draft → Generated → Approved → Paid`. Draft editable, Generated recalculable, Approved
edit-locked, Paid fully locked (period also locked).

### 15. Approved Payroll Change
No direct edit after approval. Changes require **Reopen** (non-paid only) or an adjustment in
the next cycle. Regenerate-after-approve is rejected.

### 16. Payslip
A payslip is **final** (officially downloadable/emailable) only when its run is
**approved/paid**; otherwise it shows a **PROVISIONAL** badge and Download/Email are blocked.
Shows earnings, deductions, gross, net, period, and employee/branch details.

### 17. Export
Filter-aware (month, department, status) CSV/Excel/ZIP. **Unauthorised users blocked** —
employees get 403; managers/admins/branch-admins allowed.

### 18. Audit Trail
Every payroll action (finalize, run, approve, pay, reopen, payslip PDF, bulk, email) writes to
`ActivityLog` (action, target, who, when, IP, URL, method).

### 19. Salary Structure Version
Revising salary **never overwrites** — the active version is **superseded** and a new version
is inserted with its own `effective_from`, components, creator, and approval status. The engine
always resolves the version **in force** for the period (future-dated revisions don't orphan the
current month; past payslips reconstruct correctly).

### 20. Tenant / Company Isolation
All queries derive `client_id` from the authenticated user (never the request body). Sub-branch
users are **pinned** to their own branch. Cross-tenant access returns 404/403.

### 21. Full & Final Settlement (FNF)
Exited employees are excluded from regular payroll and settled via FNF:
- **Auto:** salary till last working day (pro-rated), approved bonus/incentive, outstanding
  advance recovery.
- **HR inputs:** leave-encashment days, notice-period recovery, other dues / deductions.
- Returns a full earnings/deductions breakdown + **net settlement** (can be negative = employee owes).

---

## 6. Salary Structure & Adjustments

**Salary Structure (`/salary-structures`)** — versioned earnings/deductions with PF/ESI/PT
flags. Saving supersedes the active version and **propagates** to any non-locked payroll.
The **Salary Setup** tab shows a roster (Structure / Annual-fallback / Not-set) and a
**Set/Revise Salary** editor.

**Adjustments (`/payroll-adjustments`)** — overtime / bonus / incentive / one-off deduction,
created `pending` and gated by **approve/reject**. Approving/rejecting/deleting an approved
adjustment **recomputes** the employee's non-locked payslips.

**Propagation (sync everywhere):** a change to salary structure, an employee field
(salary/PF/gender/state/bank/joining/status), or a leave decision recomputes that employee's
payslips in **non-locked** runs — locked/approved/paid runs stay frozen.

---

## 7. API Endpoints

**Payroll (`PayrollController`)**
```
GET    /payroll                         cycle view (period + run + rows + counts)
GET    /payroll/cycles                  13-month strip with status
GET    /payroll/history                 all cycles + every payslip (for overall Excel)
GET    /payroll/preflight               blocking/warning issues (dry-run or generated)
POST   /payroll/finalize-attendance     Rule 1 gate + coverage report
POST   /payroll/run                     generate / regenerate
POST   /payroll/reopen                  revert non-paid run for corrections (Rule 15)
POST   /payroll/approve                 lock the run
POST   /payroll/pay                     disburse (bank gate, conditional lock)
GET    /payroll/payslip/{id}            single payslip detail (+ is_final, company, reasons)
GET    /payroll/payslip/{id}/pdf        single PDF (?download=1 to attach)
POST   /payroll/payslip/{id}/email      email one payslip
GET    /payroll/payslips/bulk           ZIP of all payslip PDFs (filter-aware)
POST   /payroll/payslips/email          email all (final) payslips
GET    /payroll/export                  filtered CSV
GET    /payroll/employee/{id}/payslips  per-employee slip history
GET    /payroll/fnf/{id}                Full & Final Settlement preview
```

**Salary structures (`SalaryStructureController`)**
```
GET    /salary-structures/employees     salary roster (status per employee)
GET    /salary-structures               list (latest first)
POST   /salary-structures               create / revise (new version)
GET    /salary-structures/{id}          show
DELETE /salary-structures/{id}          soft delete (non-active)
```

**Adjustments (`PayrollAdjustmentController`)**
```
GET    /payroll-adjustments             list
POST   /payroll-adjustments             create (pending, or auto_approve)
POST   /payroll-adjustments/{id}/approve
POST   /payroll-adjustments/{id}/reject
DELETE /payroll-adjustments/{id}
```

---

## 8. Frontend Surfaces

- **HR → Payroll** (`HrPayroll.tsx`): cycle strip, KPI cards, tabs — **Payroll Processing**,
  **Biometric Input**, **Salary Report**, **Salary Setup**. Hero actions: **Run Payroll**
  (finalize → generate → pre-flight modal), **Reopen**, and an **Export ▾** menu (Excel / CSV /
  All payslips ZIP / Email all / Payroll history Excel). Every export shows a spinner + disables
  until done; tables and KPIs shimmer while loading.
- **Run modal** (`PayrollRunModal.tsx`): blocking vs warning issues with the **real** server
  reasons; "Go to Attendance" / "Open Employee" navigate; "Proceed to Pay" → approve + pay.
- **Payslip viewer** (`PayslipViewerModal.tsx`): real branch letterhead, real earnings/deductions,
  recent-payslip history, View PDF / Download / Print / Email; PROVISIONAL gating.
- **Salary editor** (`SalaryStructureModal.tsx`): add/remove components, PF/ESI/PT toggles,
  effective date, live gross.
- **Employee Profile → Payroll tab**: real Current Compensation, real Salary Timeline (versions),
  real breakdown, real payslip history + viewer, **Revise Salary** → same editor.

---

## 9. Security & Multi-Tenancy

- `client_id` always from `auth()->user()`; sub-branch users pinned to their branch.
- State-changing actions (finalize/run/approve/pay/reopen/adjustments) require manage rights;
  plain **employees are blocked (403)**.
- Export/download/email require export rights (admins, branch-admins, or `can_export`).
- Employees may only view/download **their own** payslips.
- Cross-tenant access → 404/403. All actions audit-logged.

---

## 10. Testing Summary

The module has been verified with **95 scenarios, all passing**:
- **31 positive** — every one of the 21 rules end-to-end (incl. male/female PT slabs).
- **64 negative/adversarial** — malformed data, boundary values, proration edges,
  attendance/leave edge cases, salary-structure abuse, adjustment abuse, lifecycle/locking,
  RBAC/tenant isolation, FNF edges, payslip consistency, and malformed API params.

Reusable test data: `database/seeders/PayrollTestSeeder.php`
(`php artisan db:seed --class=PayrollTestSeeder`) seeds employees across every PT slab +
attendance/leave/salary scenarios.

**Real bugs found & fixed during hardening:** future-dated salary revision orphaning the
current month, zero-net employee silently marked Ready, leave-spanning-weekend over-crediting,
and the Run modal showing a false "bank" reason for non-bank holds.

---

## 11. Known Gaps / Next Steps

- **TDS** has no slab engine yet (honours a structure `tds` line; otherwise 0).
- **Overtime/bonus** require an approved adjustment to appear (no auto-import from external
  timesheets/incentive systems).
- **FNF** is a calculator/preview API; a dedicated FNF screen + leave-encashment auto-balance
  from leave plans is the next UI increment.
- **Adjustments UI** (overtime/bonus panel) is API-complete; a frontend panel is pending.
