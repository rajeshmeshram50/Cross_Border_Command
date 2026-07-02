# LEAVE MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Leave (requests, plans, balances, approvals)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Leave manages **Leave Plans** (named policies made of leave types with per-type config), **Leave Requests** (employee applications through a snapshotted approval chain), **Balances** (quota − used), and **Approvals**. HR is view-only on decisions — the chain ends at the reporting manager. Approved/rejected/cancelled requests propagate to Payroll (paid vs unpaid days).

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  HrLeave.tsx (all requests + inline approvals + on-leave-today)        │
│  HrLeavePlans.tsx (plans / types / balances admin)                    │
│  HrLeaveApprovals.tsx (dedicated approval queue)                      │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  LeaveRequestController: index/store/show/approvals/approve/reject/    │
│    cancel/hr-view/approvers/colleagues  (chain snapshot, balance,      │
│    half-day, monthly cap, no self-approval)                           │
│  LeavePlanController: plans + types(config) + employees + balances     │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  master_leave_plans ─ leave_plan_leave_types (config_json) ─ master_  │
│    leave_types ; leave_plan_employees (1 plan/employee) ; leave_       │
│    requests (approval_chain json)                                     │
│  Feeds: PayrollService leaveAggregates (paid vs unpaid, half-day 0.5) │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/LeaveRequestController.php · LeavePlanController.php
app/Models/LeaveRequest.php · Masters/LeavePlans.php · Masters/LeaveTypes.php · Masters/LeavePlanLeaveType.php
database/migrations/ (master_leave_types, master_leave_plans, leave_plan_leave_types,
                     leave_plan_employees, leave_requests + FK + approval_chain migrations)
resources/js/pages/hrms/HrLeave.tsx · HrLeavePlans.tsx · HrLeaveApprovals.tsx · leavePlansApi.ts
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) |
| Mail | synchronous (`sendNow`) — no queue worker |

---

## 3. DATABASE SCHEMA

### 3.1 `leave_requests` (no SoftDeletes — cancel is a status)
Tenancy, `employee_id`, `leave_type_id`, `leave_plan_id`, `from_date`, `to_date`, `days` (decimal 5,2), `day_type` (full/first_half/second_half), `reason`, `attachment_path`, `notify` (json), handover fields (cover_person_id, handover_notes, critical_tasks, avail_on_call, emergency_number, avail_note), **`status`** (Pending/Approved/Rejected/Cancelled), `approved_by`/`approved_at`/`approver_comment`, `hr_viewed_at`/`hr_viewed_by`, **`approval_chain`** (json), `current_approval_level`, `created_by`. **FKs (retro):** employee_id cascade, leave_plan_id nullOnDelete, leave_type_id restrictOnDelete.

### 3.2 `master_leave_plans`
`plan_name`, `from_month_type` (Calendar/If Joining), `from_month`, `calendar_year`, `is_default`, `policy_explanation_mode`, `policy_doc_path`, `status`, **`unlocked`** (bool — clone stays editable).

### 3.3 `master_leave_types`
`name`, `type` (Regular/Incident Based Leave/Unpaid Leave/Compoff), `short_code`, `is_sick_medical`, **`paid_unpaid`** (Paid/Unpaid), `gender_restriction`, `status`. `deleting` refuses if referenced by any request (else cleans up pivot rows).

### 3.4 `leave_plan_leave_types` (pivot model)
`leave_plan_id`, `leave_type_id`, **`config_json`** (the 6-tab Setup blob: accrual/leaveApp/approval/yearEnd/probation/noticePeriod), `quota_summary`, `eoy_summary`, `is_setup`. **Unique (plan, type).**

### 3.5 `leave_plan_employees`
`leave_plan_id`, **`employee_id` unique** (one plan per employee), `assigned_at`/`assigned_by`.

---

## 4. MODELS
| Model | Table | Notes |
|---|---|---|
| `LeaveRequest` | leave_requests | casts dates, days decimal:2, notify/approval_chain array; relations employee/leaveType/leavePlan/coverPerson/approver/creator |
| `Masters\LeavePlans` | master_leave_plans | leaveTypes belongsToMany (pivot config), employees belongsToMany |
| `Masters\LeaveTypes` | master_leave_types | `deleting` guard vs requests; paid_unpaid |
| `Masters\LeavePlanLeaveType` | leave_plan_leave_types | config_json array, is_setup |

`leave_plan_employees` has no model (raw `DB::table`).

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    // Plans + types + employees + balances
    Route::apiResource('leave-plans', LeavePlanController::class);
    Route::post  ('/leave-plans/{id}/clone', ...); Route::post('/leave-plans/{id}/make-default', ...);
    Route::post  ('/leave-plans/{id}/types', ...); Route::delete('/leave-plans/{id}/types/{typeId}', ...);
    Route::put   ('/leave-plans/{id}/types/{typeId}/config', ...);
    Route::post  ('/leave-plans/{id}/employees', ...); Route::delete('/leave-plans/{id}/employees/{employeeId}', ...);
    Route::get   ('/leave-balances', ...); Route::get('/employees/{employeeId}/leave-balances', ...);
    // Requests (specific before {id})
    Route::get ('/leave-requests', ...); Route::post('/leave-requests', ...);
    Route::get ('/leave-requests/approvals', ...); Route::get('/leave-requests/colleagues', ...);
    Route::get ('/leave-requests/{id}', ...); Route::get('/leave-requests/{id}/approvers', ...);
    Route::post('/leave-requests/{id}/approve', ...); Route::post('/leave-requests/{id}/reject', ...);
    Route::post('/leave-requests/{id}/cancel', ...); Route::post('/leave-requests/{id}/hr-view', ...);
});
```
Leave **types** are served through the generic `/master/leave_type` endpoint. Full detail in **LEAVE_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

### LeaveRequestController — `store()` enforcement stack
Leave-type-in-plan → **balance/quota** (available = quota + overdraft − used[Approved+Pending]) → **half-day** gate (needs `allowHalfDay`; single day only) → **monthly cap** → **overlap** guard (opposite-half exception) → **date** guards (no backdating; same-day self-service only `second_half`) → **snapshot approval chain** (HR levels stripped — HR is view-only) → auto-approve if all levels skipped.

`setStatus()` (approve/reject): hierarchy gate (HR waits for the chain unless the RM is unavailable), **no self-approval**, advance/finalize, then `propagateToPayroll()`.

### LeavePlanController
Plans (CRUD, clone, make-default; edit locked once fully set up unless `unlocked`), type assignment + 6-tab `config_json`, employee assignment (one plan each), and the balance readers (`/leave-balances`, `/employees/{id}/leave-balances`) — full quota granted upfront, `used` = SUM approved days.

**Scoping:** admins see client-level + globals (+ switcher); branch users see only their branch. Permission slugs `hr.leave` / `hr.leave_approvals` gate UI; the API enforces tenant scope + chain/role authorization (not the slug).

---

## 7. FRONTEND
- **`HrLeave.tsx`** — all requests + KPIs + inline approve/reject (only rows where `can_act_now`), bulk actions, On-Leave-Today, Holidays modal, HR-view marker.
- **`HrLeavePlans.tsx`** — 3 tabs (Plans / Types / Balances); the 6-tab `LeaveTypeConfig` Setup drives backend enforcement.
- **`HrLeaveApprovals.tsx`** — dedicated queue with an approval-chain visualization.

---

## 8. INTEGRATION: PAYROLL
`PayrollService::leaveAggregates` reads **Approved** requests overlapping the cycle, counts working days (excludes Sundays), half-day single-day = 0.5, capped to recorded `days`, split paid/unpaid via `master_leave_types.paid_unpaid`. Any decision or cancel calls `recomputeEmployeePayslips` (non-locked runs). See `docs/payroll/`.

---

## 9. SECURITY & CAVEATS
1. **HR is view-only** on decisions; the chain ends at the reporting manager (HR acts only when the RM is unavailable, or via super-admin).
2. **No one approves their own leave** (LV-11).
3. **Half-day = 0.5** everywhere; only on a single day and only if `allowHalfDay`.
4. **Balance counts Approved + Pending**; full annual quota available day one.
5. **Notifications sent synchronously** (no queue worker).
6. **Leave types via `/master/leave_type`**; a type can't be deleted while referenced; the plan↔type pivot has no FK on leave_type_id (guarded in model).
7. FKs on `leave_requests` only (employee/plan/type); plans/pivots have limited FKs.

---

## 10. METRICS
| Metric | Value |
|---|---|
| Controllers | 2 (Request, Plan) |
| Tables | 5 (+ pivot) |
| Permission slugs | hr.leave, hr.leave_approvals |
| Request statuses | Pending/Approved/Rejected/Cancelled |
| Test coverage | none automated |

---

*Related documents: LEAVE_FUNCTIONAL_DOCUMENTATION.md · LEAVE_CODE_WALKTHROUGH.md · LEAVE_API_DOCUMENTATION.md*
