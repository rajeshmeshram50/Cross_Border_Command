# EMPLOYEE ONBOARDING MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Employee Onboarding

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Employee Onboarding has two halves:
1. **Public self-fill onboarding** — HR issues a token invite (emailed one-time 64-char link); the candidate opens a **public** React form, fills their profile, and on submit the system provisions both a `User` (login) and an `Employee` row.
2. **HR-side 6-stage onboarding wizard** — an internal tracker that advances an already-created employee through `onboarding_stage_completed` (0 → 6).

> The invite-send UI lives in `HrEmployees.tsx`; the public form is `PublicOnboarding.tsx`; the internal 6-stage tracker is `HrEmployeeOnboarding.tsx`.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  HrEmployees.tsx        → "Send Onboarding" (create invite)           │
│  PublicOnboarding.tsx   → PUBLIC 3-step self-fill form (token)        │
│  HrEmployeeOnboarding.tsx→ internal 6-stage tracker/wizard            │
└───────────────────────────────┬───────────────────────────────────────┘
        authed │                 │ PUBLIC (rate-limited 30/min)
               ▼                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  OnboardingController:                                                │
│   • createInvite() (authed) → token + OnboardingInviteMail            │
│   • show(token) (public GET) → invite preview + tenant-scoped masters │
│   • complete(token) (public POST) → provisions User + Employee        │
│     (locked, grantSelfServicePermissions, WelcomeCredentialsMail)     │
│  6-stage progression → EmployeeController PUT {onboarding_stage_...}  │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  employee_onboarding_invites (token unique; status; no FKs)           │
│  → creates users + employees; stamps invite.employee_id              │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/OnboardingController.php   # createInvite / show / complete
app/Models/EmployeeOnboardingInvite.php
app/Mail/OnboardingInviteMail.php · WelcomeCredentialsMail.php
database/migrations/2026_05_01_000007_create_employee_onboarding_invites_table.php
resources/js/pages/PublicOnboarding.tsx                    # public 3-step form
resources/js/pages/hrms/HrEmployees.tsx                    # invite-send modal
resources/js/pages/employee-onboarding/HrEmployeeOnboarding.tsx  # 6-stage tracker
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum |
| Public routes | `throttle:30,1` (30/min/IP), token-gated (no auth) |
| Mail | OnboardingInviteMail, WelcomeCredentialsMail (sent synchronously — no queue worker) |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon); localStorage draft autosave |

---

## 3. DATABASE SCHEMA

### 3.1 `employee_onboarding_invites` (no SoftDeletes, no DB FKs)
| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| client_id / branch_id | bigint nullable | indexed |
| created_by | bigint nullable | |
| invitee_name | varchar(255) | |
| invitee_email | varchar(191) | indexed |
| department_id | bigint nullable | |
| expected_join_date | date nullable | |
| token | varchar(64) | **unique** |
| expires_at | timestamp | not null |
| status | varchar(20) | default `pending` (indexed) |
| completed_at | timestamp nullable | |
| employee_id | bigint nullable | indexed (set on completion) |

Composite index `(client_id, branch_id, status)`. **Status lifecycle:** `pending → completed | expired | cancelled` (no endpoint sets `cancelled`).

---

## 4. MODEL (`EmployeeOnboardingInvite`)
```php
class EmployeeOnboardingInvite extends Model {
    protected $casts = ['expected_join_date'=>'date','expires_at'=>'datetime','completed_at'=>'datetime'];
    public function isUsable(): bool { return $this->status === 'pending' && !$this->expires_at->isPast(); }
    public function client(); public function branch(); public function creator();
    public function department(); public function employee();
}
```

---

## 5. API ENDPOINTS CONFIGURATION

```php
// PUBLIC — rate-limited (30 req/min/IP)
Route::middleware('throttle:30,1')->group(function () {
    Route::get ('/onboarding/{token}',          [OnboardingController::class, 'show']);
    Route::post('/onboarding/{token}/complete', [OnboardingController::class, 'complete']);
});

// AUTHENTICATED
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::post('/employees/onboarding-invite', [OnboardingController::class, 'createInvite']);
});
```
The 6-stage progression uses `PUT /employees/{id}` with `onboarding_stage_completed` (Employee module). Full detail in **ONBOARDING_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS (`OnboardingController`)

| Method | Access | Purpose |
|---|---|---|
| `createInvite` | authed (super_admin / client_admin / branch_user) | Validate invitee + expiry (in:3,7,15,30, default 15); dup-guard email per client; 64-char token; build the onboarding URL (anti-phishing host check); email the invite (best-effort); returns the invite + URL (201) |
| `show(token)` | public GET | 404 invalid / 410 completed/cancelled/expired (auto-marks expired); returns invite preview + org branding + tenant-scoped master lists |
| `complete(token)` | public POST | Validate the self-fill payload (min age 18, tenant-scoped FKs, XSS guards); in a **locked transaction** re-check `pending`, create `User` (employee) + allocate `emp_code` + create `Employee` + stamp invite completed; grant self-service perms; send welcome credentials (synchronously); 409 on race, 422 on unique violation |

**Security highlights:**
- Cross-tenant FK injection blocked (`client_id IS NULL OR = invite.client_id`).
- `buildOnboardingUrl` honours a caller `app_origin` only if its host matches the configured frontend host (loopback normalised for dev).
- `grantSelfServicePermissions` grants `profile`, `dashboard`, `master.employees` view + inherits any `master.*` the inviter can view.
- Welcome email sent via `->send()` (not queued) because there is no queue worker.

---

## 7. FRONTEND

### 7.1 `PublicOnboarding.tsx` (public 3-step form)
Token-gated wizard with localStorage draft autosave (`cbc:public-onboarding-draft:${token}`). Steps: **Basic Info** (identity, min age 18) → **Address** (current + permanent, "same as" mirror) → **Job Details** (dept/designation/role/legal-entity/joining). Loads masters from `show()`. Submits JSON to `/onboarding/{token}/complete` → success card with `emp_code`. **No document upload** in the public form. (Pincode enforced exactly 6 digits frontend-side, stricter than backend 4–10.)

### 7.2 `HrEmployees.tsx` (invite-send)
"Send Onboarding" modal → `POST /employees/onboarding-invite` with `invitee_name`, `invitee_email`, `department_id`, `expected_join_date`, `expiry_days` (3/7/15/30, default 15), `app_origin`. On success shows the copyable invite URL.

### 7.3 `HrEmployeeOnboarding.tsx` (6-stage tracker)
Internal tracker over existing `/employees` rows. Tabs: Pending vs Completed; KPI cards; table with Profile % and status. **6 stages:** 1 Employee Onboarding Setup, 2 Document Management, 3 Provisioning & Asset Setup, 4 Payroll & Finance Setup, 5 Policies & Agreements, 6 Final Verification & Activation. Progression via `PUT /employees/{id} {onboarding_stage_completed: n}` (high-watermark); complete → stage 6; activate → status Active + stage 6.

---

## 8. HOW ONBOARDING LINKS TO THE EMPLOYEE
- **Public completion** creates `User` + `Employee` in one locked transaction; `Employee.user_id` → the login, `created_by` = inviter, `emp_code` = `EMP-###`; the invite is stamped `completed` with `employee_id`.
- **Progression** — `onboarding_stage_completed` (0–6) on `employees` is a **high-watermark**; completing Stage 1's internal 4-step wizard (`wizard_step_completed >= 4`) forces macro ≥ 1. It drives the blended `profile_completion` score.

---

## 9. SECURITY & CAVEATS
1. **Public routes** are rate-limited (30/min/IP) and token-gated (64-char random token, expiry 3/7/15/30 days).
2. **Race-safe completion** — `lockForUpdate` + re-check prevents double provisioning (409).
3. **Anti-phishing** — the onboarding URL only accepts a caller origin whose host matches config.
4. **Per-tenant email** — the invite dup-guard is scoped to the client.
5. **No document upload** in the public form (despite older docs); pincode 6-digit frontend vs 4–10 backend.
6. **No DB foreign keys** on the invite table; `cancelled` status is defined but unused.
7. Welcome/invite emails are best-effort and sent synchronously.

---

## 10. METRICS
| Metric | Value |
|---|---|
| Controller methods | 3 (createInvite/show/complete) |
| Public routes | 2 (rate-limited) |
| Invite statuses | pending/completed/expired/cancelled |
| HR wizard stages | 6 |
| Test coverage | none automated |

---

*Related documents: ONBOARDING_FUNCTIONAL_DOCUMENTATION.md · ONBOARDING_CODE_WALKTHROUGH.md · ONBOARDING_API_DOCUMENTATION.md*
