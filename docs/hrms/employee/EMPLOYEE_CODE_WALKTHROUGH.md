# EMPLOYEE MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Employee Master
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: list → create (with login provisioning) → update (cascades) → self-service → documents. Line numbers may drift. Legend: `→` a call · `⇒` a return. Files: `EmployeeController.php`, `Employee.php`, `EmployeeDocumentController.php`, `HrEmployees.tsx`, `EmployeeProfile.tsx`.

---

## 1. LISTING & RESOLUTION

### `EmployeeController::index()` (83)
```php
$this->authorize($request, 'can_view');                       // master.employees
$q = Employee::query()->withTrashed()->with(self::WITH);      // Disabled tab needs trashed
$this->applyScope($q, $request->user(), $request->integer('branch_id') ?: null);
// filters: search (ilike display_name/emp_code/email/mobile), status, department_id,
//          onboarded_only → whereNull deleted_at + status Active + onboarding_stage_completed >= 6
return response()->json($q->orderByDesc('id')->get());
```

### `resolveIdParam()` (249) — flexible id
```php
// numeric → id; else try Crypt::decryptString(token) → id; else emp_code lookup (tenant-scoped)
```
Used by `show`/`updateBankDetails`/etc. so the SPA can pass an opaque `encrypted_id`, a raw id, or an `EMP-###` code.

### `applyScope()` (1113)
Branch users are strictly isolated to their own branch (globals visible); client admins see client-level rows (+ switcher); super-admins see all.

---

## 2. CREATE (employee + paired login)

### `EmployeeController::store()` (602)
```php
$this->authorize($request, 'can_add');
$data = $this->validatePayload($request);

return DB::transaction(function () use ($request, $data) {
    $this->assertBranchUserCap(...);                          // branch.max_users guard
    $this->guardDuplicate($data, ...);                        // mobile duplicate probe
    $empCode = $this->allocateCode($clientId, $branchId);     // EMP-### under lockForUpdate

    // 1. paired login
    $user = User::create([ 'name'=>..., 'email'=>$data['email'], 'user_type'=>'employee',
                           'password'=>Hash::make($this->generatePassword()), 'status'=>'active', ... ]);

    // 2. employee row
    $data = $this->mirrorAncillaryRoles($data);               // JSON ↔ legacy single
    $data = $this->stripDanglingAssetRefs($data);
    $employee = Employee::create($data + ['user_id'=>$user->id, 'emp_code'=>$empCode, ...]);
    $user->update(['employee_code'=>$empCode]);

    $this->syncLeavePlanPivot($employee, ...);
    $this->grantSelfServicePermissions($user, ...);           // dashboard + profile view only
    return response()->json(['message'=>'…', 'employee'=>$employee->load(self::WITH)], 201);
});
// PG 23505 (unique email) → 422 friendly message
```
> Welcome email is **not** sent here — it fires in `update()` once the wizard reaches step ≥ 4.

### `grantSelfServicePermissions()` (1749)
```php
foreach (['dashboard','profile'] as $slug)
    Permission::firstOrCreate(['user_id'=>$user->id,'module_id'=>...],
        ['can_view'=>true, /* actions false */, 'role'=>'employee']);
```

---

## 3. UPDATE (cascades to the login)

### `EmployeeController::update()` (741)
```php
$this->authorize($request, 'can_edit');
$row = $this->resolveRow($request, $this->resolveIdParam($id));
if ($row->isDisabled() && !$reactivating) return 422;         // no edits on disabled rows

$data = $this->validatePayload($request, $row->id);
DB::transaction(function () use (...) {
    // high-watermark onboarding stage: max(existing, incoming); step>=4 forces macro>=1
    $data['onboarding_stage_completed'] = max($row->onboarding_stage_completed, $incoming);
    $row->update($data);

    // cascade to the linked user
    if ($user = User::find($row->user_id)) {
        // name/email/phone/status sync; email change → must_reset_password=true + revoke tokens
        // status → inactive → revoke tokens
    }
    if ($payrollFieldTouched) $this->payroll->recomputeEmployeePayslips($row->id);  // non-locked runs
});
// welcome email when oldStep<4 && newStep>=4 (uses password_encrypted as sent-marker)
```

---

## 4. SELF-SERVICE

### `show()` (123) — self may view own
```php
$row = $this->resolveRow(...);
if ((int)($row->user_id ?? 0) !== (int)$request->user()->id)
    $this->authorize($request, 'can_view');                  // others need the grant
```

### `updateBankDetails()` (149) — self edits own
```php
$row = $this->resolveRow(...);
$isSelf = (int)($row->user_id ?? 0) === (int)$request->user()->id;
if (!$isSelf) $this->authorize($request, 'can_edit');
if ($row->isDisabled()) return 422;
$data = $request->validate([ ...bank fields; ifsc regex; account letters allowed... ]);
if (!empty($data['ifsc_code'])) $data['ifsc_code'] = strtoupper($data['ifsc_code']);
$row->fill($data)->save();                                    // only bank columns written
return response()->json(['message'=>'Bank details updated.', 'data'=>$row->only(array_keys($data))]);
```

### `holidays()` (205) — self or viewer
Resolves the employee's holiday group and returns the year's holidays (recurring ones shifted to the requested year), gated by `authorizeViewOrSelf`.

---

## 5. DOCUMENTS (`EmployeeDocumentController`)

```php
// authz: tenant match only (client_id === user's; super_admin bypass) — NOT the module perm
// store (45): 422 if employee isDisabled(); validate document_key + file (max 2MB;
//   mimes pdf/jpg/jpeg/png/webp + two-signal MIME/ext check); withTrashed restore to reuse slot;
//   delete old file; store at employee-documents/{id}/{key}-{time}.ext; status 'uploaded'
// verify (147) / reject (160, reason required) / destroy (176 soft) / download (194 stream)
```

---

## 6. THE MODEL — key accessors

```php
getProfileCompletionAttribute()   // 50% (17 data fields filled) + 50% (onboarding_stage_completed/6)
getEncryptedIdAttribute()         // URL-safe Crypt::encryptString(id) for profile/permission links
getAncillaryRolesResolvedAttribute() // resolves ancillary_role_ids (legacy ancillary_role_id fallback)
$hidden = ['face_descriptor']      // biometric never serialized
```

---

## 7. FRONTEND

### `HrEmployees.tsx`
```tsx
GET  /employees                              // list (+ onboarded_only)
GET  /master/{departments,designations,roles,legal_entities,countries,states} · /holiday-groups
GET  /employees/next-code · /managers · /available-assets?category= · /check-mobile
POST /employees | PUT /employees/{id}        // 4-step wizard save
POST /employees/onboarding-invite            // invite generator
POST /employees/{id}/documents               // doc upload
PATCH /employees/{id}/restore | DELETE /employees/{id}[/force]
```

### `EmployeeProfile.tsx`
```tsx
GET /employees (by emp_code) → GET /employees/{id}
// tabs load: payslips, salary-structures, documents, signed-documents, expense/advance,
//            my-team, hiring-requests, holidays
PUT /employees/{id}/bank-details             // self-service bank edit (PayrollTab)
POST /employees/{id}/set-password | /change-password
```

---

## 8. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Employee ↔ User provisioning | store() | One login per employee |
| Flexible id resolution | resolveIdParam | id / token / emp_code |
| Self-service exemptions | show/holidays/updateBankDetails | Own record without the grant |
| High-watermark onboarding | update() | Progress never regresses |
| Cascade to login | update()/destroy() | Email/status changes keep auth in sync |
| Tenant-only doc auth | EmployeeDocumentController | Lighter gate for attachments |
| Payslip recompute | update() | Keep pay in sync when comp changes |

---

## 9. NOTES & CAVEATS
- Documents & previous-employments gate on **tenant only** (no module permission).
- Welcome email fires at wizard step ≥ 4, using `password_encrypted` as a sent-marker.
- `emp_code` allocated under a row lock; partial unique `(client_id, emp_code)`.
- Face descriptor is `$hidden`.
- DB is PostgreSQL — `ilike`, JSON `ancillary_role_ids`, partial unique indexes.

---

*Related documents: EMPLOYEE_TECHNICAL_DOCUMENTATION.md · EMPLOYEE_FUNCTIONAL_DOCUMENTATION.md · EMPLOYEE_API_DOCUMENTATION.md*
