# EXPENSE MANAGEMENT MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Expense Management
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: raise → manager stage → HR stage → payroll recovery. Files: `ExpenseClaimController.php`, `AdvanceRequestController.php`, `PayrollService.php`, `HrExpenseManagement.tsx`, `EmployeeProfile.tsx`.

---

## 1. RAISE A CLAIM

### `ExpenseClaimController::store()`
```php
$employeeId = $this->resolveEmployeeId($employee_id, $employee_code, $user) ?? $this->currentEmployeeId();
if (!super_admin && $emp->user_id !== $user->id) abort(403);        // own only
$data = $request->validate([
  'title'=>'required|max:255', 'amount'=>'required|numeric|min:0|max:9999999999999.99',
  'expense_date'=>'required|date|before_or_equal:today|after_or_equal:'.now()->subDays(30),  // 30-day window
  'files'=>'required|array|min:1', 'files.*'=>'file|max:5120|mimes:pdf,jpg,jpeg,png',          // receipt mandatory
  'category_id'=>'nullable|integer', 'currency'=>'nullable|max:8', ...]);
// store each receipt → expense_claims/{employeeId}; attachments=[{name,size,path}]
// auto-clear manager stage if the employee has no reporting_manager_id
DB::transaction(function () {                                        // nextClaimNo() needs the tx
    $claimNo = $this->nextClaimNo();                                 // EXP-#### under lockForUpdate
    ExpenseClaim::create($data + ['claim_no'=>$claimNo, 'employee_name'=>..., 'currency'=>'INR',
        'status'=>'pending', 'hr_status'=>'pending', 'manager_id'=>..., 'category_name'=>...]);
});   // 201
```
Advance `store()` is the same shape: `requested_date` must be **today**; `recovery_mode` in emi/lumpsum/bimonthly; `recovery_months` required for EMI; `advance_type_other` required when type=Other; **receipts optional**; code `ADV-####`.

---

## 2. MANAGER STAGE

### `managerAct()` (managerApprove / managerReject)
```php
if ($row->manager_id !== $this->currentEmployeeId() && !super_admin) abort(403);   // assigned manager
if ($row->manager_status !== 'pending') abort(409);
$row->manager_status = $verdict; $row->manager_acted_at = now(); $row->manager_comment = $comment;
if ($verdict === 'rejected') $row->status = 'rejected';            // reject closes the claim
$row->save();
```

---

## 3. HR / FINANCE STAGE

### `hrAct()` (hrApprove / hrReject)
```php
$this->guardHrPermission($user, 'can_approve');                    // hr.expense
if ($verdict === 'approved' && $row->manager_status !== 'approved') abort(409);   // manager first
if ($row->hr_status !== 'pending') abort(409);
$row->hr_status = $verdict; $row->hr_user_id = $user->id; $row->hr_acted_at = now(); $row->hr_comment = $comment;
$row->status = $verdict;                                           // HR = final word
$row->save();
```

---

## 4. LISTING & SCOPE

### `index()`
```php
// scope = mine | team | all
// mine: employee_id = resolved employee (or -1)
// team: admins see tenant; managers see transitive reports via downstreamEmployeeIds() (BFS on reporting_manager_id)
// all:  guardHrPermission(can_view); optional employee_id filter
// applyTenantScope(); optional status filter; returns serialize() rows (no pagination)
```

---

## 5. PAYROLL RECOVERY

### `PayrollService::advanceRecovery(employeeId, period)`
```php
$rows = advance_requests where hr_status='approved' and recovery_start <= period_end;
foreach ($rows as $a) {
    if ($a->recovery_mode === 'emi') {
        // due only while period is within recovery_start .. +months-1 (EOM); amount = monthly_emi ?? amount/months
    } else {  // lumpsum / bimonthly (bimonthly NOT special-cased)
        // full amount once, only in the recovery_start year+month
    }
}
// caller caps advanceRec to netBeforeRecovery (earnedGross − pf/esi/pt/tds/other);
//   if exceeded → reduced + warning "Advance EMI exceeded net salary — capped…"
// stored on payslip.advance_recovery; FnF adds back the month's EMI so outstanding recovers once
```

---

## 6. ATTACHMENTS
```php
downloadAttachment(): authenticateFromQueryToken(?token=); tenant check; stream file by index
// public route (outside the auth group)
```

---

## 7. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Two-stage approval | managerAct → hrAct | Manager then finance |
| Row-locked codes | nextClaimNo / nextAdvanceNo | Unique EXP-/ADV-#### |
| Auto-clear manager | store | No manager → skip stage 1 |
| Transitive reports | downstreamEmployeeIds (BFS) | Team scope |
| Recovery cap | PayrollService | Never negative net |
| Employee-name snapshot | claims | Survive employee delete |

---

## 8. NOTES & CAVEATS
- No DB FKs / soft deletes on the three tables.
- Category limits unenforced; bimonthly = lumpsum in payroll.
- Receipts mandatory for claims, optional for advances; attachment routes public (`?token=`).
- Two permission slugs: `hr.expense` vs `master.expense_category`.
- DB is PostgreSQL.

---

*Related documents: EXPENSE_TECHNICAL_DOCUMENTATION.md · EXPENSE_FUNCTIONAL_DOCUMENTATION.md · EXPENSE_API_DOCUMENTATION.md*
