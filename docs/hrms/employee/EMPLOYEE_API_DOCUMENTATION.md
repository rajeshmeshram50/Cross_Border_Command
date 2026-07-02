# EMPLOYEE MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Employee Master
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active`. Permission slug: **`master.employees`** (view/add/edit/delete). Super-admins bypass.
- **Self-service exemptions:** `show`, `holidays`, `updateBankDetails` allow an employee to read/edit their **own** record (matched by `user_id`) without the module grant.
- `{id}` accepts a numeric id, an encrypted token (`encrypted_id`), or an `emp_code`.
- Tenancy: `client_id`/`branch_id` derived from the user; branch users are branch-isolated.
- Documents & previous-employments are **tenant-gated only** (no module permission).
- Status codes: 200/201 · 401 · 403 · 404 · 422.

---

## 2. ENDPOINT INDEX

### Employees
| Method | Path | Purpose |
|---|---|---|
| GET | `/employees` | List (search/status/department/onboarded_only) |
| GET | `/employees/next-code` | Next `EMP-###` |
| GET | `/employees/managers` | Eligible reporting managers |
| GET | `/employees/available-assets` | Free assets for assignment |
| GET | `/employees/check-mobile` | Duplicate-mobile probe |
| POST | `/employees` | Create employee + login |
| GET | `/employees/{id}` | Detail (self-service aware) |
| PUT | `/employees/{id}` | Update (cascades to login) |
| DELETE | `/employees/{id}` | Soft delete + disable login |
| PATCH | `/employees/{id}/restore` | Re-enable |
| DELETE | `/employees/{id}/force` | Permanent delete (disabled only) |
| PUT | `/employees/{id}/bank-details` | Self-service bank edit |
| POST | `/employees/{id}/set-password` | Admin password reset |
| GET | `/employees/{id}/holidays` | Holiday-group calendar |

### Documents & previous employments
| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/employees/{employee}/documents` | List / upload |
| GET | `/documents/{document}/download` | Download |
| PATCH | `/documents/{document}/verify` · `/reject` | Verify / reject |
| DELETE | `/documents/{document}` | Delete |
| GET/POST | `/employees/{employee}/previous-employments` | List / add |
| PATCH/DELETE | `/previous-employments/{prev}` | Update / delete |

---

## 3. KEY ENDPOINT DETAIL

### 3.1 GET `/employees`
**Query:** `search` (display_name/emp_code/email/mobile ILIKE), `status`, `department_id`, `onboarded_only` (bool), `branch_id`.
**Response 200** (array; each employee carries relations + appended `photo_url`, `ancillary_roles_resolved`, `profile_completion`, `encrypted_id`).

### 3.2 POST `/employees`
Creates the employee **and its login**. Content type JSON (multipart if photo).
**Body (subset):** `first_name`* (+ middle/last), `email`* (unique per client), `gender`, `date_of_birth`, `mobile`, `department_id`, `designation_id`, `primary_role_id`, `ancillary_role_ids[]`, `work_type`, `reporting_manager_id`, `date_of_joining`, addresses, `enable_payroll`, `annual_salary`, `pan_number` (unique per client), bank fields, `status`, `wizard_step_completed`, `onboarding_stage_completed`.
**Response 201:** `{ "message": "…", "employee": { …, "emp_code": "EMP-001", "user_id": 90 } }`
**Errors:** 403 · 422 (validation / branch-user cap / duplicate mobile/email).

### 3.3 GET `/employees/{id}`
Full employee with relations. **Self** may view own record without `can_view`.
**Errors:** 403 (viewing another without grant) · 404.

### 3.4 PUT `/employees/{id}`
Update. Cascades name/email/phone/status to the login; email change → `must_reset_password` + token revoke; onboarding stage is high-watermark; payroll-field edits recompute payslips.
**Response 200:** `{ "message": "…", "employee": { … } }`
**Errors:** 403 · 404 · 422 (or blocked if disabled and not re-activating).

### 3.5 PUT `/employees/{id}/bank-details` (self-or-`can_edit`)
**Body:** `salary_payment_mode` (bank/cheque/cash), `bank_name`, `bank_account_number` (≤30, letters allowed), `ifsc_code` (`^[A-Za-z]{4}0[A-Za-z0-9]{6}$`, stored uppercased), `account_holder_name`, `bank_branch`, `bank_account_type`.
**Response 200:** `{ "message": "Bank details updated.", "data": { …bank fields… } }`
**Errors:** 403 (editing another's without `can_edit`) · 422 (disabled employee / invalid IFSC).

### 3.6 GET `/employees/{id}/holidays?year=YYYY`
**Response 200:** `{ "group": {…}, "year": 2026, "holidays": [ { "date": "…", "name": "…" } ] }`

### 3.7 GET `/employees/managers` · `/available-assets` · `/check-mobile` · `/next-code`
Pickers/helpers (all `can_view`). `check-mobile` returns `{ available, conflict, message? }` (PII-safe). `next-code` → `{ code: "EMP-00N", prefix: "EMP-" }`.

### 3.8 Documents
- **POST `/employees/{employee}/documents`** (multipart): `document_key` (≤60), `file` (≤2MB, pdf/jpg/jpeg/png/webp). → 201 with the document row. (422 if the employee is disabled.)
- **PATCH `/documents/{document}/verify`** → status verified. **`/reject`** requires `rejection_reason`.
- **GET `/documents/{document}/download`** streams the file.

### 3.9 Previous employments
- **POST `/employees/{employee}/previous-employments`**: `company_name`* (≤255), `job_title`, `start_date` (≤ today), `end_date` (≥ start, ≤ today), `hr_email_1`, `hr_email_2` (≠ hr_email_1), `contact_number`.

---

## 4. ERROR EXAMPLES
**403 — viewing another employee without grant**
```json
{ "message": "This action is unauthorized." }
```
**422 — duplicate email (per client)**
```json
{ "message": "…", "errors": { "email": ["This email is already registered for this organization."] } }
```

---

## 5. QUICK REFERENCE

```
GET  /employees?onboarded_only=1        # list
GET  /employees/next-code               # EMP-### preview
POST /employees                         # create + login (201)
GET  /employees/{id}                    # detail (self-service aware)
PUT  /employees/{id}                    # update (cascades)
POST /employees/{employee}/documents    # upload doc → verify/reject
PUT  /employees/{id}/bank-details       # self-service bank edit
DELETE /employees/{id}                  # soft delete + disable login
```

---

## 6. NOTES (caveats)
1. Self-service (own record) bypasses the module grant for read/holidays/bank-details.
2. Documents & previous-employments are tenant-gated only.
3. `email` unique per client; changing it forces reset + token revoke.
4. Face descriptor never returned.
5. `onboarding_stage_completed` is high-watermark.

---

*Related documents: EMPLOYEE_TECHNICAL_DOCUMENTATION.md · EMPLOYEE_FUNCTIONAL_DOCUMENTATION.md · EMPLOYEE_CODE_WALKTHROUGH.md*
