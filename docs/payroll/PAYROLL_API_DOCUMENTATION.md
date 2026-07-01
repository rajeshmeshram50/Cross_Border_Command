# PAYROLL MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Payroll
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS

### 1.1 Authentication
Every payroll endpoint sits behind `auth:sanctum` + `user.active`. Send:
```
Authorization: Bearer <token>
Accept: application/json
```
There is **no throttle** on `/payroll/*` routes.

### 1.2 Tenant & branch scoping
- `client_id` and `branch_id` are derived from the authenticated user — **never** send them in the body.
- The SPA auto-injects `?branch_id=<active>` on requests. A `branch_user` is pinned to their own branch (the param cannot widen scope); admins may use it to focus a branch, or omit it for a client-wide view.

### 1.3 Common query parameters
| Param | Type | Applies to | Notes |
|---|---|---|---|
| `month` | int 1–12 | cycle actions/reads | defaults to current month |
| `year` | int 2000–2100 | cycle actions/reads | defaults to current year |
| `branch_id` | int | most reads | auto-injected by the SPA |
| `department` | string | export / bulk / email | optional filter |
| `status` | string | export / bulk / email | optional filter |
| `run_id` | int | approve / pay | body or query |

### 1.4 Response envelope
```json
{ "data": { } }                              // reads
{ "message": "…", "data": { } }              // mutating actions
{ "message": "…" }                           // simple result / error
{ "message": "…", "errors": { } }            // 422 inline validation (fnf)
```

### 1.5 Status codes
| Code | Meaning |
|---|---|
| 200 | Success |
| 403 | Authorization failure (not allowed / cross-tenant / employee self-access) |
| 404 | Run / employee / payslip not found or fails tenant ownership |
| 422 | Business-rule or validation failure |
| 500 | Server capability missing (e.g. `ZipArchive` for bulk ZIP) |

---

## 2. ENDPOINT INDEX

### PayrollController
| # | Method | Path | Purpose | Auth |
|---|---|---|---|---|
| 1 | GET | `/payroll/cycles` | 13-month cycle strip | any authed |
| 2 | GET | `/payroll/history` | Cross-cycle summaries + rows | any (employee = own) |
| 3 | GET | `/payroll/preflight` | Dry-run issue list | any authed |
| 4 | GET | `/payroll/export` | Streamed CSV | canExport |
| 5 | GET | `/payroll/payslips/bulk` | ZIP of payslip PDFs | canExport |
| 6 | POST | `/payroll/payslips/email` | Bulk-email payslips | canManage/canExport |
| 7 | GET | `/payroll/payslip/{id}/pdf` | Single payslip PDF | owner / employee-self |
| 8 | POST | `/payroll/payslip/{id}/email` | Email one payslip | canManage |
| 9 | GET | `/payroll/payslip/{id}` | Full payslip JSON | owner / employee-self |
| 10 | GET | `/payroll/employee/{employeeId}/payslips` | Employee payslip list | employee-self aware |
| 11 | GET | `/payroll/fnf/{employeeId}` | Full & Final settlement | canManage |
| 12 | GET | `/payroll` | Cycle detail (rows + counts) | any authed |
| 13 | POST | `/payroll/finalize-attendance` | Lock attendance | canManage |
| 14 | POST | `/payroll/run` | Generate payroll | canManage |
| 15 | POST | `/payroll/reopen` | Reopen a non-paid cycle | canManage |
| 16 | POST | `/payroll/approve` | Approve a run | canManage |
| 17 | POST | `/payroll/pay` | Disburse a run | canManage |

### PayrollPaymentController
| Method | Path | Purpose |
|---|---|---|
| POST | `/payroll/payment/prepare` | Prepare a disbursement batch |
| GET | `/payroll/payment/{id}` | Batch detail |
| POST | `/payroll/payment/{id}/approve` | Record sign-off |
| POST | `/payroll/payment/{id}/initiate` | Initiate payment |
| GET | `/payroll/payment/{id}/bank-file` | Download bank file |
| GET | `/payroll/payment/{id}/audit` | Batch audit trail |

### PayrollAdjustmentController
| Method | Path | Purpose |
|---|---|---|
| GET | `/payroll-adjustments` | List adjustments |
| POST | `/payroll-adjustments` | Create an adjustment |
| POST | `/payroll-adjustments/{id}/approve` | Approve |
| POST | `/payroll-adjustments/{id}/reject` | Reject |
| DELETE | `/payroll-adjustments/{id}` | Delete |

---

## 3. PAYROLL CONTROLLER — DETAIL

### 3.1 GET `/payroll/cycles`
Returns a trailing 13-month strip (11 months back → next month) with status per month.

**Response 200**
```json
{
  "data": [
    { "key": "jul-2025", "label": "Jul 2025", "range": "01 Jul–31 Jul",
      "month": 7, "year": 2025, "status": "Not Started" },
    { "key": "jun-2026", "label": "Jun 2026", "range": "01 Jun–30 Jun",
      "month": 6, "year": 2026, "status": "In Progress" }
  ]
}
```
`status` ∈ `Completed | In Progress | Not Started`.

---

### 3.2 GET `/payroll`
Cycle detail: the period, its latest run, per-employee rows and aggregate counts.

**Query:** `month`, `year`, `branch_id`

**Response 200**
```json
{
  "data": {
    "period": {
      "id": 42, "month": 6, "year": 2026, "label": "Jun 2026",
      "working_days": 26, "total_month_days": 30,
      "attendance_finalized": true, "status": "processing", "run_status": "generated"
    },
    "run": {
      "id": 91, "period_id": 42, "status": "generated",
      "total_employees": 22, "employees_on_hold": 1,
      "total_gross": 1240000.00, "total_deductions": 96000.00, "total_net": 1144000.00
    },
    "rows": [
      {
        "id": "501", "payslip_id": 501, "employee_id": 1,
        "empId": "E-001", "encryptedId": "xX…", "name": "Vaibhav Rao",
        "department": "IT", "designation": "Developer",
        "ctc": 45000, "earnings": 45000, "deductions": 6200, "netPay": 38800,
        "attendance": 24, "present": 24, "absent": 2,
        "lateMarks": 1, "missingPunch": 0, "unpaidLeave": 0, "paidLeave": 0,
        "attSource": "Biometric", "mismatch": null, "attMismatch": false,
        "pfEmp": 1800, "esi": 0, "pt": 200, "tds": 0,
        "lopDeducted": 0, "advanceRec": 0, "workingDays": 26, "lop_days": 2,
        "status": "Ready", "holdReason": null, "reasons": [], "bankVerified": true
      }
    ],
    "counts": {
      "totalEmployees": 22, "ready": 18, "processed": 18,
      "pendingReview": 3, "onHold": 1,
      "totalPayroll": 1144000, "totalGross": 1240000, "totalNetPay": 1144000,
      "totalPf": 39600, "totalTds": 0, "totalLop": 4200
    }
  }
}
```

---

### 3.3 GET `/payroll/history`
Cross-cycle summaries + up to 8000 payslip rows (for XLSX export). Employees are restricted to their own `employee_id`.

**Response 200**
```json
{
  "data": {
    "cycles": [
      { "period_id": 42, "label": "Jun 2026", "month": 6, "year": 2026,
        "status": "processing", "attendance_final": true, "run_status": "generated",
        "employees": 22, "on_hold": 1,
        "gross": 1240000, "deductions": 96000, "net": 1144000, "paid_at": null }
    ],
    "rows": [
      { "cycle": "Jun 2026", "employee_code": "E-001", "employee_name": "Vaibhav Rao",
        "department": "IT", "designation": "Developer",
        "working_days": 26, "present_days": 24, "paid_days": 24, "lop_days": 2,
        "paid_leave_days": 0, "unpaid_leave_days": 0, "late_marks": 1, "missing_punches": 0,
        "att_source": "Biometric", "gross_earnings": 45000, "basic": 22500,
        "pf_employee": 1800, "esi": 0, "pt": 200, "tds": 0, "lop_amount": 1730,
        "advance_recovery": 0, "total_deductions": 6200, "net_pay": 38800,
        "status": "Ready", "bank_account": "XXXX1234", "ifsc": "HDFC0001234" }
    ]
  }
}
```

---

### 3.4 GET `/payroll/preflight`
Dry-run: lists blocking/warning issues without persisting anything.

**Query:** `month`, `year`, `branch_id`

**Response 200**
```json
{
  "data": {
    "attendance_finalized": true,
    "issues": [
      { "id": 7, "type": "blocking", "empCode": "E-007", "empName": "Asha K",
        "department": "Ops", "reasons": ["Missing salary structure"] },
      { "id": 3, "type": "warning", "empCode": "E-003", "empName": "Ravi P",
        "department": "IT", "reasons": ["2 day(s) with a missing punch"] }
    ],
    "blocked_amount": 52000.00,
    "at_risk_amount": 38800.00
  }
}
```

---

### 3.5 POST `/payroll/finalize-attendance` — **[Rule 1]**
Locks attendance for the cycle. Requires `canManage`.

**Body:** `{ "month": 6, "year": 2026 }`

**Response 200**
```json
{
  "message": "Attendance finalized. 2 of 22 employees have no attendance this cycle.",
  "coverage": { "total": 22, "with_attendance": 20, "missing": 2 },
  "data": { "id": 42, "attendance_finalized": true, "status": "open", "…": "…" }
}
```
**Errors:** 403 (not allowed) · 422 (no scope / future cycle / locked period).

---

### 3.6 POST `/payroll/run` — **[Rules 5-14]**
Generates payslips for all eligible employees. Requires `canManage`.

**Body:** `{ "month": 6, "year": 2026 }`

**Response 200**
```json
{
  "message": "Payroll generated.",
  "data": { "id": 91, "period_id": 42, "status": "generated",
            "total_employees": 22, "employees_on_hold": 1,
            "total_gross": 1240000, "total_deductions": 96000, "total_net": 1144000 }
}
```
**Errors:** 403 · 422 (no scope / future cycle / *"Finalize attendance before generating payroll."* / *"This cycle is locked…"*).

---

### 3.7 POST `/payroll/approve` — **[Rule 14]**
Approves the run. Requires `canManage`.

**Body / Query:** `{ "run_id": 91 }`

**Response 200**
```json
{ "message": "Payroll approved.",
  "data": { "id": 91, "status": "approved", "…": "…" } }
```
**Errors:** 403 · 404 (run not found) · 422 (already locked / zero employees).

---

### 3.8 POST `/payroll/pay` — **[Rules 12, 13]**
Disburses the run. Marks each payslip Paid or On Hold based on live bank validity.

**Body / Query:** `{ "run_id": 91 }`

**Response 200**
```json
{ "message": "21 paid, 1 held.",
  "data": { "paid": 21, "held": 1,
            "run": { "id": 91, "status": "approved", "…": "…" } } }
```
If `held = 0` the run becomes `paid` and the period is **locked**.
**Errors:** 403 · 404 · 422 (status not approved/paid / already fully paid).

---

### 3.9 POST `/payroll/reopen` — **[Rule 15]**
Reverts a non-paid cycle to editable. Requires `canManage`.

**Body:** `{ "month": 6, "year": 2026 }`

**Response 200**
```json
{ "message": "Cycle reopened.", "data": { "id": 42, "status": "open", "…": "…" } }
```
**Errors:** 403 · 422 (no scope / latest run is `paid` / any payslip already `Paid`).

---

### 3.10 GET `/payroll/payslip/{id}`
Full payslip JSON incl. company letterhead. Owner-scoped; an employee may only view their own.

**Response 200**
```json
{
  "data": {
    "payslip_id": 501, "employee_code": "E-001", "employee_name": "Vaibhav Rao",
    "department": "IT", "designation": "Developer",
    "working_days": 26, "present": 24, "paid_days": 24, "lop_days": 2,
    "gross_earnings": 45000, "basic": 22500,
    "earnings": [ { "label": "Basic", "amount": 22500 }, { "label": "HRA", "amount": 13500 } ],
    "deductions": [ { "label": "Provident Fund (12%)", "amount": 1800 },
                    { "label": "Professional Tax", "amount": 200 } ],
    "pf_employee": 1800, "esi": 0, "pt": 200, "tds": 0, "lop_amount": 1730,
    "advance_recovery": 0, "total_deductions": 6200, "net_pay": 38800,
    "status": "Ready", "is_final": true,
    "company": { "name": "IGC Group", "meta": "…", "initials": "IG", "hrEmail": "hr@…" },
    "period_label": "Jun 2026"
  }
}
```
**Errors:** 404 (not found / not owner) · 403 (employee viewing another's slip).

---

### 3.11 GET `/payroll/payslip/{id}/pdf`
Streams the payslip PDF. `?download=1` forces attachment.

**Response 200:** raw PDF, `Content-Type: application/pdf`, `Content-Disposition: inline|attachment; filename="Payslip_E-001_Jun-2026.pdf"`.
**Errors:** 404 · 403 · 422 (status `On Hold` / `Pending Review`).

---

### 3.12 POST `/payroll/payslip/{id}/email`
Emails the payslip to the employee. Requires `canManage`.

**Response 200:** `{ "message": "Payslip emailed to vaibhav@…" }`
**Errors:** 403 · 404 · 422 (not a final slip / On Hold / Pending Review / send failure).

---

### 3.13 GET `/payroll/employee/{employeeId}/payslips`
Up to 24 recent payslips for one employee (self-aware for the employee tier).

**Response 200**
```json
{ "data": [
    { "payslip_id": 501, "label": "Jun 2026", "month": 6, "year": 2026,
      "net_pay": 38800, "status": "Ready", "is_final": true }
] }
```
**Errors:** 403 (employee viewing another).

---

### 3.14 GET `/payroll/payslips/bulk`
ZIP of payslip PDFs for the cycle. Requires `canExport`. Excludes `On Hold` / `Pending Review`.

**Query:** `month`, `year`, `department?`, `status?`

**Response 200:** ZIP download, `Content-Type: application/zip`, filename `Payslips_Jun-2026.zip`.
**Errors:** 403 · 422 (empty result) · 500 (`ZipArchive` unavailable).

---

### 3.15 POST `/payroll/payslips/email`
Bulk-email payslips. Requires `canManage` or `canExport`. Run must be finalized (locked / approved / paid).

**Body:** `{ "month": 6, "year": 2026, "department": "IT", "status": "Ready" }`

**Response 200**
```json
{ "message": "18 sent, 3 skipped, 1 failed.",
  "data": { "sent": 18, "skipped": ["E-007"], "failed": ["E-011"] } }
```
**Errors:** 403 · 422 (no scope / run not finalized / empty).

---

### 3.16 GET `/payroll/export`
Streamed CSV of the cycle (200-row chunks). Requires `canExport`.

**Query:** `month`, `year`, `department?`, `status?`

**Response 200:** `text/csv`, `Content-Disposition: attachment; filename="payroll_Jun-2026.csv"`.
Columns: `Emp Code, Employee, Department, Designation, Working Days, Paid Days, LOP Days, Gross, PF, ESI, PT, TDS, LOP Amt, Advance Rec, Total Deductions, Net Pay, Status`.
**Errors:** 403 · 422 (no scope).

---

### 3.17 GET `/payroll/fnf/{employeeId}` — **[Rule 21]**
Full & Final settlement, computed live (not persisted). Requires `canManage` and an `employee_exits` record.

**Query (validated, all optional):**
| Param | Rule |
|---|---|
| `leave_encashment_days` | numeric, 0–365 |
| `notice_recovery_amount` | numeric, 0–100000000 |
| `other_dues` | numeric, 0–100000000 |
| `other_deductions` | numeric, 0–100000000 |

**Response 200**
```json
{
  "data": {
    "employee": { "code": "E-014", "name": "Sunil M", "last_working_day": "2026-06-20" },
    "final_salary": 24000.00,
    "leave_encashment": 3000.00,
    "bonus": 0.00,
    "other_dues": 0.00,
    "additions_total": 27000.00,
    "outstanding_advances": 5000.00,
    "notice_recovery": 0.00,
    "other_deductions": 0.00,
    "deductions_total": 5000.00,
    "net_settlement": 22000.00
  }
}
```
**Errors:** 403 (not allowed / cross-tenant) · 404 (employee not found) · 422 (no exit record / validation).

---

## 4. PAYROLL PAYMENT CONTROLLER (disbursement)

### 4.1 POST `/payroll/payment/prepare`
Prepares a disbursement batch for a run.
**Body:** `{ "run_id": 91, "mode": "online" }` (`mode` ∈ `cheque | online`).
**Response:** `{ "data": { "id": 5, "mode": "online", "status": "draft", "employee_count": 21, "total_amount": 1120000, "…": "…" } }`

### 4.2 GET `/payroll/payment/{id}`
Batch detail (advice rows, sign-off, status).

### 4.3 POST `/payroll/payment/{id}/approve`
Records the 3-level sign-off.
**Body:** `{ "prepared_by": "…", "verified_by": "…", "approved_by": "…" }`

### 4.4 POST `/payroll/payment/{id}/initiate`
Initiates the payment (marks the batch/run appropriately). **Response:** paid/held summary + batch reference.

### 4.5 GET `/payroll/payment/{id}/bank-file`
Downloads the bank upload file (online mode).

### 4.6 GET `/payroll/payment/{id}/audit`
Returns the batch audit trail.

---

## 5. PAYROLL ADJUSTMENT CONTROLLER

Adjustment `type` ∈ `overtime | bonus | incentive | deduction`. Earning types (`overtime`, `bonus`, `incentive`) add to pay; `deduction` subtracts. Only **approved** adjustments affect a run (Rules 4, 10).

### 5.1 GET `/payroll-adjustments`
**Query:** `employee_id?`, `month?`, `year?`, `status?`
**Response:** `{ "data": [ { "id": 12, "employee_id": 1, "month": 6, "year": 2026, "type": "overtime", "label": "Weekend OT", "amount": 2000, "hours": 8, "rate": 250, "status": "approved" } ] }`

### 5.2 POST `/payroll-adjustments`
**Body:**
```json
{ "employee_id": 1, "month": 6, "year": 2026, "type": "bonus",
  "label": "Festival bonus", "amount": 5000, "reason": "Diwali" }
```
**Response:** `{ "message": "Adjustment created.", "data": { "id": 13, "status": "pending" } }`

### 5.3 POST `/payroll-adjustments/{id}/approve`
Marks the adjustment `approved` (stamps approver + time).

### 5.4 POST `/payroll-adjustments/{id}/reject`
Marks the adjustment `rejected`.

### 5.5 DELETE `/payroll-adjustments/{id}`
Soft-deletes the adjustment.

---

## 6. RELATED (NON-PAYROLL-PREFIX) ENDPOINTS USED BY THE UI

These belong to other controllers but are consumed by the payroll screens:

| Method | Path | Used by | Purpose |
|---|---|---|---|
| GET | `/salary-structures?employee_id=&active_only=1` | Profile / roster | Active salary structure |
| GET | `/salary-structures/{id}` | SalaryStructureModal | Prefill on revise |
| POST | `/salary-structures` | SalaryStructureModal | Create / revise (versioned, Rule 19) |
| GET | `/salary-structures/employees` | Salary Setup tab | Roster of employees + structure state |
| PUT | `/employees/{id}/bank-details` | PayrollTab | Edit bank details (self-or-can_edit) |
| GET | `/master/departments` | Dashboard filter | Department list |

---

## 7. ERROR RESPONSE EXAMPLES

**403 — authorization**
```json
{ "message": "You do not have permission to run payroll." }
```
**404 — not found / cross-tenant**
```json
{ "message": "Payroll run not found." }
```
**422 — business rule**
```json
{ "message": "Finalize attendance before generating payroll." }
```
**422 — inline validation (fnf)**
```json
{ "message": "The given data was invalid.",
  "errors": { "leave_encashment_days": ["The leave encashment days may not be greater than 365."] } }
```
**500 — capability missing**
```json
{ "message": "ZIP support is not available on this server." }
```

---

## 8. QUICK REFERENCE — TYPICAL FLOW

```
GET  /payroll/cycles                         # pick a cycle
GET  /payroll?month=6&year=2026              # load it (auto-creates the period)
POST /payroll/finalize-attendance            # Rule 1
GET  /payroll/preflight?month=6&year=2026    # optional dry-run
POST /payroll/run                            # generate payslips
GET  /payroll?month=6&year=2026              # review (4 tabs)
POST /payroll/approve            {run_id}    # Rule 14
POST /payroll/pay                {run_id}    # disburse → period locks
GET  /payroll/payslips/bulk                  # distribute (ZIP)
POST /payroll/payslips/email                 # or email
# corrections (non-paid): POST /payroll/reopen
# exits: GET /payroll/fnf/{employeeId}
```

---

*Related documents: PAYROLL_TECHNICAL_DOCUMENTATION.md · PAYROLL_FUNCTIONAL_DOCUMENTATION.md · PAYROLL_CODE_WALKTHROUGH.md*
