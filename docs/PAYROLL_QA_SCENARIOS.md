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
| G2 | Paid leave over present days **+ 3 unrelated absences** | 26 | 26 | 0 | 3 | 0 | ₹1,00,216.67 | **Pending Review** | see the fix below |
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

**Was broken — now fixed (S1).** Row **G2** is the real hole. An employee
present 23 days, with **3 days that had no attendance row and no leave request**,
plus an approved 3-day paid leave filed over dates they were *already* marked
present, came out at **26 paid days, 0 LOP and a full month's salary** — the
`min()` ceiling on paid days absorbed the double credit, and the three genuine
absences were paid for with nothing anywhere on the slip. The unpaid side
already reported its version of this; the paid side did not. Payroll now
compares the leave dates against the attendance dates and raises a warning —
`N day(s) counted twice — attendance marks the employee present on dates their
approved paid leave also covers…` — which pushes the slip to **Pending Review**
so HR reconciles before approving. The money is deliberately left unchanged:
either side can be the wrong one (a duplicate leave request or a bad punch), so
it is HR's call, not the engine's. A legitimate half-present + half-paid-leave
day (row D2) totals exactly one day and is **not** flagged.

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
- **Verified both sides of the branch's 3-late threshold.** Two late marks →
  no deduction, and the slip still says why:
  `2 late mark(s) — under this branch's threshold of 3, no pay deducted.`
  Three → exactly 0.5 day LOP (₹809.81) and **Pending Review**, with the rule
  spelled out. Note the half day comes off **paid days** as well (26 → 25.5),
  so `working = paid + lop` still reconciles.

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
