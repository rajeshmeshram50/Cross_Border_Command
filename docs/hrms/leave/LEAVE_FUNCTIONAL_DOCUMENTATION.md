# LEAVE MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Leave

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |
| 2.0 | 2026-09-08 | System | Sandwich Leave Policy and its waiver, notice-period and probation gates, HR made view-only in the approval chain, plan locking and clone-to-edit, monthly cap, balance enforcement, payroll propagation, RM-unavailable escape. Corrected the accrual model — the full annual quota is granted up front; periodic accrual has been removed. |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose

Leave Management governs time off end to end: HR writes the policy as a **Leave Plan**, attaches **Leave Types** to it and configures each type's quota, application rules and approval chain. Employees are assigned a plan, apply against it, and each request runs a snapshotted approval chain before it lands on attendance and the payslip.

The module is deliberately strict at the point of application. A dozen guards run before a request is accepted — onboarding, probation, notice period, joining date, balance, monthly cap, overlap, tenant — so an unroutable or unpayable request never enters the queue.

### 1.2 Business value

| Benefit | Description |
|---|---|
| Policy as data | Quotas, half-day rules, monthly caps and approval chains are configured, not coded |
| Enforced quotas | The balance check counts approved **and** pending days, so requests cannot be stacked past the quota |
| Correct day counts | Weekly-offs and holidays inside a range are free; a half-day is half a day |
| Sandwich policy | An off-day flanked by leave is charged, per branch, sized identically by the screen and the payslip |
| Straight to payroll | Every approve, reject and cancel recomputes the employee's draft payslips |
| No stalled queues | HR can step in when the reporting manager is unavailable |
| Auditable | The approval chain is snapshotted per request with actor, timestamp and comment on every level |
| Policy stability | A completed plan locks; changes are made by cloning, so in-flight requests keep their rules |

### 1.3 Key features

- **Leave Plans** — per tenant/branch, named, one default, Active/Inactive, cloneable.
- **Leave Types** — Regular / Incident Based / Unpaid, Paid or Unpaid, short code.
- **Per-type setup wizard** — Accrual, Leave Application, Approval.
- **Approval chain** — multi-level, snapshotted at submission, with rule-based level skipping.
- **Balances** — quota, extra allowance, used, available, with a full transaction ledger.
- **Sandwich Leave Policy** — per-branch, with an HR waiver per leave.
- **Guards** — probation, notice period, onboarding, joining date, overlap, monthly cap.
- **HR Leave console** — status tabs with counts, server-side filters, bulk approve/reject, "on leave today" panel.
- **Employee self-service** — request drawer, balance panel, request history, cancel.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Employee | Apply **for themselves only**; view own history and balances; cancel own Pending requests |
| Reporting Manager | Approve / reject their reports' requests — this is the default and usually only chain level |
| HR / Branch Admin | **View** everything in their tenant; cannot approve until the chain reaches them; may step in when the manager is unavailable; may waive the sandwich policy; may cancel |
| Client Admin | Everything HR can do, **plus** filing leave on behalf of an employee |
| Super Admin | All, cross-tenant; the only role that may act out of turn in the chain |

**Two rules override everything else:**

- **Nobody approves their own leave** — not even a super admin acting through the override.
- **HR is view-only in the chain.** Any HR level found in a leave type's saved configuration is stripped when the chain is snapshotted, so a request ends at the reporting manager. HR sees it throughout and can act only through the manager-unavailable escape.

---

## 3. BUSINESS PROCESS FLOW

### 3.1 Setting up the policy

```
   HR creates a LEAVE PLAN                "Leave Plan For HOD"
     - plan name, calendar year, year start (calendar month or joining date)
     - optional: mark as the branch default
        |
        v
   HR assigns LEAVE TYPES to the plan     Casual / Sick / Emergency / Unpaid
        |
        v
   HR configures EACH TYPE (3-section wizard)
     1. Accrual            yearly quota, unlimited, extra allowance
     2. Leave Application  half-day allowed, max per month
     3. Approval           the approval chain
        |
        v
   PLAN LOCKS once every attached type is configured
     - view-only from here; to change it, CLONE the plan and edit the copy
        |
        v
   HR assigns EMPLOYEES to the plan
     - one plan per employee (leave_plan_employees), or stamped on the
       employee record by the onboarding wizard
```

### 3.2 Applying for leave

```
   EMPLOYEE opens Request Leave
        |
        v
   GUARDS, in order - any one refuses the request outright
     |- onboarding not complete            -> blocked
     |- on probation                       -> blocked
     |- serving notice + PAID leave        -> blocked (unpaid is allowed)
     |- from_date in the past              -> blocked
     |- from_date before joining date      -> blocked
     |- today, and not second-half only    -> blocked (self-service only)
     |- half-day spanning several days     -> blocked
     |- to_date more than a year out       -> blocked
     |- overlaps an existing Pending/Approved request -> blocked
     |- cover person / notify outside tenant -> blocked
     |- no leave plan assigned             -> blocked
     |- type not in the assigned plan      -> blocked
     |- half-day on a type that forbids it -> blocked
     |- days > available balance           -> blocked
     |- monthly cap for this type exceeded -> blocked
        |
        v
   DAY COUNT computed (see 3.4)
        |
        v
   APPROVAL CHAIN snapshotted from the plan's config for this leave type
     - every level's skip rules evaluated now, against the day count
     - if every level is skipped -> AUTO-APPROVED
        |
        v
   PENDING at the first actionable level        -> notifications sent
```

### 3.3 The approval chain

```
   Request lands at level 1
        |
        v
   +---------------------------------------------------------+
   |  APPROVE  -> advance to the next level that is not       |
   |              Skipped; past the end -> APPROVED           |
   |  REJECT   -> terminal. Every downstream level is marked  |
   |              Skipped so no one is left showing Pending   |
   +---------------------------------------------------------+
        |
        v
   ON FINAL APPROVAL
     - unpaid leave during notice extends the last working day
     - draft payslips recomputed
     - requester notified
```

**Who may act on a level**

| Condition | May act |
|---|---|
| The level names their user or employee id | Yes |
| The level is `reporting_manager` and they are the requester's manager | Yes |
| Super admin | Yes, at any level |
| HR / branch admin, manager unavailable (on approved leave, disabled, or unassigned) | Yes — the deadlock escape |
| HR / branch admin, manager available | **No** — must wait for the chain |

**Level skipping.** A level can carry a rule such as "skip when the request is under 2 days". Rules are evaluated once, at submission, against the computed day count, and the result is frozen into the snapshot. A chain whose levels all skip auto-approves the request immediately, and the requester is told — otherwise they would wait for an approval email that never comes.

### 3.4 How leave days are counted

| Situation | Charged |
|---|---|
| Half day (single date) | 0.5 |
| Each working day in the range | 1 |
| A weekly-off inside the range | 0 |
| A company or group holiday inside the range | 0 |
| An off-day sandwiched between leave, where the branch runs the policy | 1 |

Weekly-offs understand nth-Saturday patterns, not just fixed weekdays. Holidays include both the employee's holiday group **and** company-wide holidays that carry no group.

### 3.5 The Sandwich Leave Policy

An off-day is normally free. Under this policy it becomes chargeable when the employee was on leave on **both** sides of it.

```
   Fri     Sat     Sun     Mon
   LEAVE   off     off     LEAVE     -> Sat + Sun charged too   (4 days)
   LEAVE   off     off     present   -> Sat + Sun free          (1 day)
```

- It is a **per-branch switch**, so everyone posted to that office is covered, joiners included.
- It applies to **every leave type** — the trigger is the shape of the calendar, not the kind of leave.
- The two leave days may be in **separate requests**. The rule is that a run of off-days is charged to the leave covering the day **immediately after** the run — so the closing request pays, and no day can be charged twice.
- **HR or an administrator can waive it** for one leave, with a reason. The leave is immediately re-sized and the draft payslips are recomputed.
- A waiver spares **that leave only**. The employee was still absent, so those days still count as leave when a neighbouring request runs its own sandwich test.

### 3.6 Probation and notice period

| Situation | Rule |
|---|---|
| On probation | Cannot apply for leave at all — the policy does not apply yet |
| Serving notice, paid leave | Refused |
| Serving notice, unpaid leave | Allowed. On final approval the **last working day moves out** by the length of the leave, so the notice is still served in full |
| That leave later cancelled | The extension is given back, so approve → cancel cannot ratchet the exit date |

### 3.7 Balances

The **whole annual quota is granted on the first day of the plan year.** There is no monthly vesting — periodic accrual was removed from the product.

| Figure | Meaning |
|---|---|
| Quota | The yearly entitlement from the type's setup |
| Extra | An optional overdraft the employee may go beyond the quota by |
| Used | Days on **Approved** requests |
| Available | (Quota + Extra) − (Approved + **Pending**) |

Pending days are held against the balance so several over-quota requests cannot be stacked before any is decided. Types marked **unlimited** skip the check entirely.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 HR Leave console (`HrLeave.tsx`)

```
+----------------------------------------------------------------------+
|  Leave Management                                     [Filter Leaves] |
|  [KPI cards]                        [Holidays panel] [On leave today] |
|  [All n] [Pending n] [Approved n] [Rejected n] [Cancelled n]  search  |
|  +----------------------------------------------------------------+  |
|  | Employee | Type | Dates | Duration | Payroll | Status | Actions |  |
|  +----------------------------------------------------------------+  |
|  [Approve Selected] [Reject Selected]              < page n of m >    |
+----------------------------------------------------------------------+
```

Tab counts describe the whole filtered set, not the page. Search (name / code), Leave Type, Department and Payroll (Paid/Unpaid) filters all run **server-side** — a filter and a page size cannot both live in the browser. An "Approval Timeline" popover shows every chain level with actor and timestamp.

### 4.2 Leave Plans (`HrLeavePlans.tsx`)

Three tabs — **Plans**, **Leave Types**, **Leave Balances**.

- **Plans** — cards per plan with employee and type counts, a Setup state, Clone, Make Default, Delete. A completed plan shows a Locked indicator instead of editable setup buttons.
- **Leave type setup wizard** — Accrual → Leave Application → Approval, with "Save & Next" per section and "Save & Close" on the last.
- **Leave Balances** — a matrix of every employee against every leave type in scope, with department and location filters.

### 4.3 Leave Approvals (`HrLeaveApprovals.tsx`)

The approver's queue: pending requests they can act on, with approve/reject and comment.

### 4.4 Employee self-service

- **`RequestLeaveModal.tsx`** — type, dates, day type, reason, attachment, notify colleagues, handover (cover person, notes, critical tasks), availability on call with an emergency number.
- **`LeaveSummaryPanel.tsx`** — balance cards per type and the request history.
- **`LeaveRequestDetailsModal.tsx`** — one request with its full approval timeline.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | An employee may raise leave **only for themselves**; filing on behalf is client-admin and super-admin only |
| 2 | Nobody may approve their own leave request |
| 3 | HR is view-only in the chain — HR levels are stripped at snapshot time |
| 4 | HR may act only when the reporting manager is unavailable; super admin may act at any level |
| 5 | A request must belong to a leave plan the employee is assigned to, and to a type in that plan |
| 6 | Leave cannot start in the past, before the joining date, or more than one year ahead |
| 7 | Leave for today is second-half only (self-service); admins filing on behalf are exempt |
| 8 | A half-day must be a single calendar day, and only on types that allow half days |
| 9 | Two halves of the same day may be applied for separately; anything else that overlaps a Pending/Approved request is refused |
| 10 | Available balance = (quota + extra) − (approved + pending); unlimited types are exempt |
| 11 | A per-type monthly cap applies even to unlimited types, attributed to the month the request starts in |
| 12 | Employees on probation cannot apply for leave |
| 13 | Paid leave is refused while serving notice; approved unpaid leave extends the last working day |
| 14 | Weekly-offs and holidays inside a range are never charged, unless sandwiched under a branch that runs the policy |
| 15 | Only HR or an administrator may waive the sandwich policy, and only where the branch runs it |
| 16 | A rejection is terminal and marks every downstream level Skipped |
| 17 | Only Pending requests can be cancelled, by the requester or HR |
| 18 | Every approve, reject, cancel and sandwich waiver recomputes the employee's non-locked payslips |
| 19 | A plan locks once all of its types are configured; edit by cloning |
| 20 | A plan cannot be deleted while it is the default, or while Pending/Approved requests reference it |
| 21 | Plan names are unique per tenant/branch, case-insensitively |
| 22 | Cover person and notify recipients must be in the same tenant |

---

## 6. STATUS MODEL

**Request status** — `Pending` → `Approved` | `Rejected` | `Cancelled`. Terminal in every case; there is no re-open.

**Per-level chain status** — each level is `Pending`, `Approved`, `Rejected` or `Skipped`. `Skipped` is set at snapshot time (a rule matched, or the approver could not be resolved) or on a rejection (every level after it).

**Plan state** — `status` Active/Inactive, plus a derived **setup complete** flag (every attached type configured) and an `unlocked` override that keeps a freshly cloned plan editable until its next completing save.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| **Carry-forward** | The year-end carry-forward cap is validated and stored but **never applied** — no year-end process exists, and the section is not reachable in the setup wizard |
| **Probation / notice sections** | Both exist in the saved configuration and in the code, but neither is reachable from the wizard sidebar; the live probation and notice rules come from the employee record, not from these settings |
| **Periodic accrual** | Removed. The full quota is granted on day one; older plans still carrying a periodic configuration are simply treated as immediate |
| **Attendance-based accrual** | The threshold field is validated but nothing accrues from attendance |
| Gender restriction | `gender_restriction` and `is_sick_medical` on a leave type are stored but never enforced when applying |
| Backdated leave | Impossible for everyone, including HR — there is no adjustments path for a historical absence |
| HR approval | HR cannot approve even when it would be reasonable, unless the manager is unavailable |
| Encashment | Not implemented anywhere |
| Attachments | The request stores a path only — there is no upload endpoint in this module |
| Leave history list | The employee's own history is not paginated |
| Integrity | Leave requests are never soft-deleted; a cancelled request stays on the record |
| Timezone | "Today" is resolved in IST for the past-date guard; other comparisons use server time |

---

*Related documents: LEAVE_TECHNICAL_DOCUMENTATION.md · LEAVE_CODE_WALKTHROUGH.md · LEAVE_API_DOCUMENTATION.md*
