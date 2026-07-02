# EXPENSE MANAGEMENT MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Expense Management
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS
- Auth: `auth:sanctum` + `user.active`. Permission slug **`hr.expense`** (`can_view` for scope=all, `can_approve` for HR act). Owner/assigned-manager act on their own rows; super-admin bypasses.
- Categories also via generic `/master/expense_category`.
- Status codes: 200/201 · 401 · 403 · 404 · 409 (stage order / already acted) · 422 (validation).

---

## 2. ENDPOINT INDEX

### Expense Claims
| Method | Path |
|---|---|
| GET | `/expense-claims` · `/expense-claims/categories` |
| POST | `/expense-claims` |
| GET | `/expense-claims/{id}` |
| POST | `/expense-claims/{id}/manager-approve` · `/manager-reject` · `/hr-approve` · `/hr-reject` |
| GET | `/expense-claims/{id}/attachments/{index}` (public, `?token=`) |

### Advance Requests
| Method | Path |
|---|---|
| GET | `/advance-requests` |
| POST | `/advance-requests` |
| GET | `/advance-requests/{id}` |
| POST | `/advance-requests/{id}/manager-approve` · `/manager-reject` · `/hr-approve` · `/hr-reject` |
| GET | `/advance-requests/{id}/attachments/{index}` (public, `?token=`) |

---

## 3. EXPENSE CLAIMS

### GET `/expense-claims?scope=mine|team|all&status=`
`scope=all` requires `hr.expense` `can_view`. Returns serialized rows (employee/manager/category names flattened; attachment URLs `/api/expense-claims/{id}/attachments/{i}`).

### GET `/expense-claims/categories`
Active expense categories → `[{ id, name, code }]`.

### POST `/expense-claims` (multipart)
**Body:** `title`* (≤255), `amount`* (≥0), `expense_date`* (within last 30 days), `category_id`, `currency`, `project`, `payment_method`, `vendor`, `purpose`, `files[]`* (≥1, pdf/jpg/jpeg/png ≤5MB), `employee_id`/`employee_code` (admin on behalf).
**Response 201:** serialized claim (`claim_no` `EXP-####`, `status` pending).
**Errors:** 403 (not own) · 422.

### POST `/expense-claims/{id}/manager-approve` · `/manager-reject`
Only the assigned manager or super-admin; **409** if not pending; `comment` optional. Reject sets top-level `status=rejected`.

### POST `/expense-claims/{id}/hr-approve` · `/hr-reject`
Needs `hr.expense` `can_approve`; approve **409** unless manager already approved; sets final `status`.

---

## 4. ADVANCE REQUESTS

### POST `/advance-requests` (multipart)
**Body:** `advance_type`* (Travel/Salary/Medical/Other), `advance_type_other` (required if Other), `amount`*, `requested_date`* (today), `recovery_start`* (≥ requested_date), `recovery_mode`* (emi/lumpsum/bimonthly), `recovery_months` (required for emi, 1–120), `monthly_emi`, `reason`* (≤500), `files[]` (optional).
**Response 201:** serialized advance (`advance_no` `ADV-####`).
**Errors:** 403 · 422 (e.g. EMI without months).

### Approval endpoints
Same 4 endpoints/rules as claims. Approved advances feed payroll recovery (`hr_status=approved`).

---

## 5. ATTACHMENTS
### GET `/expense-claims/{id}/attachments/{index}?token=<token>` (public)
Streams the receipt at `index`; authenticates via `?token=`; tenant-checked. (Same for advances.)

---

## 6. ERROR EXAMPLES
**409 — stage order**
```json
{ "message": "The reporting manager must approve before HR." }
```
**422 — receipt required (claim)**
```json
{ "message": "…", "errors": { "files": ["A receipt is required."] } }
```

---

## 7. QUICK REFERENCE
```
GET  /expense-claims/categories
POST /expense-claims (files[])                 # raise (EXP-####)
POST /expense-claims/{id}/manager-approve      # stage 1
POST /expense-claims/{id}/hr-approve           # stage 2 (final)
POST /advance-requests                         # raise (ADV-####) → payroll recovery on approval
```

---

## 8. NOTES (caveats)
1. Manager stage before HR stage; HR sets the final status.
2. `hr.expense` gates scope=all + HR act; owner/manager act on own rows.
3. No DB FKs / soft deletes; category limits unenforced.
4. Bimonthly recovery behaves as lumpsum in payroll; recovery capped to net.
5. Claims require a receipt; advances don't. Attachment routes are public (`?token=`).

---

*Related documents: EXPENSE_TECHNICAL_DOCUMENTATION.md · EXPENSE_FUNCTIONAL_DOCUMENTATION.md · EXPENSE_CODE_WALKTHROUGH.md*
