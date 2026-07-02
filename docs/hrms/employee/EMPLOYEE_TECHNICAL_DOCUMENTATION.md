# EMPLOYEE MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Employee Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
The Employee module is the HRMS **employee master** — the canonical record for every staff member. Each employee row is paired with a login `User` (`user_type=employee`), carries multi-role assignments, documents, previous employments, assets, salary/finance fields, face biometrics, and an onboarding progress meter. It also powers **self-service** (an employee can view their own profile, holidays, and edit their own bank details) and feeds Attendance, Leave, Payroll and Exit.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  HrEmployees.tsx (list + 4-step Add/Edit wizard + invite + assets)    │
│  EmployeeProfile.tsx (tabbed profile: Profile/Job/Attendance/Vault/   │
│    Payroll/Expense/Leave/Holidays/Hiring)                             │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON (multipart for docs/photo)
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  EmployeeController (CRUD + self-service + provisions User login)      │
│    authorize(master.employees) · applyScope · resolveIdParam          │
│    updateBankDetails (self-or-can_edit) · grantSelfServicePermissions │
│  EmployeeDocumentController (docs; tenant-gated, no module perm)       │
│  PreviousEmploymentController (prior employers; tenant-gated)          │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  employees (many fields; multi-role JSON; soft deletes) ─ user_id →   │
│    users (login; password_encrypted)                                  │
│  employee_documents · previous_employments · employee_exits ·         │
│  attendances · leave_requests · salary_structures · payslips          │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/
  EmployeeController.php            # ~1779 lines — CRUD + self-service + login provisioning
  EmployeeDocumentController.php    # per-employee documents (upload/verify/reject/download)
  PreviousEmploymentController.php  # prior-employer background records
app/Models/Employee.php            # the master record (~454 lines)
database/migrations/
  2026_05_01_000001_create_employees_table.php  (+ ~20 ALTERs)
  2026_05_02_000001_create_employee_documents_table.php
  2026_05_02_000002_create_previous_employments_table.php
resources/js/pages/hrms/HrEmployees.tsx          # list + wizard
resources/js/pages/employee/EmployeeProfile.tsx  # tabbed profile
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum |
| Auth extras | `PasswordHistory` trait; reversible `password_encrypted` on the paired user |
| Files | `public` disk (documents, photo) |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) · xlsx export · face-api.js |

---

## 3. DATABASE SCHEMA

### 3.1 `employees` (highlights — the table has ~120 columns across create + ~20 ALTERs)
`SoftDeletes`. `user_id` **unique** (one login per employee). Partial unique `(client_id, emp_code)` where code non-blank.

| Group | Columns |
|---|---|
| Tenancy | client_id, branch_id, created_by, **user_id (unique)** |
| Identity | emp_code, first_name, middle_name, last_name, display_name, gender, date_of_birth, blood_group, email, official_email, mobile, alt_mobile, nationality_country_id, work_country_id |
| Address | country_id, state_id, city, address_line1/2, pincode + perm_* (permanent) |
| Job | department_id, designation_id, primary_role_id, **ancillary_role_id (legacy), ancillary_role_ids (JSON)**, work_type, reporting_manager_id, reporting_manager_user_id, date_of_joining, probation_*, notice_period(_days), legal_entity_id, location |
| Work | leave_plan, holiday_group_id, shift, weekly_off, attendance_tracking, attendance_number, assets (laptop/mobile/other master asset ids) |
| Payroll/finance | enable_payroll, pay_group, annual_salary, salary_frequency, salary_effective_from, salary_structure, tax_regime, pf_eligible, pf_type, esi_applicable, bank_name, bank_account_number, ifsc_code, account_holder_name, bank_branch, bank_account_type, uan_number, pan_number, agreed_ctc_lpa |
| Biometric | face_descriptor (JSON, `$hidden`), face_registered_at, face_consent_* |
| Lifecycle | **status** (enum: Active/Inactive/On Leave/Probation/Notice Period/Resigned/Terminated), wizard_step_completed (0–4), onboarding_stage_completed (0–6) |

**Status enum:** `Active` (default), Inactive, On Leave, Probation, Notice Period, Resigned, Terminated.

### 3.2 `employee_documents`
`SoftDeletes`. `document_key` (e.g. `photo`, `prev_<id>_exp_letter`); `status` enum pending/uploaded/verified/rejected (default uploaded); `file_path`, `original_name`, `mime_type`, `size_bytes`, `rejection_reason`, uploader/verifier + timestamps. **Partial unique `(employee_id, document_key)` WHERE deleted_at IS NULL** (re-upload after soft delete works). FK `employee_id` cascade.

### 3.3 `previous_employments`
`SoftDeletes`. `company_name` (required), `job_title`, `start_date`, `end_date`, `hr_email_1`, `hr_email_2`, `contact_number`. Index `(employee_id, deleted_at)`. FK `employee_id` cascade. (Captured at onboarding for background verification.)

---

## 4. MODEL (`app/Models/Employee.php`)

```php
class Employee extends Model {
    use SoftDeletes;
    const DISABLED_STATUSES = ['inactive','resigned','terminated'];
    protected $hidden  = ['face_descriptor'];   // raw 128-d biometric never serialized
    protected $appends = ['other_assets_resolved','ancillary_roles_resolved','photo_url',
                          'face_registered','encrypted_id','profile_completion'];
    // casts: dates; assets/other_master_asset_ids/ancillary_role_ids/face_descriptor => array;
    //        annual_salary/agreed_ctc_lpa => decimal:2; many booleans/integers

    public static function composeDisplayName(...);      // first/middle/last → display_name
    public function isDisabled(): bool;                  // trashed OR terminal status

    // key accessors
    public function getProfileCompletionAttribute();     // 50% fields filled + 50% stage/6
    public function getEncryptedIdAttribute();           // URL-safe Crypt token (profile links)
    public function getAncillaryRolesResolvedAttribute();// ancillary_role_ids, legacy fallback

    // relationships: client, branch, creator, user, department, designation, primaryRole,
    //   ancillaryRole, holidayGroup, reportingManager(+User), laptop/mobileAsset,
    //   photoDocument, exit (hasOne), previousEmployments, attendances, leaveRequests,
    //   salaryStructures, activeSalaryStructure, payslips
}
```

**Multi-role:** current roles live in `ancillary_role_ids` (JSON); `ancillary_role_id` is a legacy single-value fallback (mirrored by `mirrorAncillaryRoles`).

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/employees/next-code',        [EmployeeController::class, 'nextCode']);
    Route::get   ('/employees/managers',         [EmployeeController::class, 'managers']);
    Route::get   ('/employees/available-assets', [EmployeeController::class, 'availableAssets']);
    Route::get   ('/employees/check-mobile',     [EmployeeController::class, 'checkMobile']);
    Route::post  ('/employees/onboarding-invite',[OnboardingController::class, 'createInvite']);
    Route::patch ('/employees/{id}/restore',     [EmployeeController::class, 'restore']);
    Route::delete('/employees/{id}/force',       [EmployeeController::class, 'forceDestroy']);
    Route::get   ('/employees/{id}/holidays',    [EmployeeController::class, 'holidays']);
    Route::post  ('/employees/{id}/set-password',[EmployeeController::class, 'setPassword']);
    Route::put   ('/employees/{id}/bank-details',[EmployeeController::class, 'updateBankDetails']);
    Route::apiResource('employees', EmployeeController::class);  // index/store/show/update/destroy
    // documents
    Route::get   ('/employees/{employee}/documents', [EmployeeDocumentController::class, 'index']);
    Route::post  ('/employees/{employee}/documents', [EmployeeDocumentController::class, 'store']);
    Route::get   ('/documents/{document}/download',  [EmployeeDocumentController::class, 'download']);
    Route::patch ('/documents/{document}/verify',    [EmployeeDocumentController::class, 'verify']);
    Route::patch ('/documents/{document}/reject',    [EmployeeDocumentController::class, 'reject']);
    Route::delete('/documents/{document}',           [EmployeeDocumentController::class, 'destroy']);
    // previous employments
    Route::get   ('/employees/{employee}/previous-employments', [PreviousEmploymentController::class, 'index']);
    Route::post  ('/employees/{employee}/previous-employments', [PreviousEmploymentController::class, 'store']);
    Route::patch ('/previous-employments/{prev}', [PreviousEmploymentController::class, 'update']);
    Route::delete('/previous-employments/{prev}', [PreviousEmploymentController::class, 'destroy']);
});
```
Specific routes are declared before `apiResource` to avoid shadowing. Full detail in **EMPLOYEE_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS (`EmployeeController`)

Permission slug: **`master.employees`** (flags can_view/add/edit/delete). `resolveIdParam` accepts numeric id, encrypted token, or `emp_code`.

| Method | Purpose | Auth notes |
|---|---|---|
| `index` | List (search/status/department/`onboarded_only`), `withTrashed` for the Disabled tab | can_view + applyScope |
| `show` | Single employee | **self may view own** (by `user_id`) without grant; else can_view |
| `updateBankDetails` | Self-service bank edit | **self edits own**; others need can_edit; 422 if disabled |
| `holidays` | Employee holiday-group calendar | authorizeViewOrSelf |
| `managers` / `nextCode` / `checkMobile` / `availableAssets` | Pickers/helpers | can_view |
| `store` | Create employee **+ paired User login** (emp_code under lock, guardDuplicate, branch-user cap, leave-plan pivot, grantSelfServicePermissions) | can_add; transaction |
| `update` | Update; cascades name/email/phone/status to the user; email change → reset + revoke tokens; high-watermark onboarding stage; welcome email at step≥4; recompute payslips if payroll touched | can_edit; transaction |
| `destroy` / `restore` / `forceDestroy` | Soft delete / re-enable / permanent (disabled-only) | can_delete/can_edit; guardHierarchicalAction |
| `setPassword` | Admin reset (PasswordHistory reuse-check) | can_edit; can't reset self |

**Self-service exemptions:** `show`, `holidays`, `updateBankDetails` allow an employee to read/edit their **own** record without holding `master.employees`. New hires get only `dashboard` + `profile` view permissions.

> `EmployeeDocumentController` and `PreviousEmploymentController` gate on **tenant match only** (client_id), not the module permission.

---

## 7. FRONTEND

### 7.1 `HrEmployees.tsx` — list + 4-step wizard
Tabs Active/Disabled; KPI cards (Total, Active, Disabled, Onboarding Completed, New Joiners). Table: Sr No, Employee, Emp ID, Department, Designation, Primary Role, Ancillary Role, Manager, Profile %, Onboarding, Actions. Wizard steps: 1 Personal/Identity, 2 Job/Org, 3 Work Details/Assets, 4 Compensation (salary breakup). Modals: Add/Edit wizard, Onboarding-invite, Assign Assets, Face Registration, Evidence Vault, delete/disable confirms. Profile links use `encrypted_id`.

### 7.2 `EmployeeProfile.tsx` — tabbed profile
Tabs: `profile · job · attendance · vault · payroll · expense · apply_leave · holidays · hiring` (Hiring conditional). Self-service + HR view. Loads via `/employees` (by emp_code) then `/employees/{id}`. Modals: Attendance Regularization, Payslip Viewer, Salary Structure, Salary Breakdown, Expense/Advance claim, Change/Set Password, Image Cropper (photo), Face Registration, Hiring Request modals.

---

## 8. SECURITY & CAVEATS
1. **Employee ↔ User pairing** — create provisions a login; email change forces reset + token revoke; delete/deactivate revokes tokens.
2. **Self-service** is scoped to the employee's own record (via `user_id`), bypassing the module grant only for read/holidays/bank-details.
3. **Reversible bank/login handling** — the paired user stores `password_encrypted`; bank-details edit validates IFSC and writes only bank columns.
4. **Face descriptor** is `$hidden` (never serialized).
5. **Documents & previous-employments** are tenant-gated only (no module permission).
6. **Multi-role** lives in `ancillary_role_ids` JSON (legacy single column mirrored).
7. **`onboarding_stage_completed`** is a high-watermark (never decreases).

---

## 9. METRICS
| Metric | Value |
|---|---|
| EmployeeController LOC | ~1779 |
| Controllers | 3 (Employee, Documents, PreviousEmployment) |
| employees columns | ~120 |
| DB transactions | store / update / destroy paths |
| Permission slug | master.employees |
| Test coverage | none automated |

---

*Related documents: EMPLOYEE_FUNCTIONAL_DOCUMENTATION.md · EMPLOYEE_CODE_WALKTHROUGH.md · EMPLOYEE_API_DOCUMENTATION.md*
