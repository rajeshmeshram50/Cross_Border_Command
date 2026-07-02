# EXIT MANAGEMENT MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Exit Management
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: open exit → save draft → complete → status/login/payroll effects. Line numbers may drift. Legend: `→` a call · `⇒` a return. Files: `ExitController.php`, `EmployeeExit.php`, `HrExitManagement.tsx`, `PayrollService.php`/`PayrollController.php`.

---

## 1. OPENING THE EXIT (lazy default)

### Frontend (`HrExitManagement.tsx`)
```tsx
// hub lists fully-onboarded employees, bucketed; opening the wizard:
const res = await api.get(`/employees/${id}/exit`);   // always returns a shape (row or default)
```

### `ExitController::show()` (28)
```php
$employee = Employee::withTrashed()->findOrFail($employeeId);   // disabled employees still load
$this->guardSameTenant($request, $employee);                    // authz (see §4)
$row = EmployeeExit::firstWhere('employee_id', $employee->id);  // may be null
return response()->json($this->format($row, $employee));        // format() supplies defaults
```
`format()` returns a flat object with sensible defaults (`exit_case_status='Open'`, `current_stage=1`) plus a `reporting_manager` payload whose `disabled` flag is true when the manager is soft-deleted or Resigned/Terminated/Inactive — so the wizard can block on a stale manager.

---

## 2. SAVING A DRAFT (any stage)

### Frontend
```tsx
await api.put(`/employees/${id}/exit`, buildExitPayload());   // Save Draft / per-stage save
```

### `ExitController::upsert()` (40)
```php
$this->guardSameTenant($request, $employee);
$data = $this->validatePayload($request);                     // rules per stage (all nullable)
$row = EmployeeExit::firstOrNew(['employee_id' => $employee->id]);
$row->fill($data);
$row->employee_id = $employee->id;                            // forced
$row->client_id   = $employee->client_id;                     // forced (never from body)
$row->branch_id   = $employee->branch_id;
$row->reporting_manager_id ??= $employee->reporting_manager_id;
if (!$row->exists) $row->created_by = $request->user()?->id;
$row->save();
return response()->json(['message' => 'Saved', 'exit' => $this->format($row->fresh(), $employee)]);
```

---

## 3. COMPLETING THE EXIT (the finalize)

### Frontend gates then completes
```tsx
// completeExit() checks: LWD reached, manager ok, all assets handed over,
// all exit docs Completed, all clearances Approved, all validations ticked, HR sign-off Approved
await api.post(`/employees/${id}/exit/complete`, buildExitPayload());
```

### `ExitController::complete()` (69)
```php
$this->guardSameTenant($request, $employee);
$data = $this->validatePayload($request);

DB::transaction(function () use ($employee, $data, $request) {
    $row = EmployeeExit::firstOrNew(['employee_id' => $employee->id]);
    $row->fill($data);
    $row->employee_id = $employee->id;
    $row->client_id   = $employee->client_id;
    $row->branch_id   = $employee->branch_id;
    // forced closure state (ignores client input)
    $row->exit_case_status = 'Closed';
    $row->current_stage    = 4;
    $row->completed_at     = now();
    $row->save();

    // employee → Resigned | Terminated
    $employee->status = $this->resolveFinalStatus($row->exit_type);
    $employee->save();

    // disable the paired login (reversible — no soft delete)
    if ($employee->user_id && ($user = User::find($employee->user_id))) {
        $user->status = 'inactive';
        $user->save();
        $user->tokens()->delete();          // revoke all Sanctum tokens
    }
});

$this->sendFarewellEmail($employee);        // after commit; best-effort, never throws
return response()->json(['message' => 'Exit completed — employee marked as exited and login disabled.',
                         'exit' => $this->format($employee->exit()->first(), $employee)]);
```

### `resolveFinalStatus()` (160)
```php
return match ($exitType) {
    'Termination', 'Absconding' => 'Terminated',
    default                     => 'Resigned',   // Resignation/Retirement/End of Contract/Other/blank
};
// employees.status enum has no Retired/Exited → Retirement maps to Resigned (avoids CHECK-constraint 500)
```

---

## 4. AUTHORIZATION

```php
private function guardSameTenant($request, $employee) {          // 207
    $user = $request->user(); if (!$user) abort(401);
    $this->authorizeMaster($user);                               // permission gate
    if ($user->user_type === 'super_admin') return;
    if ($user->client_id !== $employee->client_id) abort(403);   // same-tenant
}
private function authorizeMaster($user) {                        // 220
    if ($user->isSuperAdmin()) return;
    $moduleId = Module::where('slug','master.employees')->value('id');   // exit piggybacks on Employees
    if (!$moduleId) { if (in_array($user->user_type,['client_admin','branch_user'])) return; abort(403); }
    $ok = Permission::where('user_id',$user->id)->where('module_id',$moduleId)->where('can_edit',true)->exists();
    if (!$ok) abort(403);
}
```

---

## 5. THE MODEL (`EmployeeExit`)
```php
class EmployeeExit extends Model {   // NO SoftDeletes
    protected $casts = ['notice_date'=>'date','last_working_day'=>'date',
        'clearances'=>'array','asset_returns'=>'array','validation'=>'array','stage_status'=>'array',
        'current_stage'=>'integer','completed_at'=>'datetime'];
    public function employee() { return $this->belongsTo(Employee::class); }
    public function manager()  { return $this->belongsTo(Employee::class, 'reporting_manager_id'); }
}
```
Stage 2/4 data (clearances, asset_returns, validation, stage_status) are stored as JSON blobs on the single row.

---

## 6. PAYROLL HANDOFF

### Exclusion from regular payroll (`PayrollService::eligibleEmployees`, 390)
```php
Employee::whereNotIn('status', ['Inactive','Resigned','Terminated'])   // completed exits dropped
    ->where('onboarding_stage_completed', '>=', 6)
    ->when($period->client_id, ...)->when($period->branch_id, ...)
    ->get()
    ->reject(fn($e) => ($exitMap[$e->id] ?? null) && $exitMap[$e->id] < $period->period_start);
    // exitMap = employee_id → last_working_day (from employee_exits)
```

### Full & Final (`PayrollController::fnf` → `PayrollService::computeFnf`)
```php
// controller: 422 unless an employee_exits row exists
if (!DB::table('employee_exits')->where('employee_id',$employeeId)->exists())
    return response()->json(['message' => 'This employee has no exit record…'], 422);
// service: LWD from the exit row drives the settlement window
$lwd = employee_exits.last_working_day ?? now();
```

---

## 7. FRONTEND STAGE 3 (exit documents)

`ExitProcessModal` Stage 3 wires into the HR document engine:
```tsx
GET  /hr-document-templates/match?employee_id=&trigger_keyword=exit   // matching exit templates
GET  /hr-document-templates/{id}/preview · /generate (blob DOCX)
POST /hr-document-signatures  (+ /{id}/remind, /{id}/download-pdf)
GET  /hr-generated-documents · /hr-document-signatures
// completion gate: every matched exit doc run status === 'Completed'
```

---

## 8. NOTES & CAVEATS
- **No dedicated exit permission** — gated by `master.employees` `can_edit`.
- **No DB FKs** on `employee_exits` (incl. `reporting_manager_id`).
- **Completion is reversible** — no soft delete; re-activate the employee to undo.
- **"6 stages"** in the reference checklist ≠ the 4-stage operative wizard.
- **Farewell email** is best-effort to the personal email.
- **DB is PostgreSQL.**

---

*Related documents: EXIT_TECHNICAL_DOCUMENTATION.md · EXIT_FUNCTIONAL_DOCUMENTATION.md · EXIT_API_DOCUMENTATION.md*
