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

### Where to look for an "excluded" employee

`HR → Payroll → Run Payroll` opens the preflight modal. Anyone the run left out
on purpose is listed at the bottom under **Not in this run**, with the reason,
the tenure in days, and an *On probation* chip when they left before completing
probation. Source: `GET /payroll/preflight` → `data.excluded`
(`PayrollService::payrollExclusions()`). An employee who is neither in the
payslip list nor in that panel is a genuine silent drop — log it.

---

## Group 1 — Eligibility & probation

### PAY-01 · Employee still within probation — **S1**
- **Precondition:** Employee joined recently, probation period not yet complete.
- **Steps:** Generate payroll for the current cycle.
- **Configured policy (as implemented):** Probation does **not** withhold pay.
  A probationer is paid on exactly the same rules as a confirmed employee —
  joining-date proration, LOP, late marks, OT. The only tenure-based carve-out
  in payroll is the **early exit**: resigned/left within **15 days** of joining
  (`ProbationGuard::EARLY_EXIT_DAYS`) → not put through payroll at all, and
  listed in the preflight **Excluded** panel with the tenure and reason. So
  ≥16 days of service = paid; ≤15 days *and exited* = excluded-with-reason.
  Probation length itself (`probation_end_date` = joining + policy months) has
  no bearing on whether payroll runs.
- **Expected:** Employee **appears in the run and is paid**, with an info line
  on the payslip stating either `On probation until <date> — paid in full…` or,
  when probation ended inside the cycle, `Probation completed on <date>…`.
- **Fails as:** Employee silently absent from the run with no entry in any
  "excluded / on hold" panel, so nobody notices they weren't paid; or held/₹0
  purely because probation is active; or paid with no probation info line, so
  there's no evidence the rule was evaluated.

### PAY-02 · Employee left before completing probation — **S1**
- **Precondition:** Employee resigned or was released inside the probation window.
- **Steps:** Generate payroll for the cycle covering their exit.
- **Configured policy (as implemented):** Leaving on probation never sends the
  employee through regular payroll for the cycle they leave in. Two paths:
  - **≤15 days** from joining (resignation *or* last working day) → early exit:
    no payroll at all, no notice period.
  - **>15 days but still inside probation** → excluded from the regular run
    like any leaver; salary and dues are settled through **Full & Final**.

  Either way the row appears in the preflight **Excluded** panel carrying
  `tenure_days`, `on_probation`, `probation_end`, and a reason that now names
  the probation status, e.g.
  `Left on 20 Aug 2026 — excluded from this cycle; salary and dues are settled in the Full & Final settlement. Left before completing probation (probation ran to 24 Dec 2026) — notice period was not applicable.`
  Probation status is measured at the date employment ended, so an exit after
  probation completed is **not** labelled a probation leaver.
- **Expected:** Absent from the payslip list, present in **Excluded** with the
  reason above; the money is settled in F&F, not in this run.
- **Fails as:** Full month's salary paid to someone who worked a few days; or a
  silent drop with no Excluded row; or an exit dated after probation ended still
  labelled as a probation leaver.

### PAY-03 · Employee completes probation mid-cycle — **S2**
- **Precondition:** Probation end date falls inside the cycle.
- **Steps:** Generate payroll.
- **Expected:** Becomes eligible from the correct date; any pre/post-probation
  rate difference applies from the right day.
- **Fails as:** Eligibility flips on the 1st or the 31st instead of the actual date.

### PAY-04 · Half-onboarded employee — **S2**
- **Precondition:** Employee record exists but onboarding is incomplete.
- **Steps:** Generate payroll.
- **Configured policy (as implemented):** `eligibleEmployees()` requires
  `onboarding_stage_completed >= 6`, so a half-onboarded employee never gets a
  payslip. They are now reported in the **Not in this run** panel as
  `Onboarding incomplete (stage 3 of 6) — excluded from payroll until onboarding is completed.`
  Soft-deleted (disabled) half-onboarded records are not reported — an
  abandoned draft is not a payroll omission.
- **Expected:** Excluded from payroll, reason visible in the Run Payroll modal.
- **Fails as:** Appears in the run with blank department/designation and a ₹0 or
  garbage salary line; or excluded with nothing on screen to say so.
- **Verified boundaries:** stage 0 / 1 / 3 / 5 → all excluded and reported;
  stage 6 and 7 → paid normally. `onboarding_stage_completed` is NOT NULL at
  the DB level, so there is no "null stage" case to test.
- **Reason precedence** when more than one exclusion applies — the panel prints
  exactly one reason, strongest first:
  1. Resigned within 15 days of joining (no payroll at all)
  2. Left inside this cycle (settled through F&F)
  3. Onboarding incomplete
  4. Payroll switched off on the employee record

  A stage-3 employee who also exited in the cycle therefore reads as an exit,
  not as an onboarding problem.
- **Not reported at all (correct):** joining date after the period end (they
  were never expected in this run), and soft-deleted records.

### PAY-04b · Payroll switched off on the employee — **S1**
- **Precondition:** Employee → Salary → **Payroll** toggle set to off
  (`employees.enable_payroll = false`), everything else complete.
- **Steps:** Generate payroll.
- **Expected:** No payslip; listed under **Not in this run** as
  `Payroll is switched off on this employee record — no payslip is generated for them.`
- **Fails as:** Full salary paid to someone explicitly taken off payroll —
  which is what the system did before this was wired up. Only an explicit
  `false` excludes; a record where the switch was never set (NULL) is still
  paid, so legacy/imported employees do not vanish from a run.

### PAY-04c · Status says Resigned but no exit record — **S2**
- **Precondition:** Employee's status changed to Inactive / Resigned /
  Terminated directly on the record, with **no** exit case carrying a last
  working day. They were paid in the previous cycle.
- **Steps:** Generate payroll for the next cycle.
- **Expected:** No payslip, and listed under **Not in this run** as
  `Employee status is Resigned — paid last cycle, not this one. No exit record with a last working day exists, so any dues must be settled manually or through Exit Management.`
- **Fails as:** They vanish between two cycles with nothing on screen — the
  status filter drops them and no exit record exists for the exit branch to
  report. This is the only remaining way an employee can leave a run silently,
  so it is bounded deliberately: **only** someone who had a payslip in the
  immediately preceding cycle is reported. Someone who left long ago, or who
  was never paid at all, is not re-listed every month.

---

## Group 2 — Joining, exit & proration

### PAY-05 · Joined before the cycle, active throughout — **S1**
- **Steps:** Generate payroll for a month fully after the joining date.
- **Expected:** Appears with a **full** month's salary; no proration.
- **Fails as:** Salary quietly pro-rated because the joining date is being
  compared against the wrong boundary.
- **Verified:** joined Jun-2025, present all 26 working days of Aug-2026 →
  gross ₹1,00,416.67, working 26, paid 26, LOP 0, net ₹1,00,216.67 (PT ₹200).
  No proration factor applied at all.

### PAY-06 · Joined mid-cycle — **S1**
- **Precondition:** Joining date inside the cycle (e.g. 10-Aug for an Aug run).
- **Steps:** Generate payroll.
- **Expected:** Pro-rated from the joining date per the configured basis
  (calendar days vs working days — **check which**). Working days and paid days
  both reflect the shortened window.
- **Fails as:** Full month paid; or pro-rated on calendar days while LOP is
  computed on working days, so the two disagree.
- **Configured basis (as implemented):** the **money** is pro-rated on
  **calendar days** — `active days ÷ days in month`, where the active window
  runs from the joining date to the period end. A 16-Aug joiner in a 31-day
  month earns 16/31 of gross. The **day counts** on the slip
  (`working_days` / `paid_days` / `lop_days`) are counted over that same window
  using the employee's own weekly-off pattern, so they are whole days and
  reconcile: `working_days = paid_days + lop_days`.
- **Verified with inserted attendance** (Aug 2026, ₹1,00,416.67 gross,
  Sunday-off, present every working day of the window):

  | Joined | Active days | Working | Paid | LOP | Gross |
  |---|---|---|---|---|---|
  | 1 Aug | 31 | 26 | 26 | 0 | ₹1,00,416.67 (no proration) |
  | 2 Aug | 30 | 25 | 25 | 0 | ₹97,177.42 |
  | 10 Aug | 22 | 19 | 19 | 0 | ₹71,263.44 |
  | 16 Aug | 16 | 13 | 13 | 0 | ₹51,827.96 |
  | 31 Aug | 1 | 1 | 1 | 0 | ₹3,239.25 |
  | 9 Aug (a Sunday) | 23 | 19 | 19 | 0 | ₹74,502.69 |
  | joined months earlier | 31 | 26 | 26 | 0 | full salary |

- **Negative case — joiner who is also absent:** joined 16 Aug, absent 3
  working days → working 13, paid 10, LOP 3 days = ₹4,858.87
  (basic ÷ 31 × 3), net ₹46,769.09. Proration and LOP both apply and do not
  double-count each other.
- **Fixed while testing:** the denominator used to be the full month's working
  days *scaled* by the calendar ratio (26 × 30/31 = 25.16), a fraction no
  attendance record can ever reach — so a 2-Aug joiner present every single
  working day was still charged 0.16 of a day's LOP. It is now counted over the
  active window. Separately, the slip used to report the **full month's**
  `working_days` (26) next to a prorated paid/LOP pair, so the three numbers
  could not be reconciled by anyone reading the payslip.

### PAY-07 · Joining date in a future month — **S1**
- **Precondition:** Joining date in September; generate the August run.
- **Expected:** **Not present at all** in the August run.
- **Fails as:** Appears with a full salary, or with a negative/zero paid-day count.
- **Rule (as implemented):** `eligibleEmployees()` keeps only
  `date_of_joining <= period_end`, so the boundary is the **period end date**,
  not the month or a cutoff. Joining ON the last day is in (pro-rated to that
  one day); the first day after is out.
- **Verified with inserted data — Aug 2026 run:**

  | Joined | Payslip | Result |
  |---|---|---|
  | 31 Aug (last day of cycle) | yes | working 1, paid 1, LOP 0, gross ₹3,239.25 (= gross ÷ 31) |
  | 1 Sep (day after cycle) | none | out |
  | 10 Sep | none | out |
  | 1 Mar 2027 | none | out |
  | 5 Sep, but **already has Aug attendance rows** | none | out — stray punches before joining cannot become salary |

  None of the future joiners is listed under **Not in this run** either: they
  were never expected in that cycle, so reporting them would be noise. Running
  **September** afterwards picks up exactly the ones who had joined by then
  (1-Sep, 5-Sep, 10-Sep and the 31-Aug joiner); the 2027 hire stays out.
- **Also checked:** no payslip anywhere shows a zero or negative paid-day count.

### PAY-08 · Joined after the payroll cutoff — **S2**
- **Precondition:** Joining date after the configured cutoff for the cycle.
- **Expected:** Excluded from this cycle, or carried into it — **whichever the
  cutoff rule states** — and applied the same way for every such employee.
- **Fails as:** Inconsistent: some post-cutoff joiners in, some out.
- **Configured rule (as implemented): there is no payroll cutoff.** Nothing in
  `PayrollService` or `PayrollController` reads a cutoff date. Anyone joined on
  or before the period end is in the run, pro-rated. Verified: joined 28-Aug →
  in the Aug run with working 3, paid 3, gross ₹12,956.99 (= ₹1,00,416.67 × 4/31).
  Consistent by construction, since there is no rule to apply unevenly. If the
  business wants a cutoff, it is a feature request, not a bug.

### PAY-09 · Exited before the cycle started — **S1**
- **Precondition:** Last working day 31-Jul; generate the August run.
- **Expected:** No August salary. No payslip row.
- **Fails as:** Full August salary paid to someone who left in July.
- **Verified:** last working day 31-Jul → no Aug payslip, and correctly **not**
  re-listed in **Not in this run** (that absence belongs to the July cycle;
  re-reporting it every month would turn the panel into a log of all past
  leavers).

#### The first-15-days rule, applied to PAY-09

"Left before the payroll month" answers only the **August** question. What the
employee is owed for the month they actually left in is decided by the 15-day
rule (`ProbationGuard::EARLY_EXIT_DAYS`), measured from the joining date to the
**resignation** date, counting the joining day itself:

- **≤ 15 days** → no payroll at all. Not in the run, and the exit-month F&F
  settles **₹0** with the reason stated on it.
- **≥ 16 days** → normal treatment: excluded from the regular run for the month
  they left, and paid through the F&F, pro-rated to the days worked.

Either way, **no later cycle ever produces a payslip for them.**

**Verified end-to-end** (all left in July; August 2026 run generated afterwards):

| Case | Tenure | Aug payslip | Exit-month settlement |
|---|---|---|---|
| Long-serving, left 31-Jul | 907 days | none | July ₹1,00,216.67 |
| Joined 16-Jul, left 31-Jul | **16 days** | none | July ₹51,627.96 — over the line, so it pays |
| Joined 16-Jul, left 30-Jul | **15 days** | none | July **₹0.00** — `exited on day 15 of joining, within 15 days, so payroll is not processed` |
| Joined 16-Jul, left 20-Jul | 5 days | none | July **₹0.00**, same reason |
| Resigned on day 15, **no last working day agreed** | 15 days | none | July **₹0.00** |

The 15/16-day boundary is exact: one extra day of service flips ₹0 into
₹51,627.96.

**One deliberate difference to be aware of:** the case with no last working day
*is* listed in the August panel (`Resigned within 15 days of joining…`), unlike
the others. That is intentional — with no last working day recorded, the exit is
still open, so they are genuinely being skipped in August and the panel says
why. It keeps repeating each cycle until Exit Management records a last working
day, which is the cue to close the case.

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
- **Verified — no double pay.** Anyone whose last working day falls on or
  before the period end is dropped by `eligibleEmployees()`, so the run cannot
  produce a payslip for them; the money comes only from
  `earnedSalaryForExitMonth()`. Two leavers, both present every working day of
  their window:

  | Last working day | Payslip in run | F&F working / paid | F&F gross | F&F payable |
  |---|---|---|---|---|
  | 15 Aug | none | 13 / 13 | ₹48,588.71 | ₹48,388.71 |
  | 20 Aug | none | 17 / 17 | ₹64,784.95 | ₹64,584.95 |

  Both grosses match `₹1,00,416.67 × days ÷ 31` exactly, and both employees are
  listed under **Not in this run** with the F&F reason. Note PT stays a flat
  ₹200 slab rather than pro-rating — that is how professional tax works, not a
  proration bug.

### PAY-12 · Rejoining employee — **S2**
- **Precondition:** Employee previously exited, now rehired with a new joining date.
- **Expected:** Paid from the new joining date; the old exit does not suppress them.
- **Fails as:** Stale exit record keeps excluding them from every future run.
- **Was broken — now fixed.** A rehire (exited 31-Dec-2025, rejoined 1-Aug-2026)
  got **no payslip and no exclusion row**: the old `employee_exits` record still
  said they had left, and the exclusion panel only reports exits inside or after
  the period, so they vanished from every run with nothing on screen. Exit rows
  that end **before** the employee's current joining date are now ignored as a
  previous stint (`exitMap()` / `resignationMap()`). Re-verified: same employee
  now gets a full ₹1,00,416.67 gross, working 26, paid 26, LOP 0.

---

## Group 3 — Attendance & leave

> **Verified end-to-end** against Aug 2026 (31 days, 26 working days on a
> Sunday-off pattern), gross ₹1,00,416.67, basic ₹50,208.34. One LOP day costs
> **basic ÷ 31 = ₹1,619.62**. Every case below was run with real attendance
> rows, real approved leave and a real holiday, through the actual payroll run.
>
> | Case | Working | Paid | LOP | Paid lv | Unpaid lv | Net | Status |
> |---|---|---|---|---|---|---|---|
> | PAY-13 paid leave ×3 | 26 | 26 | 0 | 3 | 0 | ₹1,00,216.67 | Ready |
> | PAY-14 unpaid leave ×3 | 26 | 23 | 3 | 0 | 3 | ₹95,357.80 | Ready |
> | PAY-15 absent ×3, no request | 26 | 23 | 3 | 0 | 0 | ₹95,357.80 | Ready |
> | PAY-16 holiday on a working day | 26 | 26 | 0 | 0 | 0 | ₹1,00,216.67 | Ready |
> | PAY-16 Sat+Sun off pattern | 21 | 21 | 0 | 0 | 0 | ₹1,00,216.67 | Ready |
> | PAY-17 one half day | 26 | 25.5 | 0.5 | 0 | 0 | ₹99,406.86 | Ready |
> | PAY-18 two late marks | 26 | 26 | 0 | 0 | 0 | ₹1,00,216.67 | Ready |
> | PAY-18 three late marks | 26 | 25.5 | 0.5 | 0 | 0 | ₹99,406.86 | Pending Review |
> | PAY-19 missing out-punch | 26 | 26 | 0 | 0 | 0 | ₹1,00,216.67 | Pending Review |
> | PAY-20 no attendance at all | 26 | 0 | 26 | 0 | 0 | ₹58,106.45 | Pending Review |
>
> `working_days = paid_days + lop_days` holds on every row.

### PAY-13 · Approved paid leave — **S1**
- **Precondition:** Approved paid leave inside the cycle.
- **Expected:** Counted as **paid**; no deduction. Shows under paid leave days,
  not under absent.
- **Fails as:** Deducted as LOP, or double-counted as both paid leave and present.

#### Verified end-to-end — full tally sheet

Employee #22, **Aug 2026** (31 days · 26 working days · Sunday-off pattern),
gross ₹1,00,416.67, basic ₹50,208.34. One LOP day = basic ÷ 31 = **₹1,619.62**.
Every row below was produced by seeding real attendance rows and real
`leave_requests` and running the actual payroll computation. Leave type
`sick` (`paid_unpaid = Paid`) vs `LWP` (`Unpaid`).

| # | Case | Working | Paid | LOP | Paid lv | Unpaid lv | Net | Slip status | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| A | Baseline — present 26/26, no leave | 26 | 26 | 0 | 0 | 0 | ₹1,00,216.67 | Ready | reference |
| B | **Paid leave ×3** (Tue–Thu, absent those days) | 26 | 26 | 0 | 3 | 0 | ₹1,00,216.67 | Ready | **pass** — net identical to A |
| C | Paid leave Fri→Mon (spans the Sunday off) | 26 | 26 | 0 | 3 | 0 | ₹1,00,216.67 | Ready | pass — Sunday not credited |
| D | Paid **half-day**, no attendance the other half | 26 | 25.5 | 0.5 | 0.5 | 0 | ₹99,406.86 | Ready | pass — only the unworked half is LOP |
| D2 | Half present + half paid leave, same day | 26 | 26 | 0 | 0.5 | 0 | ₹1,00,216.67 | Ready | pass — no deduction, not flagged |
| E | Paid leave 30 Jul → 4 Aug (straddles cycle start) | 26 | 26 | 0 | 3 | 0 | ₹1,00,216.67 | Ready | pass — clipped to the 3 Aug working days |
| F | Same 3 days, leave **Pending** not approved | 26 | 23 | 3 | 0 | 0 | ₹95,357.80 | Ready | pass — only *Approved* is paid |
| G | Present **and** paid leave the same 3 days | 26 | 26 | 0 | 3 | 0 | ₹1,00,216.67 | **Pending Review** | pass — capped at 26, overlap flagged |
| G2 | Paid leave over present days **+ 3 unrelated absences** | 26 | 23 | **3** | 3 | 0 | ₹95,357.80 | **Pending Review** | **fixed** — absences now charged |
| H | Whole cycle on approved paid leave | 26 | 26 | 0 | 26 | 0 | ₹1,00,216.67 | Ready | pass — full salary, 0 LOP |
| I | Contrast (PAY-14) — same 3 days **unpaid** leave | 26 | 23 | 3 | 0 | 3 | ₹95,357.80 | Ready | pass — the paid flag is what decides |
| J | Contrast (PAY-15) — same 3 days simply absent | 26 | 23 | 3 | 0 | 0 | ₹95,357.80 | Ready | pass |

`working_days = paid_days + lop_days` reconciles on **all 12 rows**. The three
₹95,357.80 rows are 3 × ₹1,619.62 below baseline exactly, so the paid-vs-unpaid
split is worth precisely the LOP it should be.

**Persisted payslip** (run through `finalizeAttendance()` → `generate()`, case B):
`present_days 23 · paid_leave_days 3 · paid_days 26 · lop_days 0 ·
lop_amount ₹0 · gross ₹1,00,416.67 · deductions ₹200 (PT) · net ₹1,00,216.67 ·
status Ready`, one payslip row, no duplicate. The paid leave is visible as its
own field — it is not silently folded into present days.

**Was broken — now fixed (S1).** Row **G2** was the real hole. An employee
present 23 days, with **3 days that had no attendance row and no leave request**,
plus an approved 3-day paid leave filed over dates they were *already* marked
present, came out at **26 paid days, 0 LOP and a full month's salary** — the
`min()` ceiling on paid days absorbed the double credit, and the three genuine
absences were paid for with nothing anywhere on the slip.

Paid days are now reconciled **date by date** (see the fix written up under
PAY-14, which shares the root cause), so a paid leave can only ever pay for its
own dates and the three absences are charged: **paid 23, LOP 3, ₹95,357.80**.
The overlap is still reported — `N day(s) where attendance and an approved leave
request cover the same date…` — pushing the slip to **Pending Review** so HR
fixes the bad punch or the duplicate request at source. A legitimate
half-present + half-paid-leave day (row D2) totals exactly one day and is **not**
flagged.

**How to reproduce G2 manually:** mark an employee present for the whole month,
delete the attendance rows for any 3 working days, then approve a 3-day paid
leave on three *different* days they were present. Generate payroll → the slip
must show the overlap warning and sit at Pending Review. If it says Ready with
a full net, the guard has regressed.

### PAY-14 · Unpaid leave — **S1**
- **Precondition:** 3 days approved unpaid leave.
- **Expected:** Exactly 3 days LOP, valued on the configured per-day basis.
- **Fails as:** 2 or 4 days deducted (boundary/inclusive-date error), or the
  per-day rate derived from a different base than the policy states.

#### Verified end-to-end — full tally sheet

Same bed as PAY-13: employee #22, Aug 2026, 26 working days, gross ₹1,00,416.67,
one LOP day = basic ÷ 31 = **₹1,619.62**. Leave type `LWP` (`paid_unpaid =
Unpaid`). The **SW** column is the branch's Sandwich Leave Policy switch
(`branches.sandwich_policy`), toggled per case.

| # | Case | SW | Working | Paid | LOP | Unpaid lv | LOP amt | Net | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| A | Baseline, present 26/26 | off | 26 | 26 | 0 | 0 | ₹0 | ₹1,00,216.67 | reference |
| U1 | **Unpaid ×3** (Tue–Thu) | off | 26 | 23 | 3 | 3 | ₹4,858.87 | ₹95,357.80 | **pass** — exactly 3, not 2 or 4 |
| U2 | Unpaid Fri→Mon (spans Sunday) | off | 26 | 23 | 3 | 3 | ₹4,858.87 | ₹95,357.80 | pass — Sunday free |
| U3 | Same, policy **ON** | ON | 26 | 22 | **4** | 3 | ₹6,478.50 | ₹93,738.17 | pass — Sunday sandwiched, charged |
| U4 | Fri and Mon as **two separate requests** | ON | 26 | 22 | **4** | 3 | ₹6,478.50 | ₹93,738.17 | pass — sandwich still detected |
| U5 | Fri→Mon, `sandwich_waived` by HR | ON | 26 | 23 | 3 | 3 | ₹4,858.87 | ₹95,357.80 | pass — waiver honoured |
| U6 | Contrast: same shape but **paid** leave | ON | 26 | 26 | 0 | 0 | ₹0 | ₹1,00,216.67 | pass — sandwich hits balance, not salary |
| U7 | Unpaid 30 Jul → 4 Aug (straddles start) | off | 26 | 23 | 3 | 3 | ₹4,858.87 | ₹95,357.80 | pass — clipped to the cycle |
| U8 | Unpaid half-day, other half unworked | off | 26 | 25 | 1 | 0.5 | ₹1,619.62 | ₹98,597.05 | pass — the unworked half is its own LOP |
| U8b | Half present + half unpaid, same day | off | 26 | 25.5 | 0.5 | 0.5 | ₹809.81 | ₹99,406.86 | pass |
| U9 | Unpaid ×3 on days **also marked present** | off | 26 | 23 | **3** | 3 | ₹4,858.87 | ₹95,357.80 | **fixed** — deducted + flagged |
| U10 | Mixed: 2 paid + 2 unpaid | off | 26 | 24 | 2 | 2 | ₹3,239.25 | ₹96,977.42 | pass — only the unpaid pair costs |
| U11 | Whole cycle unpaid | off | 26 | 0 | 26 | 26 | ₹42,110.22 | ₹58,106.45 | pass, flagged Pending Review |

`working_days = paid_days + lop_days` reconciles on **all 13 rows**, sandwich
rows included. Every LOP amount is an exact multiple of ₹1,619.62.

#### Does unpaid leave come under the Sandwich policy? — **yes**

- **It applies to unpaid leave and it costs salary.** An off-day (weekly-off or
  holiday) with approved leave on **both** sides is charged straight to LOP —
  row U3: a Fri→Mon LWP costs **4** days, not 3. `SandwichPolicy` triggers on
  the *shape of the calendar*, not the leave type.
- **It survives being split across requests** (U4). Friday filed as one request
  and Monday as another still charges the Sunday — the run of off-days is
  charged to the leave covering the day immediately after it.
- **On PAID leave it never touches salary** (U6). There the sandwich is charged
  to the leave **balance** (`leave_requests.days`), so pay only moves once the
  balance runs out and further leave has to be unpaid. This asymmetry is
  deliberate: an unpaid leave has no balance to burn, so the charge has to land
  on LOP or the policy would mean nothing for LWP.
- **HR can waive it** per request via `sandwich_waived` (U5) — one waiver covers
  both the paid and unpaid sides.
- **Configuration warning for testers:** `sandwich_policy` is currently **OFF on
  all three branches** in this database. Sandwich behaviour therefore does not
  fire in normal testing at all — rows U3/U4/U5 only reproduce after switching
  it on for the branch. If you test the sandwich rule without turning it on and
  see 3 days instead of 4, that is configuration, not a bug.

#### Was broken — now fixed (S1, shared root cause with PAY-13 G2)

Row **U9** used to pay in full. Unpaid leave approved for 3 days on which
attendance *also* marked the employee present deducted **nothing**: LOP was
derived as `working − paid_days`, those days were already filled by the present
credit, and `unpaid_leave_days` was a label with no money behind it. The mirror
image on the paid side (PAY-13 **G2**) let a paid leave filed over present days
free up head-room that backfilled unrelated absences.

Both came from the same arithmetic — three independent running totals added and
capped, `min(workingDays, present + paidLeave + holidays)`, which never knew
*which dates* each total came from. Paid days are now reconciled **date by
date**:

```
payable(d) = min( 1 − unpaidLeave(d),  present(d) + paidLeave(d) + holiday(d) )
```

An approved unpaid leave reserves its share of the day and nothing can pay it
back; a paid leave can only ever pay for its own dates, so it can never mask an
absence elsewhere. Half days are unaffected (0.5 present + 0.5 paid = 1 payable;
0.5 present + 0.5 unpaid = 0.5 payable, 0.5 LOP). The overlap is still reported
so HR knows the punch and the leave request disagree — but the money no longer
waits on someone reading the warning.

**Persisted payslip** (real `finalizeAttendance()` → `generate()`, 3 unpaid days):
`present_days 23 · paid_days 23 · lop_days 3 · unpaid_leave_days 3 ·
lop_amount ₹4,858.87 · deductions ₹5,058.87 (LOP + ₹200 PT) · net ₹95,357.80`,
one payslip row.

#### Behaviour change to be aware of — attendance on a weekly off

Only the employee's **own working dates** are now walked for payable credit.
Previously every attendance row in the window was summed, so a Sunday shift
could silently cancel a Monday absence and the slip showed no LOP at all.
Verified: Sunday 16 Aug worked + Monday 17 Aug absent now gives **paid 25,
LOP 1** — and the Sunday is paid through **overtime** instead (net ₹1,02,459.31,
above baseline). Off-day work is compensated as OT, not by offsetting loss of
pay. If a tester was relying on the old behaviour, this is the change.

#### Regression sweep after the rewrite

Every other Group-3 case was re-run and matches its recorded value exactly:

| Case | Expected (working / paid / LOP / net) | Result |
|---|---|---|
| PAY-16 holiday on a working day | 26 / 26 / 0 / ₹1,00,216.67 | match |
| PAY-16 Sat+Sun off pattern | 21 / 21 / 0 / ₹1,00,216.67 | match |
| PAY-17 one half day | 26 / 25.5 / 0.5 / ₹99,406.86 | match |
| PAY-18 two late marks | 26 / 26 / 0 / ₹1,00,216.67 | match |
| PAY-18 three late marks | 26 / 25.5 / 0.5 / ₹99,406.86 | match |
| PAY-19 missing out-punch | 26 / 26 / 0 / ₹1,00,216.67 | match |
| PAY-20 no attendance at all | 26 / 0 / 26 / ₹58,106.45 | match |

### PAY-15 · Unapproved absence — **S1**
- **Expected:** Deducted per the absent-day policy, and distinguishable from
  approved unpaid leave on the payslip.
- **Fails as:** Absent and unpaid-leave days collapse into one figure, so the
  employee can't be told why they were docked.
- **Verified — the two are distinguishable.** Three unapproved absent days and
  three approved unpaid-leave days both produce 3 LOP days and the identical
  ₹4,858.87 deduction, but `unpaid_leave_days` reads **3** for the leave case
  and **0** for the plain absence. That field is the only thing separating
  them, so a payslip or export that omits it makes the two indistinguishable.

#### Verified end-to-end — full tally sheet

Employee #22, Aug 2026, gross ₹1,00,416.67, basic ₹50,208.34, 31 calendar days,
26 working days. Positive **and** negative cases — an absence must be charged,
and things that only *look* like absences must not be.

| # | Case | Present | Paid | LOP | Unpaid lv | LOP amt | Net | Verdict |
|---|---|---|---|---|---|---|---|---|
| A | Baseline present 26/26 | 26 | 26 | 0 | 0 | ₹0 | ₹1,00,216.67 | reference |
| N1 | **Absent ×3, no attendance row** | 23 | 23 | 3 | 0 | ₹4,858.87 | ₹95,357.80 | **pass** |
| N2 | Absent ×3, explicit `status = Absent` | 23 | 23 | 3 | 0 | ₹4,858.87 | ₹95,357.80 | pass — same as a missing row |
| N3 | Absent ×1 | 25 | 25 | 1 | 0 | ₹1,619.62 | ₹98,597.05 | pass — exact per-day rate |
| N4 | Absent on a **holiday** | 25 | 26 | 0 | 0 | ₹0 | ₹1,00,216.67 | pass — holiday paid, not charged |
| N5 | Absent on a **weekly off** only | 26 | 26 | 0 | 0 | ₹0 | ₹1,00,216.67 | pass — Sundays never charged |
| N6 | Half day (short hours) | 25.5 | 25.5 | 0.5 | 0 | ₹809.81 | ₹99,406.86 | pass — exactly half |
| N7 | Absent ×1 **+ 3 late marks** | 25 | 24.5 | 1.5 | 0 | ₹2,429.44 | ₹97,787.23 | pass — both accumulate |
| N8 | Absent ×3 **+ unpaid leave ×3** | 20 | 20 | 6 | **3** | ₹9,717.74 | ₹90,498.93 | pass — still distinguishable |
| N9 | Absent the whole cycle | 0 | 0 | 26 | 0 | ₹42,110.22 | ₹58,106.45 | pass, flagged Pending Review |
| N10 | Absent ×3 but **covered by paid leave** | 23 | 26 | 0 | 0 | ₹0 | ₹1,00,216.67 | pass — negative case |

Every LOP amount divides to exactly **₹1,619.62/day** until the cap bites at
N9. A missing attendance row and an explicit `Absent` row are priced the same.

#### "According to the configured rule" — was NOT configurable, now it is

The deduction always worked, but there was **no rule to configure**: the per-day
rate was hardcoded as `basic ÷ calendar days` in the middle of the money block,
with no setting, column or UI anywhere. Worse, [PAYROLL_QA_RULES.md](PAYROLL_QA_RULES.md)
documented it as *"per-day salary basis = monthly gross ÷ working days"* —
₹3,862.18/day, **2.4× what the code actually charges**. Anyone testing PAY-15
against the written rule would have logged a bug against correct code, or
signed off a wrong number believing it matched.

It is now a per-branch policy, `branches.lop_policy`, on the same pattern as the
late-mark policy:

```
per-day = (basic | gross) ÷ (calendar days | working days)
```

All four combinations verified against the same 3 absent days:

| Branch LOP policy | Per day | LOP amount | Net pay |
|---|---|---|---|
| **NULL — never configured** | ₹1,619.62 | ₹4,858.87 | ₹95,357.80 |
| `basic ÷ calendar` | ₹1,619.62 | ₹4,858.87 | ₹95,357.80 |
| `basic ÷ working` | ₹1,931.09 | ₹5,793.27 | ₹94,423.40 |
| `gross ÷ calendar` | ₹3,239.25 | ₹9,717.74 | ₹90,498.93 |
| `gross ÷ working` | ₹3,862.18 | ₹11,586.54 | ₹88,630.13 |
| invalid / garbage values | ₹1,619.62 | ₹4,858.87 | ₹95,357.80 |

**Nothing moves until an admin changes it.** An unconfigured branch (NULL) and
an invalid stored value both fall back to the legacy `basic ÷ calendar`, giving
the identical ₹4,858.87 — so no existing payslip is affected and historic runs
stay reproducible. Re-verified: all of PAY-13, PAY-14 and PAY-16 → PAY-20
produce their recorded numbers unchanged.

#### What the default policy means in money — worth a business decision

Charging on **basic** means allowances are never clawed back. Row N9 is the
clearest statement of it: an employee absent **every working day of the month**
still takes home **₹58,106.45** — the entire HRA / special-allowance half of
their salary — because the deduction is capped at the pro-rated basic. And an
absent day costs ₹1,619.62 while a worked day earns gross ÷ 26 = ₹3,862.18, so
a day off costs the employee **42%** of what that day is worth to them.

That is a legitimate policy many employers run, and it is now switchable rather
than buried. But whoever owns payroll should confirm the default is the intended
one, and **PAYROLL_QA_RULES.md needs correcting** either way — the code and the
written rule currently disagree by 2.4×.

### PAY-16 · Weekly offs and holidays — **S1**
- **Precondition:** Cycle contains weekly offs and at least one holiday from the
  employee's holiday group.
- **Expected:** Both are **paid** and never counted as absent or LOP. Employees
  on different weekly-off patterns get different working-day denominators.
- **Fails as:** Everyone measured against the same working-day count, inflating
  LOP for anyone not on the default pattern.

#### Verified end-to-end — offs and holidays are never absent

| # | Case | Working | Paid | LOP | Net | Verdict |
|---|---|---|---|---|---|---|
| H1 | Holiday on a working day (Wed 12) | 26 | 26 | 0 | ₹1,00,216.67 | pass |
| H2 | Holiday landing on a Sunday (16) | 26 | 26 | 0 | ₹1,00,216.67 | pass — not double-credited |
| H3 | Sat+Sun off pattern | **21** | 21 | 0 | ₹1,00,216.67 | pass — own denominator |
| H4 | No attendance rows on Sundays at all | 26 | 26 | 0 | ₹1,00,216.67 | pass — never absent |
| H5 | Two holidays in the cycle | 26 | 26 | 0 | ₹1,00,216.67 | pass |

H3 is the one that matters most: a Saturday-off employee is measured against
**21** working days, not the company's 26, so the same attendance does not
manufacture 5 days of LOP. Both patterns end on the identical net.

#### Sandwich policy — no violation of PAY-16

The sandwich rule is the *only* thing that can ever make an off-day cost money,
so it was tested for over-reach in both directions. Sandwich switch **ON**
except where stated.

| # | Case | SW | Working | Paid | LOP | Net | Verdict |
|---|---|---|---|---|---|---|---|
| S1 | **Paid** leave Fri + Mon | ON | 26 | 26 | 0 | ₹1,00,216.67 | pass — paid sandwich hits the *balance*, never salary |
| S2 | Unpaid leave Fri + Mon (Sat is a working day) | ON | 26 | 24 | 2 | ₹96,977.42 | pass — **no** sandwich, see below |
| S3 | Unpaid leave **Fri only**, present Mon | ON | 26 | 25 | 1 | ₹98,597.05 | pass — Sunday free |
| S4 | Present Fri, unpaid leave **Mon only** | ON | 26 | 25 | 1 | ₹98,597.05 | pass — Sunday free |
| S5 | **Absent** Fri + absent Mon, no leave filed | ON | 26 | 24 | 2 | ₹96,977.42 | pass — absence is not leave, Sunday free |
| S6 | Unpaid leave Fri + **holiday** Mon | ON | 26 | 25 | 1 | ₹98,597.05 | pass — a holiday is not a leave day |
| S7 | Sat+Sun off, unpaid leave Fri + Mon | ON | 21 | 17 | **4** | ₹93,738.17 | pass — 2 leave + **both** sandwiched offs |
| S8 | Same as S2 but switch **off** | off | 26 | 24 | 2 | ₹96,977.42 | pass |
| S9 | Unpaid Tue + Thu with a **holiday** Wed between | ON | 26 | 23 | 3 | ₹95,357.80 | pass — holiday sandwiched and charged |
| S10 | Month-boundary: unpaid Fri 28 + Mon 31 | ON | 26 | 24 | 2 | ₹96,977.42 | pass — no sandwich (Sat 29 is a working day) |

**No violation found.** The sandwich only ever charges an off-day that sits in a
**contiguous run of off-days with approved leave on both sides**. It never
touches an off-day next to a plain absence (S5), next to a holiday (S6), or with
leave on one side only (S3, S4) — and on paid leave it never touches salary at
all (S1).

> **The trap that will catch testers — S2 vs S7.** For a **Sunday-only**
> employee, leave on Friday and leave on Monday does **not** sandwich the
> Sunday, because **Saturday is a working day** sitting between them: the
> off-run is broken. It only bites when the leave covers Saturday too (a single
> Fri→Mon request — that is PAY-14 U3, LOP 4), or when the employee is on a
> **Sat+Sun** pattern so the two off-days are contiguous (S7, LOP 4). Testing
> Fri+Mon on a Sunday-only employee and reporting "sandwich didn't fire" is a
> false positive — that is the rule working correctly.

#### Negative cases — things that must NOT be credited or charged

A holiday must only be credited when it is genuinely *this employee's* holiday,
and a sandwich must only fire on genuinely approved leave. Both were attacked
directly. Baseline for the Sunday-only rows is ₹1,00,216.67; the Sat+Sun rows
run on a 21-day denominator.

| # | Case | SW | Working | Paid | LOP | Net | Verdict |
|---|---|---|---|---|---|---|---|
| X1 | Holiday belongs to **another holiday group** | off | 26 | 25 | 1 | ₹98,597.05 | pass — not credited |
| X2 | Employee has **no holiday group** at all | off | 26 | 25 | 1 | ₹98,597.05 | pass — no credit, no crash |
| X3 | **Soft-deleted** holiday row | off | 26 | 25 | 1 | ₹98,597.05 | pass — ignored |
| X4 | Holiday dated **outside the cycle** (5 Sep) | off | 26 | 25 | 1 | ₹98,597.05 | pass — irrelevant |
| X5 | **Three duplicate** holiday rows, same date | off | 26 | 26 | 0 | ₹1,00,216.67 | pass — credited **once** |
| X6 | **Recurring** holiday stored under 2020 | off | 26 | 26 | 0 | ₹1,00,216.67 | pass — re-anchored to 2026 |
| X7 | Holiday on a day the employee **was present** | off | 26 | 26 | 0 | ₹1,04,078.93 | pass — paid capped at 26, see note |
| X8 | **Pending** leave both sides of the off-run | ON | 21 | 19 | 2 | ₹96,977.42 | pass — no sandwich |
| X9 | **Rejected** leave both sides | ON | 21 | 19 | 2 | ₹96,977.42 | pass — no sandwich |
| X10 | Approved one side, **pending** the other | ON | 21 | 19 | 2 | ₹96,977.42 | pass — no sandwich |
| X11 | **Paid** leave both sides | ON | 21 | 21 | 0 | ₹1,00,216.67 | pass — salary untouched |
| X12 | Leave both sides, switch **off** | off | 21 | 19 | 2 | ₹96,977.42 | pass — offs stay free |

In X8–X10 the sandwich would have produced **LOP 4** had it fired (2 absent
days + 2 sandwiched off-days). It produced **2** — the two days are charged as
ordinary absence and the weekend stays free. Only `status = Approved` leave can
sandwich; Pending and Rejected cannot, and one approved side is not enough.

> **Reading X10 correctly.** LOP 2 is right, not 1: the Friday is approved
> unpaid leave (1 day) *and* the Monday, whose request is only Pending, is a
> plain unapproved absence (1 more day). Two separate charges, no sandwich.

> **X7 — working on a holiday pays more, not less.** Paid days correctly cap at
> 26 rather than 27, so the holiday is never double-paid. But the net comes out
> **above** baseline (₹1,04,078.93) because the hours worked on the holiday earn
> **overtime**. Same principle as working a weekly off: off-day work is
> compensated through OT, never by inflating paid days. Not a PAY-16 violation —
> the holiday was not treated as absent — but a tester expecting the baseline
> figure should know why the number is higher.

Two mechanics worth knowing when reading these numbers:

- **`paid_days` is restated as `working − lop`** after the sandwich and
  late-mark charges are added ([PayrollService.php:1326](../app/Services/PayrollService.php#L1326)),
  which is why `working = paid + lop` reconciles on every row even though the
  sandwich charge originates outside the working-day denominator. In S9 the
  holiday is first credited as paid and then charged back by the sandwich, so it
  nets to a cost — the `holiday credited as paid` info line and the
  `off-day sandwiched … charged as loss of pay` line both appear on the slip.
- **LOP is capped at the working days** of the cycle, so a sandwich can never
  push an employee below zero paid days.

### PAY-17 · Half-day / short hours — **S2**
- **Expected:** Counted as **0.5** — not rounded to 0 or 1.
- **Fails as:** Half-days silently promoted to full present.

#### Verified end-to-end — the 0.5 arithmetic is exact

Employee #22, Aug 2026, 26 working days. One LOP day = ₹1,619.62, so a half day
= **₹809.81**.

| # | Case | Present | Paid | LOP | LOP amt | Net | Verdict |
|---|---|---|---|---|---|---|---|
| A | Baseline, all full days | 26 | 26 | 0 | ₹0 | ₹1,00,216.67 | reference |
| P1 | **One Half Day** | 25.5 | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | **pass** |
| P2 | Two Half Days | 25 | 25 | 1.0 | ₹1,619.62 | ₹98,597.05 | pass |
| P3 | Three Half Days | 24.5 | 24.5 | 1.5 | ₹2,429.44 | ₹97,787.23 | pass — clean 0.5 steps |
| P4 | Half Day + half **paid** leave, same day | 25.5 | 26 | 0 | ₹0 | ₹1,00,216.67 | pass — halves make a whole |
| P5 | Half Day + half **unpaid** leave, same day | 25.5 | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | pass — only the unpaid half docked |
| P6 | Half Day on a **holiday** | 25.5 | 26 | 0 | ₹0 | ₹1,01,933.23 | pass — holiday covers it, hours earn OT |
| N4 | Half Day with **no punches at all** | 25.5 | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | pass — status is the source of truth |
| N5 | Half Day with **only an IN punch** | 25.5 | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | pass — 0.5 + missing-punch warning |
| N6 | Half Day that is also **late** (10:30 in) | 25.5 | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | pass — not promoted to Late |
| N1 | **Short hours (2h) but status `Present`** | **26** | 26 | 0 | ₹0 | ₹1,00,216.67 | full day — see below |

Never rounded to 0 or 1 in any case, and a half day is not swallowed by the
Late promotion. Invalid status spellings (`half day`, `HALF DAY`) are impossible
to store — a DB `CHECK` constraint on `attendances.status` restricts it to the
twelve valid labels, so the case-sensitive `switch` in `attendanceAggregates()`
can never silently miss one.

#### The gap — a half day is a *status*, never derived from hours

Payroll halves the day **only** when `attendances.status = 'Half Day'`. It never
looks at how long the employee actually worked. Row **N1** is the proof: a
2-hour day stored as `Present` is paid as a **full day**, no LOP, no flag.

And in production **nothing ever writes that status**:

- Face clock-in / clock-out → `AttendancePunchService` writes `'Present'`
  ([AttendancePunchService.php:58](../app/Services/AttendancePunchService.php#L58)).
- eSSL device import → same path, `'Present'`.
- `resolveDayStatus()` only ever promotes `Present → Late`; it has no
  short-hours branch ([AttendanceController.php:946](../app/Http/Controllers/Api/AttendanceController.php#L946)).
- The only writer of `'Half Day'` in the whole codebase is the **dev seeder**,
  `AttendanceTestController`.

So the half-day *calculation* was correct and exact, but a half day could only
arise if someone set the status by hand.

#### Now implemented — the short-hours policy

The "short hours" half of this scenario is now a per-branch rule,
`branches.short_hours_policy`, alongside the late-mark and LOP policies:

```
worked < absent_below    → 0    (day not credited)
worked < half_day_below  → 0.5  (half day)
otherwise                → full credit, as before
```

Defaults: **`enabled = false`**, `half_day_below = 4h`, `absent_below = 0`
(absent tier off). Nothing changes until an admin switches it on. Hours are
measured from **completed in→out punch pairs**, so a long lunch is not counted
as time worked; a day with no usable pairs falls back to the first-in →
last-out span, and a day that cannot be measured at all is left alone.

The demotion is applied where the day earns its credit
([PayrollService.php](../app/Services/PayrollService.php)), so present days,
paid days, LOP and the per-date leave reconciliation all see one consistent
number. Each demoted day is named on the slip with the hours actually worked —
`2 day(s) short of this branch's 4h minimum: 12 Aug (2h → 0.5 day), …` — because
this is pay coming off a threshold the employee cannot see on their clock-in
screen, and HR has to be able to check it day by day.

| # | Case | Policy | Present | LOP | LOP amt | Net | Warned | Verdict |
|---|---|---|---|---|---|---|---|---|
| A0 | 9h day | never configured | 26 | 0 | ₹0 | ₹1,00,216.67 | — | reference |
| A1 | **2h day** | never configured | 26 | 0 | ₹0 | ₹1,00,216.67 | — | **full day — old behaviour preserved** |
| A2 | 2h day | present but disabled | 26 | 0 | ₹0 | ₹1,00,216.67 | — | switch respected |
| P1 | **2h day** | on, half < 4h | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | yes | **half day** |
| P2 | 3h59m day | on | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | yes | just under the line |
| P3 | **exactly 4h** | on | 26 | 0 | ₹0 | ₹1,00,216.67 | — | full — boundary exclusive |
| P4 | 4h01m | on | 26 | 0 | ₹0 | ₹1,00,216.67 | — | full |
| P5 | 6h span, **3h worked** (3h lunch) | on | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | yes | breaks excluded |
| P6 | 1h day | on, absent < 2h | 25 | **1** | ₹1,619.62 | ₹98,597.05 | yes | absent tier |
| P7 | 3h day | on, absent < 2h | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | yes | above absent, below half |
| P8 | 2h **late** day | on | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | yes | late promotion still applies |
| N1 | Explicit **Half Day**, 4h | on | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | — | stays 0.5, never halved twice |
| N2 | Explicit **Half Day**, 2h | on | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | — | not demoted to 0.25 |
| N3 | **Missing OUT punch** | on | 26 | 0 | ₹0 | ₹1,00,216.67 | — | unmeasurable, never guessed |
| N4 | No punch rows, 9h header span | on | 26 | 0 | ₹0 | ₹1,00,216.67 | — | span fallback |
| N5 | No punch rows, 2h header span | on | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | yes | span fallback measures |
| N6 | **Garbage** thresholds (−5 / 99) | on | 26 | 0 | ₹0 | ₹1,00,216.67 | — | clamped, no crash |

17/17. The boundary is **exclusive** — exactly 4h is a full day, 3h59m is half.
N3 is the important safety case: a day missing one side of its punch pair cannot
be measured, so it is never demoted; docking pay on unmeasurable data would turn
a data-quality problem into a pay cut, and those days already raise their own
missing-punch warning.

**Regression:** every prior scenario re-run unchanged — PAY-13 (12 cases),
PAY-14 (13), PAY-15 (11), PAY-17 base (11) and the Group-3 sweep (7). The
policy being disabled by default is what guarantees that.

### PAY-18 · Late marks crossing the threshold — **S2**
- **Precondition:** Employee has late marks either side of the configured threshold.
- **Expected:** LOP accrues **only** on completed blocks (e.g. every 3 late marks
  = half day). Under the threshold, no deduction — and the payslip still explains
  why nothing was deducted.
- **Fails as:** Deduction on the very first late mark, or a non-zero late count
  with no explanation anywhere on the slip.
- **Verified both sides of the branch's 3-late threshold.** Two late marks →
  no deduction, and the slip still says why:
  `2 late mark(s) — under this branch's threshold of 3, no pay deducted.`
  Three → exactly 0.5 day LOP (₹809.81) and **Pending Review**, with the rule
  spelled out. Note the half day comes off **paid days** as well (26 → 25.5),
  so `working = paid + lop` still reconciles.

#### Verified end-to-end — full tally sheet

Employee #22, Aug 2026, shift starts **09:30** with a **10-minute grace**, 26
working days. One LOP day ₹1,619.62, half ₹809.81, baseline net ₹1,00,216.67.
Policy is per branch (`branches.late_mark_policy`: `enabled`, `count`,
`deduction`).

**The threshold ladder** — default policy, every 3 late marks = half a day.
LOP accrues once per **completed** block, never part-way through one:

| # | Late marks | Paid | LOP | LOP amt | Net | Slip status |
|---|---|---|---|---|---|---|
| A | 0 | 26 | 0 | ₹0 | ₹1,00,216.67 | Ready |
| B | **1** | 26 | **0** | ₹0 | ₹1,00,216.67 | Ready |
| C | **2** | 26 | **0** | ₹0 | ₹1,00,216.67 | Ready |
| D | **3** | 25.5 | **0.5** | ₹809.81 | ₹99,406.86 | Pending Review |
| E | 4 | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | Pending Review |
| F | 5 | 25.5 | 0.5 | ₹809.81 | ₹99,406.86 | Pending Review |
| G | **6** | 25 | **1.0** | ₹1,619.62 | ₹98,597.05 | Pending Review |
| H | **9** | 24.5 | **1.5** | ₹2,429.44 | ₹97,787.23 | Pending Review |

**Other configured policies:**

| # | Case | Late | LOP | Net | Verdict |
|---|---|---|---|---|---|
| I | 4 late · count **5** / full day | 4 | 0 | ₹1,00,216.67 | pass — under a 5 threshold |
| J | 5 late · count 5 / **full day** | 5 | **1.0** | ₹98,597.05 | pass — a whole day, not half |
| K | 10 late · count 5 / full day | 10 | 2.0 | ₹96,977.42 | pass — two blocks |
| L | 1 late · count **1** / half day | 1 | 0.5 | ₹99,406.86 | pass — every late costs |
| M | 3 late · policy **disabled** | 3 | **0** | ₹1,00,216.67 | pass — switch respected |
| N | 3 late · **never configured** | 3 | 0.5 | ₹99,406.86 | pass — legacy 3 / half default |

**Negative cases — the grace window and things that are not late:**

| # | Case | Late | LOP | Net | Verdict |
|---|---|---|---|---|---|
| X1 | In at **09:40** (exactly 10 min) ×3 | **0** | 0 | ₹1,00,216.67 | pass — grace edge is not late |
| X2 | In at **09:41** ×3 | **3** | 0.5 | ₹99,406.86 | pass — one minute past grace is |
| X3 | In **early** at 09:00 ×3 | 0 | 0 | ₹1,00,216.67 | pass |
| X4 | Policy saved with **count 0** | 3 | **0** | ₹1,00,216.67 | **fixed** — treated as off, was 1.5 |
| X5 | 3 late **+ 3 unpaid leave days** | 3 | **3.5** | ₹94,547.99 | pass — charges stack, not merge |
| X6 | Late in-punch on a **Half Day** ×3 | **3** | **2.0** | ₹96,977.42 | **fixed** — was 0 late / 1.5 |

Every case carries an explanation on the slip, both when it deducts
(`6 late marks → 1 day LOP (branch rule: every 3 late marks = half day; verify
hours covered before approving)`) and when it deliberately does not
(`2 late mark(s) — under this branch's threshold of 3, no pay deducted.` /
`…this branch does not deduct pay for late marks.`). A non-zero late count with
a zero deduction is never left unexplained.

#### Two defects found here — both now fixed

**X4 · a `count` of 0 used to *maximise* the rule instead of disabling it.**
Zero was clamped up to 1 (a 0 block size would divide the month into infinite
deductions), so a branch saved with `count: 0` charged on **every single late
mark** — the harshest possible setting, reached by typing the value that most
obviously means "don't deduct". Nobody enters 0 intending constant deductions.
An unusable count (0 or negative) now switches the rule **off** instead, which
is both the safer failure and the obvious reading: X4 went from 1.5 LOP
(₹97,787.23) to **0 LOP, full pay**. The upper clamp of 31 is unchanged, and an
invalid `deduction` value still falls back to `half_day`.

**X6 · a Half Day never accrued a late mark.** The Present → Late promotion only
ran on rows whose status was `Present`, so an employee who turned up at 10:30
and worked a half day recorded **0 late marks** and the slip carried no
late-mark line at all — arriving late was free as long as the day was short.
The promotion now evaluates arrival time for `Half Day` rows too. The day's
**credit is untouched at 0.5**; only the late count changes, and that still
costs nothing until the branch threshold is reached. X6 (three late half days)
went from 0 late / 1.5 LOP to **3 late / 2.0 LOP** — the 1.5 for the halves plus
0.5 for the completed late block.

Neither fix moves any other row: all 20 PAY-18 cases, PAY-13 (12), PAY-15 (11),
PAY-17 (11 + 17 short-hours) and the Group-3 sweep re-run unchanged. A single
late half day still costs nothing (1 late mark is under the threshold of 3) —
only an employee doing it repeatedly now reaches the block.

### PAY-19 · Missing punch / incomplete attendance — **S2**
- **Precondition:** A day with an in-punch but no out-punch.
- **Expected:** Flagged for review before approval; not silently treated as a
  full present day **or** a full absence.
- **Fails as:** Day counted as fully present, so the error never surfaces.

#### Verified end-to-end — detection

Employee #22, Aug 2026, 26 working days, baseline net ₹1,00,216.67. `Miss` is
the payslip's `missing_punches` column; `Flag` is whether the slip carries the
`N day(s) with a missing punch — verify attendance before approving` line.

| # | Case | Miss | Present | LOP | Net | Flag | Slip status |
|---|---|---|---|---|---|---|---|
| A | Baseline, every punch complete | 0 | 26 | 0 | ₹1,00,216.67 | — | Ready |
| P1 | **One missing OUT punch** | 1 | 26 | 0 | ₹1,00,216.67 | yes | **Pending Review** |
| P2 | One missing IN punch | 1 | 26 | 0 | ₹1,00,216.67 | yes | Pending Review |
| P3 | Three missing OUT punches | 3 | 26 | 0 | ₹1,00,216.67 | yes | Pending Review |
| P4 | Explicit status `Missing Out` | 1 | 26 | 0 | ₹1,00,216.67 | yes | Pending Review |
| P5 | Explicit status `Missing In` | 1 | 26 | 0 | ₹1,00,216.67 | yes | Pending Review |
| P6 | Missing punch on a **Half Day** | 1 | 25.5 | 0.5 | ₹99,406.86 | yes | Pending Review |
| P7 | Missing punch, otherwise perfect month | 1 | 26 | 0 | ₹1,00,216.67 | yes | Pending Review |
| N1 | **No attendance row at all** | 0 | 25 | 1 | ₹98,597.05 | — | Ready |
| N2 | Day covered by approved **paid leave** | 0 | 25 | 0 | ₹1,00,216.67 | — | Ready |
| N3 | `Absent` status, no timestamps | 0 | 25 | 1 | ₹98,597.05 | — | Ready |
| N4 | One-sided punch on a **weekly off** | 1 | 27 | 0 | ₹1,00,216.67 | yes | Pending Review |

The behaviour is exactly right on both sides: an incomplete punch is **paid in
full and flagged**, never silently docked (P7) and never silently swallowed. A
genuine absence, an approved leave and an explicit `Absent` are all *complete*
information and correctly raise nothing (N1–N3). Note N4: an off-day punch is
not payable — paid days stay 26 — but it still counts as an incomplete record
worth flagging.

#### Was broken — now fixed (S2): the flag did not gate approval

The flag was raised and then **had no effect on the one decision it exists to
gate**. `PayrollController::approve()` checked only that the run existed, was
unlocked and had employees; it never looked at payslip statuses. A payslip PDF
was already blocked while `On Hold` / `Pending Review`, and bulk download
excluded them — but the run carrying them could be approved outright, which is
what actually moves money.

Approval now stops on unresolved slips:

| # | Case | HTTP | Run after | Message |
|---|---|---|---|---|
| G1 | Clean run → approve | **200** | approved | `Payroll approved.` |
| G2 | **Missing punch → approve** | **422** | **generated** | `Payroll not approved — 1 pending review. Correct the attendance or salary data and regenerate, or re-send with acknowledge_unresolved…` |
| G3 | Missing punch → approve **with acknowledgement** | 200 | approved | `Payroll approved with 1 unresolved slip(s) acknowledged.` |
| G4 | Clean run, acknowledgement flag passed anyway | 200 | approved | `Payroll approved.` |

The 422 response names the employees (`data.employees`, up to 25) with each
one's status, so HR goes straight to them instead of hunting the payslip list
for whatever tripped the flag. G4 matters too: passing the flag on a clean run
produces no false "acknowledged" noise.

**Deliberately not a hard block.** Some warnings cannot be corrected away — an
employee who was genuinely late three times leaves a slip that reads Pending
Review no matter how often it is regenerated, and there is no endpoint to clear
a slip's status by hand. A hard block would leave those runs unapprovable
forever. So approval stops **once**, states exactly what is unresolved, and
proceeds only on an explicit `acknowledge_unresolved` — with who acknowledged it
and which employees they waved through written into the audit log.

> **For testers:** the gate counts every unresolved slip in the run, not just
> the employee you are testing. An employee with no attendance at all is itself
> a Pending Review case (PAY-20), so a run where only one person has been seeded
> will block on everybody else. Seed the whole roster before testing G1.

### PAY-20 · Zero attendance for the whole cycle — **S1**
- **Precondition:** An eligible employee with no attendance rows at all.
- **Expected:** Full LOP **and** prominently flagged — this is nearly always a
  data problem, not a genuinely absent employee.
- **Fails as:** Quietly paid a full month, or quietly paid ₹0 with no warning.
- **Was broken — now fixed.** An employee with zero attendance rows was charged
  26 LOP days and then handed a payslip marked **Ready** with a net of
  **₹58,106.45** and *no warning of any kind*. The existing zero-net check never
  fired, because LOP is capped at the pro-rated basic — so a full month of
  absence still leaves every allowance payable and the net looks healthy.
  A payroll run with a dead attendance sync would have been approved on sight.
  There is now a warning (`No attendance recorded at all this cycle — 26 day(s)
  charged as loss of pay…`) which also drops the slip to **Pending Review**.
  Deliberately a warning, not a hold: tenants that do not track attendance at
  all would otherwise have every payslip blocked.

#### Verified end-to-end — full tally sheet

Employee #22, Aug 2026, gross ₹1,00,416.67, basic ₹50,208.34, 26 working days.
`Zero?` is whether the slip carries the zero-attendance warning.

| # | Case | Work | Present | Paid | LOP | LOP amt | Net | Zero? | Status |
|---|---|---|---|---|---|---|---|---|---|
| Z1 | **No attendance at all** · default policy | 26 | 0 | 0 | 26 | ₹42,110.22 | ₹58,106.45 | yes | Pending Review |
| Z2 | Same · LOP `basic ÷ working` | 26 | 0 | 0 | 26 | ₹50,208.34 | ₹50,008.33 | yes | Pending Review |
| Z3 | Same · LOP `gross ÷ working` | 26 | 0 | 0 | 26 | ₹50,208.34 | ₹50,008.33 | yes | Pending Review |
| Z4 | No attendance, whole month **paid leave** | 26 | 0 | 26 | 0 | ₹0 | ₹1,00,216.67 | — | Ready |
| Z5 | No attendance, whole month **unpaid leave** | 26 | 0 | 0 | 26 | ₹42,110.22 | ₹58,106.45 | yes | Pending Review |
| Z6 | No attendance **+ 2 holidays** | 26 | 0 | 2 | 24 | ₹38,870.97 | ₹61,345.70 | yes | Pending Review |
| Z7 | No attendance, **joined mid-cycle** (17 Aug) | 13 | 0 | 0 | 13 | ₹21,055.11 | ₹27,333.60 | yes | Pending Review |
| N1 | **Exactly one day present** | 26 | 1 | 1 | 25 | ₹40,490.60 | ₹59,726.07 | — | Ready |
| N2 | Punches on **weekly offs only** | 26 | 3 | 0 | 26 | ₹42,110.22 | ₹69,693.23 | yes | Pending Review |
| N3 | **One row, status `Absent`** | 26 | 0 | 0 | 26 | ₹42,110.22 | ₹58,106.45 | yes | Pending Review |
| N4 | Full attendance (control) | 26 | 26 | 26 | 0 | ₹0 | ₹1,00,216.67 | — | Ready |

LOP follows the branch policy (Z1–Z3) and the active window for a mid-cycle
joiner (Z7 — 13 working days, not 26). A single attended day is correctly *not*
the zero-attendance case (N1), and a fully paid-leave month raises nothing (Z4).

#### Was broken — now fixed (S1): one meaningless row switched the flag off

The check asked *"does the attendance table have zero rows for this employee?"*
(`$att['rows'] === 0 && $paidDays <= 0`) rather than *"did they do any work?"*.
Any row at all — even one that pays for nothing — silently disabled the warning
while the employee stayed fully docked. Three real shapes slipped through,
each reading **Ready** with a five-figure deduction and nothing on the slip:

| Case | Before | After |
|---|---|---|
| Z6 · a **public holiday** in the cycle | Ready, no flag (holiday pushed paid days above 0) | **Pending Review, flagged** |
| N2 · punches on **weekly offs only** | Ready, no flag ("rows exist") | **Pending Review, flagged** |
| N3 · a single **`Absent`** row | Ready, no flag | **Pending Review, flagged** |

N3 is the worst of the three: an `Absent` marker is exactly what a failed import
tends to leave behind, so the one case most likely to be a broken sync was the
one most reliably hidden. The test is now work credit earned on the employee's
own working dates, with `lop_days > 0` so a legitimately fully-covered month
(all approved paid leave, Z4) is not flagged as a data problem. Where an
approved **unpaid** leave covers the cycle the wording changes accordingly —
`…Covered by approved unpaid leave; confirm that is correct before approving.`
— instead of sending HR hunting for a device fault that isn't there.

#### Two things to know about the money

- **LOP is capped at the pro-rated basic**, always. Z2 and Z3 charge very
  different per-day rates (₹1,931.09 and ₹3,862.18) yet land on the *same*
  ₹50,208.34, because the cap bites first. So an employee who never attends
  cannot be docked below **gross − basic − PT**: the entire allowance half of
  the salary is paid regardless of policy. On this salary that is a floor of
  **₹50,008.33** for a month of zero attendance.
- **N2 pays *more*, not less.** Punching three Sundays and no working days
  gives 26 LOP days *and* overtime for the Sunday hours — net ₹69,693.23,
  ₹11,586.78 above the plain zero-attendance case. Off-day work is compensated
  as OT and never offsets loss of pay (the same rule as PAY-14/PAY-16). Correct,
  but it is the one shape where a fully-absent employee out-earns another.

---

## Group 4 — Overtime

> **Verified end-to-end.** Shift 09:30–18:30 (9 h), basic ₹50,208.34, 26 working
> days, OT policy "Double Time" (×2). Hourly = 50,208.34 ÷ 26 ÷ 9 = **₹214.57**,
> effective **₹429.14/h**. OT is detected from attendance — no approval step.
>
> | Case | Hours | OT amount | Gross | Net |
> |---|---|---|---|---|
> | PAY-21 · 3 h past shift end | 3.00 | ₹1,287.42 | ₹1,01,704.09 | ₹1,01,504.09 |
> | PAY-24 · 2.5 h | 2.50 | ₹1,072.85 | ₹1,01,489.52 | ₹1,01,289.52 |
> | PAY-25 · none | 0 | ₹0 | ₹1,00,416.67 | ₹1,00,216.67 — **no OT line at all** |
> | PAY-23 · full shift on a Sunday | 12.00 | ₹5,149.68 | ₹1,05,566.35 | ₹1,05,366.35 |
>
> OT is added to gross **and** carried into net; 2.5 h is not truncated; and a
> zero-OT payslip has no OT earning row.

### PAY-21 · OT on a normal working day — **S1**
- **Precondition:** 3 approved OT hours on an ordinary working day.
- **Expected:** OT amount = configured rate × 3.
- **Fails as:** Rate applied per day instead of per hour, or OT added to gross
  but omitted from net.

#### Verified end-to-end — full tally sheet

Employee #22, Aug 2026, basic ₹50,208.34, 26 working days, 9 h shift
(09:30–18:30). `hourly = 50,208.34 ÷ 26 ÷ 9 = ₹214.57`, rounded to paise before
the multiplier. Baseline net (no OT) ₹1,00,216.67. Rate names come from the
**Overtime Rate master** (`master_overtime_rates`) via the employee's
*Overtime* field.

| # | Case | Hours | OT amount | Rate/hr | Mult | Rate name | Net |
|---|---|---|---|---|---|---|---|
| A | Baseline — no overtime | 0 | ₹0 | — | — | — | ₹1,00,216.67 |
| O1 | **2 h OT · Double Time ×2** | 2 | **₹858.28** | ₹429.14 | 2 | Double Time | ₹1,01,074.95 |
| O2 | 1 h OT | 1 | ₹429.14 | ₹429.14 | 2 | Double Time | ₹1,00,645.81 |
| O3 | 2 h OT on three days | 6 | ₹2,574.84 | ₹429.14 | 2 | Double Time | ₹1,02,791.51 |
| O4 | 2 h OT · **Time and a Half ×1.5** | 2 | ₹643.71 | ₹321.86 | 1.5 | Time and a Half | ₹1,00,860.38 |
| O5 | 2 h OT · **Regular Time ×1.0** | 2 | ₹429.14 | ₹214.57 | 1 | Regular Time | ₹1,00,645.81 |
| O6 | 2 h OT · **Triple Time ×3.0** | 2 | ₹1,287.42 | ₹643.71 | 3 | Triple Time | ₹1,01,504.09 |
| O7 | **Approved OT row** overrides detection | 5 | ₹2,145.70 | ₹429.14 | 2 | Double Time | ₹1,02,362.37 |
| N1 | Leaves **exactly** at 18:30 | 0 | ₹0 | — | — | — | ₹1,00,216.67 |
| N2 | Leaves **10 minutes** past 18:30 | 0.17 | ₹72.95 | ₹429.14 | 2 | Double Time | ₹1,00,289.62 |
| N3 | Overtime **not applicable** to employee | 0 | ₹0 | — | — | — | ₹1,00,216.67 |
| N4 | OT rate name **not in the master** | 2 | ₹429.14 | ₹214.57 | 1 | — | ₹1,00,645.81 |
| N5 | 06:00 → 23:59 on one day | 5.48 | ₹2,351.69 | ₹429.14 | 2 | Double Time | ₹1,02,568.36 |
| N6 | **Missing OUT punch** on the OT day | 0 | ₹0 | — | — | — | ₹1,00,216.67 |
| N7 | Late stay on an **`Absent`** day | 0 | ₹0 | — | — | — | ₹98,597.05 |
| N8 | Arrives **2 h early**, leaves on time | 0 | ₹0 | — | — | — | ₹1,00,216.67 |

The rate is applied **per hour, not per day** (O1 vs O2 vs O3 scale linearly),
every multiplier resolves from the master (O4–O6), and the OT lands in **net**,
not just gross. Two paths feed it: an **approved** `payroll_adjustments` row of
type `overtime` wins outright (O7 — 5 approved hours paid even though attendance
showed 2), otherwise the hours are derived from attendance and paid with an info
line spelling out the arithmetic.

Reading N5 correctly: on a **normal working day** OT is the stretch past the
shift end only, so 06:00 → 23:59 yields 5.48 h (18:30 → 23:59), not 8.98 h. The
early hours are not OT (N8 confirms this in isolation). The 12 h/day cap
therefore does not bite here — it applies to rest days, where the *whole* worked
stretch counts (PAY-23).

#### Was broken — now fixed (S1): a dead OT rate silently halved overtime

An employee assigned an OT rate that no longer resolves against the master —
renamed, deactivated, deleted, or scoped to another tenant — has the multiplier
fall back to **1×**. On a "Double Time" employee that is **half** the overtime
they were promised. It was disclosed only as an `info` line, so the slip stayed
**Ready** and the run sailed through: deactivating a single master row could
quietly halve overtime for everyone on it, with nothing to show for it.

It now raises a **warning**, so the slip drops to **Pending Review**:

```
Overtime rate "Quadruple Time" is not an active rate in the Overtime Rate
master — overtime paid at 1× hourly instead. Fix the rate or the employee's
overtime setting before approving.
```

N4's money is unchanged (₹429.14 at 1×) — this is about the run no longer
being approvable without someone seeing it. Note the OT is still *paid*, rather
than withheld, so a mis-set master row never costs the employee the hours
outright.

> **N2 — there is no minimum OT threshold.** Ten minutes past the shift end
> earns 0.17 h (₹72.95), and it is paid automatically from attendance. Many
> policies require a minimum block (15 or 30 minutes) before OT accrues; this
> one has none, so anyone who lingers past 18:30 accrues OT every day. Not a
> defect against the stated rule, but confirm it is what the business wants —
> it is the kind of thing that shows up as unexplained OT drift across a large
> roster.

### PAY-22 · OT base is the eligible/overall amount — **S1**
- **Precondition:** Employee has Basic + allowances + other eligible components.
- **Expected:** OT computed on the **configured base**, not on Basic alone.
- **Fails as:** OT visibly low because only Basic fed the hourly rate.
  *Verify by hand for at least one employee — this one is invisible unless you
  recompute it yourself.*
- **Configured base (as implemented): BASIC only, deliberately.**
  `overtimeRate()` prices OT as `basic ÷ period working days ÷ shift hours ×
  multiplier`, documented as the statutory "ordinary rate of wages" basis —
  allowances compensate for costs that do not scale with an extra hour. Hand-
  checked: ₹50,208.34 ÷ 26 ÷ 9 = ₹214.57/h × 2 = ₹429.14/h, and 3 h paid exactly
  ₹1,287.42. **This is a policy decision, not a bug** — but if your OT policy
  says the base is gross or "eligible components", the figures above are all
  ~50% low and it needs a config option.

### PAY-23 · OT on a holiday or weekly off — **S2**
- **Expected:** Holiday/weekend multiplier applied instead of the normal rate,
  if configured.
- **Fails as:** Normal rate applied on a holiday, or the holiday is treated as a
  non-working day so the OT is dropped entirely.
- **Was broken — now fixed.** An employee who worked a **full 12-hour Sunday**
  was paid overtime for only the 3 hours that happened to fall past 18:30 — the
  shift-length stretch before that earned nothing, because rest days were being
  measured against a shift end that does not apply to them. A weekly off or a
  holiday is now treated as a rest day: **every hour worked on it is overtime**
  (12 h → ₹5,149.68 instead of 3 h → ₹1,287.42). The payslip note names the
  basis (`worked on weekly offs / holidays (every hour counts)`) so the figure
  is not mistaken for a shift-end calculation.
- **Still not implemented:** there is no separate *holiday* multiplier. Rest-day
  hours are paid at the same OT rate as weekday hours (₹429.14/h here). If the
  business wants a higher weekend/holiday rate, that is a feature request.

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
- **Verified — two different outcomes, know which you are testing:**
  - No structure **and** no annual salary → **On Hold**, hold reason
    `Missing salary structure`, ₹0, blocking exception. Correct.
  - No structure **but** an annual salary on the employee → **paid**, from a
    derived 50/30/20 split (₹1,00,416.67 here), flagged **Pending Review** with
    `No salary structure on file — auto-derived from annual salary`. Deliberate
    fallback, but it means a half-configured employee **can be paid without any
    approved structure** — worth a ticket if your process requires one.

#### Verified end-to-end — full tally sheet

Employee #22, Aug 2026, full attendance in every case so the structure is the
only variable.

| # | Case | Gross | Net | Status | Hold reason |
|---|---|---|---|---|---|
| S1 | **No structure, no annual salary** | ₹0 | ₹0 | **On Hold** | Missing salary structure |
| S2 | Only a **draft** structure | ₹0 | ₹0 | **On Hold** | Salary structure is still a draft |
| S3 | Structure effective **after** the cycle | ₹0 | ₹0 | **On Hold** | Salary structure not yet effective |
| S4 | Structure with **zero gross** | ₹0 | ₹0 | **On Hold** | Salary structure has no value |
| S5 | Active structure (control) | ₹1,00,416.67 | ₹1,00,216.67 | Ready | — |
| S6 | **Superseded** version still in force | ₹1,00,416.67 | ₹1,00,216.67 | Ready | — |
| S7 | Superseded + **future** active revision | ₹1,00,416.67 | ₹1,00,216.67 | Ready | — |
| S8 | Two versions, later one in force | ₹1,00,416.67 | ₹1,00,216.67 | Ready | — |
| S9 | No structure but **annual salary** set | ₹1,00,416.67 | ₹1,00,216.67 | Pending Review | — |
| S10 | Draft structure **+ annual salary** | ₹1,00,416.67 | ₹1,00,216.67 | Pending Review | — |
| S11 | Annual salary of **zero** | ₹0 | ₹0 | **On Hold** | Missing salary structure |

S6–S8 are the version-resolution cases and all behave: payroll uses the version
**in force on the cycle's dates**, so a `superseded` row still pays when it is
the one that was current (S6), and a future-dated revision never leaks back into
an earlier cycle (S7).

**The hold really holds.** End-to-end through `finalizeAttendance()` →
`generate()`: the held employee gets `status = On Hold`, `net = ₹0`, a blocking
exception, and is excluded from the run's payable total. Approval then stops on
them — `Payroll not approved — 1 on hold` (`data.on_hold = 1`), run left at
`generated` (see the PAY-19 approval gate).

#### Improved — the reason now names the actual cause

All four hold cases used to report the same thing: `Missing salary structure` /
`No active salary structure or salary on file`. In three of the four a structure
**does** exist — it is a draft, it is future-dated, or it is priced at ₹0 — so
the message sent HR looking for something that was already there. The reason now
identifies which:

| Cause | Hold reason | Detail on the slip |
|---|---|---|
| Nothing on file | `Missing salary structure` | No salary structure and no annual salary on file — nothing to pay. |
| Draft only | `Salary structure is still a draft` | …saved as a draft — publish it (Active) so payroll can use it. |
| Future-dated | `Salary structure not yet effective` | …starts on 01 Dec 2026, after this cycle ends — no version is in force for Aug 2026. |
| Zero gross | `Salary structure has no value` | …has a monthly gross of ₹0 — set the amounts before running payroll. |

Behaviour is otherwise unchanged: still On Hold, still ₹0, still blocking.

> **The gap to know about (S9/S10):** an employee with **no structure at all**
> but an `annual_salary` on their record is **not held** — payroll derives a
> 50/30/20 split and pays them, flagged Pending Review. A draft structure does
> not change that (S10): the draft is ignored and the annual salary is used. So
> "no active salary structure" only stops payroll when there is no annual salary
> either. Deliberate, but if your process requires an approved structure before
> anyone is paid, this is the hole — and note the employee is paid on a *derived*
> split that may not match their real terms.

### PAY-27 · Salary revision mid-cycle — **S1**
- **Precondition:** ₹40,000 → ₹50,000 effective 15-Aug.
- **Expected:** Old rate for the days before, new rate from the effective date,
  correctly pro-rated. Sum of both parts = expected blended gross.
- **Fails as:** Whole month at one rate (usually the newer), or both structures
  applied in full so gross nearly doubles.
- **Was broken — now fixed.** This failed in exactly the way the line above
  predicts: only the version in force at the **period end** was read, so a
  ₹40,000 → ₹50,000 revision effective 15-Aug paid **₹50,000 for the whole of
  August**. Every mid-cycle raise overpaid, every mid-cycle cut underpaid.
  Structures in force during the cycle are now day-weighted:
  `40,000 × 14/31 + 50,000 × 17/31 = ` **₹45,483.87**, verified to the paisa,
  with each earning line re-weighted the same way (Basic ₹22,741.94 + HRA
  ₹13,645.16 + Special ₹9,096.77). The slip carries an info note naming the
  split: `1 Aug–14 Aug at ₹40,000.00/month (14 day(s)); 15 Aug–31 Aug at
  ₹50,000.00/month (17 day(s))`. PF / ESI / PT applicability flags follow the
  **latest** version — those are terms, not amounts to average.

### PAY-28 · Backdated revision after a run — **S2**
- **Precondition:** Revision dated inside a cycle that is already generated.
- **Expected:** Handled per the arrears rule — either the cycle recomputes, or
  the difference carries to the next cycle as arrears. Not silently ignored.
- **Fails as:** Revision saved, payroll unchanged, no arrears anywhere.

### PAY-29 · Structure with an effective date in the future — **S2**
- **Expected:** Not applied to the current cycle; the currently-active structure is.
- **Fails as:** Future structure applied early.
- **Verified:** a ₹90,000 version dated 1-Oct alongside a live ₹40,000 one →
  the Aug run pays **₹40,000**, untouched by the future version, and no blend
  note appears (nothing was in force during the cycle but the current version).

---

## Group 6 — Deductions & net pay

> **Verified end-to-end** (Aug 2026, present every working day unless stated).
> Every head is its own payslip line — nothing is lumped into "Other".
>
> | Case | Gross | PF | ESI | PT | LOP | Net |
> |---|---|---|---|---|---|---|
> | Wage under the ESI ceiling | ₹18,000 | — | ₹135.00 | ₹200 | — | ₹17,665.00 |
> | Wage above it | ₹1,00,416.67 | — | **₹0** | ₹200 | — | ₹1,00,216.67 |
> | Woman, gross ₹20,000 | ₹20,000 | — | ₹150.00 | **₹0** | — | ₹19,850.00 |
> | PF statutory (₹15k ceiling) | ₹60,000 | **₹1,800.00** | — | ₹200 | — | ₹58,000.00 |
> | PF standard (12% of basic) | ₹60,000 | **₹3,600.00** | — | ₹200 | — | ₹56,200.00 |
> | Joined 16-Aug, PF standard | ₹30,967.74 | ₹1,858.06 | — | ₹200 | — | ₹28,909.68 |
> | No attendance at all | ₹40,000 | — | — | ₹200 | ₹16,774.19 | ₹23,025.81 |
>
> **Eligibility is respected:** ESI stops above the ₹21,000 ceiling, PT is
> waived for a woman under ₹25,000, PF caps at the ₹15,000 EPF wage ceiling on
> `statutory` and rides the full basic on `standard`.
>
> **PAY-31 (pro-rated month):** PF on the 16-Aug joiner is ₹1,858.06 = 12% of
> the **earned** basic (₹15,483.87), not of the full-month basic — deductions
> track the pro-rated earnings rather than the contract figure.
>
> **PAY-32 / PAY-33 invariants held on every payslip generated in this pass:**
> net never negative, paid days never negative, LOP days never exceed working
> days, total deductions never exceed gross.
>
> **PAY-34:** sum of payslip nets = run `total_net` **to the paisa**
> (₹3,24,157.48 = ₹3,24,157.48).
>
> ⚠️ Note: PF is skipped entirely unless the **employee** carries
> `pf_eligible = true` — the structure's `pf_applicable` flag alone is not
> enough. In this tenant only 3 of 13 employees have it set, so a payslip with
> no PF line is usually a data setting, not a calculation bug. Check the
> employee before raising one.

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

#### Verified end-to-end — full tally sheet

Employee #22, Aug 2026, gross ₹1,00,416.67, baseline net ₹1,00,216.67. Advance
recovery is capped at **70% of net-before-recovery** (the same FOI headroom
enforced when an advance is raised), so 70% of ₹1,00,216.67 = **₹70,151.67** is
the most that can ever come off in this month.

| # | Case | Recovery | Total ded | **Net** | Status | Negative? |
|---|---|---|---|---|---|---|
| A | No advance (control) | ₹0 | ₹200 | ₹1,00,216.67 | Ready | no |
| R1 | EMI ₹10,000 — affordable | ₹10,000 | ₹10,200 | ₹90,216.67 | Ready | no |
| R2 | EMI ₹50,000 — half of net | ₹50,000 | ₹50,200 | ₹50,216.67 | Ready | no |
| R3 | **EMI ₹1,00,000 ≈ the whole net** | **₹70,151.67** | ₹70,351.67 | **₹30,065.00** | Pending Review | **no** |
| R4 | **EMI ₹5,00,000 — 5× the net** | ₹70,151.67 | ₹70,351.67 | ₹30,065.00 | Pending Review | **no** |
| R5 | **EMI ₹99,99,999 — absurd** | ₹70,151.67 | ₹70,351.67 | ₹30,065.00 | Pending Review | **no** |
| R6 | EMI ₹50,000 + 13 LOP days | ₹50,000 | ₹71,255.11 | ₹29,161.56 | Ready | no |
| R7 | EMI ₹50,000 + **zero attendance** | ₹40,674.52 | ₹82,984.74 | ₹17,431.93 | Pending Review | no |
| R8 | **Two EMIs** ₹60,000 + ₹60,000 | ₹70,151.67 | ₹70,351.67 | ₹30,065.00 | Pending Review | no |
| R9 | **Three EMIs** ₹40,000 each | ₹70,151.67 | ₹70,351.67 | ₹30,065.00 | Pending Review | no |
| N1 | Recovery starts next month | ₹0 | ₹200 | ₹1,00,216.67 | Ready | no |
| N2 | Advance not HR-approved | ₹0 | ₹200 | ₹1,00,216.67 | Ready | no |

**Net never goes negative in any case**, and the employee always keeps at least
30% of net-before-recovery. R3–R5 all land on the identical ₹30,065.00 no matter
how large the EMI is — the cap, not the EMI, decides. R7 shows the cap tracking
a lean month: on a fully-absent cycle the ceiling drops with earnings
(70% of ₹58,106.45 = ₹40,674.52) rather than eating what little is left.

**The shortfall is carried, not dropped.** The capped cycle warns explicitly:

```
Advance recovery exceeded the 70% FOI headroom this cycle —
₹29,848.33 carried to the next cycle.
```

Recovery is driven by the schedule against the recovery ledger, and the ledger
records what was actually taken — so the unrecovered remainder stays outstanding
and is collected in later cycles rather than being written off. R8/R9 confirm
the allocation order: the **oldest** schedule is satisfied first and the newer
advance carries, instead of both being trimmed to fit.

#### The second path — deductions that are not advances

The FOI cap only governs advance recovery. PF, ESI, PT, TDS, structure
deductions and one-off HR deduction adjustments are not capped by it, so they
were tested separately with a manual `deduction` adjustment:

| Manual deduction | Net | Status | Behaviour |
|---|---|---|---|
| ₹50,000 | ₹50,216.67 | Ready | taken in full |
| ₹1,50,000 | **₹0.00** | Pending Review | floored, warned |
| ₹5,00,000 | **₹0.00** | Pending Review | floored, warned |

```
Deductions exceeded earned pay — net floored to ₹0; carry the balance to the
next cycle.
```

So both routes to a negative net are closed: advance recovery is *capped before
it is applied*, and everything else is *floored at ₹0 after*. **No code change
was needed for this scenario.**

#### Negative / adversarial cases

Corrupt schedules, exhausted advances and months with nothing left to take —
the shapes where a negative net or an over-recovery could actually sneak in.

| # | Case | Recovery | Net | Verdict |
|---|---|---|---|---|
| X1 | **Negative** monthly EMI (−₹10,000) | ₹10,000 | ₹90,216.67 | falls back to amount ÷ months; never adds to net |
| X2 | EMI of **zero** | ₹10,000 | ₹90,216.67 | same fallback, no divide-by-zero |
| X3 | `recovery_months = 0` | ₹0 | ₹1,00,216.67 | no crash — but see the note below |
| X4 | **Negative** advance amount | ₹0 | ₹1,00,216.67 | never pays the employee extra |
| X5 | **Outstanding smaller than the EMI** (₹5,000 left) | **₹5,000** | ₹95,216.67 | trims to the balance, not the EMI |
| X6 | Advance **already fully recovered** | ₹0 | ₹1,00,216.67 | never over-recovers |
| X7 | Ledger **over** the advance amount | ₹0 | ₹1,00,216.67 | no negative recovery (no accidental refund) |
| X8 | **Lump-sum ₹1,20,000** due this cycle | **₹70,151.67** | ₹30,065.00 | capped, not taken whole |
| X8b | **Lump-sum ₹5,00,000** due this cycle | ₹70,151.67 | ₹30,065.00 | capped |
| X9 | **Bi-monthly** due this cycle | ₹20,000 | ₹80,216.67 | recovers on its cadence |
| X9b | Bi-monthly **off-cycle** month | ₹0 | ₹1,00,216.67 | correctly skipped |
| X10 | Schedule already **exhausted** | ₹0 | ₹1,00,216.67 | nothing due |
| X11 | EMI **+ manual deduction that already eats net** | ₹151.67 | **₹65.00** | shrinks to the last of the headroom |
| X12 | EMI on a **held** employee (no structure) | ₹0 | ₹0 | On Hold — nothing taken from a ₹0 slip |

**No negative net and no negative recovery in any case.** X5–X7 are the
over-recovery guards: recovery is always `min(scheduled, outstanding, headroom)`,
so an advance can never be collected past its balance, and a ledger that somehow
holds more than the advance produces zero rather than a refund. X11 is the
tightest squeeze — with only ₹216.67 of net-before-recovery left, the cap
computes to ₹151.67 and takes exactly that, landing on ₹65.00 rather than
overshooting.

> **Two data-integrity notes (not PAY-32 failures).** A negative or zero EMI is
> silently replaced by `amount ÷ months` with nothing on the slip to say the
> stored value was unusable (X1/X2) — safe for pay, but the corrupt figure stays
> in the advance record. And an advance with `recovery_months = 0` but a valid
> EMI recovers **nothing, ever** (X3), so it would sit outstanding forever;
> `AdvanceRequestController` enforces `min:1` for EMI/bi-monthly modes, so this
> is only reachable by direct DB edit or import.

> **One caveat on the floor message.** For advances the carry-forward is real —
> the ledger keeps the outstanding balance. For a one-off **deduction
> adjustment** there is no carry mechanism: the adjustment belongs to that
> month, and the un-taken remainder is simply not collected. Read that message
> as an instruction to HR ("carry the balance yourself next cycle"), not as a
> promise the system will do it. Worth a ticket if you expect an automatic
> carry-forward for manual deductions.

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

> **Verified end-to-end.**
>
> | Scenario | Result |
> |---|---|
> | PAY-35 · generate twice | 8 payslips → 8, **same run id**, 0 duplicate employee rows, totals unchanged |
> | PAY-36 · future cycle | blocked — `Payroll cannot be processed because attendance is not finalized.` |
> | PAY-37 · attendance not finalized | blocked — same message |
> | PAY-38 · locked cycle | blocked — `This payroll period is locked. Adjustments must go to the next cycle.` |
> | PAY-39 · disburse an empty run | no-op: run stays `generated`, `paid_at` stays NULL, nothing marked Paid |
>
> Two things to know:
> - A **future cycle is blocked indirectly**, by the attendance-finalized gate
>   rather than by a date rule of its own. It cannot be run, but if a future
>   period were ever marked attendance-finalized the date alone would not stop it.
> - **PAY-39 is safe but silent.** Disbursing an empty run returns
>   `paid 0, held 0` rather than raising an error, so the UI can read as success
>   while nothing happened. The money state is correct — the cycle is *not*
>   marked paid — but the feedback is worth a UX ticket.

### PAY-35 · Duplicate generation for the same month — **S1**
- **Steps:** Generate the cycle, then generate it again. Also try a rapid
  **double-click** on the run action.
- **Expected:** Either blocked, or a clean regenerate that **replaces** the prior
  payslips. Employee count and totals stay the same.
- **Fails as:** Totals double; two payslip rows per employee.

#### Verified end-to-end — full tally sheet

Aug 2026, period #25, client 1 / branch 2, 13 eligible employees, all present
for the whole cycle.

| Step | Runs | Run id | Payslips | Duplicates | Total net | Outcome |
|---|---|---|---|---|---|---|
| 1st generate | 1 | 159 | 13 | **0** | ₹4,69,584.34 | baseline |
| 2nd generate | 1 | **159** | 13 | **0** | ₹4,69,584.34 | **same run reused** |
| 3rd generate | 1 | **159** | 13 | **0** | ₹4,69,584.34 | same run reused |
| **+5 rapid calls** (8 total) | 1 | **159** | 13 | **0** | ₹4,69,584.34 | still one run |
| Regenerate after 3 days removed | 1 | 159 | 13 | **0** | ₹4,64,725.47 | figures refreshed, emp #22 LOP 3 |

Eight consecutive `generate()` calls produce **one run, 13 payslips, zero
duplicates and unchanged totals**. The period row is locked for update before
the run is read, so a double-click cannot race two runs into existence, and
prior payslips are force-deleted before the rebuild so a regenerate replaces
rather than appends. A regenerate still picks up changed attendance (row 5).

**Three refusal paths, all working:**

| Attempt | Result |
|---|---|
| Generate after the run is **approved** | `Payroll for this period is already approved/paid and cannot be regenerated.` |
| Generate on a **locked period** | `This payroll period is locked. Adjustments must go to the next cycle.` |
| Generate before **attendance is finalized** | `Payroll cannot be processed because attendance is not finalized.` |

#### The dangerous duplicate — two period records for the same month

The nastier shape is not a double-click but a **branch-level and a client-wide
period for the same month**, each generating its own run. Tested in both orders:

| Order | First run | Second run | Payslips total | Paid twice |
|---|---|---|---|---|
| Branch → client-wide | 13 employees | **0 employees** | 13 | **0** |
| Client-wide → branch | 13 employees | **0 employees** | 13 | **0** |

Whichever runs first claims the employees; the second finds them already
covered for that client + month + year and skips them, so nobody receives two
payslips for one month. This holds in both directions, which matters — the
protection would be worthless if it only worked when the branch happened to run
first.

**Disbursement is idempotent too.** Disbursing the same approved run twice pays
`{paid: 13}` then `{paid: 0}` — the second pass finds nothing left to pay rather
than paying everyone again.

**No code change was needed for this scenario.**

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

#### Verified end-to-end — full tally sheet

Employee #22, Aug 2026, 13 employees in the run when everyone is payable. Each
case regenerates the whole run from scratch.

| # | Case | In the run | Net | Run size | Listed in exclusions | Reason shown |
|---|---|---|---|---|---|---|
| A | Active (control) | **yes** | ₹1,00,216.67 | 13 | — | paid |
| P1 | `status = Inactive` | **no** | — | 12 | **yes** | Employee status is Inactive — paid last cycle, not this one… |
| P2 | `status = Resigned` | **no** | — | 12 | **yes** | Employee status is Resigned — … |
| P3 | `status = Terminated` | **no** | — | 12 | **yes** | Employee status is Terminated — … |
| P4 | Payroll switch **off** on the employee | **no** | — | 12 | **yes** | Payroll is switched off on this employee record — no payslip is generated for them. |
| P5 | Exit, last working day **15 Aug** (mid-cycle) | **no** | — | 12 | yes | settled through F&F, not the regular run |
| P6 | Exit, last working day **31 Aug** | **no** | — | 12 | yes | LWD inside the cycle |
| N1 | Exit, last working day **15 Sep** (after the cycle) | **yes** | ₹1,00,216.67 | 13 | — | still employed all month — correctly **paid** |
| N2 | Employee **soft-deleted** mid-cycle | **no** | — | 12 | yes | Employee record was removed/disabled — paid last cycle, not this one… |
| N3 | Onboarding incomplete (stage 4) | **no** | — | 12 | yes | not fully onboarded (PAY-04) |

Every route to "inactive" removes the employee from the current run, and N1 is
the control that matters: an exit dated **after** the period end leaves them in
and fully paid, so the rule keys on the last working day rather than on the mere
existence of an exit record.

**History survives.** `GET /payroll/employee/{id}/payslips` was called for the
same employee in four states:

| Employee state | HTTP | History rows returned |
|---|---|---|
| Active | 200 | 1 |
| Inactive | 200 | 1 |
| Resigned | 200 | 1 |
| Inactive **and soft-deleted** | 200 | 1 |

Prior payslips remain queryable in every state, including after the record is
soft-deleted — deactivating an employee does not erase their payroll history.

**Re-verified 2026-08-13**, every case replayed live against Aug 2026 (period 25,
13 payable) with each mutation rolled back. All rows reproduced as above except
**N2**, which was a genuine silent drop: `EmployeeController::destroy` (the HR
*Remove employee* action) soft-deletes the record and disables the login but
creates **no** exit record and leaves `status = Active`, so none of the exclusion
branches fired — the employee left the run with no panel row at all. Employees
removed through Exit Management were always listed (they carry a last working
day), which is why the first pass missed it. Fixed by adding a `disabledNoExit`
branch in `PayrollService::payrollExclusions()`, bounded by "paid in the previous
cycle" exactly like the status-based rows.

> **Reading the exclusions panel correctly.** The status-based rows
> (P1–P3) are reported **only for an employee who was paid in the previous
> cycle**. That bound is deliberate — without it every person who ever left
> would be re-listed on every future run forever — but it means an employee who
> joins and is deactivated in the *same* month drops out with no panel row.
> Nobody was expecting a payslip for them, so it is not a silent drop in the
> harmful sense, but do not read an empty panel as proof that nothing was
> excluded. Exit-based and payroll-switch exclusions (P4–P6, N2, N3) have no
> such bound and are always listed.

**Re-verified again 2026-08-13 (second pass), exclusions + history + access.**
All nine exclusion cases and the four history states replayed against Aug 2026
(period 25, client 1 / branch 2, 13 payable) and reproduced exactly as tabled
above, each mutation rolled back. The exit-date boundary was re-run separately
and is the part worth keeping in view:

| Last working day | In the run | Run size | Listed |
|---|---|---|---|
| 15 Aug 2026 (mid-cycle) | no | 12 | yes — F&F |
| 31 Aug 2026 (period end) | no | 12 | yes — F&F |
| 15 Sep 2026 (after cycle) | **yes** | 13 | — |
| 20 Jul 2026 (before cycle) | no | 12 | **no** — earlier cycle's business |

The last row is by design, not a silent drop: the relevance gate skips anyone
whose last working day precedes the period start, so a July leaver does not
re-appear on the August panel forever.

**Access control — one real defect found and fixed this pass.** "History stays
available" was true but *unguarded*: `GET /payroll/employee/{id}/payslips` and
`GET /payroll/payslip/{id}` (plus its PDF and email actions) were **tenant-gated
only**, so any logged-in employee could read a colleague's payslip and full
salary history — net pay per cycle — by walking the id in the URL. This is the
PAY-45 promise ("an employee sees **only** their own payslip") failing on the
PAY-47 path. Fixed by adding a self-guard for the employee tier in
`PayrollController::ownsRow()` and in `employeePayslips()`. Verified per tier:

| Caller | Own payslip | Colleague's payslip | Own history | Colleague's history |
|---|---|---|---|---|
| Employee | 200 | **404** | 200 | **403** |
| Client admin | 200 | 200 | 200 | 200 |
| Other-tenant admin | 404 | 404 | 200 `{"data":[]}` | 200 `{"data":[]}` |

HR/admin access is unchanged. The foreign-tenant 200 is an empty payload, not a
leak, so it was left as-is rather than converted to a 404.

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
| PAY-04b | Payroll switched off on employee | S1 | | | |
| PAY-04c | Resigned status, no exit record | S2 | | | |
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
| PAY-45 | Unauthorised access | S1 | Partial | — | Payslip-read leg only (found via PAY-47): employee tier could read any colleague's payslip + salary history by id — fixed & re-verified. Run/approve legs still untested |
| PAY-46 | Historical immutability | S1 | | | |
| PAY-47 | Inactive employee history | S2 | Pass | — | Verified end-to-end twice (9 exclusion cases + 4 exit-date boundaries + history in 4 states); 2 fixes: `disabledNoExit` exclusion row, payslip/history self-guard |
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
