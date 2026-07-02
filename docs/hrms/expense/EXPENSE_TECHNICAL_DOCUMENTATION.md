# EXPENSE MANAGEMENT MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Expense Management (claims & advances)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Expense Management has two parallel sub-modules sharing an identical **two-stage approval** (Reporting Manager → HR/Finance):
- **Expense Claims** — reimbursements with mandatory receipts.
- **Advance Requests** — salary/travel/medical advances with a recovery schedule.

Both are per-tenant, use `EXP-####` / `ADV-####` codes, store attachments on the public disk, and are gated by the `hr.expense` permission. **Approved advances feed Payroll** as monthly recovery deductions.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  HrExpenseManagement.tsx (HR review of all claims + advances)          │
│  EmployeeProfile ExpenseTab (raise claim / advance; my/team)          │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON (multipart for receipts)
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  ExpenseClaimController:  index/store/show/categories/                 │
│    manager(Approve|Reject)/hr(Approve|Reject)/downloadAttachment      │
│  AdvanceRequestController: same shape (no categories)                  │
│  Approval: RM stage → HR/Finance stage (hr.expense can_approve)        │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  expense_claims · advance_requests · master_expense_categories        │
│  (no soft deletes; no DB FKs)                                         │
│  Feeds: PayrollService advanceRecovery (EMI/lumpsum, capped to net)   │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ExpenseClaimController.php · AdvanceRequestController.php
app/Models/ExpenseClaim.php · AdvanceRequest.php · Masters/ExpenseCategories.php
database/migrations/
  2026_05_04_000003_create_expense_claims_table.php
  2026_05_18_000001_create_advance_requests_table.php
  2026_05_04_000001_create_master_expense_categories_table.php
  2026_05_04_000002_seed_expense_category_module.php
resources/js/pages/hrms/HrExpenseManagement.tsx (+ ExpenseTab, forms in EmployeeProfile)
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum |
| Files | receipts on `public` disk (pdf/jpg/jpeg/png ≤ 5MB) |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) · Recharts · xlsx |

---

## 3. DATABASE SCHEMA

### 3.1 `expense_claims` (no SoftDeletes; no DB FKs)
Tenancy (`client_id`/`branch_id` indexed), `claim_no` (`EXP-####`), `employee_id`, `employee_name` (snapshot, added 2026-06-30), `manager_id`, `category_id`/`category_name`, `currency` (default INR), `project`, `payment_method`, `title`*, `amount` (decimal 18,2), `expense_date`*, `vendor`, `purpose`, `attachments` (json), `status`/`manager_status`/`hr_status` (enum pending/approved/rejected), `manager_acted_at`/`manager_comment`, `hr_user_id`/`hr_acted_at`/`hr_comment`, `created_by`. Indexes incl. `(client_id,status)`, `(client_id,branch_id,employee_id)`.

### 3.2 `advance_requests` (no SoftDeletes; no DB FKs)
Tenancy, `advance_no` (`ADV-####`), `employee_id`, `manager_id`, `advance_type`* (Travel/Salary/Medical/Other), `advance_type_other`, `amount`, `requested_date`* (today), `recovery_start`*, `recovery_mode`* (emi/lumpsum/bimonthly), `recovery_months`, `monthly_emi`, `reason`*, `attachments` (json, optional), same status/approval columns.

### 3.3 `master_expense_categories` (no SoftDeletes; no DB FKs)
`code`, `name`, `monthly_limit`/`yearly_limit` (**present but unenforced**), `description`, `status` (Active/Inactive).

---

## 4. MODELS
| Model | Table | Notes |
|---|---|---|
| `ExpenseClaim` | expense_claims | casts amount decimal:2, dates, attachments array; relations employee/manager/category/creator/hrUser |
| `AdvanceRequest` | advance_requests | casts amount+monthly_emi decimal:2, recovery_months int; no category relation |
| `Masters\ExpenseCategories` | master_expense_categories | limits unenforced |

No SoftDeletes on any. `status`/`manager_status`/`hr_status` ∈ pending/approved/rejected.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get ('/expense-claims',                        [ExpenseClaimController::class, 'index']);
    Route::get ('/expense-claims/categories',             [ExpenseClaimController::class, 'categories']);   // before {id}
    Route::post('/expense-claims',                        [ExpenseClaimController::class, 'store']);
    Route::get ('/expense-claims/{id}',                   [ExpenseClaimController::class, 'show']);
    Route::post('/expense-claims/{id}/manager-approve',   [ExpenseClaimController::class, 'managerApprove']);
    Route::post('/expense-claims/{id}/manager-reject',    [ExpenseClaimController::class, 'managerReject']);
    Route::post('/expense-claims/{id}/hr-approve',        [ExpenseClaimController::class, 'hrApprove']);
    Route::post('/expense-claims/{id}/hr-reject',         [ExpenseClaimController::class, 'hrReject']);
    // advance-requests mirror the same 7 routes (no categories)
});
// PUBLIC (query-token auth): /expense-claims/{id}/attachments/{index} · /advance-requests/{id}/attachments/{index}
```
Categories are also served by the generic Master endpoint `/master/expense_category`. Full detail in **EXPENSE_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

**Permission slug `hr.expense`** — `guardHrPermission($user, 'can_view'|'can_approve')`; super-admin bypass; unseeded-module fallback allows admin-tier. Owner/assigned-manager always allowed for their own rows.

| Method | Purpose |
|---|---|
| `categories` (claims only) | Active expense categories for the dropdown |
| `index` | List with `scope` = mine / team (transitive reports) / all (needs can_view) |
| `store` | Create (transaction; `EXP-`/`ADV-####` under lock); ownership guard; auto-clear manager stage if no reporting manager |
| `managerApprove/Reject` | Manager stage (assigned manager or super-admin); 409 if not pending; reject closes the claim |
| `hrApprove/Reject` | HR/Finance stage (can_approve); approve requires manager approved first; HR is the final word (`status = verdict`) |
| `downloadAttachment` | Stream a receipt (public route, `?token=`) |

**Validation highlights:** claim `expense_date` within the last 30 days; `title`* + `amount`* + **`files` required (min 1)** (pdf/jpg/jpeg/png ≤5MB). Advance `requested_date` = today; `recovery_mode`* with `recovery_months` required for EMI; `reason`* (≤500); receipts optional.

---

## 7. FRONTEND
- **`HrExpenseManagement.tsx`** — HR/Finance surface: `expense`/`advance` toggle, KPI tiles, Spend Analytics (Recharts), tables (`ExpenseClaimsTable`/`AdvanceRequestsTable`), Excel/PDF/CSV export, approve/reject actions. `canHrApprove` = super-admin / `hr.expense.can_approve` / client_admin. Loads `?scope=all`.
- **Employee ExpenseTab + raise forms** (in `EmployeeProfile`) — My/Team sub-tabs, filters, local drafts (localStorage + IndexedDB). Claim form (title/amount/date/category/receipt); advance form (type/amount/recovery mode + months/EMI/reason). Submits multipart to `POST /expense-claims` / `/advance-requests`.

---

## 8. INTEGRATION: PAYROLL (advance recovery)
`PayrollService::advanceRecovery()` reads **`hr_status='approved'`** advances with `recovery_start <= period_end`:
- **EMI:** `monthly_emi` (or amount/months) due each cycle within the schedule.
- **Lumpsum / bimonthly:** full amount once, in the `recovery_start` month (bimonthly is **not** specially handled — behaves as lumpsum).
- **Capped to net-before-recovery** (never drives net negative; raises a warning). Stored on the payslip `advance_recovery`; in FnF the month's already-deducted EMI is added back so the outstanding is recovered once. See `docs/payroll/`.

---

## 9. SECURITY & CAVEATS
1. **Two-stage approval** — manager must approve before HR/Finance; HR is the final `status`.
2. **`hr.expense`** gates listing-all + HR approve; owner/manager act on their own rows.
3. **No DB FKs, no soft deletes** on the three tables (claims carry an `employee_name` snapshot for deleted employees; advances rely on `withTrashed`).
4. **Category limits exist but are unenforced.**
5. **`bimonthly` recovery is a no-op distinction** (treated as lumpsum in payroll).
6. **Receipts mandatory for claims**, optional for advances; attachment routes are public (`?token=`).
7. Two permission slugs: `hr.expense` (approvals) vs `master.expense_category` (category master).

---

## 10. METRICS
| Metric | Value |
|---|---|
| Controllers | 2 (Claim, Advance) |
| Permission slug | hr.expense (+ master.expense_category) |
| Tables | 3 |
| DB FKs / soft deletes | none |
| Test coverage | none automated |

---

*Related documents: EXPENSE_FUNCTIONAL_DOCUMENTATION.md · EXPENSE_CODE_WALKTHROUGH.md · EXPENSE_API_DOCUMENTATION.md*
