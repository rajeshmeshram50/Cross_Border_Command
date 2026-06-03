# Part 08 — HR: Employees, Documents, Onboarding, Exit, Previous Employment, Attendance, Leave Plans & Requests

> Base URL: `http://127.0.0.1:8000`
> All endpoints require `Authorization: Bearer {{token}}` **except** the PUBLIC onboarding pair (`GET /api/onboarding/{token}` and `POST /api/onboarding/{token}/complete`), which are 64-char token-gated and rate-limited to 30 req/min/IP.
> `{employee}` path params accept a numeric id, an `emp_code` (e.g. `EMP-001`), or the encrypted-id token used by SPA URLs (`resolveIdParam`).

---

## EmployeeController

### GET /api/employees
**Action:** `EmployeeController@index` — list employees (includes soft-deleted rows so the Disabled tab can render).
**Auth:** Bearer token required (needs `can_view` on `master.employees`)
**Query params:** `search` (matches display_name / emp_code / email / mobile), `status`, `department_id`, `branch_id` (BranchSwitcher narrow)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees?search=patekar&status=Active&department_id=3' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/employees
**Action:** `EmployeeController@store` — create employee + paired login User; welcome email defers to wizard Step 4.
**Auth:** Bearer token required (needs `can_add` on `master.employees`)

```bash
curl -X POST 'http://127.0.0.1:8000/api/employees' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "first_name": "Atharv",
  "middle_name": "Suresh",
  "last_name": "Patekar",
  "email": "atharv.patekar@example.com",
  "mobile": "+91 9876543210",
  "gender": "Male",
  "date_of_birth": "1996-04-12",
  "department_id": 3,
  "designation_id": 7,
  "designation_name": "Sales Executive",
  "date_of_joining": "2026-06-01",
  "reporting_manager_id": 2,
  "leave_plan": "Standard FY Plan",
  "status": "Active",
  "wizard_step_completed": 1
}'
```

**Body fields:**
- `first_name` (string, max 100) — **required** (only hard-required field; drives display_name).
- `email` (email, max 191) — **required** on store, unique on `users.email` (case-insensitive). Lowercased server-side.
- All other ~50 profile fields are **optional** (wizard saves incrementally). Key ones:
  - Identity (opt): `middle_name`, `last_name` (string max 100), `gender` (in: Male, Female, Other, Prefer not to say), `date_of_birth` (date), `blood_group`, `nationality_country_id`/`work_country_id` (int), `official_email` (email), `mobile`/`alt_mobile` (string max 15, regex `^[+0-9\s\-()]{6,15}$`).
  - Address (opt): `country_id`, `state_id` (int), `city`, `address_line1/2`, `pincode`; permanent mirror `perm_country_id`, `perm_state_id`, `perm_city`, `perm_address_line1/2`, `perm_pincode`.
  - Job (opt): `legal_entity_id`, `department_id`, `designation_id`, `primary_role_id`, `ancillary_role_id` (int), `ancillary_role_ids` (int array), `work_type`, `reporting_manager_id`, `reporting_manager_user_id`, `has_prior_experience` (bool), `probation_policy`, `probation_months` (0-60), `notice_period`, `notice_period_days` (0-365).
  - Work (opt, Step 3): `leave_plan`, `holiday_list`, `attendance_tracking` (bool), `shift`, `weekly_off`, `attendance_number`, `laptop_assigned`, `laptop_asset_id`, `mobile_device`, `other_assets`.
  - Compensation (opt, Step 4 — **required when `wizard_step_completed >= 4` AND `enable_payroll` true**): `annual_salary` (numeric, min 0.01, max 999999999999.99), `salary_frequency` (string max 30), `salary_effective_from` (date). Also `enable_payroll` (bool), `pay_group`, `salary_structure`, `tax_regime`, `bonus_in_annual`/`pf_eligible`/`detailed_breakup` (bool).
  - Payroll/Finance (opt): `salary_payment_mode` (in: bank, cheque, cash), `bank_name`, `bank_account_number` (max 30), `ifsc_code` (regex `^[A-Za-z]{4}0[A-Za-z0-9]{6}$`), `account_holder_name`, `bank_branch`, `bank_account_type`, `uan_number` (regex `^\d{12}$`), `pan_number` (regex `^[A-Za-z]{5}[0-9]{4}[A-Za-z]$`, tenant-unique, upper-cased), `pf_deduction`, `esi_applicable` (Yes/No), `gratuity_nominee_name`, `agreed_ctc_lpa` (numeric).
  - Assets (opt): `assets` (int array), `laptop_master_asset_id`/`mobile_master_asset_id` (int, exists:master_assets,id), `other_master_asset_ids` (int array, exists).
  - Physical setup (opt): `biometric_status` (Not Registered/Registered/Pending/Failed), `desk_workstation_no`, `id_card_status` (Not Printed/Printed/Issued/Lost/Reissued), `status` (Active/Inactive/On Leave/Probation/Notice Period/Resigned/Terminated), `onboarding_stage_completed` (int 0-6), `wizard_step_completed` (1-4).
  - Note: `client_id`/`branch_id` are derived from the authenticated user, never trusted from body (super_admin may pass them).

---

### GET /api/employees/available-assets
**Action:** `EmployeeController@availableAssets` — free assets for the Stage-1 dropdown (excludes assets booked by other employees).
**Auth:** Bearer token required (`can_view`)
**Query params:** `category` (**required** — laptop | mobile | other), `exclude_employee_id` (optional, keeps the edited row's own asset visible)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/available-assets?category=laptop&exclude_employee_id=15' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/employees/check-mobile
**Action:** `EmployeeController@checkMobile` — proactive uniqueness probe for the Mobile field.
**Auth:** Bearer token required (`can_view`)
**Query params:** `mobile` (the number to check), `exclude_employee_id` (optional, ignore this row on edit)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/check-mobile?mobile=9876543210&exclude_employee_id=15' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/employees/managers
**Action:** `EmployeeController@managers` — eligible Reporting Manager picker (active, fully-onboarded employees + tenant login users).
**Auth:** Bearer token required (`can_view`)
**Query params:** `branch_id` (optional BranchSwitcher narrow)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/managers' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/employees/next-code
**Action:** `EmployeeController@nextCode` — next `EMP-###` code for the resolved tenant.
**Auth:** Bearer token required (`can_view`)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/next-code' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/employees/{employee}
**Action:** `EmployeeController@show` — single employee with all nested relations.
**Auth:** Bearer token required (`can_view`)
**Path params:** `{employee}` = id / emp_code / encrypted token

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/EMP-001' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/employees/{employee}
**Action:** `EmployeeController@update` — partial per-step wizard save; cascades name/email/status/phone to the linked User; fires welcome email on Step 4.
**Auth:** Bearer token required (`can_edit`)
**Path params:** `{employee}` = numeric id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/employees/15' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "department_id": 3,
  "designation_id": 7,
  "designation_name": "Senior Sales Executive",
  "reporting_manager_id": 2,
  "wizard_step_completed": 2
}'
```

**Body fields:** same schema as POST but all nullable (including `email`, still uniqueness-checked). Partial step payloads accepted; `wizard_step_completed` / `onboarding_stage_completed` tracked as high-watermarks (never decrease). Disabled (soft-deleted) rows reject updates with 422.

---

### DELETE /api/employees/{employee}
**Action:** `EmployeeController@destroy` — soft-delete employee + disable login + revoke tokens.
**Auth:** Bearer token required (`can_delete`; hierarchical guard blocks acting on rows owned by higher-privileged users)
**Path params:** `{employee}` = numeric id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/employees/15' \
  --header 'Authorization: Bearer {{token}}'
```

---

### DELETE /api/employees/{id}/force
**Action:** `EmployeeController@forceDestroy` — permanently delete a row (only allowed when already soft-deleted).
**Auth:** Bearer token required (`can_delete` + hierarchical guard)
**Path params:** `{id}` = numeric id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/employees/15/force' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PATCH /api/employees/{id}/restore
**Action:** `EmployeeController@restore` — re-enable a soft-deleted employee (status → Active, re-enable login).
**Auth:** Bearer token required (`can_edit`)
**Path params:** `{id}` = numeric id

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/employees/15/restore' \
  --header 'Authorization: Bearer {{token}}'
```

---

## EmployeeDocumentController

### GET /api/employees/{employee}/documents
**Action:** `EmployeeDocumentController@index` — list an employee's uploaded documents.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{employee}` = numeric id (route-model bound)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/15/documents' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/employees/{employee}/documents
**Action:** `EmployeeDocumentController@store` — upload (or replace) a document for a `document_key`.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{employee}` = numeric id

```bash
curl -X POST 'http://127.0.0.1:8000/api/employees/15/documents' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'document_key=aadhaar' \
  --form 'file=@/path/to/aadhaar.pdf'
```

**Body fields (multipart):**
- `document_key` (string, max 60) — **required**.
- `file` (file, max 2 MB) — **required**. Allowed: PDF / JPG / JPEG / PNG / WEBP (accepted if MIME OR extension matches). Re-upload to the same key replaces the prior file and resets verification.

---

### PATCH /api/documents/{document}/verify
**Action:** `EmployeeDocumentController@verify` — mark a document verified.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{document}` = numeric document id

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/documents/42/verify' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PATCH /api/documents/{document}/reject
**Action:** `EmployeeDocumentController@reject` — mark a document rejected with a reason.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{document}` = numeric document id

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/documents/42/reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "rejection_reason": "Document is blurry and unreadable. Please re-upload a clear scan."
}'
```

**Body fields:** `rejection_reason` (string, max 500) — **required**.

---

### DELETE /api/documents/{document}
**Action:** `EmployeeDocumentController@destroy` — soft-delete a document and remove its file from disk.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{document}` = numeric document id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/documents/42' \
  --header 'Authorization: Bearer {{token}}'
```

---

## OnboardingController

### POST /api/employees/onboarding-invite
**Action:** `OnboardingController@createInvite` — mint a 64-char onboarding token + email the candidate.
**Auth:** Bearer token required (super_admin / client_admin / branch_user only)

```bash
curl -X POST 'http://127.0.0.1:8000/api/employees/onboarding-invite' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "invitee_name": "Sneha Kulkarni",
  "invitee_email": "sneha.kulkarni@example.com",
  "department_id": 3,
  "expected_join_date": "2026-07-01",
  "expiry_days": 15,
  "app_origin": "http://127.0.0.1:8000"
}'
```

**Body fields:**
- `invitee_name` (string, max 255) — **required**.
- `invitee_email` (email, max 191) — **required**; must not already have a user account.
- `department_id` (int, exists:master_departments,id) — optional.
- `expected_join_date` (date) — optional.
- `expiry_days` (int, in: 3, 7, 15, 30; default 15) — optional.
- `app_origin` (url, max 255) — optional; SPA origin for the invite link.

---

### GET /api/onboarding/{token}
**Action:** `OnboardingController@show` — **Public (token-gated)** — preview the invite + tenant-scoped master dropdowns.
**Auth:** Public (no login; 64-char token, rate-limited 30/min/IP)
**Path params:** `{token}` = 64-char onboarding token

```bash
curl -X GET 'http://127.0.0.1:8000/api/onboarding/AbC123...64charToken...xYz'
```

> Returns 404 (invalid), 410 (completed / cancelled / expired) as applicable.

---

### POST /api/onboarding/{token}/complete
**Action:** `OnboardingController@complete` — **Public (token-gated)** — candidate submits the full form; creates Employee + User + sends welcome credentials.
**Auth:** Public (no login; 64-char token, rate-limited 30/min/IP)
**Path params:** `{token}` = 64-char onboarding token

```bash
curl -X POST 'http://127.0.0.1:8000/api/onboarding/AbC123...64charToken...xYz/complete' \
  --header 'Content-Type: application/json' \
  --data '{
  "first_name": "Sneha",
  "middle_name": "Rajesh",
  "last_name": "Kulkarni",
  "gender": "Female",
  "date_of_birth": "1998-02-20",
  "mobile": "9876501234",
  "country_id": 1,
  "state_id": 14,
  "city": "Pune",
  "address_line1": "Flat 7, Sunrise Residency",
  "pincode": "411014",
  "designation_id": 7,
  "date_of_joining": "2026-07-01"
}'
```

**Body fields:**
- `first_name` (string, max 100, name regex `^[A-Za-z][A-Za-z\s'\-.]*$`) — **required**.
- Names (opt): `middle_name`, `last_name` (same regex).
- `gender` (in: Male, Female, Other) — optional.
- `date_of_birth` (date, must be at least 18 years ago) — optional.
- `nationality_country_id`, `work_country_id` (int) — optional.
- `mobile`, `alt_mobile` (string max 30, regex `^[+\d\s\-()]{7,20}$`) — optional.
- Current address (opt): `country_id`, `state_id` (int), `city`, `address_line1/2`, `pincode` (regex `^\d{4,10}$`).
- Permanent address (opt): `perm_country_id`, `perm_state_id`, `perm_city`, `perm_address_line1/2`, `perm_pincode` (4-10 digits).
- Job (opt, defaults from invite when omitted): `department_id`, `designation_id`, `primary_role_id`, `ancillary_role_id`, `legal_entity_id` (int), `location` (string max 191), `date_of_joining` (date).
- Note: `email` comes from the invite, not the body.

---

## ExitController

### GET /api/employees/{employee}/exit
**Action:** `ExitController@show` — return the (possibly null) exit row, pre-filling reporting manager from the employee record.
**Auth:** Bearer token required (`can_edit` on `master.employees`, same-tenant)
**Path params:** `{employee}` = numeric id (route-model bound)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/15/exit' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/employees/{employee}/exit
**Action:** `ExitController@upsert` — create or update the exit record (Stage 1 Exit Initiation).
**Auth:** Bearer token required (`can_edit` on `master.employees`, same-tenant)
**Path params:** `{employee}` = numeric id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/employees/15/exit' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "exit_type": "Resignation",
  "initiated_by": "Employee",
  "reason_for_exit": "Better opportunity",
  "notice_date": "2026-06-03",
  "last_working_day": "2026-07-03",
  "reporting_manager_id": 2,
  "business_impact": "Medium",
  "replacement_required": "Yes — Within 30 days",
  "comments": "Smooth handover planned."
}'
```

**Body fields (all optional):**
- `exit_type` (in: Resignation, Termination, Retirement, End of Contract, Absconding, Other).
- `initiated_by` (in: Employee, HR, Manager).
- `reason_for_exit` (string, max 60), `other_reason` (string, max 255).
- `notice_date` (date), `last_working_day` (date, after_or_equal:notice_date).
- `reporting_manager_id` (int, exists:employees,id).
- `comments` (string, max 2000).
- `business_impact` (in: Low, Medium, High, Critical).
- `replacement_required` (in: `Yes — Immediate`, `Yes — Within 30 days`, `Yes — Within 90 days`, `No`).

---

## PreviousEmploymentController

### GET /api/employees/{employee}/previous-employments
**Action:** `PreviousEmploymentController@index` — list an employee's prior-employment records (Stage 2).
**Auth:** Bearer token required (same-tenant)
**Path params:** `{employee}` = numeric id (route-model bound)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/15/previous-employments' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/employees/{employee}/previous-employments
**Action:** `PreviousEmploymentController@store` — add a previous-employment record.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{employee}` = numeric id

```bash
curl -X POST 'http://127.0.0.1:8000/api/employees/15/previous-employments' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "company_name": "Infotech Solutions Pvt Ltd",
  "job_title": "Junior Developer",
  "start_date": "2022-01-10",
  "end_date": "2024-05-31",
  "hr_email_1": "hr@infotech.example.com",
  "hr_email_2": "payroll@infotech.example.com",
  "contact_number": "+91 2041234567"
}'
```

**Body fields:**
- `company_name` (string, max 255) — **required**.
- `job_title` (string, max 255) — optional.
- `start_date` (date) — optional.
- `end_date` (date, after_or_equal:start_date) — optional.
- `hr_email_1` (email, max 191) — optional.
- `hr_email_2` (email, max 191, different:hr_email_1) — optional.
- `contact_number` (string, max 30) — optional.

---

### PATCH /api/previous-employments/{prev}
**Action:** `PreviousEmploymentController@update` — edit a previous-employment record.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{prev}` = numeric record id (route-model bound)

```bash
curl -X PATCH 'http://127.0.0.1:8000/api/previous-employments/8' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "company_name": "Infotech Solutions Pvt Ltd",
  "job_title": "Software Developer",
  "end_date": "2024-06-30"
}'
```

**Body fields:** same as POST (`company_name` still required).

---

### DELETE /api/previous-employments/{prev}
**Action:** `PreviousEmploymentController@destroy` — soft-delete a previous-employment record.
**Auth:** Bearer token required (same-tenant)
**Path params:** `{prev}` = numeric record id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/previous-employments/8' \
  --header 'Authorization: Bearer {{token}}'
```

---

## AttendanceController

### GET /api/attendance
**Action:** `AttendanceController@index` — HR/admin paginated attendance list (employee user_type is blocked → use /my).
**Auth:** Bearer token required (non-employee)
**Query params:** `branch_id`, `date`, `from`, `to`, `employee_id`, `status`, `per_page` (default 50)

```bash
curl -X GET 'http://127.0.0.1:8000/api/attendance?date=2026-06-03&status=Present&per_page=50' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/attendance/daily-view
**Action:** `AttendanceController@dailyView` — per-employee daily card payload (status, punches, MTD KPIs, 90-day log) for the HR Attendance page.
**Auth:** Bearer token required (non-employee)
**Query params:** `date` (YYYY-MM-DD, default today IST), `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/attendance/daily-view?date=2026-06-03&branch_id=4' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/attendance/employee/{employeeId}/summary
**Action:** `AttendanceController@employeeSummary` — month summary (today card + stats + history) for a profile page.
**Auth:** Bearer token required (self, or admin in same tenant, or super_admin)
**Path params:** `{employeeId}` = numeric id **or** emp_code (e.g. EMP-001)
**Query params:** `month` (YYYY-MM, default current month IST)

```bash
curl -X GET 'http://127.0.0.1:8000/api/attendance/employee/EMP-001/summary?month=2026-06' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/attendance/face/clock-in
**Action:** `AttendanceController@faceClockIn` — verify face (threshold 0.55) and write an 'in' punch (strict in→out alternation; mismatch → 422).
**Auth:** Bearer token required (caller must have a linked employee record + enrolled face)

```bash
curl -X POST 'http://127.0.0.1:8000/api/attendance/face/clock-in' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "descriptor": [0.12, -0.04, 0.08, 0.15, -0.21, 0.03, "... 128 floats total ..."],
  "label": "Check In",
  "lat": 18.5204,
  "lng": 73.8567
}'
```

**Body fields:**
- `descriptor` (array, **exactly 128** numeric values) — **required**; the face-api.js 128-d descriptor.
- `descriptor.*` (numeric) — **required**.
- `label` (string, max 50) — optional (defaults to Check In / Step In by direction). Known labels: Check In, Step Out, Step In, Lunch Out, Lunch In, Meeting, Check Out (free text accepted).
- `lat` (numeric, -90..90) — optional.
- `lng` (numeric, -180..180) — optional.

---

### POST /api/attendance/face/clock-out
**Action:** `AttendanceController@faceClockOut` — verify face and write an 'out' punch (same alternation/threshold rules as clock-in).
**Auth:** Bearer token required (linked employee + enrolled face)

```bash
curl -X POST 'http://127.0.0.1:8000/api/attendance/face/clock-out' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "descriptor": [0.11, -0.05, 0.09, 0.14, -0.20, 0.04, "... 128 floats total ..."],
  "label": "Check Out",
  "lat": 18.5204,
  "lng": 73.8567
}'
```

**Body fields:** same as `face/clock-in` — `descriptor` (128 floats, required), `label` (opt), `lat`/`lng` (opt).

---

### GET /api/attendance/my
**Action:** `AttendanceController@my` — the signed-in employee's own paginated attendance history with punches.
**Auth:** Bearer token required (linked employee)
**Query params:** `from`, `to` (YYYY-MM-DD), `per_page` (default 30)

```bash
curl -X GET 'http://127.0.0.1:8000/api/attendance/my?from=2026-06-01&to=2026-06-30&per_page=30' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/attendance/today
**Action:** `AttendanceController@today` — today's attendance row + punch timeline + next_direction for the signed-in employee.
**Auth:** Bearer token required (linked employee)

```bash
curl -X GET 'http://127.0.0.1:8000/api/attendance/today' \
  --header 'Authorization: Bearer {{token}}'
```

---

## LeavePlanController

### GET /api/employees/{employeeId}/leave-balances
**Action:** `LeavePlanController@employeeBalances` — per-type balance/ledger for an employee's assigned leave plan.
**Auth:** Bearer token required
**Path params:** `{employeeId}` = numeric id

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/15/leave-balances' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/leave-balances
**Action:** `LeavePlanController@leaveBalances` — aggregated balances matrix (dynamic leave-type columns + per-employee rows) for the Leave Balances tab.
**Auth:** Bearer token required
**Query params:** `branch_id`, `department_id`, `location`, `search`

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-balances?department_id=3&search=patekar' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/leave-plans
**Action:** `LeavePlanController@index` — list leave plans (scoped) with employee/type counts.
**Auth:** Bearer token required
**Query params:** `branch_id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-plans?branch_id=4' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-plans
**Action:** `LeavePlanController@store` — create a leave plan.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-plans' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "plan_name": "Standard FY 2026-27 Plan",
  "description": "Default annual plan for full-time staff.",
  "from_month_type": "Calendar",
  "from_month": "April",
  "calendar_year": "2026",
  "policy_explanation_mode": "System",
  "status": "Active",
  "is_default": true
}'
```

**Body fields:**
- `plan_name` (string, max 255) — **required**.
- `from_month_type` (in: Calendar, If Joining) — **required**.
- `description` (string) — optional.
- `from_month` (in: January…December) — optional.
- `calendar_year` (string, max 20) — optional.
- `policy_explanation_mode` (in: System, Custom; default System) — optional.
- `policy_doc_path` (string, max 1024) — optional.
- `status` (in: Active, Inactive; default Active) — optional.
- `is_default` (bool) — optional (setting true clears the prior default for the branch).

---

### GET /api/leave-plans/{id}
**Action:** `LeavePlanController@show` — single plan with assigned types + employees.
**Auth:** Bearer token required
**Path params:** `{id}` = numeric plan id

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-plans/5' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/leave-plans/{id}
**Action:** `LeavePlanController@update` — edit a leave plan.
**Auth:** Bearer token required
**Path params:** `{id}` = numeric plan id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/leave-plans/5' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "plan_name": "Standard FY 2026-27 Plan (Revised)",
  "from_month_type": "Calendar",
  "status": "Active"
}'
```

**Body fields:** all `sometimes`/optional — `plan_name` (required when present), `from_month_type` (required when present, in: Calendar/If Joining), plus `description`, `from_month`, `calendar_year`, `policy_explanation_mode`, `policy_doc_path`, `status`, `is_default` (same rules as store).

---

### DELETE /api/leave-plans/{id}
**Action:** `LeavePlanController@destroy` — delete a plan (blocked with 422 if it is the default).
**Auth:** Bearer token required
**Path params:** `{id}` = numeric plan id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/leave-plans/5' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-plans/{id}/clone
**Action:** `LeavePlanController@clone` — duplicate a plan with its types/config (not employees, not default flag).
**Auth:** Bearer token required
**Path params:** `{id}` = source plan id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-plans/5/clone' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "plan_name": "Standard FY 2026-27 Plan (Copy)"
}'
```

**Body fields:** `plan_name` (string) — optional (defaults to `"<source> (Copy)"`).

---

### POST /api/leave-plans/{id}/employees
**Action:** `LeavePlanController@assignEmployees` — assign employees to a plan (each employee belongs to exactly one plan; upsert moves them).
**Auth:** Bearer token required
**Path params:** `{id}` = numeric plan id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-plans/5/employees' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "employee_ids": [15, 16, 17]
}'
```

**Body fields:** `employee_ids` (array, **required**), `employee_ids.*` (int, exists:employees,id, must be in the plan's tenant scope).

---

### DELETE /api/leave-plans/{id}/employees/{employeeId}
**Action:** `LeavePlanController@removeEmployee` — unassign an employee from a plan.
**Auth:** Bearer token required
**Path params:** `{id}` = plan id, `{employeeId}` = employee id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/leave-plans/5/employees/15' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-plans/{id}/make-default
**Action:** `LeavePlanController@makeDefault` — set a plan as the branch default (clears the prior default).
**Auth:** Bearer token required
**Path params:** `{id}` = numeric plan id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-plans/5/make-default' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-plans/{id}/types
**Action:** `LeavePlanController@assignTypes` — attach/replace the set of leave types on a plan.
**Auth:** Bearer token required
**Path params:** `{id}` = numeric plan id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-plans/5/types' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "leave_type_ids": [1, 2, 3],
  "mode": "replace"
}'
```

**Body fields:** `leave_type_ids` (array, **required**), `leave_type_ids.*` (int, exists:master_leave_types,id), `mode` (in: replace, append; default replace).

---

### DELETE /api/leave-plans/{id}/types/{typeId}
**Action:** `LeavePlanController@removeType` — detach a leave type from a plan.
**Auth:** Bearer token required
**Path params:** `{id}` = plan id, `{typeId}` = leave type id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/leave-plans/5/types/2' \
  --header 'Authorization: Bearer {{token}}'
```

---

### PUT /api/leave-plans/{id}/types/{typeId}/config
**Action:** `LeavePlanController@saveTypeConfig` — persist the 6-tab Setup popup config for a (plan, type) pair.
**Auth:** Bearer token required
**Path params:** `{id}` = plan id, `{typeId}` = leave type id (must already be assigned, else 404)

```bash
curl -X PUT 'http://127.0.0.1:8000/api/leave-plans/5/types/2/config' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "config": {
    "accrual": { "yearlyQuota": 12, "unlimited": false },
    "approval": { "chain": [{ "approver_kind": "reporting_manager" }] }
  },
  "quota_summary": "12 days / year",
  "eoy_summary": "Lapse unused"
}'
```

**Body fields:** `config` (array/object, **required** — the full LeaveTypeConfig blob), `quota_summary` (string, max 255) — optional, `eoy_summary` (string, max 255) — optional.

---

## LeaveRequestController

### GET /api/leave-requests
**Action:** `LeaveRequestController@index` — list an employee's own leave requests (or a specified employee's, tenant-guarded).
**Auth:** Bearer token required
**Query params:** `employee_id` (admin viewing another), `status` (Pending | Approved | Rejected)

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-requests?employee_id=15&status=Pending' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-requests
**Action:** `LeaveRequestController@store` — submit a leave application (computes days, overlap + past-date + plan/type guards, snapshots the approval chain).
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-requests' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "employee_id": 15,
  "leave_type_id": 2,
  "from_date": "2026-06-10",
  "to_date": "2026-06-12",
  "day_type": "full",
  "reason": "Family function",
  "handover_required": true,
  "cover_person_id": 16,
  "handover_notes": "Sai will cover client follow-ups.",
  "avail_on_call": true,
  "emergency_number": "+91 9876543210",
  "notify": { "employee_ids": [17, 18] }
}'
```

**Body fields:**
- `leave_type_id` (int, exists:master_leave_types,id) — **required** (must be part of the employee's assigned plan).
- `from_date` (date, today or later) — **required**.
- `to_date` (date, after_or_equal:from_date) — **required**.
- `employee_id` (int, exists:employees,id) — optional (admin filing on behalf; else self).
- `day_type` (in: full, first_half, second_half) — optional (half-day only valid on a single day → 0.5 day).
- `reason` (string) — optional.
- `attachment_path` (string, max 1024) — optional.
- `notify` (array, e.g. `{ "employee_ids": [..] }`) — optional (same-tenant only).
- `handover_required` (bool), `cover_person_id` (int, exists, same-tenant), `handover_notes` (string), `critical_tasks` (string) — optional.
- `avail_on_call` (bool), `emergency_number` (string, max 50), `avail_note` (string) — optional.

---

### GET /api/leave-requests/approvals
**Action:** `LeaveRequestController@approvals` — pending requests the signed-in user can approve (admins see the whole tenant; managers see their chain levels).
**Auth:** Bearer token required
**Query params:** `status` (default Pending; or `All`), `branch_id`, `search`

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-requests/approvals?status=Pending&search=patekar' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/leave-requests/colleagues
**Action:** `LeaveRequestController@colleagues` — lightweight same-tenant employee search for the Notify / Cover-person picker.
**Auth:** Bearer token required (any authenticated user)
**Query params:** `search`, `limit` (1-20, default 10)

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-requests/colleagues?search=sai&limit=10' \
  --header 'Authorization: Bearer {{token}}'
```

---

### GET /api/leave-requests/{id}
**Action:** `LeaveRequestController@show` — single request with every relation the approval modal needs (tenant-guarded against IDOR).
**Auth:** Bearer token required
**Path params:** `{id}` = numeric request id

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-requests/42' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-requests/{id}/approve
**Action:** `LeaveRequestController@approve` — approve the current chain level (advances to next level or finalizes).
**Auth:** Bearer token required (approver for the level, or admin override)
**Path params:** `{id}` = numeric request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-requests/42/approve' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Approved. Enjoy your time off."
}'
```

**Body fields:** `comment` (string) — optional.

---

### GET /api/leave-requests/{id}/approvers
**Action:** `LeaveRequestController@approvers` — the snapshotted approval chain with per-level status + resolved approver name/email.
**Auth:** Bearer token required (tenant-guarded)
**Path params:** `{id}` = numeric request id

```bash
curl -X GET 'http://127.0.0.1:8000/api/leave-requests/42/approvers' \
  --header 'Authorization: Bearer {{token}}'
```

---

### POST /api/leave-requests/{id}/cancel
**Action:** `LeaveRequestController@cancel` — cancel a Pending request (owner or HR only).
**Auth:** Bearer token required
**Path params:** `{id}` = numeric request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-requests/42/cancel' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none (only Pending requests can be cancelled).

---

### POST /api/leave-requests/{id}/reject
**Action:** `LeaveRequestController@reject` — reject the request at the current level (terminates immediately).
**Auth:** Bearer token required (approver for the level, or admin override)
**Path params:** `{id}` = numeric request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/leave-requests/42/reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Insufficient leave balance for this period."
}'
```

**Body fields:** `comment` (string) — optional.
