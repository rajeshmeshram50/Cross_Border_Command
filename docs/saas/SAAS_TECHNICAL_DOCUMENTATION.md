# SAAS PLATFORM — TECHNICAL DOCUMENTATION

> Cross_Border_Command · Multi-tenant SaaS ERP for export/import (cross-border trade)
> Platform-level view: tenancy, subscription/module gating, billing, tenant isolation.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial platform technical documentation |

> This is the **platform overview**. For per-entity depth see the module doc sets: `docs/client/`, `docs/branch/`, `docs/plan/`, `docs/payment/`, `docs/permission/`, `docs/payroll/`.

---

## 1. WHAT THE PLATFORM IS

Cross_Border_Command is a **multi-tenant SaaS ERP** that bundles five capabilities into one app:

1. **Sales Matrix** — lead → quotation → proforma invoice → procurement → shipment (6-stage pipeline).
2. **CLM (Central Legal Module)** — segment-driven compliance (KYC, DD, licenses, agreements, e-sign).
3. **HRMS** — employee master, attendance, leave, expenses, recruitment, payroll.
4. **Procurement & Vendor master** — step-wise vendor/product onboarding.
5. **Billing** — plan subscriptions, module gating, Razorpay.

**Tenancy hierarchy:** `Client` (the company that bought the SaaS) → `Branch` (their offices) → `User` (members). Almost every business table carries `client_id`; most also carry `branch_id`; data is scoped accordingly throughout the API.

---

## 2. HIGH-LEVEL ARCHITECTURE

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  React 19 + TypeScript SPA (Vite → public/build)                      │
│  Contexts: Auth · BranchSwitcher · Settings (feature flags) · Toast   │
│  resources/js/api.ts (Axios):                                         │
│    • injects Authorization: Bearer <sanctum_token>                    │
│    • auto-injects ?branch_id=<active> on GETs                         │
│    • 401 → force logout                                               │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ HTTPS / JSON
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                           API GATEWAY (Laravel 12)                     │
│  routes/api.php (single file, prefix /api)                            │
│  Public: login · onboarding (30/min) · razorpay/webhook · signed PDFs │
│  Protected group: auth:sanctum → user.active (EnsureUserActive)       │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER                               │
│  ~72 Api controllers scope by client_id (always) + branch_id          │
│  Support: MasterVisibility (creator-hierarchy scope) · Settings       │
│  Services: Razorpay · ZohoSign · IndiaMart · BrandingResolver ·       │
│            InvoiceMailer · HrTemplateDocxRenderer · Payroll · …       │
│  Access model:                                                        │
│    • user_type: super_admin / client_admin / client_user /           │
│      branch_user / employee                                           │
│    • per-user Permission rows (7 action flags) — gate the SPA         │
│    • ClientSetting feature flags — gate whole modules per tenant      │
│    • Plan → plan_modules → Module — gate which modules a tenant has   │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                            DATA LAYER                                  │
│  PostgreSQL (c_b_c, :5432) — 228+ migrations, ~148 models             │
│  Most tables carry client_id (+ branch_id); soft deletes common       │
│  Storage: local public disk + Azure Blob (flysystem)                  │
│  Cache / Queue / Session driver: database (no Redis; jobs run inline) │
│                                                                       │
│  External: Razorpay (billing) · Zoho Sign (e-sign) · Google OAuth ·   │
│            IndiaMart (lead sync) · Azure Blob                         │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 3. TECHNOLOGY STACK

### 3.1 Backend
| Component | Technology | Notes |
|---|---|---|
| Language | PHP 8.2+ | |
| Framework | Laravel 12 | single `routes/api.php` |
| Database | **PostgreSQL** (`c_b_c` @ :5432) | not MySQL; `ilike` search, JSONB, partial unique indexes |
| Auth | Sanctum 4 | bearer tokens in localStorage |
| Cache / Queue / Session | **database** driver | no Redis; no queue worker (jobs fire inline) |
| Mail | SMTP | sent inline |
| PDF / DOCX | dompdf / phpword | quotations, invoices, payslips, HR/CLM docs |
| Storage | public disk + Azure Blob | flysystem |

### 3.2 Frontend
| Component | Technology | Notes |
|---|---|---|
| Framework | React 19 + TypeScript 6 | |
| Build | Vite 7 → `public/build/` | |
| UI | reactstrap + Bootstrap 5.3 + Tailwind 4 | Velzon admin theme |
| State | Redux (theme only) + Context + Axios | business data via Context/Axios |
| Misc | react-table, Recharts, xlsx, face-api.js, TipTap | |

---

## 4. TENANCY MODEL

### 4.1 Hierarchy
```
Client (tenant)
  ├─ plan_id / plan_type (free|paid) / plan_expires_at / status
  ├─ branding (logo/colors) · GST/PAN · client_admin user
  └─ Branch (office; equal isolated peers — no "main branch")
        ├─ letterhead/compliance (GST state code, CIN, IEC, signature…)
        ├─ branch_user login
        └─ Users / Employees / Departments (branch-scoped)
```

### 4.2 User types
| user_type | Scope |
|---|---|
| `super_admin` | Cross-tenant; bypasses permission checks; manages Clients/Plans/Payments |
| `client_admin` | Full within their client; can switch branches; grants permissions to branch users |
| `client_user` | Client-wide (like client_admin scope for reads) |
| `branch_user` | Pinned to their own branch; sibling branches hidden |
| `employee` | Peer-isolated to their own records within their branch |

### 4.3 Tenant columns
Most business tables carry nullable, indexed `client_id` (+ `branch_id`), snapshotted at write. `client_id` is **always derived from `auth()->user()`**, never trusted from the request body.

### 4.4 Tenant isolation — `App\Support\MasterVisibility`
Central creator-hierarchy scoping (tiers: super=5, client=4, branch=2, none=0). `applyReadScope($query, $user)`:
- **super_admin** → all rows (optional branch filter).
- **client_admin / client_user** → `client_id IS NULL` (globals) OR own client; may narrow via the BranchSwitcher.
- **branch_user** → globals + client-level rows + own branch; **sibling branches hidden**; switcher ignored.
- **employee** → globals + client-level + **own rows** (`created_by = self`); peer-isolated.
- unknown → `whereRaw('1=0')`.

Mutation guard `hierarchicalDenial()` derives a row's tier from its own `client_id`/`branch_id` stamps and denies edits by lower tiers.

> Note: `MasterVisibility` scopes **business/master data**. Platform tables (`clients`, `plans`) are super-admin catalogue records and are not tenant-scoped; per-controller ownership checks apply (e.g. Branch/Payment controllers compare `client_id`).

---

## 5. AUTHENTICATION & SESSION

### 5.1 Login paths (all return one Sanctum token)
| Path | Endpoint | Notes |
|---|---|---|
| Email + password | `POST /api/login` | Password history enforced |
| Face recognition | `POST /api/login/face` | 128-d descriptor; **login threshold 0.50** (attendance uses 0.55) |
| Google OAuth | `POST /api/google-login` | User must already exist |

- **Per-tenant email:** email is unique **per client** (not global). The same email can exist across clients; login disambiguates by org (a `needs_org_selection` picker).
- **Brute-force lockout:** 5 attempts / 15 min, shared cache key across password/face/Google (gated by the security setting).
- **Session:** Sanctum token in `localStorage`; no refresh token. Idle-timeout logic exists (gated by a security toggle). On `401` the SPA wipes the token and redirects to `/login`.
- **Reversible admin passwords:** client/branch admin passwords are stored bcrypt **and** `Crypt`-encrypted (`password_encrypted`), and can be read back by super-admins (a documented security surface — see the Client/Branch docs).

### 5.2 The login permissions payload
`AuthController::formatUser()` builds a `permissions` map keyed by **module slug** (`{can_view, can_add, …}`). Super-admins bypass (empty/all). The SPA gates menus/pages on `perms[slug].can_view`. Refreshed via `/me`.

### 5.3 Middleware
- `auth:sanctum` — token auth.
- `user.active` (`EnsureUserActive`) — checks the **status** of the user, their client, and their branch (not module permissions).
- **No dedicated permission middleware** — most business endpoints are not flag-enforced server-side; the permission map primarily gates the SPA.

---

## 6. THREE LAYERS OF ACCESS CONTROL

The platform gates access at three independent layers:

| Layer | Mechanism | Granularity | Where |
|---|---|---|---|
| **Plan / module gating** | `Plan → plan_modules → Module` (`access_level`) | Which modules a tenant *has* | Set at plan activation → seeds client-admin permissions (`docs/plan/`, `docs/payment/`) |
| **Feature flags** | `ClientSetting` (per tenant) | Whole modules on/off per tenant | `SettingsContext` on the frontend |
| **Per-user permissions** | `permissions` rows (7 action flags) | What each user can view/do | Permission Matrix (`docs/permission/`) |

Plus the **tenancy scope** (§4.4) and **role** (§4.2) that bound every query.

---

## 7. REQUEST LIFECYCLE (authenticated GET)

1. React fires `api.get('/customers')`.
2. Axios injects `Authorization: Bearer <token>` and `?branch_id=<active>` (from BranchSwitcher).
3. Laravel routes through `auth:sanctum` → `user.active`.
4. The controller resolves `auth()->user()`, derives `client_id` (always) and `branch_id` (when relevant), and scopes the Eloquent query (often via `MasterVisibility`).
5. Response JSON is consumed; `401` → token wiped, redirect to `/login`.

**BranchSwitcher:** client-admins pick an active branch (persisted in `localStorage` per user); the Axios interceptor injects it on GETs. Branch users are hard-pinned to their own branch.

---

## 8. SUBSCRIPTION & BILLING (platform view)

```
Plan (catalogue, super-admin)
  → plan_modules (access_level: full/limited/addon/not_included)
Client picks a plan on "My Plan" (PlanSelection)
  → SubscriptionController: create-order → Razorpay checkout → verify-payment
  → activatePlan (transaction):
       client.plan_id / plan_type=paid / status=active / plan_expires_at
       reset & regrant client-admin permissions from the plan's modules
       enforce branch limit (deactivate extras, revoke tokens)
  → Payment row (GST 18%, invoice PDF) — see docs/payment/
Expiry: client-admin → /my-plan · branch_user → /plan-blocked
```
There is **no `Subscription` model** — subscription state lives on `clients` (`plan_id`, `plan_type`, `plan_expires_at`, `status`). The Razorpay **webhook is disabled locally** (blank secret); the checkout **verify-payment** path is authoritative.

---

## 9. PLATFORM API CONVENTIONS

- All routes in `routes/api.php` (prefix `/api`).
- **Public** routes are explicitly listed at the top (login, onboarding — rate-limited 30/min, `razorpay/webhook`, signed PDF links, invoice view/download with `?token=`).
- Everything else sits under `Route::middleware(['auth:sanctum','user.active'])->group(...)`.
- Most resources use `apiResource` + extra verbs (`/duplicate`, `/approve`, `/convert-to-pi`, …).
- Response shapes vary by controller (many predate a uniform envelope): commonly `{ data }` for reads, `{ message, data }` for actions, `{ message, errors }` for 422.
- Status codes: 200/201 · 401 (unauth) · 403 (inactive / cross-tenant / role) · 404 · 422 (validation/business) · 500.

---

## 10. MODULE → DOC MAP

| Platform concern | Module docs |
|---|---|
| Tenant (company) | `docs/client/` |
| Office / branch scoping + switcher | `docs/branch/` |
| Subscription tiers & module gating | `docs/plan/` |
| Billing / Razorpay | `docs/payment/` |
| Per-user access control | `docs/permission/` |
| HR Payroll (sample business module) | `docs/payroll/` |

---

## 11. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| `client_id` from the user, never the body | all controllers | Tenant safety |
| Creator-hierarchy scope | `MasterVisibility` | Branch/employee isolation |
| Branch-id auto-injection | `api.ts` + BranchSwitcher | Client-admin branch focus |
| Provisioning transactions | Client/Branch create | Tenant + admin created atomically |
| Reversible admin password | Client/Branch admins | Super-admin recall (security surface) |
| Token revocation on deactivate | Client/Branch status change | Instant logout of a suspended tenant/office |
| Plan-driven permissions | `activatePlan` | Module gating → concrete grants |
| Inline jobs/mail | no queue worker | Mail/PDF run in-request |

---

## 12. KNOWN PLATFORM CAVEATS

- **PostgreSQL** (not MySQL as older docs say); per-tenant email uniqueness via a partial unique index.
- **No queue worker / scheduler** — mail, lead sync and Zoho status polling happen on request/UI poll.
- **Most business APIs are not permission-flag-enforced** server-side — gating is SPA/menu-level.
- **Reversible admin passwords** are decryptable with DB + `APP_KEY`.
- **Client/Branch/Plan CRUD have no route-level role middleware** — super-admin restriction is menu-visibility + in-method ownership checks.
- **Razorpay webhook disabled locally** — checkout verify path is authoritative.
- **"Main branch" concept removed** (2026-06-20) — branches are equal isolated peers.

---

## 13. PLATFORM METRICS

| Metric | Value |
|---|---|
| Migrations | 228+ |
| Models | ~148 |
| Api controllers | ~72 |
| Product pillars | 5 (Sales, CLM, HRMS, Procurement, Billing) |
| User tiers | 5 |
| Access-control layers | 3 (plan gating · feature flags · per-user permissions) + tenancy scope |
| Test coverage | none automated |

---

*Related documents: SAAS_FUNCTIONAL_DOCUMENTATION.md · SAAS_CODE_WALKTHROUGH.md · SAAS_API_DOCUMENTATION.md · and the per-module sets under docs/.*
