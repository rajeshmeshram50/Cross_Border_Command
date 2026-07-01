# PAYROLL MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Payroll

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │            React 19 + TypeScript SPA (Vite dev :5173)          │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐  │ │
│  │  │ HrPayroll    │ │ PayrollTab   │ │ SalaryStructureModal │  │ │
│  │  │ (dashboard)  │ │ (emp profile)│ │ PaymentDisbursement… │  │ │
│  │  │ 4 tabs       │ │ 2 sub-tabs   │ │ PayslipViewerModal   │  │ │
│  │  └──────────────┘ └──────────────┘ └──────────────────────┘  │ │
│  │   resources/js/api.ts → Bearer token + ?branch_id auto-inject │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │  HTTPS / JSON
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY                                 │
│           Laravel 12 · routes/api.php  (prefix /api)                 │
│      middleware: auth:sanctum → user.active (EnsureUserActive)       │
│              (no per-route throttle on /payroll/*)                   │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       APPLICATION LAYER                              │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │        PayrollController.php  (1066 lines · 17 routes)         │ │
│  │  index() cycles() history() preflight() run() approve() pay()  │ │
│  │  finalizeAttendance() reopen() fnf() payslip*() export()       │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────┐  ┌────────────────────────────────────┐ │
│  │ PayrollPaymentController│  │ PayrollAdjustmentController         │ │
│  │ (disbursement + audit)  │  │ (OT / bonus / incentive / deduction)│ │
│  └────────────────────────┘  └────────────────────────────────────┘ │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  SERVICES                                                       │ │
│  │  PayrollService.php  (the compute engine — Rules 1-21)         │ │
│  │  PayslipPdfService.php  (DomPDF render + branch letterhead)    │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  MODELS                                                         │ │
│  │  PayrollPeriod · PayrollRun · Payslip · SalaryStructure ·      │ │
│  │  PayrollAdjustment · PayrollPayment                            │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER                                   │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │        PostgreSQL  (database: c_b_c, :5432)                    │ │
│  │  payroll_periods · payroll_runs · payslips ·                   │ │
│  │  salary_structures · payroll_adjustments · payroll_payments    │ │
│  │  (+ activity_logs for audit; attendances / leave_requests /    │ │
│  │   advance_requests / employee_exits as compute inputs)         │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  Cache / Queue / Session driver: database (no Redis)                 │
│  Payslip PDF: DomPDF (barryvdh/laravel-dompdf) · Excel: SheetJS     │
└─────────────────────────────────────────────────────────────────────┘
```

> **Note on the stack:** the platform runs on **PostgreSQL** (`DB_CONNECTION=pgsql`, database `c_b_c`), not MySQL. PostgreSQL advisory/row locks are used by the compute engine. There is no scheduler or queue worker dedicated to payroll — everything fires synchronously on the triggering HTTP request.

### 1.2 Request Lifecycle (authenticated payroll GET)

1. A React payroll screen calls e.g. `api.get('/payroll', { params: { month, year } })`.
2. The Axios interceptor in `resources/js/api.ts` attaches `Authorization: Bearer <sanctum_token>` and auto-injects `?branch_id=<active branch>`.
3. Laravel routes through `auth:sanctum` → `user.active`.
4. `PayrollController::ctx()` derives `client_id` (always) and `branch_id` (branch-user pinned, others honour the switcher) from `auth()->user()` — never from the body.
5. The controller delegates computation to `PayrollService`, serialises the result, and returns the JSON envelope.
6. On `401` the SPA wipes the token and redirects to `/login`.

### 1.3 Module Structure

```
app/
├── Http/
│   └── Controllers/Api/
│       ├── PayrollController.php            # Cycle, run, approve, pay, payslips, export (1066 lines)
│       ├── PayrollPaymentController.php      # Disbursement prepare/approve/initiate/bank-file/audit
│       └── PayrollAdjustmentController.php   # OT / bonus / incentive / deduction adjustments
├── Services/
│   ├── PayrollService.php                    # Compute engine (Rules 1-21)
│   └── PayslipPdfService.php                 # DomPDF payslip render + letterhead
├── Models/
│   ├── PayrollPeriod.php                     # Monthly cycle
│   ├── PayrollRun.php                        # A generation of a period
│   ├── Payslip.php                           # Per-employee result row
│   ├── SalaryStructure.php                   # Versioned CTC structure
│   ├── PayrollAdjustment.php                 # One-off adjustments
│   └── PayrollPayment.php                    # Disbursement batch
└── Mail/
    └── PayslipMail.php                       # Payslip email

database/migrations/
├── 2026_06_05_000001_create_payroll_periods_table.php
├── 2026_06_05_000002_create_salary_structures_table.php
├── 2026_06_05_000003_create_payroll_runs_table.php
├── 2026_06_05_000004_create_payslips_table.php
├── 2026_06_05_000005_create_payroll_adjustments_table.php
├── 2026_06_05_000006_create_payroll_payments_table.php
└── 2026_06_12_000002_add_payroll_leave_employee_foreign_keys.php   # retro FKs

resources/js/
├── pages/hrms/HrPayroll.tsx                  # Main dashboard (4 tabs, 1776 lines)
├── pages/employee/tabs/PayrollTab.tsx        # Employee-profile payroll tab
└── components/
    ├── SalaryStructureModal.tsx              # Create / revise salary structure
    ├── PaymentDisbursementModal.tsx          # Proceed-to-pay flow
    ├── PayslipViewerModal.tsx                # Payslip viewer (shared)
    └── PayrollRunModal.tsx                   # Pre-flight blocking/warning check

docs/
└── PAYROLL_QA_RULES.md                       # The 21 payroll business rules
```

---

## 2. TECHNOLOGY STACK

### 2.1 Backend Stack

| Component | Technology | Version | Purpose |
|---|---|---|---|
| Language | PHP | 8.2+ | Server-side |
| Framework | Laravel | 12.x | MVC / routing / ORM |
| Database | PostgreSQL | 14+ (`c_b_c` @ :5432) | Relational store |
| ORM | Eloquent | 12.x | DB abstraction |
| Auth | Laravel Sanctum | 4.x | Bearer-token API auth |
| PDF | barryvdh/laravel-dompdf | 3.x | Payslip PDF generation |
| Excel (server) | — | — | CSV streamed natively; XLSX built client-side |
| Cache / Queue / Session | database driver | — | No Redis; jobs fire inline |

### 2.2 Frontend Stack

| Component | Technology | Version | Purpose |
|---|---|---|---|
| Framework | React | 19 | UI |
| Language | TypeScript | 6 | Type safety |
| Build | Vite | 7 | Bundler → `public/build/` |
| UI | reactstrap + Bootstrap 5.3 + Tailwind 4 | — | Velzon admin theme |
| HTTP | Axios | 1.x | API client (`resources/js/api.ts`) |
| Spreadsheet | xlsx (SheetJS) | — | Client-side Excel export |
| Icons | Remix Icon (`ri-*`) | — | Iconography |

### 2.3 Development Tools

| Tool | Purpose |
|---|---|
| Composer | PHP dependency manager |
| npm | Node package manager |
| `composer dev` | Runs serve + queue:listen + pail + vite concurrently |
| `npm run build` | Production bundle → `public/build/` |
| PHPUnit 11 | Test scaffold (no real payroll coverage) |
| `php artisan tinker` | Manual data verification |

---

## 3. DATABASE SCHEMA

### 3.1 Entity Relationship Diagram

```
┌──────────────────────┐        ┌──────────────────────┐
│  salary_structures   │        │      employees       │
├──────────────────────┤        ├──────────────────────┤
│ id            PK      │        │ id            PK      │
│ employee_id   FK ─────┼───────►│ …                    │
│ version               │        │ shift (free text)    │
│ effective_from        │        │ pf_eligible          │
│ status(draft/active/  │        │ bank_account_number  │
│        superseded)    │        │ ifsc_code            │
│ earnings   json       │        │ holiday_group_id     │
│ deductions json       │        │ date_of_joining      │
│ monthly_gross         │        └──────────────────────┘
│ monthly_ctc           │                  ▲
└──────────────────────┘                  │ FK
                                           │
┌──────────────────────┐                  │
│   payroll_periods    │                  │
├──────────────────────┤                  │
│ id            PK      │                  │
│ client_id / branch_id│                  │
│ month / year         │                  │
│ label                │                  │
│ period_start/end     │                  │
│ working_days (26 dflt)│                 │
│ attendance_finalized │                  │
│ status(open/          │                  │
│   processing/locked) │                  │
│ locked_at            │                  │
└──────────┬───────────┘                  │
           │ 1                            │
           │  hasMany                     │
           ▼ *                            │
┌──────────────────────┐                  │
│    payroll_runs      │                  │
├──────────────────────┤                  │
│ id            PK      │                  │
│ payroll_period_id FK ─┼──► payroll_periods
│ status(draft/         │                  │
│  generated/approved/  │                  │
│  paid)               │                  │
│ total_employees      │                  │
│ employees_on_hold    │                  │
│ total_gross/deduct/net│                 │
│ generated/approved/  │                  │
│   paid _by / _at     │                  │
└──────────┬───────────┘                  │
           │ 1                            │
           │  hasMany                     │
           ▼ *                            │
┌──────────────────────┐                  │
│      payslips        │                  │
├──────────────────────┤                  │
│ id            PK      │                  │
│ payroll_run_id    FK ─┼──► payroll_runs │
│ payroll_period_id FK ─┼──► payroll_periods
│ employee_id       FK ─┼──────────────────┘
│ working/present/paid/ │
│   lop_days           │
│ late_marks           │
│ missing_punches      │
│ att_source           │
│ earnings   json      │
│ deductions json      │
│ gross_earnings/basic │
│ pf_employee/esi/pt/  │
│   tds/lop_amount     │
│ advance_recovery     │
│ net_pay              │
│ status / hold_reason │
│ exceptions json      │
│ bank_verified        │
│ UNIQUE(run,employee) │
└──────────────────────┘

┌──────────────────────┐        ┌──────────────────────┐
│ payroll_adjustments  │        │  payroll_payments    │
├──────────────────────┤        ├──────────────────────┤
│ id            PK      │        │ id            PK      │
│ employee_id          │        │ payroll_run_id       │
│ month / year         │        │ payroll_period_id    │
│ type(overtime/bonus/ │        │ mode(cheque/online)  │
│   incentive/deduction)│       │ status(draft→pending │
│ amount / hours / rate │       │   _approval→approved │
│ status(pending/       │        │   →paid)             │
│   approved/rejected) │        │ employee_count       │
└──────────────────────┘        │ total_amount         │
   (no DB FK)                    │ prepared/verified/   │
                                 │   approved_by_name   │
                                 │ batch_ref            │
                                 └──────────────────────┘
                                    (no DB FK)
```

**FK note:** the original six create-table migrations declared **no** foreign keys. FKs on `payslips` (→ runs, periods, employees) and `payroll_runs` (→ periods), all `cascadeOnDelete`, were retro-added in `2026_06_12_000002`. `payroll_adjustments` and `payroll_payments` still carry **no** DB-level foreign keys — integrity there is application-enforced.

### 3.2 Table Specifications

#### payroll_periods
Unique cycle key prevents two periods for the same tenant/branch/month.

| Column | Type | Null | Default |
|---|---|---|---|
| id | bigint PK | no | auto |
| client_id | bigint | yes | (indexed) |
| branch_id | bigint | yes | (indexed) |
| month | tinyint | no | — |
| year | smallint | no | — |
| label | varchar(20) | no | — |
| period_start | date | no | — |
| period_end | date | no | — |
| working_days | tinyint | no | 26 |
| attendance_finalized | boolean | no | false |
| attendance_finalized_at | timestamp | yes | — |
| attendance_finalized_by | bigint | yes | — |
| status | enum(open, processing, locked) | no | open |
| locked_at | timestamp | yes | — |
| created_by | bigint | yes | — |
| deleted_at | timestamp | yes | — (soft delete) |

**Unique:** `payroll_periods_unique_cycle (client_id, branch_id, month, year)`

#### salary_structures
Versioned — a new version supersedes the previous active one; drafts are never used for compute (Rule 19).

| Column | Type | Null | Default |
|---|---|---|---|
| id | bigint PK | no | auto |
| client_id / branch_id | bigint | yes | (indexed) |
| employee_id | bigint | no | (indexed) |
| version | int | no | 1 |
| effective_from | date | no | — |
| status | enum(draft, active, superseded) | no | active |
| earnings | json | yes | — |
| deductions | json | yes | — |
| monthly_gross | decimal(14,2) | no | 0 |
| monthly_ctc | decimal(14,2) | no | 0 |
| pf_applicable | boolean | no | false |
| esi_applicable | boolean | no | false |
| pt_applicable | boolean | no | true |
| approval_status | enum(draft, approved) | no | approved |
| approved_by / approved_at | bigint / timestamp | yes | — |
| revision_note | text | yes | — |

**Index:** `salary_structures_emp_status_idx (client_id, employee_id, status)` — **non-unique** (see §9 discrepancy note).

#### payroll_runs

| Column | Type | Null | Default |
|---|---|---|---|
| id | bigint PK | no | auto |
| client_id / branch_id | bigint | yes | (indexed) |
| payroll_period_id | bigint | no | (indexed) |
| status | enum(draft, generated, approved, paid) | no | draft |
| total_employees | int | no | 0 |
| employees_on_hold | int | no | 0 |
| total_gross / total_deductions / total_net | decimal(16,2) | no | 0 |
| generated_by / generated_at | bigint / timestamp | yes | — |
| approved_by / approved_at | bigint / timestamp | yes | — |
| paid_by / paid_at | bigint / timestamp | yes | — |
| notes | text | yes | — |

**FK (retro):** `payroll_period_id → payroll_periods.id` cascade.

#### payslips
The per-employee output row. Computed columns are a **snapshot** taken at generation time.

| Column | Type | Null | Default |
|---|---|---|---|
| id | bigint PK | no | auto |
| client_id / branch_id | bigint | yes | (indexed; branch = employee's real branch) |
| payroll_run_id / payroll_period_id / employee_id | bigint | no | (indexed) |
| employee_code / employee_name / department / designation | varchar | yes | — |
| working_days / present_days / paid_days / lop_days | decimal(6,2) | no | 0 |
| paid_leave_days / unpaid_leave_days | decimal(6,2) | no | 0 |
| late_marks / missing_punches | smallint | no | 0 |
| overtime_hours | decimal(6,2) | no | 0 |
| att_source | varchar(16) | no | Manual |
| earnings / deductions / exceptions | json | yes | — |
| gross_earnings / basic | decimal(14,2) | no | 0 |
| overtime_amount / bonus_amount | decimal(14,2) | no | 0 |
| pf_employee / esi / pt / tds | decimal(14,2) | no | 0 |
| lop_amount / advance_recovery / loan_recovery / other_deductions | decimal(14,2) | no | 0 |
| total_deductions / net_pay | decimal(14,2) | no | 0 |
| status | varchar(24) | no | Ready |
| hold_reason | text | yes | — |
| bank_account_number / ifsc_code | varchar | yes | — |
| bank_verified | boolean | no | false |

**Unique:** `payslips_run_emp_unique (payroll_run_id, employee_id)`
**FKs (retro):** run, period, employee — all cascade.

#### payroll_adjustments

| Column | Type | Null | Default |
|---|---|---|---|
| id | bigint PK | no | auto |
| client_id / branch_id / employee_id | bigint | no/yes | (indexed) |
| month / year | tinyint / smallint | no | — |
| type | varchar(20) | no | overtime\|bonus\|incentive\|deduction |
| label | varchar(120) | yes | — |
| amount / hours / rate | decimal | no/yes | 0 |
| status | enum(pending, approved, rejected) | no | pending |
| approved_by / approved_at / reason | — | yes | — |

**Indexes:** `(client_id, employee_id, year, month)`, `(employee_id, year, month, status)`. **No FKs.**

#### payroll_payments

| Column | Type | Null | Default |
|---|---|---|---|
| id | bigint PK | no | auto |
| client_id / branch_id | bigint | yes | (indexed) |
| payroll_run_id / payroll_period_id | bigint | no | (indexed) |
| mode | varchar(16) | no | cheque \| online |
| status | varchar(24) | no | draft → pending_approval → approved → paid |
| employee_count | int | no | 0 |
| total_amount | decimal(16,2) | no | 0 |
| company_name / bank_name | varchar(191) | yes | — |
| prepared_by_name / verified_by_name / approved_by_name | varchar(191) | yes | — |
| batch_ref | varchar(40) | yes | — |
| approved_at / paid_at | timestamp | yes | — |

**No FKs.**

---

## 4. MODEL RELATIONSHIPS

All six models extend `Model`, use `SoftDeletes`, use conventional table names, and define **no query scopes**.

### 4.1 PayrollPeriod
```php
class PayrollPeriod extends Model {
    use SoftDeletes;
    protected $casts = [
        'period_start' => 'date', 'period_end' => 'date',
        'working_days' => 'integer', 'month' => 'integer', 'year' => 'integer',
        'attendance_finalized' => 'boolean',
        'attendance_finalized_at' => 'datetime', 'locked_at' => 'datetime',
    ];
    public function runs()     { return $this->hasMany(PayrollRun::class); }
    public function payslips() { return $this->hasMany(Payslip::class); }
    // activeRun(): helper returning the latest run (not an Eloquent relation)
}
```

### 4.2 PayrollRun
```php
public function period()   { return $this->belongsTo(PayrollPeriod::class, 'payroll_period_id'); }
public function payslips() { return $this->hasMany(Payslip::class); }
public function isEditable(): bool { return in_array($this->status, ['draft','generated']); }
public function isLocked():   bool { return in_array($this->status, ['approved','paid']); }
// casts: totals decimal:2, counts integer, *_at datetime
```

### 4.3 Payslip
```php
public function run()      { return $this->belongsTo(PayrollRun::class); }
public function employee() { return $this->belongsTo(Employee::class); }
public function period()   { return $this->belongsTo(PayrollPeriod::class); }
// casts: earnings/deductions/exceptions => array; all money => decimal:2;
//        bank_verified => boolean; late_marks/missing_punches => integer
```

### 4.4 SalaryStructure
```php
public function employee() { return $this->belongsTo(Employee::class); }
public function basicAmount(): float {   // 'basic' component amount, else 50% of monthly_gross
    // reads earnings JSON
}
// casts: earnings/deductions => array; monthly_gross/monthly_ctc => decimal:2;
//        pf_applicable/esi_applicable/pt_applicable => boolean; version => integer
```

### 4.5 PayrollAdjustment
```php
const TYPES         = ['overtime','bonus','incentive','deduction'];
const EARNING_TYPES = ['overtime','bonus','incentive'];
public function employee() { return $this->belongsTo(Employee::class); }
```

### 4.6 PayrollPayment
```php
public function run() { return $this->belongsTo(PayrollRun::class); }
```

---

## 5. API ENDPOINTS CONFIGURATION

### 5.1 Routes Definition

All routes live in `routes/api.php` inside the single authenticated group and gain the global `/api` prefix.

```php
Route::middleware(['auth:sanctum', 'user.active'])->group(function () {
    // ── PayrollController ──────────────────────────────────────────
    Route::get ('/payroll/cycles',                        [PayrollController::class, 'cycles']);
    Route::get ('/payroll/history',                       [PayrollController::class, 'history']);
    Route::get ('/payroll/preflight',                     [PayrollController::class, 'preflight']);
    Route::get ('/payroll/export',                        [PayrollController::class, 'export']);
    Route::get ('/payroll/payslips/bulk',                 [PayrollController::class, 'payslipsBulk']);
    Route::post('/payroll/payslips/email',                [PayrollController::class, 'emailPayslipsBulk']);
    Route::get ('/payroll/payslip/{id}/pdf',              [PayrollController::class, 'payslipPdf'])->whereNumber('id');
    Route::post('/payroll/payslip/{id}/email',            [PayrollController::class, 'emailPayslip'])->whereNumber('id');
    Route::get ('/payroll/payslip/{id}',                  [PayrollController::class, 'payslip'])->whereNumber('id');
    Route::get ('/payroll/employee/{employeeId}/payslips',[PayrollController::class, 'employeePayslips'])->whereNumber('employeeId');
    Route::get ('/payroll/fnf/{employeeId}',              [PayrollController::class, 'fnf'])->whereNumber('employeeId');
    Route::get ('/payroll',                               [PayrollController::class, 'index']);
    Route::post('/payroll/finalize-attendance',           [PayrollController::class, 'finalizeAttendance']);
    Route::post('/payroll/run',                           [PayrollController::class, 'run']);
    Route::post('/payroll/reopen',                        [PayrollController::class, 'reopen']);
    Route::post('/payroll/approve',                       [PayrollController::class, 'approve']);
    Route::post('/payroll/pay',                           [PayrollController::class, 'pay']);

    // ── PayrollPaymentController (disbursement) ────────────────────
    Route::post('/payroll/payment/prepare',               [PayrollPaymentController::class, 'prepare']);
    Route::get ('/payroll/payment/{id}',                  [PayrollPaymentController::class, 'show'])->whereNumber('id');
    Route::post('/payroll/payment/{id}/approve',          [PayrollPaymentController::class, 'approve'])->whereNumber('id');
    Route::post('/payroll/payment/{id}/initiate',         [PayrollPaymentController::class, 'initiate'])->whereNumber('id');
    Route::get ('/payroll/payment/{id}/bank-file',        [PayrollPaymentController::class, 'bankFile'])->whereNumber('id');
    Route::get ('/payroll/payment/{id}/audit',            [PayrollPaymentController::class, 'auditTrail'])->whereNumber('id');

    // ── PayrollAdjustmentController ────────────────────────────────
    Route::get   ('/payroll-adjustments',                 [PayrollAdjustmentController::class, 'index']);
    Route::post  ('/payroll-adjustments',                 [PayrollAdjustmentController::class, 'store']);
    Route::post  ('/payroll-adjustments/{id}/approve',    [PayrollAdjustmentController::class, 'approve'])->whereNumber('id');
    Route::post  ('/payroll-adjustments/{id}/reject',     [PayrollAdjustmentController::class, 'reject'])->whereNumber('id');
    Route::delete('/payroll-adjustments/{id}',            [PayrollAdjustmentController::class, 'destroy'])->whereNumber('id');
});
```

**Route-ordering note:** specific segments (`/payroll/payslip/{id}/pdf`, `/payroll/cycles`) are declared **before** the bare/catch-all forms (`/payroll/payslip/{id}`, `/payroll`) so they are not shadowed.

### 5.2 Response Format Standards

| Shape | When |
|---|---|
| `{ "data": ... }` | Read endpoints (single object, collection, or composite) |
| `{ "message": "...", "data": ... }` | Mutating actions (run/approve/pay/reopen/finalize) |
| `{ "message": "..." }` | Simple action results and all errors |
| Binary / stream | `payslipPdf` (PDF), `payslipsBulk` (ZIP), `export` (streamed CSV) |

```json
{
  "message": "Human-readable result",
  "data": { },
  "errors": { }          // only on inline 422 validation (fnf)
}
```

Status codes: **200/201** success · **403** authorization · **404** not-found / cross-tenant · **422** business-rule/validation · **500** server capability missing (e.g. `ZipArchive`).

---

## 6. CONTROLLER & SERVICE METHOD ANALYSIS

### 6.1 PayrollController — cross-cutting mechanics

| Helper | Lines | Purpose |
|---|---|---|
| `ctx()` | 41-70 | Derives `{user_id, client_id, branch_id}` from the authed user |
| `effectiveBranchId()` | 57-70 | branch-user pinned to own branch; others honour the switcher param |
| `canManage()` | 77-87 | Gate for state-changing actions (super/client admin, branch user, or `hr.payroll` can_edit/can_approve) |
| `canExport()` | 896-905 | Gate for export endpoints |
| `requireScope()` | 92-98 | 422 if neither client_id nor branch_id resolved |
| `ownsRow()` | 886-894 | Row-level tenant gate for a Payslip |
| `findRun()` | 869-884 | Loads a PayrollRun from `run_id` (body or query), tenant-gated |
| `guardPeriodStarted()` | 119-132 | 422 if the period start is in the future |
| `audit()` | 1042-1065 | Best-effort ActivityLog write (`module='hr.payroll'`) |

> The controller performs **no** DB transactions or row locks itself — all locking is delegated to `PayrollService`.

### 6.2 PayrollService — key methods

| Method | Line | Complexity | Purpose |
|---|---|---|---|
| `resolveOrCreatePeriod` | 50 | O(1) + query | Race-safe get/create of the open period (firstOrCreate on unique key) |
| `finalizeAttendance` | 376 | O(1) | Rule 1 — mark attendance finalized |
| `generate` | 440 | O(n employees) | Rule 1/13/14 — transaction, row-lock period, wipe+recompute payslips, dedup, totals |
| `computeForEmployee` | 545 | O(1) per employee | Core per-employee calc (see §6.3) |
| `attendanceAggregates` | 969 | O(rows) | Present/Late/Missing from `attendances` (09:30 default, 10-min grace) |
| `leaveAggregates` | 1056 | O(rows) | Rule 3 — paid vs unpaid leave days |
| `professionalTax` | 1132 | O(1) | Rule 9 — Maharashtra slab (hardcoded) |
| `disburseRun` | 176 | O(n) | Row-locks run, validates bank per slip, marks Paid/On Hold |
| `computeFnf` | 256 | O(1) | Rule 21 — Full & Final (computed, not persisted) |
| `reopen` | 88 | O(n) | Rule 15 — revert a non-paid run to draft |
| `refreshRunTotals` | 237 | O(n) | Recompute run headline totals |

### 6.3 computeForEmployee() — statutory pipeline

```
Rule 5  active structure → gross/basic (else On Hold, "Missing salary structure")
Rule 6  proration = min(1, activeDays / calendarDays)   [join/exit mid-month]
Rule 2  attendance: Present→Late if first-in > shift+10min; late LOP = ⌊late/3⌋
Rule 3  leave: paid/unpaid (working days, half-day 0.5)
        paidDays = min(effectiveWorkingDays, present + paidLeave + holidays)
Money   daily basis = TOTAL CALENDAR DAYS (÷30/31); LOP charged on BASIC only
Rule 8  PF = min(earnedBasic, 15000) × 12%   (if pf_applicable & eligible)
        ESI = earnedGross × 0.75%            (if gross ≤ 21000)
Rule 9  PT  = Maharashtra slab
        TDS = structure 'tds' line only (no slab engine)
Rule 11 advanceRec capped at net-before-recovery
Net     earnedGross + OT + bonus − (pf+esi+pt+tds+advanceRec+other), floored at 0
Rule 12 blocking bank exception if !bank_verified
Status  blocking→On Hold · warning→Pending Review · else Ready
```

### 6.4 Constants (PayrollService)

| Constant | Value | Meaning |
|---|---|---|
| `PF_WAGE_CEILING` | 15000 | EPF wage ceiling |
| `PF_RATE` | 0.12 | PF employee share |
| `ESI_GROSS_LIMIT` | 21000 | ESI eligibility ceiling |
| `ESI_RATE` | 0.0075 | ESI employee share |
| `DISPLAY_TZ` | Asia/Kolkata | Late-mark timezone (attendance stored UTC) |
| default shift start | 09:30 | Used when the employee shift label is unparseable |
| late grace | 10 min | Present→Late threshold |

---

## 7. FRONTEND COMPONENTS ARCHITECTURE

### 7.1 Component Hierarchy

```
HrPayroll (pages/hrms/HrPayroll.tsx)
├─ hero strip · cycle-history strip · 4 KPI cards · tab strip · filters
├─ Tab bodies (inline tables): processing | biometric | report | salary
├─ AnimatedNumber (inline)
├─ PaymentDisbursementModal   → Header, ModeCard
├─ SalaryStructureModal
├─ PayrollRunModal            → IssueCard, PayrollRunStyles
└─ PayslipViewerModal

EmployeeProfile (pages/employee/EmployeeProfile.tsx)   ← owns payroll state; provides context
├─ EmployeeProfileContext.Provider
│    └─ PayrollTab (tabs/PayrollTab.tsx)   ← useEmployeeProfile()
│         ├─ summary sub-tab (bank / identity / statutory cards)
│         ├─ details sub-tab (compensation + Salary Timeline)
│         └─ Bank/Payment-Details edit Modal (local)
├─ PayslipViewerModal        (viewSlip + payslipHistory)
├─ Salary Breakdown Modal    (local)
└─ SalaryStructureModal
```

`SalaryStructureModal` and `PayslipViewerModal` are **shared** between the two parents.

### 7.2 Main dashboard tabs (`HrPayroll.tsx`)

| Tab | Label | Shows |
|---|---|---|
| `processing` | Payroll Processing | Per-employee earnings/deductions/net/attendance/status + View & Download-PDF actions |
| `biometric` | Biometric Input | Read-only attendance table (Present/Absent/Late/Missing/Source/Mismatch) + 5 tiles |
| `report` | Salary Report | Statutory breakdown (PF/ESI/PT/TDS/LOP/Advance) + 5 currency tiles |
| `salary` | Salary Setup | Roster with monthly-gross + source badge; Set/Revise salary structure |

### 7.3 Row contract (`PayrollRow`)

The dashboard row type carries both display and computed fields; notable ones:
`attendance` = **paid days**, `present` = **present days** (attendance record), `attSource` ∈ Biometric/Review/Manual, `mismatch` (label), `bankVerified`, `reasons[]`, `encryptedId` (opaque profile link). See the API doc for the serialised payslip contract.

---

## 8. SECURITY IMPLEMENTATION

### 8.1 Authentication & transport
- All payroll routes require `auth:sanctum` (bearer token) + `user.active` (`EnsureUserActive`).
- SPA injects the token and the active `branch_id` via the Axios interceptor.
- No throttle middleware on `/payroll/*` (Sanctum auth is the gate).

### 8.2 Authorization
```php
// State-changing actions
if (!$this->canManage($user)) return response()->json(['message' => '…'], 403);
// Exports
abort_unless($this->canExport($user), 403);
// Row-level tenant gate (payslip)
if (!$this->ownsRow($slip, $user)) abort(404);
// Employee self-service isolation (history, payslip, payslipPdf, employeePayslips)
if ($user is employee && $slip->employee_id !== $ownEmployeeId) abort(403);
```

### 8.3 Multi-tenancy (Rule 20)
- Every payroll table carries nullable, indexed `client_id` + `branch_id`, snapshotted at write.
- `client_id`/`branch_id` are derived from `auth()->user()`, **never** from the request body.
- `branch_user` is pinned to their own branch; the injected `branch_id` cannot widen scope.
- Payslips store the **employee's real branch**, so a client-wide run keeps per-branch reporting accurate.
- Cross-run/cross-level dedup prevents branch-level vs client-wide double payment.

### 8.4 Bank-details gate (Rule 12) & input validation
- IFSC validated `^[A-Za-z]{4}0[A-Za-z0-9]{6}$`; account `^\d{6,18}$` at disbursement.
- FnF inline validation clamps numeric inputs (0 … 1e8; encashment ≤ 365 days).
- Payroll bank details editable via `PUT /employees/{id}/bank-details` (self-or-`can_edit`).

---

## 9. ERROR HANDLING

| Exception / condition | HTTP | Source |
|---|---|---|
| Authorization failure | 403 | `canManage` / `canExport` / cross-tenant / employee self-access |
| Run / employee / payslip not found or `!ownsRow` | 404 | controller guards |
| Business-rule / validation failure | 422 | missing scope, locked/paid/future period, not-approved, unresolved slip status, empty result, `RuntimeException` from service |
| Inline validation (FnF) | 422 | Laravel `validate()` with `errors` map |
| Server capability missing | 500 | `ZipArchive` absent in `payslipsBulk` |

`RuntimeException`s thrown inside `PayrollService::generate()` (e.g. "attendance not finalized", "period locked") are caught in the controller and re-emitted as **422** with the service message.

### 9.1 Known discrepancies / caveats
- **Salary-structure index** is `(client_id, employee_id, status)` **non-unique** in the migration (QA doc calls it unique — the DB does not enforce uniqueness there).
- **`payroll_adjustments` / `payroll_payments` have no DB FKs** — integrity is application-level.
- **TDS** has no slab engine — only a structure `tds` line is honoured.
- **Professional Tax** is Maharashtra-only (state is ignored).
- **Loan recovery** column exists but is always 0 (only advances are recovered).
- Computed payslip columns are a **snapshot**; a paid/locked run cannot be regenerated (reopen only for non-paid runs).

---

## 10. PERFORMANCE

| Optimization | Where |
|---|---|
| Batch-load latest run per period (avoids N+1) | `cycles()`, `history()` |
| Eager loading with column selection | `index()`, `payslip()` |
| Streamed CSV in 200-row chunks | `export()` |
| Row-lock only the period/run being mutated | `generate()`, `disburseRun()` |
| Client-side XLSX build (offloads server) | `HrPayroll.tsx` exports |
| Memoised derived aggregates (`counts`, `filtered`) | `HrPayroll.tsx` |

---

## 11. CODE QUALITY METRICS

| Metric | Value |
|---|---|
| PayrollController LOC | ~1066 |
| PayrollController public routes | 17 |
| PayrollService methods | 30+ (compute engine) |
| Payroll models | 6 |
| Payroll migrations | 7 |
| Business rules documented | 21 (see `docs/PAYROLL_QA_RULES.md`) |
| DB transactions (service) | generate / disburseRun / reopen / resolveOrCreatePeriod |
| Test coverage | none automated (manual tinker verification) |

---

*Related documents: PAYROLL_FUNCTIONAL_DOCUMENTATION.md · PAYROLL_CODE_WALKTHROUGH.md · PAYROLL_API_DOCUMENTATION.md*
