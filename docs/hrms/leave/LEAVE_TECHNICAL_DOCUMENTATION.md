# LEAVE MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Leave

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |
| 2.0 | 2026-09-08 | System | Sandwich policy support class, notice/probation/onboarding guards, chain snapshotting with HR stripped, plan locking + `unlocked`, opt-in paging with tab counts on `/approvals`, payroll propagation, holiday resolution shared with payroll, dead accrual helpers. |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is

Two controllers over five tables, plus four `App\Support` classes that hold the rules shared with other modules.

- **`LeavePlanController`** — the policy side: plans, the types attached to them, each type's `config_json`, employee assignment, and the balance reads.
- **`LeaveRequestController`** — the transaction side: apply, list, approve/reject/cancel, sandwich waiver, and the approval-chain machinery.

The design decision that shapes everything else: **each leave type's policy is a JSON blob (`leave_plan_leave_types.config_json`) and the approval chain is snapshotted onto the request at submission.** Changing a plan later never reroutes or re-prices requests already in flight.

The second is that **leave days are sized in two independent places** — here when a request is raised, and in `PayrollService` when a payslip is cut. They must agree, which is why the sandwich rule and the "is this an off day?" rule live in shared `App\Support` classes rather than in either caller.

### 1.2 High-level architecture

```
+-----------------------------------------------------------------------+
|                            CLIENT LAYER                                |
|  HrLeave.tsx (1,979)          HR console: tabs+counts, server filters, |
|                               bulk approve/reject, approval timeline   |
|  HrLeavePlans.tsx (3,132)     plans / types / balances, setup wizard   |
|  HrLeaveApprovals.tsx (742)   approver queue                           |
|  leavePlansApi.ts (384)       typed client for the plan endpoints      |
|  RequestLeaveModal.tsx (683)  employee application drawer              |
|  LeaveSummaryPanel.tsx (730)  balances + history                       |
|  LeaveRequestDetailsModal.tsx (412)                                    |
+-------------------------------+---------------------------------------+
                                | auth JSON
                                v
+-----------------------------------------------------------------------+
|                     APPLICATION LAYER (Laravel 12)                     |
|  LeaveRequestController  (2,006 lines, 13 routes)                      |
|    index / store / show / approvals / colleagues / approvers           |
|    approve / reject / cancel / hr-view / sandwich-waiver               |
|    + snapshotApprovalChain, canActOnLevel, computeLeaveDays            |
|  LeavePlanController     (1,152 lines, 14 routes)                      |
|    CRUD / clone / make-default / assignTypes / saveTypeConfig          |
|    assignEmployees / employeeBalances / leaveBalances                  |
|                                                                        |
|  App\Support\SandwichPolicy    off-day-flanked-by-leave maths          |
|  App\Support\WeekOff           the single "is this an off day?"        |
|  App\Support\NoticePeriodGuard paid-leave block + LWD extension        |
|  App\Support\ProbationGuard    probation block                         |
|  App\Support\OnboardingGuard   onboarding-complete block               |
+-------------------------------+---------------------------------------+
                                |
                                v
+-----------------------------------------------------------------------+
|                       DATA LAYER (PostgreSQL)                          |
|  master_leave_plans  --< leave_plan_leave_types >--  master_leave_types|
|         |                     (config_json)                            |
|         +--< leave_plan_employees >-- employees                        |
|                                                                        |
|  leave_requests   (approval_chain JSON snapshot, sandwich_*, notice_*) |
|                                                                        |
|  Downstream: PayrollService::recomputeEmployeePayslips() on every      |
|              approve / reject / cancel / sandwich-waiver               |
|              AttendanceController overlays approved leave on the log   |
+-----------------------------------------------------------------------+
```

### 1.3 Module structure

```
app/Http/Controllers/Api/
  LeaveRequestController.php   (2,006 lines)
  LeavePlanController.php      (1,152 lines)
  SandwichTestController.php   (dev-only seeder, /dev/sandwich-leave)
app/Models/
  LeaveRequest.php             (106)
  Masters/LeavePlans.php       (71)
  Masters/LeaveTypes.php       (107)
  Masters/LeavePlanLeaveType.php (40)
app/Support/
  SandwichPolicy.php · WeekOff.php
  NoticePeriodGuard.php · ProbationGuard.php · OnboardingGuard.php
app/Notifications/LeaveRequestNotification.php
database/migrations/           (16 leave migrations - see 3.6)
resources/js/pages/hrms/       HrLeave · HrLeavePlans · HrLeaveApprovals · leavePlansApi
resources/js/pages/employee/   RequestLeaveModal · LeaveSummaryPanel · LeaveRequestDetailsModal
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · **PostgreSQL** · Sanctum |
| Policy storage | `config_json` (JSON column) per (plan, type) |
| Chain storage | `approval_chain` (JSON column) per request — a snapshot, not a reference |
| Search | `ilike` on employee name / code, and on the `approval_chain` JSON text |
| Dates | Carbon; `DISPLAY_TZ = Asia/Kolkata` used for the "today" guard |
| Notifications | `LeaveRequestNotification`, sent best-effort inside try/catch |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) |

---

## 3. DATABASE SCHEMA

### 3.1 `master_leave_plans`

| Group | Columns |
|---|---|
| Tenancy | `client_id`, `branch_id` (both nullable, indexed) |
| Identity | `plan_name`, `description` |
| Year | `calendar_year`, `from_month_type` (`Calendar` \| `If Joining`), `from_month` (enum of months) |
| State | `status` (`Active`\|`Inactive`), `is_default`, **`unlocked`** |
| Policy doc | `policy_explanation_mode` (`System`\|`Custom`), `policy_doc_path` |
| Audit | `created_by`, timestamps |

`unlocked` exists solely for clones: a clone is born fully configured and would otherwise lock the instant it is created.

### 3.2 `master_leave_types`

`client_id`, `branch_id`, `name`, `description`, `type` (`Regular` \| `Incident Based Leave` \| `Unpaid Leave`), `short_code`, `is_sick_medical`, `paid_unpaid` (`Paid`\|`Unpaid`), `gender_restriction` (`None`\|`Male`\|`Female`), `status`, `created_by`, timestamps.

> `is_sick_medical` and `gender_restriction` are stored and editable through the master screen but **never read** by the leave-request path.

### 3.3 `leave_plan_leave_types` — the policy pivot

| Column | Purpose |
|---|---|
| `leave_plan_id`, `leave_type_id` | Unique together (`lplt_plan_type_unique`) |
| **`config_json`** | The whole policy for this (plan, type) — see §3.7 |
| `quota_summary`, `eoy_summary` | Human-readable summaries rendered on the card |
| `is_setup` | Flipped true only by the wizard's finalising save |

### 3.4 `leave_plan_employees`

`leave_plan_id`, `employee_id` (**unique** — one plan per employee), `assigned_at`, `assigned_by`.

A second, older assignment path exists: `employees.leave_plan` stamped by the onboarding wizard. Every resolver prefers the pivot and falls back to that column.

### 3.5 `leave_requests`

| Group | Columns |
|---|---|
| Tenancy | `client_id`, `branch_id` |
| Links | `employee_id`, `leave_type_id`, `leave_plan_id`, `cover_person_id`, `created_by` |
| Dates | `from_date`, `to_date`, `day_type` (`full`\|`first_half`\|`second_half`) |
| Amount | `days` decimal(5,2) |
| **Sandwich** | `sandwich_waived`, `sandwich_waived_by`, `sandwich_waived_at`, `sandwich_waiver_reason` |
| **Notice** | `notice_extension_days` |
| Application | `reason`, `attachment_path`, `notify` json, `handover_required`, `handover_notes`, `critical_tasks`, `avail_on_call`, `emergency_number`, `avail_note` |
| Decision | `status` (`Pending`\|`Approved`\|`Rejected`\|`Cancelled`), `approved_by`, `approved_at`, `approver_comment` |
| **Chain** | `approval_chain` json, `current_approval_level` |
| HR | `hr_viewed_at`, `hr_viewed_by` |

**No soft deletes.** Indexes on `employee_id`, `leave_type_id`, `leave_plan_id`, `status`, `client_id`, `branch_id`.

### 3.6 Migration history (16)

| Migration | What it adds |
|---|---|
| `..._05_13_000001/2` | `master_leave_types`, `master_leave_plans` |
| `..._05_13_000004` | plan `description` |
| `..._05_14_000001` | type `description`, `is_sick_medical`, `paid_unpaid`, `gender_restriction` |
| `..._05_14_000002` | plan `is_default`, `policy_explanation_mode`, `policy_doc_path` |
| `..._05_14_000003/4` | the two pivots |
| `..._05_14_000010` | `leave_requests` |
| `..._05_14_000020`, `..._06_04_000200` | seed / ensure the `hr.leave_approvals` module |
| `..._05_14_000021` | **`approval_chain`, `current_approval_level`** |
| `..._06_12_000002` | payroll/leave employee foreign keys |
| `..._06_30_000020` | `hr_viewed_at`, `hr_viewed_by` |
| `..._07_01_000001` | plan **`unlocked`** |
| `..._08_05_000002` | **`notice_extension_days`** |
| `..._08_06_150000` | **`sandwich_waived*`** (4 columns) |

### 3.7 `config_json` shape

```jsonc
{
  "accrual": {
    "unlimited": false,
    "yearlyQuota": 12,                    // 0..365, fractional allowed
    "mode": "immediate",                  // 'periodic' rows survive but behave as immediate
    "attendanceDaysWorked": 0,            // validated 0..31, NOT enforced anywhere
    "employeeOverdraft": { "enabled": true, "days": 1 }
  },
  "leaveApp": {
    "allowHalfDay": true,
    "maxPerMonth": { "enabled": true, "days": 3 }
  },
  "approval": {
    "chain": [                            // new shape
      { "kind": "reporting_manager", "skip_if": { "days_lt": 2 } },
      { "kind": "role", "role": "hr" }    // stripped at snapshot - HR is view-only
    ],
    "required": true, "approverRole": "hr"   // legacy shape, wrapped as one level
  },
  "yearEnd":      { "carryForwardCap": 5 },  // validated, stored, NEVER applied
  "probation":    { ... },                    // stored, not reachable in the wizard
  "noticePeriod": { ... }                     // stored, not reachable in the wizard
}
```

Only `accrual.unlimited`, `accrual.yearlyQuota`, `accrual.employeeOverdraft`, `leaveApp.allowHalfDay`, `leaveApp.maxPerMonth` and `approval.chain` are read by the request path.

---

## 4. MODELS

### `LeaveRequest`

Casts: `from_date`/`to_date` → `date`, `days` → `decimal:2`, `notify`/`approval_chain` → `array`, `sandwich_waived` → `boolean`, `sandwich_waived_at`/`approved_at`/`hr_viewed_at` → `datetime`.
Relations: `employee`, `leaveType`, `leavePlan`, `coverPerson`, `approver`, `sandwichWaiver` (→ `User`).

### `Masters\LeavePlans`

Appends `employees_count`, `leave_types_count` and `setup_complete` — the last derived from the pivot's `is_setup` flags and what drives the Locked indicator in the UI.

### `Masters\LeaveTypes` / `Masters\LeavePlanLeaveType`

Straightforward masters; `LeavePlanLeaveType` casts `config_json` to array.

---

## 5. API SURFACE

### Leave plans (`LeavePlanController`) — 14 routes

| Method | Endpoint | Method |
|---|---|---|
| GET/POST | `/leave-plans` | `index` / `store` |
| GET/PUT/DELETE | `/leave-plans/{id}` | `show` / `update` / `destroy` |
| POST | `/leave-plans/{id}/clone` | `clone` |
| POST | `/leave-plans/{id}/make-default` | `makeDefault` |
| POST | `/leave-plans/{id}/types` | `assignTypes` |
| DELETE | `/leave-plans/{id}/types/{typeId}` | `removeType` |
| PUT | `/leave-plans/{id}/types/{typeId}/config` | `saveTypeConfig` |
| POST | `/leave-plans/{id}/employees` | `assignEmployees` |
| DELETE | `/leave-plans/{id}/employees/{employeeId}` | `removeEmployee` |
| GET | `/leave-balances` | `leaveBalances` (roster matrix) |
| GET | `/employees/{employeeId}/leave-balances` | `employeeBalances` |

### Leave requests (`LeaveRequestController`) — 11 routes

| Method | Endpoint | Method |
|---|---|---|
| GET/POST | `/leave-requests` | `index` / `store` |
| GET | `/leave-requests/approvals` | `approvals` |
| GET | `/leave-requests/colleagues` | `colleagues` |
| GET | `/leave-requests/{id}` | `show` |
| GET | `/leave-requests/{id}/approvers` | `approvers` |
| POST | `/leave-requests/{id}/approve` \| `/reject` \| `/cancel` | `setStatus` / `cancel` |
| POST | `/leave-requests/{id}/hr-view` | `hrView` |
| POST | `/leave-requests/{id}/sandwich-waiver` | `sandwichWaiver` |

`/approvals` and `/colleagues` are declared **before** `/{id}` so they are not captured by the wildcard.

---

## 6. CONTROLLER ANALYSIS

### LeaveRequestController (2,006 lines, 27 methods)

| Concern | Implementation |
|---|---|
| Guards at raise time | 16 distinct refusals — see the Code Walkthrough §2 |
| Day sizing | `computeLeaveDays()` → `WeekOff` + holiday set + `SandwichPolicy` |
| Chain | `snapshotApprovalChain()` freezes levels, resolves approvers, evaluates `skip_if` |
| Level gating | `canActOnLevel()` — **public**, reused by `MyTeamController` so the two inboxes agree |
| Deadlock escape | `isReportingManagerUnavailable()` — approved leave, disabled, or unassigned |
| Payroll | `propagateToPayroll()` after every terminal decision; failures logged, never fatal |
| Listing scope | `/approvals` — admin tiers see the tenant; everyone else gets a wide SQL pre-filter on the JSON chain, then a precise PHP pass through `canActOnLevel` |
| Paging | **Opt-in** via `per_page`; non-admin scope counts and slices the *permission-filtered* collection, not the raw query |
| Tab counts | `with_counts=1` — taken from a clone of the query with every filter applied **except** status |

### LeavePlanController (1,152 lines, 22 methods)

| Concern | Implementation |
|---|---|
| Scoping | Own `resolveOwnership` / `applyScope` / `applySwitcherBranchFilter` trio (mirrors `MasterController`) |
| Locking | `assertPlanEditable()` — refuses setup writes once `isPlanSetupComplete()` and not `unlocked` |
| Clone | `replicate(['is_default'])`, copies types + config, **no employees**, sets `unlocked = true` |
| Default | `makeDefault()` clears the flag across the same (client, branch) inside a transaction |
| Delete | Refused when default, or when Pending/Approved requests reference it; then cascades both pivots |
| Name uniqueness | `LOWER(plan_name)` per (client, branch) |
| Balances | Full quota granted at plan-year start; ledger built as grant + per-request deductions |
| Dead code | `accrualEvents()` / `accruedToDate()` are public static and **have no callers** — leftovers of the removed periodic accrual |

---

## 7. FRONTEND

| File | Lines | Role |
|---|---|---|
| `HrLeavePlans.tsx` | 3,132 | Plans / Types / Balances tabs + the setup wizard |
| `HrLeave.tsx` | 1,979 | HR console: KPI cards, status tabs with counts, server-side filters, bulk actions, holidays panel |
| `HrLeaveApprovals.tsx` | 742 | Approver queue |
| `LeaveSummaryPanel.tsx` | 730 | Employee balances + history |
| `RequestLeaveModal.tsx` | 683 | Application drawer |
| `LeaveRequestDetailsModal.tsx` | 412 | Single request + timeline |
| `leavePlansApi.ts` | 384 | Typed client for the plan endpoints |

The setup wizard declares six section components (`accrual`, `leaveApp`, `approval`, `yearEnd`, `probation`, `noticePeriod`) but `SETUP_SECTIONS` — the sidebar that drives navigation — lists only the first three. The other three render only if `active` is set to them, which nothing does.

Page size is persisted per browser; the HR list reads `/holidays` unpaginated to mark holidays on its calendar.

---

## 8. INTEGRATIONS

### Payroll

`propagateToPayroll()` calls `PayrollService::recomputeEmployeePayslips()` after every approve, reject, cancel and sandwich waiver. Locked/approved runs are frozen and untouched. Failures are caught and logged (LV-29) so a payroll hiccup never blocks a leave decision — at the cost that a divergence is only visible in the log.

`PayrollService::leaveAggregates()` reads `sandwich_waived` directly: waiving a sandwich on unpaid leave drops those days from loss of pay.

### Attendance

Approved leave overlays the attendance log for its date range, so a leave day is never Absent.

### Holidays

`holidayDatesInRange()` resolves **company-wide holidays (no group, client must match, branch match-or-null) plus the employee's own group** — deliberately the same rule as `PayrollService::holidayDateSet()`. It takes the `Employee`, not a group id, precisely so the company-wide half can be answered; keyed on a group id it could only ever answer half the question.

### Exit / notice period

`NoticePeriodGuard::applyExtension()` on final approval, `revertExtension()` on cancel. The response surfaces the new last working day so the approver learns the exit date moved.

---

## 9. SECURITY & CAVEATS

| Area | Note |
|---|---|
| Tenant isolation | `leave_type_id` is validated against the caller's tenant (LV-23); `employee_id`, `cover_person_id` and every notify id are checked against the target employee's client; `index` treats a null `client_id` as a mismatch (LV-18) so legacy rows do not leak |
| IDOR | `employeeBalances()` explicitly guards the employee's client before returning the ledger |
| Self-approval | Blocked at `setStatus`, including for admins |
| Out-of-turn approval | Blocked for HR — only super admin overrides, or HR when the manager is unavailable |
| Chain pre-filter | The JSON `ilike` match uses **trailing terminators** (`,` or `}`) so user 5 does not match `"approver_user_id":50` |
| Free text | `reason` ≤ 2000, handover/tasks ≤ 5000, `attachment_path` ≤ 1024 (LV-22 — previously unbounded) |
| Booking horizon | `to_date` capped at one year out (LV-09) |
| Attachments | `attachment_path` is a client-supplied **string**; this module has no upload endpoint and does not verify the path |
| Non-admin paging | Filtering happens in PHP after the fetch, so a very large tenant pulls a wide set into memory before slicing |
| Notifications | Best-effort inside try/catch — a failed send is invisible to the actor |
| Dead config | `yearEnd`, `probation` and `noticePeriod` sections are stored and validated but never applied |
| Dead helpers | `accrualEvents()` / `accruedToDate()` have no callers |

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controllers | 2 (3,158 lines combined) + 1 dev-only seeder |
| Support classes | 5 (`SandwichPolicy`, `WeekOff`, `NoticePeriodGuard`, `ProbationGuard`, `OnboardingGuard`) |
| API routes | 25 (14 plans · 11 requests) |
| Permission slugs | `hr.leave`, `hr.leave_approvals` |
| Tables | 5 |
| Migrations | 16 |
| Soft deletes | none |
| Raise-time guards | 16 |
| Frontend | 7 files (~8,100 lines) |
| Test coverage | none automated |

---

*Related documents: LEAVE_FUNCTIONAL_DOCUMENTATION.md · LEAVE_CODE_WALKTHROUGH.md · LEAVE_API_DOCUMENTATION.md*
