# LEAVE MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Leave
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: plan setup → apply (enforcement stack) → approve/reject (chain) → payroll. Files: `LeaveRequestController.php`, `LeavePlanController.php`, `PayrollService.php`, `HrLeave.tsx`.

---

## 1. PLAN SETUP (`LeavePlanController`)
```php
store()        // plan header; clears other defaults if is_default (transaction)
assignTypes()  // attach master_leave_types to the plan (config_json null, is_setup false)
saveTypeConfig() // PUT the 6-tab Setup blob into config_json + summaries; is_setup=true
assignEmployees()// updateOrInsert into leave_plan_employees (unique employee_id → moves off prior plan)
// assertPlanEditable(): once fully set up, locked unless `unlocked` (clone sets unlocked=true)
```

---

## 2. APPLY (`LeaveRequestController::store()`) — enforcement stack
```php
$data = $request->validate([ 'leave_type_id' => exists scoped to client, 'from_date','to_date' (≤ +1yr),
                             'day_type' in [full,first_half,second_half], ... handover ... ]);
$emp = resolved (self, or admin on behalf — only super/client_admin);
// tenant guard on target; self-service rule; backdate blocked; same-day → second_half only; half-day single day
// overlap guard (opposite-half same-day exception)
$plan = leave_plan_employees pivot ?? employee.leave_plan;   // else 422
$config = leave_plan_leave_types.config_json;                // type must be in plan (else 422)
// BALANCE: if accrual != unlimited → available = (yearlyQuota + overdraft) − used(Approved+Pending); over → 422
// HALF-DAY gate: day_type != full requires config.leaveApp.allowHalfDay
// MONTHLY CAP: leaveApp.maxPerMonth.enabled → block exceeding per-month
$days = computeLeaveDays(from,to,dayType,emp);              // half-day=0.5; excludes weekly-off + holidays
$chain = snapshotApprovalChain(...);                        // HR levels STRIPPED; RM resolved; skip rules
$start = firstActionableLevel();                            // auto-approve if all skipped
LeaveRequest::create([... 'days'=>$days, 'status'=>Approved(auto)|Pending, 'approval_chain'=>$chain, ...]);
notifyForSubmission(); if (auto) { notifyForDecision(); propagateToPayroll(); }
```

`computeLeaveDays()`: half-day single day → 0.5; else working days (excludes weekly-off via `parseWeeklyOffSet`, holidays via `holidayDatesInRange` recurring-anchored).

---

## 3. DECISION (`setStatus` → approve/reject)
```php
findScopedOrFail(); must be Pending;
// hierarchy gate: only super_admin acts out of turn; HR must wait for the chain UNLESS the RM is unavailable
if (approving own leave) abort;                              // LV-11 no self-approval
record decision on the chain entry;
if (reject) { mark downstream Skipped; status=Rejected; }
else { advance via firstActionableLevel(level+1); if past end → status=Approved; }
notifyForDecision(); if (final Approved|Rejected) propagateToPayroll();
```
`hrView()` records the first HR view (idempotent) so the UI "HR reviewed" node greens. `cancel()` — owner/admin, Pending only → status=Cancelled + propagateToPayroll.

`isReportingManagerUnavailable()`: RM gone / inactive / disabled / on leave today / unassigned → routes to HR.

---

## 4. BALANCES (`LeavePlanController`)
```php
employeeBalances($employeeId):   // tenant-guarded (IDOR)
  per assigned type: quota + extra(overdraft); ledger = opening grant − Approved deductions;
  used = SUM approved days; available = (quota+extra) − used; includes allow_half_day
leaveBalances():   // grid: dynamic columns per type; cell available=(quota+extra)−used
```
Full quota granted upfront (no time-phased vesting in the readers).

---

## 5. PAYROLL (`PayrollService::leaveAggregates`)
```php
$rows = Approved leave_requests overlapping [start,end];
foreach: clip to window; count WORKING days (exclude Sundays); half-day single-day → 0.5; cap to recorded days;
classify via leaveTypePaidMap() (paid_unpaid): unpaid/lwp/loss of pay → unpaid; else paid;
return ['paid'=>..., 'unpaid'=>...];   // feeds paid/unpaid/LOP day counts
// any decision/cancel → propagateToPayroll → recomputeEmployeePayslips (non-locked)
```

---

## 6. FRONTEND
```tsx
// HrLeave.tsx: leaveRequestsApi.approvals({status:'All'}); approve/reject/hrView; rows selectable only if Pending && can_act_now
// HrLeavePlans.tsx: leavePlansApi.* (plans/types/config/employees) + leaveBalancesApi
// HrLeaveApprovals.tsx: approvals + approvers(chain) + approve/reject
```

---

## 7. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Snapshot approval chain | store() | Freeze approvers at apply time |
| HR view-only | snapshotChain strips HR; setStatus gate | Manager-led decisions |
| No self-approval | setStatus (LV-11) | Integrity |
| Balance counts Pending too | store()/balances | No over-quota stacking |
| Half-day 0.5 | computeLeaveDays / leaveAggregates | Consistent everywhere |
| Synchronous mail | safeSend (sendNow) | No queue worker |
| propagateToPayroll | decisions/cancel | Keep payslips in sync |

---

## 8. NOTES & CAVEATS
- Leave types via `/master/leave_type`; type delete guarded vs requests; pivot has no FK on leave_type_id (model-guarded).
- FKs on `leave_requests` (employee/plan/type); plans/pivots limited.
- Accrual readers grant full quota upfront.
- HR can act only when the RM is unavailable (or super-admin override).
- DB is PostgreSQL.

---

*Related documents: LEAVE_TECHNICAL_DOCUMENTATION.md · LEAVE_FUNCTIONAL_DOCUMENTATION.md · LEAVE_API_DOCUMENTATION.md*
