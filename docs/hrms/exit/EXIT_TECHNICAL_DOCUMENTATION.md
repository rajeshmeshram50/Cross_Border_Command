# EXIT MANAGEMENT MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Exit Management (employee offboarding)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Exit Management is the HRMS **offboarding** flow. It records one `employee_exits` row per employee (unique on `employee_id`) and drives a **4-stage wizard** (Initiation & Approval → Clearance & Handover → Exit Documents → Final Deactivation & Closure). Completion is the single action that flips the employee to Resigned/Terminated, disables their login, and enables Full & Final settlement in Payroll.

> The backend is deliberately thin — `show` / `upsert` / `complete`. The stage workflow lives in the React modal and is persisted as JSON blobs on the single row.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  resources/js/pages/hrms/HrExitManagement.tsx (~2874 lines)           │
│   • list (Active / In Progress / Exited) + KPI cards                  │
│   • ExitProcessModal (4-stage wizard)                                 │
│   • ExitChecklistModal (reference) · EvidenceVaultModal              │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  ExitController: show() · upsert() · complete()                       │
│   • guardSameTenant() + authorizeMaster() (permission: master.employees)│
│   • resolveFinalStatus() → employees.status                          │
│   • complete(): transaction → status + disable login + revoke tokens │
│     → (after commit) ExitFarewellMail (best-effort)                  │
│  Consumes HR document/signature endpoints for Stage 3                 │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  employee_exits (1 row/employee; JSON stage blobs; no DB FKs)         │
│  employees (status enum) · users (login) · personal_access_tokens     │
│  Feeds: PayrollService FnF (last_working_day) + eligibility exclusion │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ExitController.php   # show / upsert / complete (custom routes)
app/Models/EmployeeExit.php                    # the exit row (JSON stage blobs; no SoftDeletes)
app/Mail/ExitFarewellMail.php                  # farewell email
database/migrations/
  2026_05_03_000006_create_employee_exits_table.php        # base (Stage 1 fields)
  2026_06_04_000001_add_process_fields_to_employee_exits.php # Stages 2-4 + lifecycle
resources/js/pages/hrms/HrExitManagement.tsx   # hub + 4-stage wizard + vault
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum |
| Mail | `ExitFarewellMail` (SMTP, best-effort) |
| Frontend | React 19 · TypeScript · reactstrap/Bootstrap/Tailwind (Velzon) |
| Docs (Stage 3) | HR Document Templates + Signatures (dompdf/phpword) |

---

## 3. DATABASE SCHEMA

### 3.1 Table: `employee_exits`
`UNIQUE(employee_id)` — one exit per employee. **No SoftDeletes** (completion is reversible by re-activating). **No DB foreign keys** — integrity is app-level.

| Column | Type | Null | Default | Group |
|---|---|---|---|---|
| id | bigint PK | no | — | |
| employee_id | bigint | no | — | **unique** |
| client_id / branch_id | bigint | yes | — | tenancy (indexed) |
| exit_type | varchar(40) | yes | — | Stage 1 |
| initiated_by | varchar(40) | yes | — | Stage 1 |
| reason_for_exit | varchar(60) | yes | — | Stage 1 |
| other_reason | varchar(255) | yes | — | Stage 1 |
| notice_date | date | yes | — | Stage 1 |
| last_working_day | date | yes | — | Stage 1 (→ Payroll FnF) |
| reporting_manager_id | bigint | yes | — | Stage 1 (no FK) |
| comments | text | yes | — | Stage 1 |
| business_impact | varchar(20) | yes | — | Stage 1 (Low/Medium/High/Critical) |
| replacement_required | varchar(60) | yes | — | Stage 1 |
| clearances | json | yes | — | Stage 2 |
| asset_returns | json | yes | — | Stage 2 |
| handover_notes | text | yes | — | Stage 2 |
| validation | json | yes | — | Stage 4 |
| final_employee_status | varchar(20) | yes | — | Stage 4 |
| profile_lock | varchar(20) | yes | — | Stage 4 |
| exit_case_status | varchar(20) | no | **Open** | lifecycle (indexed) |
| hr_sign_off | varchar(20) | yes | — | Stage 4 |
| stage_status | json | yes | — | per-stage progress |
| current_stage | tinyint | no | **1** | 1–4 |
| completed_at | timestamp | yes | — | set on completion |
| created_by | bigint | yes | — | |

### 3.2 Related: `previous_employments`
> **Note:** this table belongs to **onboarding** (prior-employer background-verification), *not* exit — despite the naming. It uses SoftDeletes; columns: `employee_id`, `client_id`, `branch_id`, `company_name`, `job_title`, `start_date`, `end_date`, `hr_email_1`, `hr_email_2`, `contact_number`. Per-company docs land in `employee_documents` keyed `prev_<id>_exp_letter`.

---

## 4. MODEL

### EmployeeExit (`app/Models/EmployeeExit.php`)
```php
class EmployeeExit extends Model {   // NO SoftDeletes
    protected $casts = [
        'notice_date'=>'date', 'last_working_day'=>'date',
        'clearances'=>'array', 'asset_returns'=>'array', 'validation'=>'array', 'stage_status'=>'array',
        'current_stage'=>'integer', 'completed_at'=>'datetime',
    ];
    public function employee() { return $this->belongsTo(Employee::class); }
    public function manager()  { return $this->belongsTo(Employee::class, 'reporting_manager_id'); }
}
```
No enum casts — status/stage values are enforced only by controller validation.

---

## 5. API ENDPOINTS CONFIGURATION
```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get ('/employees/{employee}/exit',          [ExitController::class, 'show']);
    Route::put ('/employees/{employee}/exit',          [ExitController::class, 'upsert']);
    Route::post('/employees/{employee}/exit/complete', [ExitController::class, 'complete']);
});
```
No `apiResource`; three custom routes nested under the employee. Full detail in **EXIT_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS (`ExitController`)

| Method | Verb | Purpose | Transaction |
|---|---|---|---|
| `show` | GET | Return the (lazily-defaulted) exit row via `format()`; loads employee `withTrashed` | — |
| `upsert` | PUT | Save/update draft (any stage); forces `employee_id`/`client_id`/`branch_id` from the employee | — |
| `complete` | POST | Finalize: force `exit_case_status=Closed`, `current_stage=4`, `completed_at`; flip employee status; disable login + revoke tokens; farewell email after commit | ✅ |

**Authorization:** `guardSameTenant()` → `authorizeMaster()` gates on the **`master.employees`** module `can_edit` (exit has no dedicated permission). Super-admins bypass; if the module row is missing, `client_admin`/`branch_user` fall through.

**`resolveFinalStatus()`:** `Termination`/`Absconding` → `Terminated`; everything else → `Resigned`. (The `employees.status` enum has no `Retired`/`Exited`, so Retirement maps to Resigned to avoid a CHECK-constraint 500.)

---

## 7. FRONTEND (`HrExitManagement.tsx`)

- **Hub:** lists fully-onboarded employees (`onboarding_stage_completed >= 6`), bucketed Active / Exit In Progress / Exited; KPI cards; table columns incl. Exit Readiness progress + Rep. Manager.
- **`ExitProcessModal`** — the 4-stage wizard (`EXIT_STAGES`): Initiation & Approval → Clearance & Handover → Exit Documents → Final Deactivation & Closure.
- **`ExitChecklistModal`** — a *reference-only* 6-stage checklist (this is the source of the misleading "6 stages" text; the operative process is 4 stages).
- **`EvidenceVaultModal`** — employee docs / organizational templates / exit templates + signing runs.
- **Persistence:** Save Draft → `PUT /employees/{id}/exit`; Complete → `POST /employees/{id}/exit/complete`.

### 7.1 Stage 3 (Exit Documents) endpoints consumed
`GET /hr-document-templates/match?trigger_keyword=exit`, `/hr-document-templates/{id}/preview` · `/generate`, `POST /hr-document-signatures` (+ `/remind`, `/download-pdf`), `GET /hr-generated-documents`, `GET /hr-document-signatures`.

---

## 8. INTEGRATION: EXIT → STATUS → PAYROLL

```
Stage 1 sets last_working_day
        │
complete() → employees.status = Resigned|Terminated
           → users.status = inactive + tokens revoked (login gate trips)
        │
PayrollService::eligibleEmployees:
   whereNotIn('status', ['Inactive','Resigned','Terminated'])   → excluded from regular payroll
   drops anyone whose employee_exits.last_working_day < period_start
        │
Payroll FnF (PayrollController::fnf):
   422 unless an employee_exits row exists
   uses employee_exits.last_working_day as the settlement LWD
```

---

## 9. SECURITY & CAVEATS

1. **No dedicated exit permission** — gated by `master.employees` `can_edit`.
2. **No DB foreign keys** on `employee_exits` (incl. `reporting_manager_id`) — app-level integrity only.
3. **Completion is reversible** (no soft delete; re-activating the employee undoes the "Exited" bucketing).
4. **"6 stages" is a reference checklist** — the real wizard is 4 stages.
5. **Farewell email** goes to the employee's personal `email`, fire-and-forget (never blocks completion).
6. **`employees.status` enum** has no Retired/Exited — Retirement maps to Resigned.
7. **`previous_employments` is onboarding data**, not exit.

---

## 10. METRICS
| Metric | Value |
|---|---|
| Controller methods | 3 (show/upsert/complete) |
| Routes | 3 |
| DB transaction | complete() |
| Stages (operative) | 4 |
| Frontend LOC | ~2874 |
| Test coverage | none automated |

---

*Related documents: EXIT_FUNCTIONAL_DOCUMENTATION.md · EXIT_CODE_WALKTHROUGH.md · EXIT_API_DOCUMENTATION.md*
