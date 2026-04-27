# Cross_Border_Command — Project Overview

A complete reference document for the Cross_Border_Command platform. Covers architecture, modules, flows, APIs, setup, and every test scenario.

---

## 1. Project summary

**Cross_Border_Command** is a multi-tenant SaaS / ERP platform for businesses doing cross-border (import / export) operations. Each customer is a tenant ("Client") that signs up, subscribes to a Plan, and then manages its own Branches, Users, Departments, and 50+ master tables (Countries, Ports, HSN Codes, GST %, Currencies, Incoterms, etc.).

- **Type:** Multi-tenant SaaS (web app)
- **Architecture style:** TenantOS / IGC SaaS
- **Local URL:** http://localhost (XAMPP) — Laravel API on `php artisan serve`, Vite dev server for React
- **Project path:** `c:\xampp\htdocs\Cross_Border_Command`
- **Active dev branch:** `saas`

---

## 2. Tech stack

| Layer | Tech |
|---|---|
| Backend | PHP 8.2+, **Laravel 12**, Sanctum (token auth) |
| Frontend | **React 19** + TypeScript, Vite, Redux Toolkit, React Router 7, Reactstrap / Bootstrap 5 (Velzon admin template) |
| Database | SQLite (dev default). Production may use MySQL / PostgreSQL. |
| Payments | **Razorpay** (UPI / Card / NetBanking) |
| PDF | dompdf (invoices) |
| Auth extras | Google Sign-In, Forgot-password OTP via email |
| Mail | Gmail SMTP (`php@inhpl.com`) |
| Queue | Database driver |

Important config files:
- [.env.example](.env.example) — copy to `.env` and fill values
- [composer.json](composer.json) — PHP dependencies
- [package.json](package.json) — JS dependencies
- [routes/api.php](routes/api.php) — every API endpoint
- [DATABASE_DESIGN.md](DATABASE_DESIGN.md) — full schema + business rules
- [GOOGLE_SIGNIN_SETUP.md](GOOGLE_SIGNIN_SETUP.md) — Google login configuration
- [RAZORPAY_INTEGRATION.md](RAZORPAY_INTEGRATION.md) — payment flow

---

## 3. User hierarchy

```
Super Admin  (SaaS owner — seeded, only 1)
   |
   +-- Client Admin   (organization owner; needs paid Plan to activate)
   |     |
   |     +-- Client User      (org-level manager / viewer)
   |     |
   |     +-- Main Branch      (is_main = true; sees ALL branches data)
   |     |     +-- Branch Users (employees)
   |     |
   |     +-- Branch 2, Branch 3, ...
   |           +-- Branch Users
   |
   +-- Client Admin 2  (separate tenant, fully isolated)
```

There are **4 user types** in the single `users` table (one login table for everyone):

| user_type | client_id | branch_id | Who they are |
|---|---|---|---|
| `super_admin` | NULL | NULL | SaaS owner |
| `client_admin` | set | NULL | Organization owner |
| `client_user` | set | NULL | Org-level manager |
| `branch_user` | set | set | Branch employee |

**Core business rules:**
1. **Tenant isolation** — Client A must never see / read / write Client B's data. Highest-severity rule.
2. **One main branch per client** (`is_main = true`).
3. **Permission inheritance** — child permissions cannot exceed parent.
4. **Inactive client = blocked** — payment must succeed before that tenant's users can use the platform.
5. **Soft delete** — `users`, `clients`, `branches` use `deleted_at`. Soft-deleted records must not appear in lists.
6. **Plan-module lock** — modules not in the client's plan show as locked / hidden.
7. **Maker-Checker** — Branch submits → Client Admin approves → record goes live (`approval_queue` table).

---

## 4. Modules / screens (frontend)

All pages live in [resources/js/pages/](resources/js/pages/).

**Auth & onboarding**
- [Login.tsx](resources/js/pages/Login.tsx)
- [ForgotPassword.tsx](resources/js/pages/ForgotPassword.tsx) → [VerifyOTP.tsx](resources/js/pages/VerifyOTP.tsx) → [ResetPassword.tsx](resources/js/pages/ResetPassword.tsx)
- [PlanSelection.tsx](resources/js/pages/PlanSelection.tsx) (client picks plan after signup)

**Super Admin area**
- [Clients.tsx](resources/js/pages/Clients.tsx) / [ClientForm.tsx](resources/js/pages/ClientForm.tsx) / [ClientView.tsx](resources/js/pages/ClientView.tsx)
- [ClientBranches.tsx](resources/js/pages/ClientBranches.tsx)
- [ClientPayments.tsx](resources/js/pages/ClientPayments.tsx)
- [ClientPermissions.tsx](resources/js/pages/ClientPermissions.tsx)
- [ClientSettings.tsx](resources/js/pages/ClientSettings.tsx)
- [Plans.tsx](resources/js/pages/Plans.tsx) / [AddPlan.tsx](resources/js/pages/AddPlan.tsx)
- [Payments.tsx](resources/js/pages/Payments.tsx)
- [Permissions.tsx](resources/js/pages/Permissions.tsx)
- [OrganizationTypes.tsx](resources/js/pages/OrganizationTypes.tsx)

**Client / Branch area**
- [Branches.tsx](resources/js/pages/Branches.tsx) / [BranchForm.tsx](resources/js/pages/BranchForm.tsx) / [BranchView.tsx](resources/js/pages/BranchView.tsx)
- [Employees.tsx](resources/js/pages/Employees.tsx) / [UsersPage.tsx](resources/js/pages/UsersPage.tsx)
- [Profile.tsx](resources/js/pages/Profile.tsx) / [Settings.tsx](resources/js/pages/Settings.tsx)

**Dashboards**
- [dashboard/AdminDashboard.tsx](resources/js/pages/dashboard/AdminDashboard.tsx)
- [dashboard/ClientDashboard.tsx](resources/js/pages/dashboard/ClientDashboard.tsx)
- [dashboard/BranchDashboard.tsx](resources/js/pages/dashboard/BranchDashboard.tsx)

**Master data (50+ master tables — list / add / edit / delete each)**
- [master/MasterPage.tsx](resources/js/pages/master/MasterPage.tsx) — generic CRUD page, driven by [master/masterConfigs.ts](resources/js/pages/master/masterConfigs.ts)
- [master/CompanyDetails.tsx](resources/js/pages/master/CompanyDetails.tsx)
- [MasterDashboard.tsx](resources/js/pages/MasterDashboard.tsx)

Master tables (full list in [app/Models/Masters/](app/Models/Masters/)):
Company, Bank Accounts, Departments, Roles, Designations, Countries, States, State Codes, Address Types, Port of Loading, Port of Discharge, Segments, HSN Codes, GST Percentage, Currencies, UoM, Packaging Material, Conditions, Incoterms, Customer Types, Customer Classifications, Vendor Types, Vendor Behaviour, Applicable Types, License Name, Risk Levels, Document Type, HAZ Class, Compliance Behaviours, Advance Payment Rules, Approval Authority, Asset Categories, Assets, Deviation Reason, Digital Twin, Exchange Rate Log, Freezers, Goods/Service Flag, Match Exception, Numbering Series, Payment Terms, Procurement Category, Rack Type Master, Racks, Shelf Master, Sourcing Type, Temp Class Master, Vendor Directory, Warehouse Master, Zone Master.

---

## 5. Database tables

Defined under [database/migrations/](database/migrations/) and [app/Models/](app/Models/). Full schema in [DATABASE_DESIGN.md](DATABASE_DESIGN.md).

| Table | Purpose |
|---|---|
| `users` | Single login table for super_admin / client_admin / client_user / branch_user |
| `clients` | Organizations / tenants |
| `branches` | Branches under each client (one is `is_main`) |
| `plans` | Subscription plans (Starter / Basic / Pro / Business / Enterprise) |
| `modules` | Platform modules (parent_id supports sub-modules) |
| `plan_modules` | Which modules each plan unlocks (full / limited / addon / not_included) |
| `permissions` | RBAC matrix per user/client/branch with `can_view/add/edit/delete` |
| `payments` | Razorpay transactions (txn_id, amount, gst, total, status) |
| `departments` | Departments under client / branch |
| `user_details` | Extended user profile (HR, salary, documents) |
| `approval_queue` | Maker-checker pending records |
| `activity_logs` | System action log |
| `client_settings` | Per-client config (privacy policy, 2FA, white-label, approval mode) |
| `password_reset_otps` | Forgot-password OTP storage |
| `organization_types` | Business / Sports / Education etc. |
| `master_*` | 50+ master tables (countries, ports, HSN, GST, currencies, etc.) |
| `personal_access_tokens` | Sanctum tokens |

---

## 6. API endpoints

All routes in [routes/api.php](routes/api.php). Auth uses Sanctum bearer tokens.

**Public**
- `POST /api/login`
- `POST /api/google-login`
- `POST /api/forgot-password/send-otp`
- `POST /api/forgot-password/verify-otp`
- `POST /api/forgot-password/reset`
- `POST /api/razorpay/webhook`

**Protected (need bearer token)**
- `GET /api/me`, `POST /api/logout`, `POST /api/change-password`
- `GET /api/dashboard/admin-stats`, `/client-stats`
- `apiResource /api/clients`, `/branches`, `/plans`, `/payments`, `/organization-types`
- `GET|POST|PUT|DELETE /api/master/{slug}[/{id}]` — generic master CRUD by slug
- `GET /api/subscription/plans|status`
- `POST /api/subscription/create-order|verify-payment`
- `GET /api/permissions/users`, `/permissions/user/{id}`
- `POST /api/permissions/user/{id}`
- `GET /api/payments/{payment}/invoice/download|view` (auth via token in query string)

Backend controllers: [app/Http/Controllers/Api/](app/Http/Controllers/Api/) — Auth, Client, Branch, Plan, Payment, Permission, Subscription, OrganizationType, Master, Dashboard, ForgotPassword, RazorpayWebhook.

---

## 7. Local setup

```bash
# from c:\xampp\htdocs\Cross_Border_Command
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate --seed     # creates tables + seeds super admin, plans, modules, masters
npm install
```

**Run dev (two terminals):**
```bash
php artisan serve              # backend at http://127.0.0.1:8000
npm run dev                    # Vite at http://localhost:5173
```
Or one shot: `composer dev` (server + queue + logs + vite together).

**Reset DB:**
```bash
php artisan migrate:fresh --seed
```

**Seeder order** ([database/seeders/](database/seeders/)):
1. `PlanSeeder` — Starter / Basic / Pro / Business / Enterprise
2. `ModuleSeeder` — platform modules
3. `OrganizationTypeSeeder` — Business / Sports / Education etc.
4. `GeographySeeder` — countries, states
5. `MasterDataSeeder` — fills master tables
6. `DatabaseSeeder` — Super Admin user

`.env` keys to fill: `APP_KEY`, mail SMTP (`MAIL_*`), `GOOGLE_CLIENT_ID`, `RAZORPAY_KEY`, `RAZORPAY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.

---

## 8. High-risk areas

### A. Tenant isolation (CRITICAL)
Login as Client A → try to view / edit / delete a Client B record by guessing the `id` in URL or API (`/api/clients/{id}`, `/api/branches/{id}`, etc.). Same for branches, users, payments, masters. Every list and detail call must scope by `client_id`. Any leak = **P0**.

### B. Auth & password
Login (right / wrong password), Google sign-in, forgot-password (OTP email → reset), expired / wrong / reused OTP, welcome email when admin creates a client, logout (token invalidated, API returns 401), 401 auto-redirect to login (handled in [resources/js/api.ts](resources/js/api.ts)).

### C. Payment / subscription (Razorpay)
Pick plan → create order → pay (test mode) → verify-payment → client status flips to `active`. Failed payment → client stays `inactive`, login blocked. Webhook `POST /api/razorpay/webhook` reconciles. Invoice download / view (PDF via dompdf). GST + total math correct.

### D. Permissions matrix
Super Admin assigns module permissions to Client. Client Admin assigns to Branch / User. Child must NEVER exceed parent. `can_view = false` → menu / page / API hidden.

### E. Main-branch visibility
Main-branch user (`is_main = true`) sees all branches' data. Non-main user sees own branch only. Only one main branch per client — try creating two.

### F. Master CRUD (50+ tables)
For each master: create / list / edit / delete + duplicate-name handling, validation, pagination, search. Endpoint pattern `/api/master/{slug}` — try invalid slugs, SQL injection in slug.

### G. Soft delete
Deleting client / branch / user → soft delete (`deleted_at`), not hard. Soft-deleted records hidden from lists. Deleted user cannot log in.

### H. Approval queue (Maker-Checker)
Branch submits record → status `pending` → Client Admin approves / rejects → record goes live or returns. Test reject reason, edit-after-reject, priority levels.

---

## 9. Test scenarios — full checklist

### 9.1 Authentication
- [ ] Super admin login (valid / invalid)
- [ ] Client admin login (active client) → success
- [ ] Client admin login (inactive client) → blocked with proper message
- [ ] Client user login → restricted to client scope
- [ ] Branch user login (active branch) → success
- [ ] Branch user login (inactive branch) → blocked
- [ ] Login with deleted (soft-deleted) user → blocked
- [ ] Login with wrong password → error, no token issued
- [ ] Login lockout / rate limit after N failures (if implemented)
- [ ] Google sign-in (valid Google account, mismatched email, revoked token)
- [ ] Forgot password — OTP sent via email
- [ ] OTP correct → reset password works
- [ ] OTP expired → rejected
- [ ] OTP wrong → rejected
- [ ] OTP reused → rejected
- [ ] Reset password → old token invalidated, new login works
- [ ] Change password (logged-in) → old password rejected, new accepted
- [ ] Logout → token invalidated, subsequent API calls return 401
- [ ] Token expiry → auto redirect to login
- [ ] Welcome email arrives when admin creates a new client

### 9.2 Client lifecycle
- [ ] Super admin creates client (all required fields)
- [ ] Required-field validation (org_name, email, phone format)
- [ ] Duplicate email / unique_number prevented
- [ ] Auto-generated `unique_number` (EA + timestamp) is unique
- [ ] New client receives credentials email
- [ ] New client login → forced to plan selection
- [ ] Client picks free plan → activates immediately (if free plan exists)
- [ ] Client picks paid plan → Razorpay order created
- [ ] Razorpay test payment success → client status `active`
- [ ] Razorpay payment fail → status stays `inactive`, retry possible
- [ ] Webhook arrives later → status reconciles
- [ ] Invoice PDF generates with correct amount + GST + total
- [ ] Invoice download works via tokenized URL
- [ ] Invoice view (in-browser PDF) works
- [ ] Edit client → only super admin allowed
- [ ] Delete client → soft delete, branches/users cascade-soft-delete
- [ ] Suspend client → all users blocked from login
- [ ] Reactivate client → users can log in again
- [ ] Plan upgrade / downgrade flow (if implemented)
- [ ] White-label colors / logo apply for that client only

### 9.3 Branches
- [ ] Client creates branch (required fields)
- [ ] Mark branch as main → only one main allowed; second attempt rejected
- [ ] Edit branch info
- [ ] Deactivate branch → branch users blocked
- [ ] Soft-delete branch → users under it cannot log in
- [ ] Branch list scoped to current client only
- [ ] Branch search / filter / pagination

### 9.4 Users / Employees
- [ ] Client admin creates user (client_user / branch_user)
- [ ] Email uniqueness across whole `users` table
- [ ] Required fields validation
- [ ] User receives credentials email (if implemented)
- [ ] Edit user → role change reflects in permissions
- [ ] Soft-delete user → blocked from login
- [ ] User profile page edit (own profile)
- [ ] Avatar upload (file size / type validation)
- [ ] User_details: HR fields, documents (Aadhaar, PAN), salary, emergency contact

### 9.5 Plans
- [ ] Super admin creates plan (Starter / Basic / Pro / Business / Enterprise / Custom)
- [ ] Plan price / period / max_branches / max_users / storage / support fields
- [ ] Featured plan badge displays
- [ ] `plan_modules` mapping with access_level (full / limited / addon / not_included)
- [ ] Edit plan → existing subscriptions unaffected
- [ ] Soft-delete / deactivate plan → not shown in selection

### 9.6 Permissions / RBAC
- [ ] Super admin sets module permissions on client
- [ ] Client admin sets permissions on branch / user
- [ ] Child permissions cannot exceed parent (UI + API enforcement)
- [ ] `can_view = false` → page / menu hidden
- [ ] `can_add = false` → Add button disabled / API rejects POST
- [ ] `can_edit = false` → Edit blocked
- [ ] `can_delete = false` → Delete blocked
- [ ] Modules not in the client's plan → locked icon, no access
- [ ] Sub-module permissions independent of parent module (where applicable)

### 9.7 Payments
- [ ] Payments list scoped to client
- [ ] Stats endpoint `/api/payments/stats` returns correct totals
- [ ] Send-reminder action emails the client
- [ ] Filter by status (pending / success / failed / expired / refunded)
- [ ] Date range filter
- [ ] Razorpay webhook signature validation rejects forged payloads
- [ ] Refund flow (if implemented) updates status

### 9.8 Master data (run on at least 5 different masters)
- [ ] List with pagination + search
- [ ] Create with valid + invalid data
- [ ] Required-field validation
- [ ] Duplicate-name validation
- [ ] Edit existing record
- [ ] Soft / hard delete (per master spec)
- [ ] Invalid `{slug}` returns 404
- [ ] Master data scoped per client where applicable
- [ ] Bulk import / export (Excel) if available
- [ ] Geography masters: state list filters by country, state-code unique

### 9.9 Tenant isolation (manual API tests)
- [ ] Login as Client A → call `/api/clients/{B_id}` → must be 403/404
- [ ] Same for `/api/branches/{B_branch_id}`
- [ ] Same for `/api/payments/{B_payment_id}`
- [ ] Same for `/api/master/{slug}/{B_master_id}` (where master is per-client)
- [ ] Cannot list users of another client
- [ ] Cannot view invoice of another client (even with token guess)
- [ ] Cannot upload file into another tenant's storage path

### 9.10 Approval queue (Maker-Checker)
- [ ] Branch user submits new record → status `pending`
- [ ] Client admin sees pending in approval queue
- [ ] Approve → record goes live
- [ ] Reject with comment → submitter sees rejection
- [ ] Priority levels (low / medium / high) sort correctly
- [ ] Approver_id captured correctly
- [ ] Audit timestamp `approved_at` set

### 9.11 Activity logs
- [ ] Login / logout logged with IP + user_agent
- [ ] Create / update / delete actions logged
- [ ] Activity scoped per client when viewed
- [ ] Super admin sees all logs
- [ ] Date range filter works

### 9.12 Client settings
- [ ] Update privacy policy / about / contact
- [ ] Toggle 2FA enabled (if implemented)
- [ ] White-label toggle applies primary / secondary color + logo
- [ ] Approval mode (default / custom)
- [ ] Settings scoped to current client only

### 9.13 Cross-cutting / non-functional
- [ ] Responsive on mobile / tablet / desktop
- [ ] Cross-browser: Chrome, Edge, Firefox, Safari
- [ ] 401 from any API auto-redirects to login
- [ ] CSRF / XSS — input fields sanitize HTML
- [ ] SQL injection — quotes / `;` in inputs handled
- [ ] File upload — type / size / virus check
- [ ] Large list performance (1000+ rows) — pagination keeps page snappy
- [ ] Concurrent edits — last-write-wins or proper conflict handling
- [ ] Date / timezone display (server vs browser)
- [ ] i18n strings render (project uses `i18next`)
- [ ] Loaders / spinners for slow actions
- [ ] Empty states (no clients, no branches, etc.)
- [ ] Error states (API down, 500 response)

---

## 10. Bug-logging template

```
Title: [Module] Short description of the issue

Severity: P0 / P1 / P2 / P3
Environment: Local / Staging / Prod
Browser + version: Chrome 130, Firefox 120, etc.
User type used: super_admin / client_admin / client_user / branch_user
Tenant (client) / branch: e.g. Client "Acme Inc" / Main Branch

Steps to reproduce:
1.
2.
3.

Expected result:
Actual result:

Evidence:
- Screenshot / screen recording
- Network tab response (copy as cURL)
- Console errors

Files / endpoints suspected (if known):
- e.g. resources/js/pages/Branches.tsx:123
- e.g. POST /api/branches → 500

Notes:
```

**Severity guide:**
- **P0** — Cross-tenant data leak, payment failure (money lost), production down, login broken for everyone.
- **P1** — Major feature broken, no workaround (cannot create client, cannot pay, OTP not arriving).
- **P2** — Feature broken with workaround, validation issue, UI bug blocking flow.
- **P3** — Cosmetic, copy / spelling, minor UX.

---

## 11. Where to look when something breaks

| Symptom | First place to check |
|---|---|
| API 500 | `storage/logs/laravel.log` |
| Frontend white screen | Browser console + Network tab |
| Payment not reconciling | [app/Http/Controllers/Api/RazorpayWebhookController.php](app/Http/Controllers/Api/RazorpayWebhookController.php) + Razorpay dashboard |
| Email not arriving | `MAIL_*` in `.env`, Gmail SMTP creds, `storage/logs/laravel.log` |
| OTP issues | [app/Http/Controllers/Api/ForgotPasswordController.php](app/Http/Controllers/Api/ForgotPasswordController.php) + `password_reset_otps` table |
| Permission weirdness | [app/Http/Controllers/Api/PermissionController.php](app/Http/Controllers/Api/PermissionController.php) + `permissions` table |
| Tenant leak | Controller's `where('client_id', auth()->user()->client_id)` filter — missing? P0 bug. |
| Token / 401 loops | [resources/js/api.ts](resources/js/api.ts) axios interceptor |
| Master CRUD broken | [app/Http/Controllers/Api/MasterController.php](app/Http/Controllers/Api/MasterController.php) + [resources/js/pages/master/masterConfigs.ts](resources/js/pages/master/masterConfigs.ts) |
| Webhook signature fail | `RAZORPAY_WEBHOOK_SECRET` in `.env` |

---

## 12. Reference

- **Codebase:** `c:\xampp\htdocs\Cross_Border_Command` (Git — current dev branch `saas`, main branch `main`)
- **Mail used by app:** php@inhpl.com (Gmail SMTP)
- **Razorpay:** test-mode keys in `.env` (`RAZORPAY_KEY`, `RAZORPAY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`)
- **Google OAuth:** `GOOGLE_CLIENT_ID` in `.env`
- **Database design (full SQL + ER diagram):** [DATABASE_DESIGN.md](DATABASE_DESIGN.md)
- **Razorpay flow:** [RAZORPAY_INTEGRATION.md](RAZORPAY_INTEGRATION.md)
- **Google sign-in setup:** [GOOGLE_SIGNIN_SETUP.md](GOOGLE_SIGNIN_SETUP.md)

---
*Document version: 1.1 — 2026-04-27*
