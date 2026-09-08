# EXPENSE MANAGEMENT MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Expense Management (claims & advances)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |
| 2.0 | 2026-09-08 | System | Settlement & payment tables, batch payments, company advances, return/reimbursement lifecycle, recovery ledger, Zoho sync. Corrected file limits, bimonthly recovery and the no-manager rule. |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is

Expense Management has two parallel sub-modules sharing an identical **two-stage approval** (Reporting Manager → HR/Finance):

- **Expense Claims** — reimbursements with mandatory receipts.
- **Advance Requests** — travel / salary / medical / loan advances, either **recovered from salary** (`used_for = self`) or **spent on the company's behalf** (`used_for = company`).

Approval is no longer the end of the story. Since v1.0 the module gained a full **post-approval money trail**: sanctioned amounts with itemised deductions and additions, partial payments with mandatory proof, consolidated batch payments, employee settlement of company advances, balance returns, over-spend reimbursement, and Zoho Books synchronisation.

Both are per-tenant, use `EXP-####` / `ADV-####` codes, store attachments on the public disk, and are gated by the `hr.expense` permission. **Approved `self` advances feed Payroll** as recovery deductions.

### 1.2 High-level architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  HrExpenseManagement.tsx      HR review: KPIs, tabs, export, actions   │
│  ExpenseSettlementModal.tsx   sanction → deductions → pay (partial)    │
│  BatchPaymentModal.tsx        pay many claims for one employee         │
│  AdvanceSettleModal.tsx       employee declares company-advance spend  │
│  ExpenseTab.tsx (profile)     raise claim / advance; my & team views   │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON · multipart for receipts & proofs
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  ExpenseClaimController    (21 routes)                                 │
│    index/store/show/categories · manager+hr approve/reject             │
│    settlement/set-deductions/settle · batch-payable/batch-payments/    │
│    batch-pay · export-pdf · email-reimbursement · Zoho sync            │
│  AdvanceRequestController  (23 routes)                                 │
│    same approval shape · emi-info · settlement/set-deductions/settle   │
│    employee-settle · settle-approve/reject · record-return ·           │
│    return-payments approve/reject · raise-reimbursement · Zoho sync    │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                      DATA LAYER (PostgreSQL)                           │
│  expense_claims (40 cols) ── expense_claim_payments ── expense_batch_  │
│                                                          payments      │
│  advance_requests (67 cols) ── advance_request_payments                │
│                            └─ advance_recovery_ledger (arrears)        │
│  master_expense_categories                                             │
│  Feeds: PayrollService::advanceRecovery() — two streams, 70% FOI cap,  │
│         arrears carried forward, loan split onto its own column        │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure

```
app/Http/Controllers/Api/
  ExpenseClaimController.php     (~2,090 lines)
  AdvanceRequestController.php   (~2,560 lines)
app/Models/
  ExpenseClaim.php · ExpenseClaimPayment.php · ExpenseBatchPayment.php
  AdvanceRequest.php · AdvanceRequestPayment.php
  Masters/ExpenseCategories.php
app/Services/PayrollService.php  (advanceRecovery + recovery ledger)
app/Support/OnboardingGuard.php  (raise-time gate)
database/migrations/             (31 expense/advance migrations — see §3.5)
resources/js/
  pages/hrms/HrExpenseManagement.tsx · ExpenseSpendChart.tsx
  pages/employee/tabs/ExpenseTab.tsx
  components/ExpenseSettlementModal.tsx · BatchPaymentModal.tsx
  components/AdvanceSettleModal.tsx
  components/ExpenseClaimsTable.tsx · AdvanceRequestsTable.tsx
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · **PostgreSQL** · Sanctum |
| Files | Receipts & proofs on the `public` disk — **pdf/jpg/jpeg/png, 2 MB per file, 5 MB per claim** |
| PDF | `barryvdh/laravel-dompdf` (`POST /expense-claims/export-pdf`) |
| External | Zoho Books (expense push) |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) · Recharts · xlsx |

> Settlement and batch modals are **lazy-loaded** (`React.lazy`) and pre-warmed on hover — `ExpenseSettlementModal` alone is ~159 KB.

---

## 3. DATABASE SCHEMA

### 3.1 `expense_claims` — 40 columns

| Group | Columns |
|---|---|
| Tenancy | `client_id`, `branch_id` (both indexed) |
| Identity | `claim_no` (`EXP-####`), `employee_id`, `employee_name` (snapshot), `manager_id` |
| Claim | `category_id`, `category_name`, `currency` (default `INR`), `project`, `payment_method`, `title`\*, `amount` decimal(18,2)\*, `expense_date`\*, `vendor`, `purpose`, `attachments` json |
| Approval | `status`, `manager_status`, `hr_status` ∈ pending/approved/rejected · `manager_acted_at`, `manager_comment`, **`manager_acted_by`** · `hr_user_id`, `hr_acted_at`, `hr_comment` |
| **Settlement** | `sanctioned_amount`, `deduction_amount`, `deduction_reason`, `deductions` json, `additions` json, `addition_amount`, `total_paid`, `settlement_status` (unpaid/partial/paid), `settled_at` |
| **Notification** | `reimbursement_emailed_at` |
| Audit | `created_by`, timestamps |

Indexes: `(client_id, status)`, `(client_id, branch_id, employee_id)`, plus single-column on `client_id`, `branch_id`, `employee_id`, `manager_id`. **No soft deletes, no DB FKs.**

### 3.2 `expense_claim_payments` — 21 columns *(new)*

One row per installment. `expense_claim_id`, `amount`, `category_id`/`category_name`, `payment_type`, `expense_type`, `note`, `proof_path`/`proof_name`, `paid_by`, `paid_at`, `batch_payment_id` (set when paid as part of a batch), `zoho_status`/`zoho_synced_at`/`zoho_expense_id`, **`deleted_at` (SoftDeletes)**.

### 3.3 `expense_batch_payments` — 17 columns *(new)*

One consolidated payment covering many claims for one employee: `employee_id`, `reference_number`, `payment_type`, `total_amount`, `note`, shared `proof_path`/`proof_name`, `zoho_*`, `paid_by`, **`deleted_at`**.

### 3.4 `advance_requests` — 67 columns

| Group | Columns |
|---|---|
| Tenancy / identity | `client_id`, `branch_id`, `advance_no` (`ADV-####`), `employee_id`, `manager_id` |
| Request | `advance_type`\*, `advance_type_other`, `amount`\*, `requested_date`\*, `reason`\*, `attachments` json, **`used_for`** (self/company), **`request_items`** json (company distribution), `expected_use_date` |
| Recovery (self) | `recovery_start`, `recovery_mode`, `recovery_months`, `monthly_emi` — **all nullable** since company advances have no recovery |
| Approval | same columns as claims, incl. **`manager_acted_by`** |
| Payout | `sanctioned_amount`, `deduction_amount`, `deduction_reason`, `deductions`, `additions`, `addition_amount`, `total_paid`, `settlement_status`, `settled_at` |
| **Employee settlement** | `employee_settled_at`, `employee_settle_note`, `settle_actual_amount`, `settle_type` (equal/return/reimburse), `settle_balance`, `settle_items` json, `settle_proof_path`/`_name`, `settle_declared_type`, `settle_target_amount` |
| **Settlement approval** | `settle_approval_status`, `settle_approved_by`, `settle_approved_at`, `settle_approval_comment` |
| **Reimbursement** | `settle_reimbursement_claim_id`, `settle_reimbursed_at` |
| **Return** | `settle_returned_at`, `settle_return_method`, `settle_return_proof_path`/`_name`, `settle_return_payments` json, `settle_return_recovery_start`, `settle_return_recovery_mode`, `settle_return_recovery_months`, `settle_return_monthly`, `settle_return_scheduled_at`, `recovery_direct_payments` json |

### 3.5 `advance_request_payments` — 18 columns *(new)*

`advance_request_id`, `amount`, `payment_type`, `reference_number`, `note`, `proof_path`/`_name`, `paid_by`, `paid_at`, `zoho_*`, **`deleted_at`**.

### 3.6 `advance_recovery_ledger` — 13 columns *(new)*

The arrears memory for payroll recovery. `advance_request_id`, `employee_id`, `client_id`, `branch_id`, `year`, `month`, `due`, `amount` (actually taken), `carried` (shortfall rolled to the next cycle), **`stream`** (`self` | `return`). Unique on `adv_recovery_stream_uniq` (advance, stream, year, month) so a payroll re-run **overwrites** rather than double-counting.

### 3.7 `master_expense_categories` — 12 columns

`code`, `name`, `monthly_limit`/`yearly_limit` (**present but deliberately unenforced**), `description`, `status`. No soft deletes, no FKs.

### 3.8 Migration history

3 original tables (May 2026) + **31 migrations** through August 2026. The bulk land in three waves: claim settlement (`2026_07_30` → `2026_08_01`), advance settlement / return / reimbursement (`2026_08_02` → `2026_08_06`), and batch payment + Zoho + company distribution (`2026_08_06` → `2026_08_12`).

---

## 4. MODELS

| Model | Table | Notes |
|---|---|---|
| `ExpenseClaim` | expense_claims | casts amount/sanctioned/deduction/addition decimal:2, dates, `attachments`/`deductions`/`additions` array; relations employee, manager, category, creator, hrUser, payments, `reimbursedAdvance` |
| `ExpenseClaimPayment` | expense_claim_payments | **SoftDeletes**; belongs to claim + batch |
| `ExpenseBatchPayment` | expense_batch_payments | **SoftDeletes**; has many payments |
| `AdvanceRequest` | advance_requests | casts money decimal:2, `recovery_months` int, `settle_items`/`settle_return_payments`/`request_items`/`recovery_direct_payments` array |
| `AdvanceRequestPayment` | advance_request_payments | **SoftDeletes** |
| `Masters\ExpenseCategories` | master_expense_categories | limits unenforced |

The two **parent** tables still have no soft deletes; the three **payment** tables do.

---

## 5. API SURFACE

44 routes total — 21 on claims, 23 on advances. Full request/response detail lives in **EXPENSE_API_DOCUMENTATION.md**; the shape is:

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    // static paths BEFORE /{id} so "categories", "batch-payable" etc. aren't captured as ids
    Route::get ('/expense-claims/categories',      [ExpenseClaimController::class, 'categories']);
    Route::get ('/expense-claims/batch-payable',   [ExpenseClaimController::class, 'batchPayable']);
    Route::post('/expense-claims/batch-pay',       [ExpenseClaimController::class, 'batchPay']);
    Route::post('/expense-claims/export-pdf',      [ExpenseClaimController::class, 'exportPdf']);
    // … CRUD, approvals, settlement, Zoho sync
    Route::get ('/advance-requests/emi-info',      [AdvanceRequestController::class, 'emiInfo']);
    // … approvals, settlement, employee-settle, returns, reimbursement
});
// PUBLIC (query-token auth) — 7 file routes, outside the auth group because they are
// opened as new-tab navigations that carry no Authorization header.
```

**Why the file routes sit outside the group:** a `<a href>` in a new tab sends no `Authorization` header. Registering them inside `auth:sanctum` produced a 500 (`Route [login] not defined`) rather than a 401. They authenticate via `?token=` and re-check tenant access.

---

## 6. CONTROLLER ANALYSIS

**Permission slug `hr.expense`** — `guardHrPermission($user, 'can_view'|'can_approve')`; super-admin bypass; unseeded-module fallback allows admin-tier. Owner and assigned manager are always allowed on their own rows.

| Method group | Purpose |
|---|---|
| `categories` (claims only) | Active categories, **branch-scoped** |
| `index` | `scope` = mine / team (transitive reports) / all (needs `can_view`); claims add `q`, `date_from`, `date_to` and **opt-in pagination** |
| `store` | Ownership guard → `OnboardingGuard` → joining-date gate → validation → transaction (`EXP-`/`ADV-####` under `lockForUpdate`) |
| `managerApprove/Reject` | Assigned manager or branch admin; **no self-approval**; 409 if already actioned |
| `hrApprove/Reject` | `can_approve`; approve requires manager approved; HR sets final `status`; may carry deductions/additions |
| `settlement` / `setDeductions` / `settle` | Sanction, lock net payable, record installments with mandatory proof |
| `batchPayable` / `batchPayments` / `batchPay` | Consolidated payment across many claims |
| `employeeSettle` / `settleApprove` / `settleReject` | Company-advance declaration and verdict |
| `recordReturn` / `approveReturnPayment` / `rejectReturnPayment` | Under-spend return, confirmed payment by payment |
| `raiseReimbursement` | Over-spend → creates a linked `EXP-####` |
| `syncPaymentToZoho` / `syncBatchPaymentToZoho` | Zoho Books push |
| `downloadAttachment` and 6 sibling proof routes | Stream files (public, `?token=`) |

**Validation highlights (corrected against v1.0)**

- Claim: `title`\*, `amount`\* ≤ 9999999999999.99, `expense_date`\* within the last 30 days and not future, **`payment_method`\***, **`files`\* — 2 MB each, 5 MB total**, `purpose` ≤ 500.
- Advance: `advance_type`\* ∈ Travel/Salary/Medical/**Loan**/Other, `amount`\* **≥ ₹100**, `used_for`\*, `requested_date`\* = today, `recovery_start` between the 1st of next month and a year out, **`files`\* now mandatory**, instalment ≥ ₹500 and ≤ the advance.
- Both fold `\r\n` → `\n` in the free-text field before the 500-char check, because multipart serialisation adds a character per line.

---

## 7. FRONTEND

- **`HrExpenseManagement.tsx`** — HR/Finance surface. Expense/Advance toggle, five KPI tiles, status tabs with badges, Spend-by-Category chart, Excel/PDF/CSV export, approve/reject, settle and batch-pay entry points. `canHrApprove` = super-admin / `hr.expense.can_approve` / client_admin.
  **The tiles, tab badges and category rollup are computed by the server** (`summary` in the paginated response) — the browser holds one page and can no longer reduce over the full list.
- **`ExpenseSettlementModal.tsx`** — sanction, itemised deductions/additions, partial payments with proof, payment history, Zoho status.
- **`BatchPaymentModal.tsx`** — pick an employee's approved-unpaid claims and pay them under one reference and proof.
- **`AdvanceSettleModal.tsx`** — employee declares bills against a company advance, then finalises.
- **`ExpenseTab.tsx`** (employee profile) — My/Team sub-tabs, filter pills, raise forms, local drafts.

---

## 8. INTEGRATION: PAYROLL (advance recovery)

`PayrollService::advanceRecovery($employeeId, $period, $cap)` reads `hr_status = 'approved'` advances with a `recovery_start` on or before the period end, and builds **two independent recovery streams**:

| Stream | Meaning |
|---|---|
| `self` | The employee repaying an advance they took (`recovery_*` columns) |
| `return` | The employee returning **unused** company advance via payroll (`settle_return_*`, scheduled at settlement) |

Per cycle, for each stream:

- **EMI** — `monthly_emi` (or `amount / months`) while the cycle is inside the schedule.
- **Bimonthly** — **every other month** (`monthIndex % 2`), for `recovery_months` instalments. *(v1.0 documented this as behaving like lumpsum; it is now genuinely bimonthly.)*
- **Lumpsum** — the full amount once, in the start month.

Then: `due = min(this cycle's instalment + carried arrears, outstanding)`, `take = min(due, room)`. Streams are sorted **oldest schedule first** so the longest-running advance gets priority when the cap bites, and the shortfall (`due − take`) is written to `advance_recovery_ledger.carried` for the next cycle.

**The cap is 70 % of net-before-recovery** (the FOI headroom). Exceeding it raises the payslip warning *"Advance recovery exceeded the 70% FOI headroom this cycle…"*. Recovery can never drive net pay negative.

**Rule 11 — loans report separately.** An advance whose type contains "loan" lands on the payslip's `loan_recovery` column; everything else on `advance_recovery`.

In Full & Final the month's already-deducted EMI is added back so the outstanding is recovered exactly once. See `docs/payroll/`.

---

## 9. SECURITY & CAVEATS

1. **Two-stage approval** — manager before HR/Finance; HR sets the final `status`.
2. **No self-action.** An employee cannot approve, or record a payment against, their own claim/advance. Super-admin is exempt.
3. **No silent auto-approval.** When an employee has no reporting manager the manager stage still starts `pending` and a **branch admin approves it explicitly** from the Inbox, preserving a two-step audit trail. *(v1.0 documented an auto-clear that no longer exists.)*
4. **`employee_id` from the request body is never trusted** for non-super-admins — the target is derived from the token.
5. **Raise-time gates:** `OnboardingGuard::assertComplete` (422) and a future-joining-date block (422).
6. **`hr.expense`** gates `scope=all` and every HR action; settlement currently reuses `can_approve`.
7. **The 70 % EMI headroom shown at raise time is advisory** — `emi-info` reports it, but `store()` does not reject an advance that exceeds it. Payroll enforces its own 70 % FOI cap at recovery time.
8. **No DB FKs; no soft deletes on the two parent tables** (payment tables do have them). Claims carry an `employee_name` snapshot so a deleted employee does not blank the trail.
9. **Category limits exist but are unenforced** — deliberately, for parity with advances.
10. **Attachment and proof routes are public**, authenticated by `?token=` and tenant-checked.
11. **Zoho sync is a gate on notification:** `email-reimbursement` refuses until every payment on the claim is synced.
12. **One-time recovery pay-off is disabled** — route commented out in `routes/api.php`, client behind `ONETIME_PAYOFF_ENABLED`; controller methods retained.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controllers | 2 (~4,650 lines combined) |
| API routes | 44 (21 claims · 23 advances) |
| Permission slugs | `hr.expense` (+ `master.expense_category`) |
| Tables | 7 (2 parent · 3 payment · 1 ledger · 1 master) |
| Migrations | 31 |
| Soft deletes | payment tables only |
| DB foreign keys | none |
| Test coverage | none automated |

---

*Related documents: EXPENSE_FUNCTIONAL_DOCUMENTATION.md · EXPENSE_CODE_WALKTHROUGH.md · EXPENSE_API_DOCUMENTATION.md*
