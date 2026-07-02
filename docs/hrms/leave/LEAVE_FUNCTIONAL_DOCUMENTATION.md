# LEAVE MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Leave

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
Leave lets employees apply for time off against a **Leave Plan** (a policy made of leave types with quotas and rules). Requests flow through an approval chain ending at the reporting manager; HR is view-only. Balances track quota − used, and approved leave adjusts payroll (paid vs unpaid).

### 1.2 Business value
| Benefit | Description |
|---|---|
| Policy-driven | Leave Plans encode quotas, half-day, monthly caps, approval chains |
| Fair balances | Real-time available = quota + overdraft − used |
| Clear approvals | Snapshotted chain, no self-approval, manager-led |
| Payroll accurate | Paid vs unpaid leave feeds the payslip |
| Self-service | Employees apply, track, and cancel their own leave |

### 1.3 Key features
- **Leave Plans** with per-type 6-tab config (accrual, application, approval chain, year-end, probation, notice).
- **Leave Requests** with half-day, handover, notify, and attachment.
- **Balances** grid + per-employee ledger.
- **Approvals** queue with chain visualization; HR-view marker.
- **Payroll integration** (paid/unpaid, half-day 0.5).

---

## 2. ROLES & ACCESS
| Role | Access |
|---|---|
| Employee | Apply / track / cancel own leave; view own balance |
| Reporting Manager | Approve/reject their reports' leave |
| HR / Client Admin | Manage plans/types/balances; **view-only** on decisions (acts only if the RM is unavailable) |
| Super Admin | All; may override |

Menu slugs `hr.leave` (Leave, Plans) and `hr.leave_approvals` (Approvals) gate visibility.

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                        LEAVE LIFECYCLE                             │
└───────────────────────────────────────────────────────────────────┘
   SETUP (HR): Leave Plan → assign leave types (+ config) → assign employees
        │
        ▼
   EMPLOYEE applies (from/to, day_type, reason, handover, notify)
        │  checks: type-in-plan · balance (quota+overdraft − used) ·
        │          half-day allowed · monthly cap · no overlap · date rules
        │  (auto-approved if the chain has no actionable level)
        ▼
   APPROVAL CHAIN (snapshotted; HR levels stripped — HR is view-only)
        Level 1 Reporting Manager → … → final
        • no self-approval; HR acts only if the RM is unavailable
        ▼
   APPROVED / REJECTED / CANCELLED
        • balance updated (used) · payroll recomputed (paid vs unpaid)
```

### 3.1 Day handling
Half-day (first_half/second_half) counts **0.5** and must be a single day; same-day self-service is limited to `second_half`; backdated requests are blocked (admins exempt from the same-day rule).

### 3.2 Balances
Full annual quota (+ overdraft) is available from day one; `used` = sum of Approved + Pending days (so you can't stack over-quota requests).

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Leave Management (`HrLeave.tsx`)
KPIs (Total / Pending / Approved-month / Rejected); tabs; table with Employee, Type, Duration, Date Range, **Approval Chain** dots, **Payroll** (Paid/Unpaid/Half-Pay), Status, Action (Approve/Reject only when you can act now). Bulk approve/reject; On-Leave-Today strip; Holidays modal.

### 4.2 Leave Plans (`HrLeavePlans.tsx`)
3 tabs — **Plans** (create/clone/make-default; locked once set up), **Types** (assign + the 6-tab Setup config), **Balances** (dynamic-column grid). The config blob defines quota, half-day, monthly cap and the approval chain the backend enforces.

### 4.3 Leave Approvals (`HrLeaveApprovals.tsx`)
Queue (Employee, Type, Dates, Days, Requested On, Status, Review) with a detail modal showing the approval chain, handover, and Approve/Reject.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | One leave plan per employee |
| 2 | Request must use a type that's in the employee's plan |
| 3 | Balance = quota + overdraft − used (Approved + Pending) |
| 4 | Half-day = 0.5; single day only; requires `allowHalfDay` |
| 5 | Same-day self-service limited to `second_half`; no backdating |
| 6 | Overlapping requests rejected (opposite-half same-day allowed) |
| 7 | Monthly cap enforced when configured |
| 8 | Approval chain ends at the reporting manager; HR view-only |
| 9 | No one approves their own leave |
| 10 | Approved/rejected/cancelled → payroll recompute (paid vs unpaid) |
| 11 | A leave type can't be deleted while referenced; a plan can't be deleted with active requests or while default |

---

## 6. STATUS MODEL
Request: **Pending → Approved / Rejected / Cancelled**. The chain tracks per-level status; HR "reviewed" turns green only after the RM decides and HR opens it (`hr-view`).

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Accrual | Balance readers grant full quota upfront (no time-phased vesting yet) |
| HR authority | HR can't approve directly unless the RM is unavailable |
| Notifications | Sent synchronously (no queue worker) |
| Types | Managed via the generic Master endpoint, not a dedicated screen |

---

*Related documents: LEAVE_TECHNICAL_DOCUMENTATION.md · LEAVE_CODE_WALKTHROUGH.md · LEAVE_API_DOCUMENTATION.md*
