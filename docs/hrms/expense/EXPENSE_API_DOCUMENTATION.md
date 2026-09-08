# EXPENSE MANAGEMENT MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Expense Management
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |
| 2.0 | 2026-09-08 | System | Settlement, batch payment, company advances, employee settlement, returns, reimbursement linkage, Zoho sync, PDF export, list pagination. Corrected file-size, amount and date validations. |

---

## 1. CONVENTIONS

- **Auth:** `auth:sanctum` + `user.active`. Permission slug **`hr.expense`** — `can_view` gates `scope=all`, `can_approve` gates every HR / Finance action (approve, reject, set-deductions, settle, batch-pay). Owners and assigned managers act on their own rows; super-admin bypasses.
- **Tenancy:** every row is scoped by `client_id` + `branch_id` derived from the authenticated user. A request-supplied `employee_id` is **never** trusted for non-super-admins — the target employee is derived from the token (see §3.3).
- **Categories:** also reachable through the generic `/master/expense_category` endpoint.
- **Money:** `decimal(18,2)`. Amounts are capped at `9999999999999.99` so a paste cannot overflow the column and surface as a 500.
- **File routes** (attachments, payment proofs) sit **outside** the auth group and authenticate via `?token=<sanctum_token>` — they are opened as plain browser navigations that carry no `Authorization` header.
- **Status codes:** 200 / 201 · 401 · 403 (ownership, self-action) · 404 · 409 (stage order, already actioned, wrong lifecycle state) · 422 (validation).

---

## 2. ENDPOINT INDEX

### 2.1 Expense Claims

| Method | Path | Purpose |
|---|---|---|
| GET | `/expense-claims` | List (paginated on request) |
| GET | `/expense-claims/categories` | Active categories (branch-scoped) |
| POST | `/expense-claims` | Raise a claim (multipart) |
| GET | `/expense-claims/{id}` | Single claim |
| POST | `/expense-claims/{id}/manager-approve` · `/manager-reject` | Stage 1 |
| POST | `/expense-claims/{id}/hr-approve` · `/hr-reject` | Stage 2 (final) |
| GET | `/expense-claims/{id}/settlement` | Payout state + payment history |
| POST | `/expense-claims/{id}/set-deductions` | Lock net payable without paying |
| POST | `/expense-claims/{id}/settle` | Record one payment (partial allowed) |
| POST | `/expense-claims/{id}/email-reimbursement` | Email the reimbursement advice |
| GET | `/expense-claims/batch-payable` | Approved-unpaid claims grouped by employee |
| GET | `/expense-claims/batch-payments` | Batch payment history |
| POST | `/expense-claims/batch-pay` | Pay many claims in one transaction |
| POST | `/expense-claims/batch-payments/{batchId}/sync-zoho` | Push batch to Zoho Books |
| POST | `/expense-claims/payments/{paymentId}/sync-zoho` | Push one payment to Zoho Books |
| POST | `/expense-claims/export-pdf` | Server-rendered PDF of the displayed rows |
| GET | `/expense-claims/{id}/attachments/{index}` | Receipt (public, `?token=`) |
| GET | `/expense-claims/payments/{paymentId}/proof` | Payment proof (public, `?token=`) |
| GET | `/expense-claims/batch-payments/{batchId}/proof` | Batch proof (public, `?token=`) |

### 2.2 Advance Requests

| Method | Path | Purpose |
|---|---|---|
| GET | `/advance-requests` | List |
| GET | `/advance-requests/emi-info` | Salary / EMI headroom for the employee |
| POST | `/advance-requests` | Raise an advance (multipart) |
| GET | `/advance-requests/{id}` | Single advance |
| POST | `/advance-requests/{id}/manager-approve` · `/manager-reject` | Stage 1 |
| POST | `/advance-requests/{id}/hr-approve` · `/hr-reject` | Stage 2 (final) |
| GET | `/advance-requests/{id}/settlement` | Payout state, payments, EMI headroom |
| POST | `/advance-requests/{id}/set-deductions` | Lock net payable without paying |
| POST | `/advance-requests/{id}/settle` | Record one payout (partial allowed) |
| POST | `/advance-requests/{id}/employee-settle` | Employee declares how a **company** advance was spent |
| POST | `/advance-requests/{id}/settle-approve` · `/settle-reject` | Branch admin / HR verdict on that declaration |
| POST | `/advance-requests/{id}/record-return` | Return an under-spent balance (direct or payroll) |
| POST | `/advance-requests/{id}/return-payments/{index}/approve` · `/reject` | Confirm each return payment |
| POST | `/advance-requests/{id}/raise-reimbursement` | Raise an expense claim for an over-spend |
| POST | `/advance-requests/payments/{paymentId}/sync-zoho` | Push payout to Zoho Books |
| GET | `/advance-requests/{id}/attachments/{index}` | Attachment (public, `?token=`) |
| GET | `/advance-requests/payments/{paymentId}/proof` | Payout proof (public, `?token=`) |
| GET | `/advance-requests/{id}/settle-proof/{index}` | Bill proof (public, `?token=`) |
| GET | `/advance-requests/{id}/return-proof/{index}` | Return proof (public, `?token=`) |

> **Disabled but present in source:** `recover-onetime` and its proof route are commented out in `routes/api.php`. Re-enabling also requires flipping `ONETIME_PAYOFF_ENABLED` in `ExpenseSettlementModal.tsx`.

---

## 3. EXPENSE CLAIMS

### 3.1 GET `/expense-claims`

| Param | Values | Notes |
|---|---|---|
| `scope` | `mine` (default) · `team` · `all` | Anything else falls back to `mine`. `all` requires `hr.expense` `can_view` |
| `status` | `pending` · `approved` · `rejected` | |
| `q` | free text | Matches claim no / title / employee |
| `date_from`, `date_to` | `YYYY-MM-DD` | On `expense_date` |
| `page`, `per_page` | ints | **Presence of either switches the response shape** |

**Two response shapes.** Without `page`/`per_page` the endpoint returns a **plain array** of serialized claims — the shape every older caller expects. With either present it returns an envelope:

```json
{
  "data": [ /* serialized claims */ ],
  "meta": { "page": 1, "per_page": 25, "total": 402, "last_page": 17 },
  "summary": {
    "counts": { "all": 402, "pending": 88, "approved": 250, "rejected": 64 },
    "total_amount": 1284300.00,
    "approved_amount": 910450.00,
    "categories": [ { "id": 4, "name": "Travel", "spent": 220100.00 } ]
  }
}
```

`per_page` is clamped to **1–200**, defaulting to **25**. `summary` is computed over **every matching claim**, not the visible page — once the client stops holding the full list it can no longer total the rows itself.

### 3.2 GET `/expense-claims/categories`

Active expense categories → `[{ id, name, code }]`. Branch-scoped, so an employee sees their own branch's categories. Declared before the `{id}` route so `categories` is not captured as an id.

### 3.3 POST `/expense-claims` (multipart)

**Who the claim is filed for.** For a non-super-admin the employee is derived from the **token**, not from the body — a stale `employee_id` would otherwise resolve to another row and trip a confusing 403. Super-admins may target any employee via `employee_id` / `employee_code`.

**Pre-validation gates**

| Gate | Failure |
|---|---|
| User has a linked Employee record | 422 `No linked Employee record found for the current user.` |
| Employee exists | 404 |
| Non-super-admin files only for self | 403 `You can only file claims for your own employee record.` |
| Onboarding complete (`OnboardingGuard`) | 422 |
| Joining date not in the future | 422 `You cannot raise an expense claim before your joining date (…).` |

**Body**

| Field | Rules |
|---|---|
| `title` | **required**, ≤255 |
| `amount` | **required**, numeric, ≥0, ≤9999999999999.99 |
| `expense_date` | **required**, date, `before_or_equal:today`, `after_or_equal:` today−30d |
| `payment_method` | **required**, ≤64 |
| `files[]` | **required**, ≥1 file · each `pdf,jpg,jpeg,png` and **≤2 MB** · **whole claim ≤5 MB** |
| `category_id` | nullable int |
| `currency` | nullable, ≤8 (defaults `INR`) |
| `project` | nullable, ≤64 |
| `vendor` | nullable, ≤255 |
| `purpose` | nullable, ≤500 |
| `reimbursement_for_advance_id` | nullable int — links the claim to an over-spent company advance |

> **Corrections against v1.0:** the per-file cap is **2 MB** (not 5 MB); 5 MB is the **total** across all receipts, guarding PHP's `post_max_size`. `payment_method` is now **required**. `purpose` is capped at 500. CRLF newlines in `purpose` are folded to LF before counting, so a textarea within the on-screen limit is not rejected.

**Reimbursement linkage.** When `reimbursement_for_advance_id` is supplied it is accepted only if the advance belongs to the same employee, is finalised (`employee_settled_at`), has `settle_type = 'reimburse'`, and has no claim linked yet. An invalid linkage is **silently ignored** and a normal claim is created. A valid one caps the amount at the advance's `settle_balance`:

```json
{ "message": "Reimbursement amount cannot exceed the balance ₹4,500.00.",
  "errors": { "amount": ["Cannot exceed ₹4,500.00."] } }
```

**Response 201:** serialized claim — `claim_no` `EXP-####` (allocated under a row lock inside the insert transaction so concurrent submitters cannot collide), `status: pending`, `manager_status: pending`, `hr_status: pending`.

> Category spending caps were **removed** — a claim of any amount is accepted, matching advance requests.

### 3.4 Approvals

**POST `/expense-claims/{id}/manager-approve` · `/manager-reject`**

- Only the assigned reporting manager, or a branch admin when no manager is assigned, or super-admin.
- **403** `You cannot approve your own expense claim…` — self-approval is blocked.
- **403** `You are not the assigned reporting manager for this claim.`
- **409** `This claim has already been actioned by the manager.`
- `comment` — **required on reject**, ≤1000 chars.

> There is no silent auto-approval when an employee has no reporting manager. The manager stage always starts `pending` and a branch admin approves it explicitly from the Inbox, so the audit trail always has two steps.

**POST `/expense-claims/{id}/hr-approve` · `/hr-reject`**

- Requires `hr.expense` `can_approve`. Self-approval blocked (403).
- **409** `Manager must approve this claim before HR / Finance can approve it.`
- **409** `This claim has already been actioned by HR / Finance.`
- `comment` — required on reject, ≤1000.
- **New:** `hr-approve` also accepts `deductions[]` / `additions[]` (same shape as §3.5) so the net payable can be fixed at approval time.

### 3.5 Settlement (post-approval payout)

**GET `/expense-claims/{id}/settlement`** — sanctioned amount, deductions/additions, total paid, remaining, and the payment history with proof links.

**POST `/expense-claims/{id}/set-deductions`** — fix the net payable **without** recording a payment.

| Field | Rules |
|---|---|
| `deductions[].amount` | required with `deductions`, numeric ≥0 |
| `deductions[].reason` | ≤500 — **required for every row with amount > 0** |
| `additions[].amount` | required with `additions`, numeric ≥0, **≤100000** |
| `additions[].reason` | ≤500 — required for every row with amount > 0 |

- **409** `Only an approved claim can be settled. Approve it first.`
- **409** `The deduction is already locked for this claim.`
- **422** `Each deduction needs a reason.` / `Net payable must be greater than zero.`

Net payable = `claim amount − Σ deductions + Σ additions`, and must be **> 0**.

**POST `/expense-claims/{id}/settle`** — record **one** installment. Partial payments are allowed until the sanctioned amount is met.

| Field | Rules |
|---|---|
| `amount` | **required**, numeric, ≥0.01, ≤ remaining |
| `category_id` | **required**, int |
| `payment_type` | **required**, one of `Cheque` · `UPI` · `PhonePe` · `Bank Transfer` |
| `expense_type` | **required**, one of `Goods` · `Service` |
| `note` | **required**, ≤500 |
| `proof` | **required** file, ≤2 MB, `pdf,jpg,jpeg,png` |
| `deductions[]`, `additions[]` | first payment only — fixes the sanctioned amount |

- **403** `You cannot record a payment for your own claim — your reporting manager (branch user) will do it.`
- **409** `Only an approved claim can be paid.` / `This claim is already fully paid.`
- **422** `Payment (5,000.00) exceeds the remaining amount (3,200.00).`

> Proof is restricted to receipt formats — spreadsheets and Word files are rejected because they are not evidence of a payment.

**POST `/expense-claims/{id}/email-reimbursement`**

- **409** `Only an approved claim can be emailed.`
- **409** `The claim must be fully paid before emailing the reimbursement.`
- **409** `All payments must be synced to Zoho Books before emailing.`

### 3.6 Consolidated (batch) payment

**GET `/expense-claims/batch-payable`** — approved, unpaid claims grouped by employee.
**GET `/expense-claims/batch-payments`** — batch history.

**POST `/expense-claims/batch-pay`** — pay many claims for one employee in a single transaction.

| Field | Rules |
|---|---|
| `employee_id` | **required** |
| `claim_ids[]` | **required**, ≥1, integers |
| `reference_number` | **required**, ≤120 |
| `payment_type` | **required**, `Cheque` · `UPI` · `PhonePe` · `Bank Transfer` |
| `expense_type` | **required**, `Goods` · `Service` |
| `note` | nullable, ≤500 |
| `proof` | **required** file, ≤2 MB, `pdf,jpg,jpeg,png,webp` (one shared proof for the batch) |

- **422** `Some selected claims were not found for this employee.` (id set must match exactly)
- **409** `EXP-0042 is not approved yet — only approved claims can be paid.`
- **409** `EXP-0042 is already fully paid.`

Each claim is paid its **remaining** amount (`sanctioned_amount ?? amount − total_paid`), so partially-paid claims settle correctly rather than being double-paid.

### 3.7 POST `/expense-claims/export-pdf`

Server-rendered PDF of the Expense / Advance list. `POST` because the screen sends the rows it is displaying rather than a query to re-run.

---

## 4. ADVANCE REQUESTS

### 4.1 POST `/advance-requests` (multipart)

Same employee-resolution, onboarding and joining-date gates as §3.3 (messages say "advance request").

| Field | Rules |
|---|---|
| `advance_type` | **required**, one of `Travel Advance` · `Salary Advance` · `Medical Advance` · `Loan` · `Other` |
| `advance_type_other` | ≤255 — **required when** `advance_type = Other` |
| `amount` | **required**, numeric, **min ₹100**, ≤9999999999999.99 |
| `used_for` | **required**, `self` (recovered from salary) or `company` (spent for the company, **not** recovered) |
| `requested_date` | **required**, must be **exactly today** (`after_or_equal:today` + `before_or_equal:today`) |
| `recovery_start` | **required if** `used_for=self` — from the **1st of the month after** the request, up to the **end of the same month a year on** |
| `recovery_mode` | **required if** `used_for=self` — `emi` · `lumpsum` · `bimonthly` |
| `recovery_months` | 1–120 — required for `emi` / `bimonthly` |
| `monthly_emi` | numeric, ≥0, ≤ advance amount |
| `reason` | **required**, ≤500 |
| `files[]` | **required**, ≥1 · each `pdf,jpg,jpeg,png` ≤2 MB |
| `request_items` | JSON string, company advances only — distribution rows |

> **Corrections against v1.0:** advance types were renamed and `Loan` added. `files[]` is now **required** (v1.0 said optional). A minimum amount of **₹100** applies. `recovery_start` has both a floor **and** a ceiling. `used_for` and company-advance distribution are new.

**Cross-field rules beyond the validator**

| Rule | Error |
|---|---|
| Instalment ≥ ₹500 (`emi` / `bimonthly`) | 422 `Each recovery instalment must be at least ₹500 — reduce the number of cycles or increase the amount.` |
| Advance below ₹500 | 422 `An advance below ₹500 must be recovered in a single instalment of ₹NNN.` |
| Instalments required | 422 `Number of instalments is required for EMI / Bi-Monthly recovery.` |
| Instalment ≤ advance | 422 `The monthly instalment ₹X cannot exceed the advance amount ₹Y.` |
| `Other` needs a label | 422 `Please specify the advance type when "Other" is selected.` |
| Distribution rows must total the amount | 422 `Distribution rows must total the advance amount ₹X — got ₹Y.` |

A **company** advance stores no `recovery_start`, `recovery_mode`, `recovery_months` or `monthly_emi` — these are nulled on write regardless of what was posted.

**Response 201:** serialized advance, `advance_no` `ADV-####`.

### 4.2 GET `/advance-requests/emi-info`

```json
{ "net_salary": 45000, "ongoing_emi": 6000, "cap": 31500, "available": 25500, "pct": 70 }
```

`cap` is **70 %** of net salary (`EMI_HEADROOM_PCT`); `available` subtracts ongoing EMIs, optionally excluding one advance via `?exclude_id=`.

> **This headroom is advisory.** It is reported here and echoed in the settlement payload, but `store()` does **not** reject an advance that exceeds it.

### 4.3 GET `/advance-requests`

Supports `scope`, `status`, `employee_id` / `employee_code`. **Not paginated** — unlike `/expense-claims`, `page` / `per_page` are ignored and the full array is returned.

### 4.4 Approvals

Identical four endpoints and rules as §3.4, with advance-flavoured messages (`Manager must approve this advance request before HR / Finance can approve it.`). Approved `self` advances feed payroll recovery (`hr_status = approved`).

### 4.5 Settlement (payout to the employee)

`GET /settlement`, `POST /set-deductions`, `POST /settle` mirror the expense-claim endpoints in §3.5, including the ≤100000 cap on each addition and the "net payable must be greater than zero" rule. The settlement payload additionally carries `emi_ongoing` and the remaining EMI headroom.

### 4.6 Company-advance settlement (employee declaration)

**POST `/advance-requests/{id}/employee-settle`** — the employee declares, bill by bill, how a company advance was spent. Settlement is **incremental**: bills can be added across several saves and the advance locks only when `finalize` is sent.

| Field | Rules |
|---|---|
| `items[].amount` | **required**, ≥0.01 |
| `items[].reason` | **required**, ≤500 |
| `items[].method` | **required**, ≤40 |
| `proofs[]` | one file per item, **index-aligned to `items[]`**, ≤2 MB, `pdf,jpg,jpeg,png,webp,doc,docx,xls,xlsx` |
| `note` | ≤500 |
| `finalize` | boolean — locks the settlement |
| `declared_type` | `equal` · `minimum` · `maximum` — captured on the first save, then **locked** |
| `target_amount` | required unless `declared_type=equal` |

**Declared type rules** (validated against the sanctioned amount):

| Type | Requirement | Outcome |
|---|---|---|
| `equal` | `target == advance` | nothing owed either way |
| `minimum` | `0 < target < advance` | employee **returns** the balance |
| `maximum` | `target > advance` | company **reimburses** the excess |

- **403** `Only the employee who took this advance can settle it.`
- **409** `Only a company-used advance needs to be settled.`
- **409** `The advance must be fully paid before it can be settled.`
- **409** `This advance is already finalised and locked.`
- **422** `The declared amount used does not match the chosen type.`
- **422** when `proofs[]` count ≠ `items[]` count.

**POST `/settle-approve` · `/settle-reject`** — branch admin / HR verdict.
- **409** `This settlement is not awaiting approval.` (both)
- `settle-approve`: `comment` is **optional** and stored if present.
- `settle-reject`: `comment` is **required**, ≤500 — `Add a short reason so the employee can fix the settlement.`

### 4.7 Returning an under-spend

**POST `/advance-requests/{id}/record-return`**

| Field | Rules |
|---|---|
| `mode` | **required**, `direct` (employee pays back) or `payroll` (recovered from salary) |
| `amount` | ≥0.01 |
| `method` | ≤40 |
| `proof` | file ≤2 MB, `pdf,jpg,jpeg,png,webp,doc,docx,xls,xlsx` |
| `note` | ≤500 |
| `recovery_start` | **`payroll` only** — required, ≥ 1st of next month |
| `recovery_type` | **`payroll` only** — required, `emi` · `lumpsum` · `bimonthly` |
| `monthly` | ≥0.01 |

- **409** `A return can only be recorded for a finalised, under-spent (return) advance.`
- **409** `The settlement must be approved by a branch admin / HR before the balance can be returned.`
- **409** `There is nothing to return.` / `The return has already been fully recorded.`

**POST `/return-payments/{index}/approve` · `/reject`** — each return payment is confirmed individually by a branch admin / HR. The return closes only once **every** payment covering the balance is approved.

### 4.8 Raising a reimbursement for an over-spend

**POST `/advance-requests/{id}/raise-reimbursement`** — creates a linked expense claim (`EXP-####`) for the excess.

- **409** `A reimbursement can only be raised for a finalised, over-spent (reimburse) advance.`
- **409** `The settlement must be approved by a branch admin / HR before a reimbursement can be raised.`
- **409** `There is nothing to reimburse.` / `A reimbursement expense has already been raised for this advance.`

---

## 5. FILES & ATTACHMENTS

All file routes live **outside** the `auth:sanctum` group and authenticate via `?token=<sanctum_token>`, because they are opened as new-tab navigations that carry no `Authorization` header. Every route re-checks tenant access.

| Route | Serves |
|---|---|
| `/expense-claims/{id}/attachments/{index}` | Claim receipt |
| `/expense-claims/payments/{paymentId}/proof` | Single payment proof |
| `/expense-claims/batch-payments/{batchId}/proof` | Batch payment proof |
| `/advance-requests/{id}/attachments/{index}` | Advance attachment |
| `/advance-requests/payments/{paymentId}/proof` | Advance payout proof |
| `/advance-requests/{id}/settle-proof/{index}` | Settlement bill proof |
| `/advance-requests/{id}/return-proof/{index}` | Return payment proof |

Stored rows keep only `{name, size, path}`; the public URL is rebuilt per request at serialization time so it always points at the Laravel route rather than a raw `/storage` or Azure blob URL.

---

## 6. ZOHO BOOKS SYNC

| Endpoint | Scope |
|---|---|
| `POST /expense-claims/payments/{paymentId}/sync-zoho` | One claim payment |
| `POST /expense-claims/batch-payments/{batchId}/sync-zoho` | A whole batch |
| `POST /advance-requests/payments/{paymentId}/sync-zoho` | One advance payout |

Rows carry a `zoho_status` (`not_synced` → synced) and the pushed expense id. `email-reimbursement` refuses to send until every payment on the claim is synced.

---

## 7. ERROR EXAMPLES

**409 — stage order**
```json
{ "message": "Manager must approve this claim before HR / Finance can approve it." }
```

**403 — self-action**
```json
{ "message": "You cannot approve your own expense claim — your reporting manager (branch user) will approve it." }
```

**422 — receipt required**
```json
{ "message": "…", "errors": { "files": ["At least one proof / receipt is required."] } }
```

**422 — total attachment size**
```json
{ "message": "…", "errors": { "files": ["Attachments total 6.4 MB — keep the claim under 5 MB."] } }
```

**422 — expense date window**
```json
{ "message": "…", "errors": { "expense_date": ["Expense date must be within the last 30 days."] } }
```

**422 — instalment floor**
```json
{ "status": false,
  "message": "Each recovery instalment must be at least ₹500 — reduce the number of cycles or increase the amount.",
  "errors": { "recovery_months": ["Minimum instalment is ₹500.00."] } }
```

**422 — overpayment**
```json
{ "status": false,
  "message": "Payment (5,000.00) exceeds the remaining amount (3,200.00).",
  "errors": { "amount": ["Cannot pay more than the remaining amount."] } }
```

---

## 8. QUICK REFERENCE

```
# Claim lifecycle
GET  /expense-claims/categories
POST /expense-claims (files[])                    # raise (EXP-####)
POST /expense-claims/{id}/manager-approve         # stage 1
POST /expense-claims/{id}/hr-approve              # stage 2 (final)
GET  /expense-claims/{id}/settlement              # payout state
POST /expense-claims/{id}/set-deductions          # fix net payable
POST /expense-claims/{id}/settle (proof)          # pay (partial allowed)
POST /expense-claims/batch-pay (proof)            # pay many at once
POST /expense-claims/{id}/email-reimbursement     # after full pay + Zoho sync

# Self advance (recovered from salary)
GET  /advance-requests/emi-info                   # 70% headroom (advisory)
POST /advance-requests (files[], used_for=self)   # raise (ADV-####)
POST /advance-requests/{id}/hr-approve            # → payroll recovery
POST /advance-requests/{id}/settle (proof)        # disburse

# Company advance (spent for the company)
POST /advance-requests (used_for=company)
POST /advance-requests/{id}/settle                # disburse to employee
POST /advance-requests/{id}/employee-settle       # declare bills, then finalize
POST /advance-requests/{id}/settle-approve        # branch admin / HR verdict
POST /advance-requests/{id}/record-return         # under-spend → return balance
POST /advance-requests/{id}/raise-reimbursement   # over-spend → new EXP-####
```

---

## 9. NOTES & CAVEATS

1. **Two-stage approval.** Manager before HR; HR sets the final status. No silent auto-approval when an employee has no reporting manager — a branch admin approves the manager stage explicitly.
2. **No self-action anywhere.** An employee cannot approve, or record a payment against, their own claim or advance. Super-admin is exempt.
3. **`hr.expense`** gates `scope=all` plus every HR / Finance action. Settlement currently reuses `can_approve` (a dedicated `can_settle` may be split out later).
4. **Per-file 2 MB, per-claim 5 MB.** Both are enforced server-side. Payment proofs are restricted to receipt formats (`pdf,jpg,jpeg,png`, plus `webp` for batch); office documents are rejected.
5. **The 70 % EMI headroom is advisory** — surfaced by `emi-info` and the settlement payload, but not enforced when an advance is created.
6. **Bimonthly recovery behaves as lumpsum in payroll**; recovery is capped to net pay.
7. **Category spending caps were removed.** Claims of any amount are accepted.
8. **Pagination is asymmetric.** `/expense-claims` paginates on request and returns a `{data, meta, summary}` envelope; `/advance-requests` always returns a plain array.
9. **CRLF folding.** `purpose` (claims) and `reason` (advances) have `\r\n` folded to `\n` before the 500-char check, so a textarea within the on-screen limit is not rejected by the server.
10. **Claim / advance numbers** are allocated under a row lock inside the insert transaction, so concurrent submitters in the same tenant cannot produce duplicate `EXP-####` / `ADV-####` values.
11. **No DB foreign keys or soft deletes** on these tables; employee and category names are snapshotted onto the row so a deleted employee does not blank the audit trail.
12. **One-time recovery pay-off is disabled** in routes and behind `ONETIME_PAYOFF_ENABLED` on the client; the controller methods remain for a later re-enable.

---

*Related documents: EXPENSE_TECHNICAL_DOCUMENTATION.md · EXPENSE_FUNCTIONAL_DOCUMENTATION.md · EXPENSE_CODE_WALKTHROUGH.md*
