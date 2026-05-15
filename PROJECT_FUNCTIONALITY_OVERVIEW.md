# Cross_Border_Command — Complete Functionality Overview

> **Document type:** Master reference doc covering every feature, every role, every module from start to end.
> **Audience:** QA, new developers, product owners, technical onboarding.
> **Last updated:** 2026-05-15 (branch: `saas`)
> **Author:** Compiled from end-to-end codebase review.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Tech Stack](#2-tech-stack)
3. [User Hierarchy & Roles](#3-user-hierarchy--roles)
4. [Authentication & Login Methods](#4-authentication--login-methods)
5. [Permission System (Core)](#5-permission-system-core)
6. [Branch Switcher (Multi-tenant scoping)](#6-branch-switcher-multi-tenant-scoping)
7. [Role-by-Role Feature Matrix](#7-role-by-role-feature-matrix)
8. [Super Admin Functionality](#8-super-admin-functionality)
9. [Client Admin Functionality](#9-client-admin-functionality)
10. [Client User Functionality](#10-client-user-functionality)
11. [Branch User Functionality (Main vs Sub)](#11-branch-user-functionality-main-vs-sub)
12. [Employee Functionality](#12-employee-functionality)
13. [Master Data Module (50+ tables)](#13-master-data-module-50-tables)
14. [HR Module Deep Dive](#14-hr-module-deep-dive)
15. [Employee Onboarding (Internal + Public)](#15-employee-onboarding-internal--public)
16. [Recruitment & Candidate Workflow](#16-recruitment--candidate-workflow)
17. [Attendance & Face Biometric](#17-attendance--face-biometric)
18. [Leave Management (Multi-level approval)](#18-leave-management-multi-level-approval)
19. [Expense Claims (2-stage approval)](#19-expense-claims-2-stage-approval)
20. [Document Templates & Signing Workflow](#20-document-templates--signing-workflow)
21. [Broadcast Centre (Announcements)](#21-broadcast-centre-announcements)
22. [Plans, Subscription & Payments (Razorpay)](#22-plans-subscription--payments-razorpay)
23. [Platform Settings](#23-platform-settings)
24. [Notifications & Inbox](#24-notifications--inbox)
25. [My Team View](#25-my-team-view)
26. [Profile & Self-service](#26-profile--self-service)
27. [API Reference (all endpoints)](#27-api-reference-all-endpoints)
28. [Database Schema Highlights](#28-database-schema-highlights)
29. [Recent Feature Additions](#29-recent-feature-additions)
30. [QA Risk Areas](#30-qa-risk-areas)

---

## 1. Executive Summary

**Cross_Border_Command** is a multi-tenant SaaS / ERP platform built for businesses in import/export and cross-border operations. The platform follows the **TenantOS / IGC SaaS** architectural pattern.

### Top-level value props
- **One platform, many tenants** — each customer (Client) owns their own org, branches, employees, masters
- **50+ master tables** — Countries, States, Ports, HSN, GST, Currencies, Incoterms, Warehouses, etc. (preseeded)
- **Full HRMS** — Employee Onboarding (public link), Recruitment, Attendance (face biometric), Leave (multi-level approval), Expense Claims (2-stage), Payroll, Document Templates with signing workflows, Broadcast Centre, PIP
- **Plan + Razorpay billing** — clients pick plans, pay via Razorpay (UPI/Card/NetBanking), modules unlock by plan
- **Granular permissions** — every leaf module has 7 flags (view/add/edit/delete/export/import/approve) per user
- **Multi-language ready** — i18next wired in, currently English

### Scale & maturity (as of 2026-05-15)
- **695 commits** since project start on 2026-04-13 (about 1 month)
- **5 active contributors:** react-sakshi, dev, Durgesh urkude, Bhavika_ReactDev, DurgeshPhp
- **142 migrations**, **36 API controllers**, **60+ Eloquent models**
- **~17K lines** of backend PHP, **~25K lines** in HRMS frontend pages alone
- **Active dev branch:** `saas` (production-ready features get merged here)

### Local URLs
- **App URL:** `http://localhost` (XAMPP)
- **Backend:** `php artisan serve` (port 8000)
- **Frontend:** Vite dev (`npm run dev`)
- **Default super admin:** `admin@saas.com` / `password`

---

## 2. Tech Stack

### Backend (Laravel 12)
| Layer | Tech |
|---|---|
| PHP | 8.2+ |
| Framework | Laravel 12 |
| Auth | Laravel Sanctum (bearer token) |
| Database | SQLite (dev), MySQL/PostgreSQL (prod-ready) |
| PDF | barryvdh/laravel-dompdf (invoices, signed docs) |
| Word | phpoffice/phpword (DOCX gen + parse) |
| Payments | razorpay/razorpay |
| Google Sign-in | google/apiclient |
| QR Codes | chillerlan/php-qrcode |
| Cloud storage (optional) | Azure Blob via league/flysystem-azure-blob-storage |
| Queue | Database driver |
| Cache | Database driver |
| Mail | SMTP (Gmail by default) |

### Frontend (React 19 + TypeScript)
| Layer | Tech |
|---|---|
| Build | Vite 7 |
| UI Framework | React 19 + TypeScript 6 |
| Styling | Tailwind 4 + Bootstrap 5 + SCSS (Velzon theme) |
| Router | React Router 7 |
| State | Redux Toolkit + reselect + Context API |
| Tables | @tanstack/react-table |
| Charts | Recharts |
| Rich text editor | TipTap (with text-align + underline extensions) |
| Date pickers | Custom MasterDatePicker |
| Toasts | Custom Toaster context (4-type) |
| Modals | reactstrap + custom portal modals |
| Image crop | react-easy-crop |
| Excel export | xlsx + file-saver |
| Face biometric | face-api.js (128-d descriptors) |
| Confirmations | sweetalert2 |
| Carousel | swiper |
| Icons | lucide-react + react-icons + feather + remix CSS |
| i18n | i18next + browser-languagedetector |

### Theme variants
The platform ships with **11 visual variants** (selectable via Theme Customizer):
`cbc` (default), `velzon-default`, `velzon-corporate`, `velzon-creative`, `velzon-galaxy`, `velzon-interactive`, `velzon-master`, `velzon-material`, `velzon-minimal`, `velzon-modern`, `velzon-saas`. Each can be toggled dark/light.

---

## 3. User Hierarchy & Roles

```
super_admin (admin@saas.com)
   │
   ├── Client A (organization, status=active/inactive/suspended)
   │     │
   │     ├── client_admin    (owner — set during client create)
   │     ├── client_user[]   (org-level managers/viewers — no branch_id)
   │     │
   │     ├── Branch 1 (is_main=true)
   │     │     ├── branch_user (HR-equivalent for that branch)
   │     │     ├── employee[]
   │     │
   │     ├── Branch 2 (is_main=false, sub-branch)
   │     │     ├── branch_user
   │     │     ├── employee[]
   │     │
   │     └── Branch N
   │
   ├── Client B (isolated tenant)
   └── …
```

### Role enum (single `users` table)
| user_type | client_id | branch_id | Description |
|---|---|---|---|
| `super_admin` | NULL | NULL | SaaS platform owner. Seeded — only one row. |
| `client_admin` | set | NULL | Organization owner. Created when super_admin creates a Client. |
| `client_user` | set | NULL | Org-wide manager/viewer. Auxiliary admin role. |
| `branch_user` | set | set | Branch's HR / ops admin. Main vs sub determined by `branches.is_main`. |
| `employee` | set | set | Regular staff. Linked 1:1 to `employees` row via `users.id = employees.user_id`. |

### Core business rules
1. **Tenant isolation** — Client A's data must NEVER be visible to Client B. Enforced per-controller via `applyScope()` walking `client_id` + `branch_id`.
2. **One main branch per client** (`is_main=true`). Main branch users see ALL branches of their client.
3. **Permission inheritance** — A user cannot grant a permission they don't have themselves. Cascades downwards on revoke.
4. **Inactive client = blocked** — Client status `inactive`/`suspended`/`pending` blocks ALL of its users from login. Existing tokens are revoked.
5. **Soft delete** — `users`, `clients`, `branches`, `employees`, etc. use `deleted_at`. Soft-deleted rows hidden from lists unless tab=Disabled.
6. **Plan-module lock** — Modules NOT in client's plan show as locked/hidden in sidebar.
7. **Hierarchical edit/delete** — Lower-ranked users (e.g. `branch_user`) cannot edit/delete records created by higher-ranked users (e.g. `client_admin`).
8. **Per-tenant code sequences** — EMP-001, REC-001, DEPT-001, EXP-0001, BR-001, ANN-0001, HRQ-001 — all isolated per (client_id, branch_id) tuple using `lockForUpdate()`.

---

## 4. Authentication & Login Methods

### Three login methods (all converge on Sanctum token)
| Method | Endpoint | Required | Notes |
|---|---|---|---|
| Password | `POST /api/login` | email + password | Default. Bcrypt hash. |
| Google OAuth | `POST /api/google-login` | id_token | Requires `GOOGLE_CLIENT_ID` env. Account must pre-exist (no auto-create). |
| Face Login | `POST /api/login/face` | email + descriptor[128] | Requires enrolled face (from /face/register). Threshold 0.50 Euclidean. |

### Security guardrails (every login path)
1. **Brute-force lockout** — 5 failed attempts in 15 min locks the account. Single cache key shared across all 3 methods (`login_attempts:<lowercase_email>`). Gated by Settings → Security → bruteForce.
2. **Account status check** — `user.status` must be `active`.
3. **Org status check** — `user.effectiveClient()` must be `active` (walks `client_id` OR `branch.client_id`).
4. **Branch status check** — If `branch_id` set, `branch.status` must be `active`.
5. **Token revocation** — Old tokens deleted on every login (`$user->tokens()->delete()`).

### Mid-session revocation (`EnsureUserActive` middleware)
Every authenticated request re-checks `user.status`, `effectiveClient.status`, `branch.status`. If any went inactive mid-session:
- Tokens deleted
- 401 returned
- SPA falls back to login

### Forgot password (3-step OTP)
1. `POST /api/forgot-password/send-otp` → 6-digit OTP via email, 10-min expiry, 2-min resend cooldown
2. `POST /api/forgot-password/verify-otp` → mark OTP verified (max 5 attempts then auto-delete)
3. `POST /api/forgot-password/reset` → new password (blocked from last 3 passwords via `PasswordHistory` trait), invalidates all tokens, sends confirmation mail with the new plaintext password

### Logout
`POST /api/logout` → `currentAccessToken()->delete()`. Clears localStorage on frontend: `cbc_token`, `cbc_user`, `cbc_user_v`, `cbc_selected_branch_id_<userId>`.

### Idle timeout (frontend)
`IdleTimeout.tsx` — When Settings → Security → sessTimeout is ON, **5 hours** of inactivity (mouse/keyboard/touch/scroll silent) triggers auto-logout.

---

## 5. Permission System (Core)

### Three-level module tree
```
Level 1 (root):     parent_id = null      e.g. "dashboard", "clients", "master", "hr"
Level 2 (category): parent_id = root.id   e.g. "master.identity", "hr.command"
Level 3 (leaf):     parent_id = category  e.g. "master.countries", "hr.employee"
```
Permissions can ONLY be granted on **leaf modules**. Parents exist for visual grouping in the sidebar + permission matrix.

### Seeded module counts
- **11 top-level modules** (Dashboard, Clients, Branches, Employees, Plans, Payments, Permissions, Master, HR, Settings, Profile)
- **9 master categories** under "Master" → **~50 leaf masters**
- **6 HR categories** under "HR" → **~25 HR leaf modules**

### Permission row shape (`permissions` table)
Each row gates ONE user on ONE leaf module with 7 boolean flags:
```php
[
  'user_id'    => int,
  'client_id'  => int|null,
  'branch_id'  => int|null,
  'role'       => string,           // denormalised from user.user_type
  'module_id'  => int,
  'can_view'   => bool,
  'can_add'    => bool,
  'can_edit'   => bool,
  'can_delete' => bool,
  'can_export' => bool,
  'can_import' => bool,
  'can_approve'=> bool,
  'granted_by' => int,              // who clicked Save
]
```

### Grant scope (who-can-grant-to-whom)
| Granter | Manages | UI access |
|---|---|---|
| super_admin | client_admin | Permissions page in main sidebar |
| client_admin | branch_user only (NOT employees) | Permissions page |
| main_branch_user | branch_user + employee under client | Permissions page |
| sub-branch user | employee under same branch | Permissions page (limited) |
| anyone else | nothing | Page hidden |

### Inheritance rule (enforced server-side)
**A granter cannot grant a flag they don't have themselves.** Code in `PermissionController::savePermissions`:
```php
foreach ($request->permissions as $perm) {
    foreach ($fields as $field) {
        if (($perm[$field] ?? false) && !$myPerm->$field) {
            return 422 — "You cannot grant '{$field}' permission that you don't have";
        }
    }
}
```

### Cascade revoke
When client_admin's own perms are reduced, **every branch_user/employee** under their client gets the same flags stripped automatically (`cascadeClearDownstream()`). Same logic fires during plan downgrades (`cascadePruneDownstreamPermissions()` in SubscriptionController).

### Frontend permission caching gotcha
`AuthContext.tsx` caches `user.permissions` in `localStorage` (key: `cbc_user`, version-keyed at v10). Stale cache means **revoked perms only take effect after**:
1. User logs out and back in, OR
2. Window focus event triggers `/me` refresh (throttled to 60s)

This is BUG-02 from the QA verification — a known UX issue, not a security hole (backend always re-checks).

---

## 6. Branch Switcher (Multi-tenant scoping)

### Visibility by role
| Role | Topbar shows | Default | Can switch? |
|---|---|---|---|
| super_admin | Nothing | — | — |
| client_admin | Dropdown | "All Branches" | Yes — any branch in their client |
| client_user | Dropdown | "All Branches" | Yes |
| main_branch_user (`branch_user` + `is_main=true`) | Dropdown | Their own branch | Yes |
| sub_branch_user | **Read-only label** | Locked to own branch | **No** |
| employee | **Read-only label** | Locked to own branch | **No** |

### Persistence
Selected branch is stored per-user in `localStorage` key `cbc_selected_branch_id_<userId>`. This per-user key prevents cross-user contamination (BUG-01 fix from BranchSwitcher audit).

### Auto-injection (axios interceptor)
`api.ts` injects `?branch_id=<selected>` on every GET request automatically (except `/branches`, `/me`, `/login`, `/logout`, `/forgot-password`, `/google-login`).

### Backend enforcement
Every list controller's `applyScope()`:
1. Resolves user's tenant scope (client_id, branch_id)
2. Validates incoming `?branch_id=` belongs to user's client (else silently ignored — no cross-tenant leak)
3. Sub-branch users are **server-locked** regardless of frontend filter

---

## 7. Role-by-Role Feature Matrix

### Top-level sidebar visibility
| Menu Item | super_admin | client_admin | client_user | branch_user (main) | branch_user (sub) | employee |
|---|---|---|---|---|---|---|
| Dashboard | ✅ Admin | ✅ Client | ✅ Branch | ✅ Branch | ✅ Branch | ✅ Employee |
| Clients | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Plans | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Payments | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Branches | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| My Plan | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Master (parent) | ✅ (only super_admin masters) | ✅ (perm-gated) | ✅ (perm-gated) | ✅ (perm-gated) | ✅ (perm-gated) | ✅ (perm-gated) |
| HR (parent) | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Clock-In | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Permissions | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Settings | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Profile | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**HR menu** is `branch_user`-only by product call. Direct URL access still works for client_admin (they can navigate to `/hr/employees`) but the menu entry is hidden.

### Topbar / dropdown items (all roles unless noted)
- **Branch Switcher** — see section 6
- **Global Search** (Ctrl+K) — filters MENU_ITEMS for the user's role
- **Theme toggle** (light/dark)
- **Fullscreen toggle**
- **Notifications bell** — drives bell badge from `/api/notifications/unread-count`
- **Profile dropdown:**
  - View Profile
  - Inbox (if `inbox_count > 0`)
  - My Team (if `is_reporting_manager` OR branch/client user)
  - Theme Customizer (variant + dark/light)
  - Logout

---

---

## 8. Super Admin Functionality

The super admin is the SaaS platform owner. There's exactly **one** super_admin (seeded in `DatabaseSeeder` with email `admin@saas.com` / password `password`). They have no `client_id` or `branch_id` — they sit above all tenants.

### Sidebar layout for super_admin
```
MAIN
  Dashboard

MANAGEMENT
  Clients

BILLING
  Plans
  Payments

MASTER DATA
  Master (only super-admin masters are visible)
    └── Organization Types
    └── Countries
    └── States
    └── State Codes
    └── Address Types

ACCESS CONTROL
  Permissions

SYSTEM
  Settings
  Profile
```

### Admin Dashboard (`/dashboard`)
Backed by `GET /api/dashboard/admin-stats`. Displays:
- **6 KPI cards** — Total Clients, Active Clients, Inactive Clients, Total Users, Total Branches, Total Revenue
- **Plan distribution pie** — free vs paid clients
- **Plan breakdown bar chart** — clients per named plan (Starter, Basic, Pro, Business, Enterprise)
- **Revenue trend** — 6-month area chart with monthly totals
- **Client growth** — 6-month line chart of new client signups
- **User type distribution** — counts per role
- **Org type distribution** — Business / Sports / Education / Healthcare / Government / NGO / Other
- **Recent clients** (top 5) — name, status, plan, branches count, users count
- **Recent payments** (top 5) — client, plan, amount, status, method
- **Top clients by revenue** (top 5)

All numbers are **animated** (count up from 0 over 1.2s) for visual polish.

### Clients module (`/clients`)
Full CRUD over the `clients` table. Endpoints: `apiResource('clients')`.

**Stats card row:** Total / Active / Inactive / Plans Count with a pie chart.

**Client form fields:**
- **Organization Info:** org_name, unique_number (auto: `EA` + initials + timestamp), email, phone, website, status, sports, industry
- **Address:** address, city, district, taluka, pincode, state, country
- **Legal:** gst_number (regex validated + globally unique), pan_number (regex validated + globally unique)
- **Plan:** plan_id, plan_type (initial save is FORCED to `free` — paid only via SubscriptionController), plan_expires_at
- **Branding:** primary_color, secondary_color, logo (jpg/png/svg/webp ≤2MB), favicon (+ico ≤512KB), profile_photo (jpg/png ≤2MB)
- **Notes:** free text
- **Client Admin credentials:** admin_name, admin_email, admin_phone, admin_designation, admin_password (min 6), admin_status

**On create:**
1. Client row inserted with `plan_type='free'`, `status='inactive'`
2. Default branch auto-created: `<OrgName> — Head Office` with `code='HO'`, `is_main=false` (the **HO placeholder** is hidden from Branches list — placeholder so the client_admin user has a `branch_id` FK target)
3. Client admin user provisioned with `user_type='client_admin'`, hash-bcrypt password
4. Welcome email sent (`WelcomeCredentialsMail`) — gated by Settings → notifications.newUser

**On status flip active → inactive:**
- All Sanctum tokens for users under this client are deleted (`revokeAllUserTokensForClient`) — kills live sessions immediately, not just future logins

**On delete:** Soft-delete cascade — client → branches → users. Tokens revoked first.

**Per-client sub-pages:**
- `/clients/:id` — ClientView (read-only summary)
- `/clients/:id/branches` — ClientBranches
- `/clients/:id/permissions` — ClientPermissions
- `/clients/:id/payments` — ClientPayments
- `/clients/:id/settings` — ClientSettings

### Plans module (`/plans`)
Full CRUD over the `plans` table. Built-in plans (seeded by `PlanSeeder`):
| Plan | Price | Branches | Users | Storage | Support |
|---|---|---|---|---|---|
| Starter | ₹0 | 1 | 3 | 1GB | Email |
| Basic | ₹1,999/mo | 5 | 15 | 5GB | Email + Chat |
| Pro (Most Popular) | ₹4,999/mo | 25 | 50 | 25GB | Priority |
| Business | ₹9,999/mo | 50 | 100 | 100GB | Dedicated |
| Enterprise (Custom) | ₹14,999/mo | unlimited | unlimited | 500GB+ | Enterprise SLA |

**Plan form fields:** name, slug (auto-generated from name), price, period (month/quarter/year), max_branches, max_users, storage_limit, support_level, is_featured, badge, color, description, best_for, status, sort_order, trial_days, yearly_discount, is_custom, modules[] (per-module access_level: full/limited/addon/not_included).

**Plan slugs are globally unique** with friendly error messages on collision. Slug derived from `name` (lowercase, non-alphanumeric → hyphens).

**Plan-module pivot** (`plan_modules` table) decides which modules a plan unlocks. When a client is on a plan, their `client_admin` user gets permission rows for every module marked `full`/`limited` on the plan.

**Cannot delete a plan with active clients** — must reassign first.

### Payments module (`/payments`)
Read-only listing (super_admin sees ALL, client_admin sees their own client's payments only — non-admin users get an empty list).

**Stats card row:** Total Revenue, Total Transactions, Successful, Pending, Failed, Refunded, Refund Amount.

**Filters:** search (txn_id / order_id / invoice_number / client name), status, client, from_date, to_date.

**Each row shows:** Invoice number, client org, plan, total, GST, status pill, method pill, billing cycle, valid window, processed_by, created_at, Actions (View Invoice / Download Invoice / Send Reminder).

**Manual payment entry** (`POST /api/payments`) — super_admin only — for offline payments (cash/cheque/bank transfer). On `status=success`, auto-generates invoice PDF via `InvoiceMailer::sendForPayment()` and emails to org + client_admin.

**Invoice routes** (auth via query token `?token=<sanctum>` — works with plain `<a>` clicks even when `/storage/` symlink is broken):
- `GET /api/payments/{payment}/invoice/download` — Download PDF
- `GET /api/payments/{payment}/invoice/view` — Inline view

**Plan expiry reminder** (`POST /api/payments/{payment}/send-reminder`) — sends `PlanReminderMail` to client org + client_admin. Gated by Settings → notifications.planExp.

### Master Data (super-admin masters only)
Super admin sees ONLY these 5 in the Master menu (per `SUPER_ADMIN_MASTERS` set in constants.ts):
- Organization Types
- Countries
- States
- State Codes
- Address Types

All other 45+ masters are tenant-owned and surfaced only to tenant users (gated by per-module `can_view` flag).

**Organization Types** has a dedicated controller (`OrganizationTypeController`) — full CRUD, blocks delete if referenced by any client.

**Countries / States** are seeded by `GeographySeeder` with 249 ISO 3166 countries + subdivisions for major trade partners. Re-running the seeder is idempotent — only super-admin-owned rows (created_by=super_admin AND client_id=null AND branch_id=null) are wiped + re-inserted.

### Permissions module (`/permissions`)
Super admin grants permissions to **client_admin users**. The 7-flag matrix (view/add/edit/delete/export/import/approve) per leaf module, with tri-state checkboxes at category level.

**Cascade rule:** When super_admin saves a client_admin's permissions, any flag REMOVED triggers `cascadeClearDownstream()` to strip the same flag from every branch_user/employee under the client. Prevents privilege escalation gaps.

### Settings module (`/settings`)
Platform-wide settings (super_admin only — read open to all). 8 tabs:

1. **General** — platform_name, tagline, description, support_email, admin_email, contact_phone, website_url
2. **Security** — Toggles: tfa, pwReset, loginNotif, ipWhite, sessTimeout (drives IdleTimeout 5h auto-logout), bruteForce (login attempt lockout)
3. **Notifications** — emailNotif (master switch), pushNotif, planExp, newUser, payAlerts, weeklyReports
4. **Appearance** — primary_color, secondary_color, dark_default, logo_path, favicon_path
5. **Privacy** — encrypt, actLog, retention, cookie (drives CookieBanner), privacy_policy_url
6. **About** (read-only platform info)
7. **Help & FAQs** — array of `{q, a}` (drives a public-facing help center)
8. **Contact Us** — support_email, support_phone, website, status_page, emergency_phone

**Storage:** `platform_settings` table, one row per section, value as JSON. Cached in PHP via `App\Support\Settings::all()` for 60 seconds.

**Master toggle behavior:**
- `notifications.emailNotif = false` → ALL platform mail blocked (including OTPs, welcome credentials, password-changed confirmations — admin accepts the trade-off)
- `security.bruteForce = false` → no login attempt counter
- `security.sessTimeout = false` → no IdleTimeout
- `privacy.cookie = false` → CookieBanner doesn't render

### Profile module (`/profile`)
Same Profile page as everyone else, but:
- super_admin uploads photo onto the `users.profile_photo` column (no tenant row to attach to)
- No "Branding" section (no client/branch row to write logo to)

---

## 9. Client Admin Functionality

The client_admin is the organization owner. Created by super_admin during Client signup. Has `client_id` set, `branch_id` set to the auto-created HO placeholder (or whichever branch they were attached to).

### Sidebar layout for client_admin
```
MAIN
  Dashboard

OPERATIONS
  Branches

BILLING
  My Plan

MASTER DATA
  Master (perm-gated — sees masters according to permissions)

ACCESS CONTROL
  Permissions

SYSTEM
  Profile
```

Note: The **HR** menu group is NOT shown to client_admin by default (product call — HR runs at branch level). Direct URL access (e.g. `/hr/employees`) still works.

### Client Dashboard (`/dashboard`)
Backed by `GET /api/dashboard/client-stats`. Honors `?branch_id` for main-branch users (sub-branch users locked).

**KPI strip:**
- Total Branches / Active Branches
- Total Users / Active Users  
- Total Payments / Successful / Pending
- Total Paid (₹)

**Plan info card:** Plan name, status (active/expired/no_plan), days remaining, monthly price.

**Payment trend chart** (last 6 months) — only renders for client_admin + main_branch_user (sub-branch users get zeroes).

**Recent payments table** — same gating.

**Branches list** (within client).

**User roles breakdown** — pie of user_type counts.

**Employee analytics** (heavy section):
- Status pie (Active, Inactive, On Leave, Probation, Notice Period, Resigned, Terminated)
- Gender split
- Department headcount (top 8 + "Unassigned" rollup)
- Designation top 5
- Joining trend (6-month bar)
- Tenure buckets (<1yr / 1-3 / 3-5 / 5-10 / 10+)
- Age distribution buckets
- Average tenure (years)
- Faces registered count
- Upcoming events — birthdays + work anniversaries in next 30 days

### Branches module (`/branches`)
Full CRUD over branches. Excludes the auto-created "Head Office" placeholder (rows with `code='HO'` AND name ending `— Head Office`).

**Plan limit enforcement:** On create, if `Client.plan.max_branches > 0` AND current count >= max, blocks creation with friendly message.

**Branch form fields:**
- **Branch Info:** name (unique within client), code, email, phone, website, contact_person, branch_type, industry, description
- **Legal:** gst_number (regex + unique per client), pan_number (regex + unique per client), registration_number
- **Address:** address, city, district, taluka, state, pincode, country
- **Hierarchy:** is_main (toggling ON unsets is_main on any other branch in the client — exactly one main)
- **Limits:** max_users, established_at, status
- **Branding:** logo, profile_photo, primary_color, secondary_color
- **Branch User credentials:** user_name, user_email, user_password, user_phone, user_designation, user_status

**On create:** Branch row + paired `branch_user` user row (with bcrypt password) + welcome email (`WelcomeCredentialsMail`).

**On status flip active → inactive:** Revokes all Sanctum tokens for users in this branch — same pattern as Client deactivation.

**On delete:** Blocks if `is_main=true` (must transfer main first). Otherwise revokes tokens, soft-deletes users, soft-deletes branch.

**Auto branch code:** BR-001, BR-002, … per client (`peekNextBranchCode` + `allocateBranchCode` with `lockForUpdate`).

### My Plan (`/my-plan`)
Backed by `PlanSelection.tsx`. Powered by `SubscriptionController`.

**Flow:**
1. `GET /api/subscription/plans` — list active plans with their modules
2. `GET /api/subscription/status` — current plan, expiry, expired flag
3. User picks plan + billing cycle (month/quarter/year, yearly gets configured discount %)
4. **Branch-shrink guard** — if new plan caps branches below current count, requires `kept_branch_ids[]` selection
5. **Free plan path** (price ≤ 0): Skip Razorpay → `activatePlan()` directly
6. **Paid path:**
   - `POST /api/subscription/create-order` → server creates Razorpay order + pending Payment row → returns key + order_id
   - Frontend opens Razorpay Checkout (modal)
   - On success → `POST /api/subscription/verify-payment` with razorpay_order_id/payment_id/signature → server verifies signature → activates plan
   - On cancel → `POST /api/subscription/cancel-order` → marks Payment as `failed`
   - On webhook (`POST /api/razorpay/webhook`) → idempotent activate-from-webhook path (covers async/eventual confirmation)

**Pricing math:**
- `quarter` = price × 3
- `year` = price × 12, optionally with `yearly_discount %` applied
- **GST 18%** added on top
- `valid_until` = now + 1 month / 3 months / 1 year

**On successful payment (`activatePlan`):**
1. `payment.status = 'success'`
2. `client.plan_id = new_plan, plan_type='paid', status='active', plan_expires_at = valid_until`
3. **Reset client_admin's permissions** — delete all, then re-insert one row per plan-included module
4. **Cascade-prune downstream permissions** — strip any flag from branch_users/employees that admin no longer has
5. **Enforce branch limit** — deactivate (status=inactive, not soft-delete) any branch not in `kept_branch_ids`; revoke tokens for users in deactivated branches
6. Send invoice PDF via email (`InvoiceMailer`) — happens AFTER DB transaction commits

### Master Data (client_admin scope)
Per the per-module `can_view` flag granted by super_admin. Typically client_admin can see all client-level masters (departments, designations, roles, KPIs, legal entities, vendor directory, etc.) but NOT super-admin global masters (countries, states are still read-visible globally).

### Permissions module (client_admin scope)
Client admin grants to `branch_user` rows ONLY (not employees — main_branch_user handles that). Inheritance: cannot grant a flag they don't have themselves.

### Profile module
- Personal info: name, phone, designation
- **Branding** section: update client logo + primary_color + secondary_color (writes to `clients` table)
- Profile photo: writes to `clients.profile_photo`
- Change password (3-history block + plaintext echo email)
- Face biometric enrolment (FaceRegistrationModal)

---

## 10. Client User Functionality

`client_user` is an auxiliary org-wide manager/viewer role. Has `client_id` set but **no `branch_id`** — they see all branches of their client (similar to client_admin but with reduced privileges).

### Sidebar layout
Identical to client_admin EXCEPT:
- No "Permissions" menu — client_user does NOT grant permissions
- No "My Plan" — billing is client_admin-only
- Otherwise sees: Dashboard, Master (perm-gated), Profile

### Scope
- Cannot manage branches (no Branches menu)
- Cannot grant permissions
- Cannot manage plan
- Can view all data in their client across all branches (subject to per-module can_view)

In practice client_user is rare — most installs use client_admin + branch_users only.

---

## 11. Branch User Functionality (Main vs Sub)

`branch_user` is the HR/ops admin for a specific branch. Has both `client_id` and `branch_id`. Two flavors:

### Main Branch User (`branch.is_main = true`)
**Scope:** Sees ALL branches under the client. Can switch BranchSwitcher freely or view "All Branches".
- All HR data across all branches visible
- Can pick any branch as filter
- Granted permissions over branch_users + employees in any branch
- Treated as "head office HR" for the org

### Sub-Branch User (`branch.is_main = false`)
**Scope:** **Strictly locked** to their own branch's data. BranchSwitcher renders as read-only label.
- Backend `applyScope()` rewrites their incoming `?branch_id` to their own — cross-tenant ids silently dropped
- Sees only their branch's employees, candidates, expense claims, leaves, recruitments, announcements
- Master tables: sees globally-owned (NULL client_id) + their client_id rows + their branch_id rows + main-branch's rows (shared template data)

### Sidebar layout for branch_user
```
MAIN
  Dashboard

MASTER DATA
  Master (perm-gated)

(HR group is HERE for branch_user)
HR
  HRMS Command Center
    HRMS Overview
    PIP
    HR Reports
  HR Core
    Recruitment
    Employee
    Employee Onboarding
    Exit Management
  Time & Pay Inputs
    Payroll
    Calculation Master
    Attendance (feature-flagged)
    Leave
    Leave Approvals
    Expense Management
  Document & Evidence
    Broadcast Centre
    Document Templates
    Custom Fields
    Trigger Point Master
  Attendance Master Management
    Leave Type Master
    Leave Plan Master

ACCESS CONTROL
  Permissions

SYSTEM
  Profile
```

### Branch Dashboard
Same data as Client Dashboard but scoped to the branch (or all branches if main). Includes all employee analytics + face biometric counts + payment trends (only for main_branch_user).

### Branch HR responsibilities
Branch user runs HR for their scope:
- Hire (Recruitment + Candidates)
- Onboard (invite public link or wizard direct add)
- Track attendance (face-driven)
- Approve leave (when they're in the approval chain)
- Approve expense claims (manager or HR stage)
- Generate documents (offer letters, NDAs, etc.)
- Announce policies (Broadcast Centre)
- Run payroll (placeholder — Calculation Master)
- Handle exits

### Branch user CANNOT
- Manage other branches (sub-branch user)
- Grant permissions outside their branch (sub-branch) — only client_admin / main_branch_user can grant cross-branch
- View payments / billing (sub-branch — only main_branch_user sees the org's payment data)
- Edit/delete records created by client_admin (hierarchical guard)

### Profile module
- Personal info (name, phone, designation)
- **Branding section** writes to `branches` table (not client) — branch-specific logo + colors
- Profile photo → `branches.profile_photo`

---

## 12. Employee Functionality

`employee` is regular staff. 1:1 paired with an `employees` row via `users.id = employees.user_id`. Has `client_id` + `branch_id` (inherited from their branch when admin creates them or when public onboarding flow runs).

### Sidebar layout for employee
```
MAIN
  Dashboard

MASTER DATA
  Master (perm-gated — defaults to just dashboard + profile)

Clock-In   (employee-only menu item)

SYSTEM
  Profile
```

Employees do NOT see:
- Clients, Plans, Payments, Branches (admin only)
- HR menu (branch admin only)
- Permissions (admin only)
- Settings (super admin only)

### Employee Dashboard (`/dashboard`)
Backed by `GET /api/dashboard/employee-stats`.

**Profile hero** (`me` object): emp_code, name, photo, status, department, designation, manager (id+name+photo), date_of_joining, email, mobile, **profile_completion_pct** (computed from 12 key fields).

**KPI tiles** (animated):
- My Expenses Pending
- My Expenses Approved
- My Expenses Rejected
- Approvals Pending (if I'm a manager)
- Team Size (same department peers)
- Days Since Joining

**Compensation tile** (only when `enable_payroll=true`):
- Annual salary
- Salary frequency
- Salary structure
- Tax regime
- Effective from

**Recent expenses** (last 5) — rolled-up status (Pending/Approved/Rejected).

**Pending approvals** (if I'm a reporting manager) — claims awaiting my decision.

**Team peers** (up to 6) — same-department employees with photo.

**Announcements** (last 5 active in tenant).

**Upcoming events** — birthdays + work anniversaries in next 30 days.

**Onboarding progress** (only when `onboarding_stage_completed < 4`) — current stage card with progress bar nudging completion.

### Clock-In page (`/clock-in`)
**Only menu item exclusive to employee role.** Face-driven attendance.

**Flow:**
1. Page loads `GET /api/attendance/today` to get today's row + punch timeline + employee's face_registered flag
2. If face not enrolled → "Register Face" CTA → `FaceRegistrationModal` (consent disclosure → camera capture → POST /api/face/register)
3. Live-ticking total updates every second when there's an open 'in' punch
4. Activity label picker (Check In / Step Out / Step In / Lunch Out / Lunch In / Meeting / Check Out) auto-defaults based on next direction
5. Camera tile (FaceCapture) → captures 128-d descriptor
6. `POST /api/attendance/face/clock-in` or `/clock-out` with descriptor[128] + label + optional lat/lng
7. Server verifies face match (Euclidean ≤ 0.55), writes punch row, recomputes daily summary

**Server enforces alternating direction** — if you try to clock-in twice in a row, 422 with `next_direction` hint.

**Match audit trail** — every punch stores `match_distance` so HR can investigate suspicious late-night punches.

### My Team page (`/my-team`)
**Visible when** `is_reporting_manager` (computed: has direct reports OR is branch_user/client_admin/client_user).

Two tabs:
1. **Employees tab** — list of direct reports (for employee-manager) or all branch/client employees (for branch/client users)
2. **Approvals tab** — pending document signatures where I'm the next signer + future expense + leave (placeholder)

### Inbox page (`/inbox`)
**Visible when** `inbox_count > 0`.

Two sections:
1. **Leave Requests** — pending leaves where I'm the approver (either reporting manager OR named in chain)
2. **Document Signatures** — pending signature tasks (Sign / Approve / Acknowledge action types)

Each row has Approve / Reject inline buttons. Signature flow opens a fullscreen action modal with the document preview + SignaturePad (Type/Draw/Upload) + remark field.

### Profile module
- Personal info editable: name, phone, designation
- Profile photo (writes to employees.photo via EmployeeDocument with document_key='photo')
- Change password
- **No Branding section** (employees don't manage tenant branding)
- View own permissions (read-only list)
- View own employee details (linked from /profile → routes to EmployeeProfile)

### EmployeeProfile (`/hr/employees/:id/profile` OR `/profile`)
Massive 5277-line component. Tabs:
1. **Profile** — personal/identity, address, job, payroll, finance, assets, biometric status
2. **Job** — department, designation, role, manager, joining/probation/notice
3. **Attendance** — month picker, today's row, punches timeline, stats (present_days / late_marks / missing_biometric / total_leaves)
4. **Vault** — categorised document grid (Identity / Address / Education / Employment History / Signed Company Docs)
5. **Payroll** — summary + details (compensation breakdown, statutory)
6. **Expense** — claim list (ExpenseClaimsTable component, mode='mine')
7. **Apply Leave** — RequestLeaveModal launcher + own leave history + balance donut cards
8. **Apply for Comp Off / WFH** (placeholders)

Admins viewing another employee's profile see the same tabs but in read-only mode (some controls hidden).

---

## 13. Master Data Module (50+ tables)

The platform ships with **50+ master tables**, each surfaced via the generic `MasterController` (one controller dispatches all by slug). The Master menu in the sidebar groups them into **9 categories**:

### Category 1: Identity & Entity (9 leaves)
| Leaf slug | Title | Key fields | Auto-code |
|---|---|---|---|
| master.organization_types | Organization Types | name, slug, icon, description, sort_order | — |
| master.company | Company Details | company_name, short_code, gstin, pan, cin, iec, email, mobile | — |
| master.bank_accounts | Bank Accounts | bank_name, account_holder, account_number, ifsc_code, swift_code, ad_code, is_primary | — |
| master.departments | Departments | name, code, parent_id (tree), head, email | DEPT-001 (tenant-scoped) |
| master.roles | Roles | name, code, role_type (Primary/Ancillary), department_id, role_category | ROL-01 |
| master.designations | Designations | name, code, department_id, level (6 canonical levels), reports_to_id | DGN-01 |
| master.employees | Employees | (dedicated controller — see Section 14) | EMP-001 |
| master.kpis | KPIs | name, description, role_id, target_type, priority | — |
| master.legal_entities | Legal Entities | entity_code (LE-0001), entity_name, legal_name, cin, date_of_incorporation, type_of_business, country, address, state, currency_id, financial_year, **sublist: banks[]** | LE-0001 |

**Designation levels:** Director / CEO, Head of Department (HOD), Team Leader, Executive, Employee, Intern / Trainee.

### Category 2: Geography & Location (6 leaves)
| Leaf | Description |
|---|---|
| master.countries | 249 ISO 3166 countries seeded by GeographySeeder (super-admin owned, NULL client_id) |
| master.states | Subdivisions for major trade partners (states/provinces/regions) |
| master.state_codes | 2-digit GST state codes for India |
| master.address_types | Billing / Shipping / Registered / etc. |
| master.port_of_loading | Origin ports for shipping bills |
| master.port_of_discharge | Destination ports for packing lists (country_id ref) |

### Category 3: Trade & Commercial (8 leaves)
| Leaf | Description |
|---|---|
| master.segments | Business segments |
| master.hsn_codes | 8-digit HSN commodity codes with default GST rate |
| master.gst_percentage | GST tax slabs (0/5/12/18/28%) |
| master.currencies | Currency master with code, symbol, exchange_rate |
| master.uom | Units of Measurement (Kg, Box, Pcs, etc.) |
| master.packaging_material | Box / Carton / Wrap / etc. |
| master.conditions | Product storage conditions (Organic, Fresh, Frozen) |
| master.incoterms | Trade terms (FOB, CIF, EXW, etc.) |

### Category 4: Party & Classification (5 leaves)
| Leaf | Description |
|---|---|
| master.customer_types | Domestic / Export / etc. |
| master.customer_classifications | Tier labels with credit limits |
| master.vendor_types | Supplier categories |
| master.vendor_behaviour | Performance tags |
| master.applicable_types | Buyer / Consignee / Notify party roles |

### Category 5: Legal & Compliance (5 leaves)
| Leaf | Description |
|---|---|
| master.license_name | Import/export license categories |
| master.risk_levels | Risk severity tags (with action_required) |
| master.document_type | Document categories for upload |
| master.haz_class | GHS/UN hazard classes (with packing groups) |
| master.compliance_behaviours | Rules for regulated substances |

### Category 6: Operations & Support (3 leaves)
| Leaf | Description |
|---|---|
| master.assets | Company equipment + assets (AST-0001 code) — referenced by employee asset assignments |
| master.asset_categories | Group assets by type (system rows for Laptop/Mobile are pinned — Stage 1 employee setup reads them by name) |
| master.expense_category | Classify expenses with monthly_limit + yearly_limit |

### Category 7: P2P Masters (10 leaves)
| Leaf | Description |
|---|---|
| master.payment_terms | Credit days, advance %, milestone structure |
| master.approval_authority | Value thresholds for approvals (composite-unique on role_name + module_scope) |
| master.procurement_category | Goods/Services/AMC match logic (3-way / 2-way / 4-way) |
| master.sourcing_type | Direct / Open Market / Spot / Rate Contract |
| master.deviation_reason | Locked picklist for overrides |
| master.match_exception | Exceptions for 3-way match engine |
| master.advance_payment_rules | Max advance % per vendor type |
| master.exchange_rate_log | Date-wise rate history (composite-unique on currency_code + effective_date) |
| master.goods_service_flag | Switches GRN logic (goods vs service) |
| master.vendor_directory | Vendor info with email + segment + address |

### Category 8: Warehouse Masters (8 leaves)
| Leaf | Description |
|---|---|
| master.warehouse_master | All warehouses (Own / Third-Party) |
| master.zone_master | Storage zones (Cold Chain / Hazmat / Dispatch / etc.) |
| master.rack_type_master | Rack types (Pallet / Cool / Hazardous) |
| master.temp_class_master | Ambient / Cold Chain / Frozen classes |
| master.racks | Warehouse → Zone → Rack → Shelf hierarchy |
| master.shelf_master | Shelves/levels inside racks |
| master.digital_twin | Visual warehouse location view |
| master.freezers | Cold storage units (composite-unique on name + warehouse) |

### Category 9: Attendance Master Management (2 leaves)
| Leaf | Description |
|---|---|
| master.leave_type | Leave categories (Regular / Incident Based / Unpaid / Compoff) with short_code, is_sick_medical, paid_unpaid, gender_restriction. **Tenant-scoped.** |
| master.leave_plan | Leave plans with calendar_year, from_month_type, is_default. **Tenant-scoped.** |

### Plus 1 standalone (under HR sidebar)
| Leaf | Description |
|---|---|
| master.trigger_point | Document generation trigger modules (Onboarding/Offboarding/Event-Based). Tenant-scoped. |

### Master Dashboard (`/master`)
Card-grid view of all 50+ masters. Each card shows:
- Icon + name + category
- **Active / Inactive / Total** count badges (loaded in ONE batch via `GET /api/master-counts`)
- "Open" button → routes to `/master/:slug`

Permission-gated: only masters with `can_view=true` for the current user render. Sub-branch users see fewer masters.

### Generic MasterPage (`/master/:slug`)
Powered by a single component (`MasterPage.tsx` — 3719 lines) that reads `masterConfigs.ts` for the slug's field/column/seed definitions and renders:
- KPI strip (optional per-master)
- Search + filter bar (with master-specific filters like designation level, role type, etc.)
- TableContainer (react-table) with sorting + client-side pagination
- Add / Edit / View / Delete buttons (gated by per-master perms)
- Excel export (current view)
- DeleteConfirmModal (portal-based, dark backdrop, animated)
- Add/Edit modal — drives all 50+ master forms from one shell, using `masterConfigs.ts` to know which fields render

### CRUD endpoints
All masters share the same routes:
- `GET    /api/master/{slug}` — list (with `?search=` + branch filter auto-injected)
- `POST   /api/master/{slug}` — create
- `GET    /api/master/{slug}/{id}` — show
- `PUT    /api/master/{slug}/{id}` — update
- `DELETE /api/master/{slug}/{id}` — delete
- `GET    /api/master/{slug}/next-code` — auto-generated code preview (where applicable)

### Uniqueness model
The `uFields` array in `masterConfigs.ts` decides per-row uniqueness:
- **Single field** (`uFields=['code']`) → standard `Rule::unique` scoped by tenant
- **Composite** (`uFields=['role_name','module_scope']`) → server builds chained `Rule::unique(...)->where(...)->where(...)` so the COMBINATION must be unique (not each field independently — BUG-04 from the QA verification batch)
- **uEach** (`uEach=['name','code']`) → each field independently unique, case-INSENSITIVE (e.g. "india" vs "India" conflicts)

### Tenant scoping for masters
Same `applyScope()` pattern as employees:
- **super_admin** → sees everything
- **client_admin/user** → NULL client_id (global) + own client_id
- **main_branch_user** → NULL client_id + own client_id (all branches)
- **sub_branch_user** → NULL client_id + own client_id (only client-level NULL branch_id OR own branch_id OR main_branch_id rows)
- **employee** → same as sub_branch_user

### Hierarchical edit/delete
Same rule everywhere: lower-ranked user cannot edit/delete records created by higher-ranked. `super_admin=3 > client_admin=client_user=2 > branch_user=1`. Friendly 403 message tells you who created it.

### Inline sublists (legal_entities → banks)
The `LegalEntities` master is special — its form includes an embedded **banks[]** sublist (Bank Name / Branch / Account Number / IFSC / Account Type / is_primary). Saved in a single payload, server transactionally syncs the child `master_legal_entity_banks` table.

---

## 14. HR Module Deep Dive

The HR menu lives under a single root `hr` module (slug). Visible to `branch_user` only (by product call). Direct URL works for everyone with perms.

### HR Module Tree (32 entries)
```
HR (root)                                              perm: hr (parent)
│
├── HRMS Command Center                                perm: hr.command
│   ├── HRMS Overview                                  perm: hr.overview
│   ├── PIP                                            perm: hr.pip
│   └── HR Reports                                     perm: hr.reports
│
├── HR Core                                            perm: hr.core
│   ├── Recruitment                                    perm: hr.recruitment
│   ├── Employee                                       perm: hr.employee
│   ├── Employee Onboarding                            perm: hr.onboarding
│   └── Exit Management                                perm: hr.exit
│
├── Time & Pay Inputs                                  perm: hr.time_pay
│   ├── Payroll                                        perm: hr.payroll
│   ├── Calculation Master                             perm: hr.calculation_master
│   ├── Attendance                                     perm: hr.attendance (feature-flagged)
│   ├── Leave                                          perm: hr.leave
│   ├── Leave Approvals                                perm: hr.leave_approvals
│   └── Expense Management                             perm: hr.expense
│
└── Document & Evidence                                perm: hr.documents
    ├── Broadcast Centre                               perm: hr.broadcast
    ├── Document Templates                             perm: hr.doc_templates
    ├── Custom Fields                                  perm: hr.custom_fields
    └── Trigger Point Master                           perm: master.trigger_point
```

Permissions can only be granted on **leaf** modules. Parents are visual groups in the permission matrix.

### HRMS Overview (`/hr/overview`)
Backed by `GET /api/hrms/overview`. Single aggregate endpoint that powers the entire dashboard.

**KPI counters (6):**
- Active Employees
- New Hires This Month
- Open Positions (recruitments In Progress / Open)
- Pending Onboarding (invites with status=pending, not expired)
- Active Exits (employees with notice_date, not yet past last_working_day)
- Pending Expense Claims

**Breakdowns:**
- Headcount by department (top 8 + "Unassigned" rollup)
- Gender split
- Employment-status pie (Active / Inactive / On Leave / Probation / Notice Period / Resigned / Terminated)
- Recruitment by status
- Expense by status (Pending / Approved / Rejected)

**12-month trends:**
- Joining trend (employees with date_of_joining in window)
- Exit trend (last_working_day in window)

**Tables:**
- Recent Joiners (last 5 employees with date_of_joining ≤ today)
- Upcoming Joiners (date_of_joining > today + pending onboarding invites)

**Department turnover:**
- Per department: headcount + exits in last 12 months + turnover_pct = exits / headcount × 100

**Probation snapshot:**
- In Progress vs Completed (based on date_of_joining + probation_months)

**Top 5 expense categories** (by amount SUM, all statuses except Rejected).

**Master totals:** departments / designations / roles counts.

### HR Dashboard (`/hr`)
Backed by `HrDashboard.tsx` (428 lines). Shows the same KPIs plus a card-grid of HR sub-modules. Each card routes to the matching `/hr/<slug>` page or — for unfinished modules — to a `ComingSoonShell`.

### HR Employees module (`/hr/employees`)
Backed by `HrEmployees.tsx` — the **largest frontend file** at **5,640 lines**.

#### Tabs
- **Active** (default) — employees with status != 'Inactive' and not soft-deleted
- **Disabled** — soft-deleted employees (`withTrashed`) for re-enable

#### Per-row actions
- View Profile → `/hr/employees/:emp_code/profile`
- Edit Permissions → `/hr/employees/:emp_code/permissions`
- Edit (opens Add Employee wizard at last-completed step)
- Initiate Onboarding (opens 6-stage Onboarding modal)
- Disable / Re-enable (soft-delete / restore)
- Force Delete (only from Disabled tab — permanently removes Employee row, keeps User row locked)

#### Stats KPI strip
Total / Active / On Leave / On Notice / In Probation / Exited.

#### Add Employee Wizard (4 internal steps)
1. **Personal & Identity** — first_name (required), middle_name, last_name, gender (Male/Female/Other/Prefer not to say), date_of_birth, blood_group, nationality_country, work_country, email (login id — unique on users.email), official_email, mobile (E.164 regex), alt_mobile, current_address (line1/line2/city/state/country/pincode), permanent_address (same fields, "same as current" toggle)
2. **Job & Org** — legal_entity, location, department, designation, primary_role, ancillary_roles[] (multi-select, mirrors to `ancillary_role_id` for legacy compat), reporting_manager (picker with Employees + tenant login users), date_of_joining, probation_policy + months, notice_period + days
3. **Work Details** — leave_plan, holiday_list, attendance_tracking toggle, shift, weekly_off, attendance_number, time_tracking, penalization_policy, overtime, expense_policy, laptop_assigned + asset (FK to master_assets), mobile_device + asset, other_assets[] (FK array)
4. **Compensation & Finance** — enable_payroll, pay_group, annual_salary, salary_frequency, salary_effective_from, salary_structure (Range Based / Fixed), tax_regime (New / Old), bonus_in_annual, pf_eligible, detailed_breakup, salary_payment_mode (bank/cheque/cash), bank fields (name, account number, IFSC + regex, account_type, branch, UAN 12-digit, PAN regex), pf_deduction, esi_applicable, gratuity_nominee_name, agreed_ctc_lpa

#### Save semantics
- **Incremental save** — each Next click PATCHes the row and bumps `wizard_step_completed` (high-watermark: never decreases)
- **Resume on Edit** — Edit modal opens at `wizard_step_completed + 1`
- **Step 4 (Compensation) requires salary fields** when `enable_payroll=true` — else they're nullable
- **Duplicate guard** (`guardDuplicate`):
  1. Same mobile in tenant → 422 with conflicting employee name + emp_code
  2. Same (first_name + last_name + date_of_birth) → 422
- **Asset uniqueness** (`assertAssetsNotDoubleBooked`) — no asset can be assigned to two employees at once. Returns per-field error messages with conflicting employee name.
- **Dangling asset FK heal** — old rows with deleted asset refs strip silently on save (controller's `stripDanglingAssetRefs`)
- **Auto emp_code** allocation (EMP-001) inside `lockForUpdate` transaction
- **Welcome credentials email** sent on first create with bcrypt'd auto-generated 12-char password
- **Login provisioning** — creates paired `users` row with `user_type='employee'`, status='active'
- **Self-service permissions** seeded (`grantSelfServicePermissions`) — dashboard + profile only (admin grants more)

#### Initiate Onboarding modal (6 macro stages)
1. Setup wizard (Stage 1 — the 4-step wizard above)
2. Document Management (Stage 2 — Vault upload + verify)
3. Provisioning & Asset Setup (Stage 3)
4. Payroll & Finance Setup (Stage 4)
5. Policies & Agreements (Stage 5 — pending)
6. Final Verification & Activation (Stage 6 — pending)

`onboarding_stage_completed` is the macro watermark. Bumps automatically when sub-stage finishes:
- Stage 1's wizard fully done (`wizard_step_completed >= 4`) → onboarding_stage_completed = 1
- Stage 4's stamp date set → onboarding_stage_completed = 4

#### Employee record status enum
`Active / Inactive / On Leave / Probation / Notice Period / Resigned / Terminated`

When status flips to `Inactive / Resigned / Terminated` → paired `users.status='inactive'` + tokens deleted (auto-revoke). Anything else keeps login alive.

#### Employee soft-delete + restore + force-delete
- **Soft-delete (DELETE)** — `deleted_at` set, status auto-flipped to inactive, tokens revoked. Visible in Disabled tab.
- **Restore (PATCH /restore)** — clears `deleted_at`, sets status=Active, re-enables user login. From Disabled tab only.
- **Force-delete (DELETE /force)** — permanently removes Employee row. Refuses unless soft-deleted first (must Disable → then Force Delete from Disabled tab). User row is **NOT hard-deleted** (kept to preserve permission/activity_log FKs).

#### Eager-loaded relations on every read
14 relations preloaded: client, branch, creator, user, department, designation, primaryRole, ancillaryRole, legalEntity, workCountry, nationalityCountry, country, state, reportingManager, laptopAsset, mobileAsset, photoDocument.

#### Bulk operations (planned, partial)
- Excel export of current view
- Sample template download for import
- Bulk import (CSV with email/mobile dedup, per-row validation)

### Exit Management (`/hr/exit-management`)
Backed by `HrExitManagement.tsx` (2058 lines) + `ExitController.php`.

**One row per employee** in `employee_exits` table (unique on employee_id).

**Stage 1 — Exit Initiation & Approval** (currently the only stage):
- exit_type (Resignation / Termination / Retirement / End of Contract / Absconding / Other)
- initiated_by (Employee / HR / Manager)
- reason_for_exit (Better Opportunity / Personal Reasons / Higher Studies / Relocation / Health / Performance / Other)
- other_reason (free-text when "Other")
- notice_date
- last_working_day (must be after_or_equal to notice_date)
- reporting_manager_id (defaults to employee's RM, overridable)
- comments
- business_impact (Low / Medium / High / Critical)
- replacement_required (Yes Immediate / Within 30d / Within 90d / No)

**Endpoint:** `GET/PUT /api/employees/{employee}/exit` — upserts (PUT creates if not exists). Same-tenant guard enforced.

**Future stages** (placeholders in the UI, not yet wired):
2. Asset return
3. Clearance checklist
4. FnF (full and final settlement)
5. Knowledge transfer
6. Final exit interview + certificate

### PIP, HR Reports, AI Master, Payroll, Calculation Master
All have UI shells (`HrPIP.tsx` 3290 lines, `HrPayroll.tsx` 1288, `HrCalculationMaster.tsx` 1099) but the backend wiring is largely **placeholder / coming soon**. They render dummy data + design mockups for the eventual real implementation.

---

## 15. Employee Onboarding (Internal + Public)

Two parallel onboarding paths:

### Path A: Internal — Add Employee Wizard
Branch HR admin clicks "Add Employee" → 4-step wizard (described in Section 14) → directly creates Employee + User in one transaction → sends welcome credentials.

### Path B: Public — Self-service Onboarding Link
Branch HR admin issues an invite → candidate clicks emailed link → fills the form themselves on a public page → submits → Employee + User auto-created.

#### Step 1: Admin creates invite
`POST /api/employees/onboarding-invite` — admin enters:
- invitee_name (required)
- invitee_email (required — must not already exist on users.email)
- department_id (optional, pre-fills the form)
- expected_join_date (optional)
- expiry_days (3 / 7 / 15 / 30 — default 15)
- app_origin (optional — caller-supplied SPA URL so the link goes to the right host)

Server:
1. Validates email isn't already on a user
2. Generates 64-char URL-safe token (Str::random with retry loop on rare collision)
3. Inserts `employee_onboarding_invites` row with status=`pending`, expires_at = now + N days
4. Sends `OnboardingInviteMail` with `{base}/onboarding/{token}` link (base = app_origin > APP_FRONTEND_URL > APP_URL)

Returns the invite + URL so the admin can copy-paste if email fails.

#### Step 2: Candidate views invite
`GET /api/onboarding/{token}` — public endpoint (no auth). Returns:
- Invite preview (name, email, department, expected_join_date, org_name, logo_url, website)
- Master dropdowns scoped to the inviting tenant (countries, states, departments, designations, roles, legal_entities)

**Statuses that return 410:**
- `completed` — link already used
- `cancelled` — admin cancelled
- `expired` — expires_at passed (auto-marked on read if was still `pending`)

If status is good, the SPA renders the `PublicOnboarding` page — a 3-step wizard:
1. **Personal** — first/middle/last names, gender, DOB (≥18 years), mobile + alt_mobile, work_country, nationality
2. **Address** — current + permanent (with "same as current" toggle), pincodes 4-10 digits
3. **Job** — department, designation, primary_role, legal_entity, location, joining_date

**Draft auto-save:** Every change writes to `localStorage` key `cbc:public-onboarding-draft:<token>` so a candidate can close the tab and resume. Restored from invite defaults + saved draft on reopen.

#### Step 3: Candidate submits
`POST /api/onboarding/{token}/complete` — public endpoint. Server validates payload (name regex, mobile regex, pincode regex, age ≥18), then in one transaction:

1. Validates invite still usable (status=pending, not expired)
2. Creates `users` row with bcrypt-hashed 12-char password, user_type=employee
3. Allocates emp_code per tenant
4. Creates `employees` row stamped with invite's client_id + branch_id
5. Updates user's employee_code
6. Grants self-service permissions (dashboard + profile + master.employees + creator's master.* perms — so dropdowns load)
7. Marks invite `status=completed`, sets `employee_id`, `completed_at = now`
8. Sends `WelcomeCredentialsMail` with login URL + plaintext password
9. Returns `{message, employee: {id, emp_code, display_name}}`

#### Race conditions handled
- **Token reuse race** — two tabs submitting the same link: first wins, second hits 410 from the `status !== 'pending'` check
- **Email collision** — caught by Postgres unique violation (SQLSTATE 23505), wrapped to friendly 422
- **Auto-expire** — `GET show()` auto-flips status to `expired` if expires_at passed

#### HrEmployeeOnboarding page (`/hr/employee-onboarding`)
Branch admin lists all employees + invites in one view. Shows onboarding progress per employee (current macro stage / 6). Lets admin re-send invite, cancel invite, or directly initiate onboarding for an existing employee.

Also includes the **6-stage Onboarding modal** (covered in Section 14) for incremental stage completion.

---

## 16. Recruitment & Candidate Workflow

### Hiring Request → Recruitment → Candidates → Selection

Three-stage pipeline:

#### Stage 1: Hiring Request (internal proposal)
`HiringRequestController` — POST /api/hiring-requests.

**Form sections:**
1. **Basics** — title, job_role, department_id, team, requested_by_name, request_date
2. **Hiring Need** — openings, employment_type (Full-time / Part-time / Contract / Intern), work_mode (Onsite / Remote / Hybrid / Flexible), urgency (Low / Medium / High / Critical)
3. **Role Details** — job_description, daily_responsibilities, required_skills, required_experience, required_qualification, preferred_profile
4. **Business Justification** — request_type (New Position / Replacement / Backfill / Expansion / Intern / Urgent Temporary), business_justification, hiring_need_reason, current_team_gap, what_if_not_filled

**Auto-code:** HRQ-001 (per-tenant).
**Statuses:** Draft / Submitted / Under Review / Approved / Sent Back / Rejected.

**Duplicate guard:** Same (title + department_id) within tenant → 422.

**Auto email to reporting manager** on submit (`HiringRequestCreatedMail`) — best-effort, logged on failure.

#### Stage 2: Recruitment (Approved hiring request becomes a recruitment)
Once a hiring request is approved, HR creates a **Recruitment** record (REC-001 per tenant).

**Form fields:** job_title, department_id, designation_id, primary_role_id, employment_type, openings, experience, work_mode, ctc_range, priority, hiring_manager_id, assigned_hr_id, start_date, deadline, job_description, requirements, post_on_portal, notify_team_leads, enable_referral_bonus.

**Statuses:** In Progress / Completed / Cancelled.

**Cannot mark "Completed"** unless `Selected` candidate count ≥ openings (`guardStatusTransition`).

#### Stage 3: Candidates (apply to a recruitment)
`CandidateController` — full CRUD over `candidates` table linked to `recruitment_id`.

**Form fields:**
- Personal: name, email, mobile, current_address, qualification
- Experience: experience_years (decimal), mode_of_transport (Walk/Bicycle/Two-wheeler/Four-wheeler/Public Transport/Other), distance_km
- Salary: current_salary_lpa, expected_salary_lpa, notice_period (Immediate / 15 Days / 30 / 45 / 60 / 90 Days)
- Source: source (LinkedIn / Naukri / Indeed / Referral / Company Website / Walk-in / Recruitment Agency / Internal / Other)
- CV: file upload (PDF/DOC/DOCX up to 10MB), stored as `candidates/<client>/<recruitment>/<random>.<ext>`

**Status pipeline (8 stages):**
Applied → Shortlisted → In Interview → Final Interview → Selected → Offered → Rejected / On Hold

**Bulk import** (`POST /api/candidates/import`) — CSV upload with:
- Per-row validation (only name is hard-required)
- Duplicate skip (same email under same recruitment)
- Header re-order tolerance (column name matching)
- Per-row error reporting (`{row, message}`)

**Export** (`GET /api/candidates/export`) — CSV with filters honored (status/source/search/recruitment_id), includes "ids[]" for "Current View Only" exports.

**CV download** — auth via query token (`?token=<sanctum>`) so plain `<a>` clicks work without Authorization header. Route OUTSIDE sanctum middleware.

**Status patch** (`PATCH /api/candidates/{id}/status`) — captures rejection_reason + status_notes for audit trail. **Hard cap:** Cannot select more than `recruitment.openings` candidates.

**Stats endpoint** (`GET /api/candidates/stats`) — single grouped query returning per-status counts.

**Summary endpoint** (`GET /api/recruitments/{recruitment}/candidates/summary`) — returns parent recruitment context for the candidate list page.

### HrRecruitment page (`/hr/recruitment`)
Card-grid view of open recruitments with status pills + opening count + priority badge. Click → `/hr/recruitment/:id/candidates`.

### HrCandidates page (`/hr/recruitment/:id/candidates`)
Table view with filters (status / source / search) + KPI stats strip + Add Candidate modal + Import button + Export button. Inline action buttons for selection (✓ green) / rejection (✗ red) trigger `CandidateConfirmModal` with optional reason.

---

## 17. Attendance & Face Biometric

Multi-punch face-driven attendance ledger.

### Data model
Two-table model:
- **`attendances`** — one row per (employee, date). Holds first_in / last_out denormalized for cheap list reads.
- **`attendance_punches`** — one row per tap. Strictly alternating direction (in → out → in → out, enforced server-side).

### Face Biometric (consent + enrolment)
Stored in `employees` table:
- `face_descriptor` — JSON array of 128 floats (face-api.js output)
- `face_registered_at` — timestamp
- `face_consent_given_at` — first enrolment timestamp (preserved across re-enrolments)
- `face_consent_revoked_at` — set on revoke (audit trail)

**Endpoints:**
- `GET /api/face/status` — returns enrolment state (registered flag + timestamps + photo_url) — never returns the raw descriptor
- `POST /api/face/register` — requires `consent=true` + 128 floats. Blocks if face matches another employee in same tenant (`findDuplicateOwner`, threshold 0.50 Euclidean)
- `DELETE /api/face/data` — revoke + wipe descriptor

**Frontend flow** (`FaceRegistrationModal.tsx`):
1. Loads face-api.js lazily (~1MB bundle deferred to first mount)
2. Loads weight models from `/face-models/` (self-hosted) — tinyFaceDetector + faceLandmark68Net + faceRecognitionNet
3. HTTPS gate — `getUserMedia` only works on https or localhost (clear error message otherwise)
4. Consent disclosure on first enrolment
5. Camera capture (480×360, facingMode=user)
6. Single-face detection → 128-d descriptor → preview canvas
7. POST to backend with descriptor + consent flag

### Attendance punch flow
`POST /api/attendance/face/clock-in` (or `/clock-out`):
1. Validates payload (`descriptor` 128 numerics, optional `label`, `lat`/`lng`)
2. Resolves caller's Employee row (must have face enrolled)
3. Computes Euclidean distance between captured + stored descriptor
4. If `distance > 0.55` → 422 with friendly retry message
5. Inside DB transaction:
   - `lockForUpdate` on today's Attendance row (or create it with status='Present')
   - Find last punch → determine `next_direction` (alternating)
   - If caller's `expected` direction doesn't match → 422 with hint (server-truth, never client-trusted)
   - Insert AttendancePunch with method='face' + match_distance + ip + lat/lng
   - Call `recomputeSummary()` to update parent row's check_in_at / check_out_at / methods / locations from punches table
6. Return `{message, matched: true, distance, punch, record, next_direction}`

### Read endpoints
- `GET /api/attendance/today` — today's row + punch timeline for caller (employee self-service)
- `GET /api/attendance/my` — caller's history (paginated)
- `GET /api/attendance` — HR/admin tenant-scoped list with filters (date, from/to, employee_id, status)
- `GET /api/attendance/employee/{id}/summary` — month view per employee (used by EmployeeProfile attendance tab)
- `GET /api/attendance/daily-view` — full HR Daily View page payload (every attendance-tracked employee × today's status + month KPIs + 30-day history)

### Display timezone (`Asia/Kolkata`)
**Hardcoded** in `AttendanceController::DISPLAY_TZ`. App stores UTC; every displayed time is converted before formatting. The `todayLocal()` helper picks today's date in IST so a 1 AM IST punch doesn't land on the previous calendar day.

### Status promotion
Face-clock flow always writes `status='Present'` on first punch (it doesn't know about shifts). `resolveDayStatus()` then promotes to `Late` at read time when first-in is >10 min past shift_start. Same heuristic in `buildHistoryLogs`.

### Shift parsing
`parseShiftWindow()` extracts HH:MM-HH:MM from shift strings like "General (09:00 – 18:00)". Accepts both en-dash and hyphen. Returns `[null, null]` if unparseable — caller falls back to 09:30-18:30 defaults.

### Weekly off parsing
`parseWeeklyOff()` reads "Sun" / "Sat, Sun" / etc. Defaults to **Sunday only** when unparseable.

### Compliance %
`(present_days / tracked_days) × 100` where tracked includes ALL days with attendance row. Missing-punch days drag this down naturally.

### Late minute heuristic
`Late` flag fires when local first-in > shift_start by >10 min. Histroric `lateMarks` count uses same threshold.

### HR Attendance page (`/hr/attendance`)
Feature-flag gated (`FEATURE_FLAGS.hrAttendance = true`). 1745-line component (`HrAttendance.tsx`).

**Two main views:**
1. **Daily View** — Day-by-day branch attendance grid with face-status pills (Present / Late / Half Day / Missing In / Missing Out / Weekly Off / Holiday / On Duty / WFH / Absent / Leave / Corrected)
2. **Approvals Queue** — Pending regularization requests

**Regularization request flow** (frontend-driven, backend partially wired):
- Modes: "adjust" (edit punch list) / "exempt" (no time edits, just request day be excluded from late/absent)
- Per-punch edits: add / edit / keep / delete with oldIn/oldOut/newIn/newOut
- Multi-select work_locations (Baner Office / Wakad Office / WFH / Client Site / Field Visit)
- Reason text
- Manager → HR approval chain

---

## 18. Leave Management (Multi-level approval)

Full Keka-style leave system. Three-table model: **Leave Type Master** → **Leave Plan** → **Leave Request**.

### Leave Type Master (`/master/leave_type`)
Catalog of leave categories. Tenant-scoped (per branch).
- name (Sick / Casual / Paid / Floater / Maternity / Comp Off / Loss of Pay)
- short_code (SL / CL / PL / FL / ML / CO / LOP)
- type (Regular / Incident Based / Unpaid / Compoff)
- paid_unpaid (Paid / Unpaid)
- is_sick_medical (bool)
- gender_restriction (None / Male / Female)
- status (Active / Inactive)

**Cascade delete:** When a leave type is deleted, all `leave_plan_leave_types` pivot rows for that type are also removed (model `booted` hook).

### Leave Plan Master (`/master/leave_plan` and `/hr/leave-plans`)
Tenant-scoped Keka-style plan. Each plan owns assigned leave types (with per-pair Setup config) + assigned employees.

**Plan fields:**
- plan_name
- description
- from_month_type (Calendar / If Joining)
- from_month (January…December — when Calendar)
- calendar_year
- policy_explanation_mode (System / Custom)
- policy_doc_path (upload for Custom)
- is_default (one default per (client_id, branch_id))
- status (Active / Inactive)

### Leave Plan operations
- **Clone** (`POST /leave-plans/{id}/clone`) — replicate plan + assigned types + their config (NOT employees)
- **Make Default** (`POST /leave-plans/{id}/make-default`) — unsets other defaults in same branch
- **Assign Types** (`POST /leave-plans/{id}/types` with `mode=replace|append`)
- **Remove Type** (`DELETE /leave-plans/{id}/types/{typeId}`)
- **Save Type Config** (`PUT /leave-plans/{id}/types/{typeId}/config`)
- **Assign Employees** (`POST /leave-plans/{id}/employees`) — upserts unique-on-employee_id (one plan per employee)
- **Remove Employee** (`DELETE /leave-plans/{id}/employees/{employeeId}`)
- **Leave Balances** (`GET /leave-balances`) — aggregated employee × leave_type matrix with quota/used/available

### Type Setup (the 6-tab popup)
Persisted as JSON in `leave_plan_leave_types.config_json`. Tabs:

1. **Accrual** — unit (days/hours), unlimited toggle, yearlyQuota, mode (periodic/attendance/immediate), frequency (monthly/quarterly/half_yearly/yearly), dayOfMonth, variesEachMonth, leaveExpires rules, restrictByAttendance, noAccrualIfOnLeaveFor, noAccrualIfBalanceExceeds, noAccrualIfJoiningAfter, managersCanGrantExtra, employeeOverdraft, accrueByTenure
2. **Leave Application** — allowHalfDay, priorNoticeNeeded, limitBackdated, backdatedWithin/Before, roundBalances, commentMandatory, preventSelfApply, attachmentsAfter, earliestApply, cannotUseSameYear, preventFutureExpected, minIfBalanceMore
3. **Approval** — chain[] — multi-level approval chain with skip rules
4. **Year End** — carry-forward / encashment / wipe rules
5. **Probation** — quota during probation
6. **Notice Period** — quota during notice

### Approval Chain (multi-level)
Each chain entry:
```json
{
  "level": 1,
  "approver_kind": "reporting_manager" | "role" | "user" | "employee",
  "approver_role": "hr" | "branch_admin" | "reporting_manager" | null,
  "approver_user_id": int | null,
  "approver_employee_id": int | null,
  "label": "...",
  "skip_if": {"days_lt": 2}  // optional
}
```

**Snapshotted at submission** — chain stored on `leave_requests.approval_chain` JSON. Changing the plan's chain later does NOT reroute in-flight requests.

**Skip rules** (auto-skip levels at submission):
- `days_lt`, `days_lte`, `days_gt`, `days_gte` thresholds

**Self-loop guard** — chain levels resolving to the requester themselves are auto-marked Skipped at snapshot time:
- `reporting_manager` resolving to self
- `role=reporting_manager` where employee.reporting_manager_id = employee.id
- Explicit approver_employee_id pointing at requester
- Explicit approver_user_id matching requester's user_id

**Deleted approver guard** — if `approver_employee_id` no longer exists in DB, level is auto-skipped with a logged reason.

### Leave Request (`/hr/leave` employee-side + `/hr/leave-approvals` manager-side)
**Submit fields:**
- employee_id (admin can file on behalf)
- leave_type_id
- from_date, to_date (to ≥ from)
- day_type (full / first_half / second_half — half-day only single calendar day)
- reason, attachment_path
- notify {manager, hr, employee_ids[]}
- handover_required + cover_person_id + handover_notes + critical_tasks
- avail_on_call + emergency_number + avail_note

**Submission guards:**
- **Past-date guard** — `from_date < today` blocked (no backdating without dedicated Adjustments path)
- **Half-day single-day guard** — half-day across multiple days blocked
- **Tenant guard** — cover_person_id + notify.employee_ids[] must all be in same tenant
- **Plan assignment required** — employee MUST be assigned to a leave plan
- **Type in plan required** — selected leave_type_id must be in the assigned plan
- **Overlap guard** — no overlapping Pending or Approved requests for same employee

**Auto-approval** when every chain level is Skipped by rule (comment: "Auto-approved — every chain level was skipped by rule").

**Notifications fired:**
- Submit → notify every approver at level 1 + cc'd colleagues from notify.employee_ids[]
- Approve at non-final level → notify next level
- Approve at final level → notify requester (Approved)
- Reject at any level → notify requester (Rejected)
- Cancel → notify current-level approver

### Approval / Rejection
`POST /api/leave-requests/{id}/approve` or `/reject`:
- Validates status='Pending'
- Validates caller `canActOnLevel()` OR is admin override (super_admin / client_admin / branch_user)
- Records decision on chain entry (acted_by, acted_at, comment)
- Reject → status='Rejected' immediately
- Approve → `firstActionableLevel(level+1)` walks past Skipped levels; if past end → status='Approved'

### Cancel
`POST /api/leave-requests/{id}/cancel`:
- Only requester (or admin role) can cancel
- Only Pending requests can be cancelled
- Notifies current-level approver to drop from queue

### Approvers list (`GET /leave-requests/{id}/approvers`)
Hydrated chain with resolved names + emails + status + acted_at + is_current flag. Backward-compat fallback to single Reporting Manager line for pre-migration requests.

### Backend approvals filter (`GET /leave-requests/approvals`)
For non-admin approvers, a wide SQL filter:
```sql
WHERE employee_id IN (SELECT id FROM employees WHERE reporting_manager_id = :myEmployeeId)
   OR approved_by = :myUserId
   OR approval_chain ILIKE '%"approver_user_id":<myUserId>%'
   OR approval_chain ILIKE '%"approver_employee_id":<myEmployeeId>%'
```
Then PHP-side `canActOnLevel` post-filter for per-level precision. (Fragile if JSON key order changes — known QA risk.)

### Leave Approvals page (`/hr/leave-approvals`)
HrLeaveApprovals.tsx (486 lines). Filters: status (Pending / Approved / Rejected / Cancelled / All), search. Click any row → details modal with full chain + Approve/Reject buttons + comment field.

### Leave page (`/hr/leave`)
HrLeave.tsx (1781 lines). Employee-facing view of their own leave + history. Apply Leave button opens `RequestLeaveModal` (slide-in drawer style).

### Inbox page integration
Pending leave approvals also surface in the global Inbox (`/inbox`) above signature tasks. Inline Approve/Reject buttons per row.

---

## 19. Expense Claims (2-stage approval)

`ExpenseClaim` entity — employee submits → reporting manager approves/rejects → HR/Finance approves/rejects.

### Submit (`POST /api/expense-claims`)
Employee files a claim with:
- category_id (FK to master_expense_categories)
- currency (default INR)
- project (free text)
- payment_method (free text — Cash / Card / UPI / etc.)
- title (required)
- amount (required)
- expense_date (required)
- vendor (optional)
- purpose (free text)
- attachments (multipart `files[]` — stored under `expense_claims/<employee_id>/`)

**Auto-claim-no:** EXP-0001 per tenant (`nextClaimNo`).

**No-manager fast path:** If employee has no `reporting_manager_id`, `manager_status='approved'` is auto-stamped on create with comment "Auto-approved · no reporting manager assigned". Claim moves straight to HR stage.

**Self-only filing rule:** Non-super_admin can only file for their own Employee record.

### Manager Stage
- `POST /expense-claims/{id}/manager-approve` — only assigned manager (or super_admin) can act
- `POST /expense-claims/{id}/manager-reject` — same. On reject, overall status flips to 'rejected' immediately (no HR stage needed)
- Optional `comment` captured (max 1000 chars)

Refuses to act if `manager_status !== 'pending'` (409 Conflict).

### HR/Finance Stage
- `POST /expense-claims/{id}/hr-approve` — requires `hr.expense` module + `can_approve` permission
- `POST /expense-claims/{id}/hr-reject` — same gate
- HR cannot approve until manager has approved (409 if manager_status != 'approved')
- HR stage is final — sets overall status

### Scope filtering (`GET /expense-claims?scope=mine|team|all`)
- **mine** — claims where employee_id = caller's Employee.id (default)
- **team** — claims where manager_id = caller's Employee.id
- **all** — every claim in tenant (requires HR perm)

Admin viewing another's profile passes explicit `employee_id` / `employee_code` to override the default.

### Tenant scope
Complex `ensureTenantAccess` + `applyTenantScope`:
- super_admin → all
- client_admin/user → same client_id
- main_branch_user → all branches of client
- sub_branch_user / employee → own branch + main_branch + globally-owned + own claims + claims where I'm the manager

### Attachment download
`GET /api/expense-claims/{id}/attachments/{index}` — query-token auth (`?token=<sanctum>`). Lives OUTSIDE sanctum middleware for plain `<a>` clicks.

### Status rollup
Single overall `status` column derived from manager + HR:
- manager_status='rejected' OR hr_status='rejected' → status='rejected'
- Both approved → status='approved'
- Otherwise → status='pending'

### HrExpenseManagement page (`/hr/expense`)
Tabs based on scope. Reuses `ExpenseClaimsTable` component (746 lines) for the row layout. Per-row 3-dot dropdown opens audit-log popover with three timeline rows (Created → Manager → HR/Finance). Inline Approve/Reject buttons appear contextually based on mode + caller's permissions.

### EmployeeProfile Expense tab
Same ExpenseClaimsTable in `mode='mine'`. Employee can file new claims via "Raise Expense" button → modal.

---

## 20. Document Templates & Signing Workflow

End-to-end document automation: build a template → resolve placeholders → send for signature → audit trail → PDF/DOCX output.

### Template Master (`/hr/doc-templates`)
`hr_document_templates` table. Auto-code format: **`<CAT>-<ROLE>-<NNN>`** (e.g. `IT-INT-001`, `NIT-EMP-002`, `LGL-HOD-003`). Sequence isolated per (client_id, branch_id, category, role) tuple.

**Categories:** IT / Non-IT / Legal
**Role types:** Director / CEO, Head of Department (HOD), Team Leader, Executive, Employee, Intern / Trainee (mirrors designation level master)

**Form fields:**
- name, description, employee_category, role_type, doc_type, trigger_point_id (FK to master_trigger_points)
- version (default v1)
- Flags: is_mandatory, requires_signature, requires_manager_approval, include_in_audit
- signing_mode (Sequential / Parallel)
- signers[] — `{role_id, role_name, designation_id, designation_name, action, days}`
- editor_mode (web / word)
- content_html (TipTap rich text)
- header_config (JSON) — logo_path, title, subtitle, align, background, text_color, show_logo, logo_height, logo_pos, title_pos
- footer_config (JSON) — text, align, background, text_color, show_page_number, page_number_align, page_number_format
- docx_path / docx_original_name (optional uploaded Word file)
- status (Draft / Active / Deprecated)

### Template Editor (`/hr/doc-templates/new` and `/edit`)
Multi-step wizard with:
1. **Basics** — name, category, role, doc type, trigger point
2. **Header & Footer** — visual editor for logo upload + title + subtitle + page numbering
3. **Body** — TipTap rich-text editor with placeholder chip palette
4. **Signers** — multi-row builder (role + designation + action + SLA days)
5. **MS Word path** — alternative DOCX upload + download / round-trip

### Placeholder tokens
Token format: `{{TokenName}}`. Two categories:

**Employee-data tokens** (hard-coded in EMPLOYEE_TOKENS):
FirstName, MiddleName, LastName, FullName, DisplayName, EmployeeNumber, Email, Mobile, Address, City, State, JobTitle, Department, Designation, JoiningDate, ReportsTo, CTC, Basic, HRA, CompanyName, CompanyAddress, CompanyLogo

**Custom Fields** (defined per-tenant in `hr_custom_fields`):
- PascalCase name (`/^[A-Za-z_][A-Za-z0-9_]*$/`)
- type (text / date / number / textarea)
- description + used_in_hint
- Unique per (client, branch, name)
- Cannot delete a custom field if referenced in any template (server scans content_html)

**Signer tokens** (positional):
- `{{SignerNName}}`, `{{SignerNDesignation}}`, `{{SignerNDate}}`, `{{SignerNSign}}`

### Token validation (`POST /hr-custom-fields/validate-tokens`)
Editor sends content_html → server strips tags → finds all `{{X}}` → splits into known vs unknown. Unknown list drives "Add as Custom Field" CTA pre-filled with each name.

### Header logo upload
`POST /hr-document-templates/upload-header-logo` — works pre-save (no template id needed), stages under `doc_templates/c<client>/logos/`. Path travels in main save payload.

### Match templates to an employee
`GET /hr-document-templates/match?employee_id=N` — returns Active templates where:
- `employee_category` = department-mapped category (IT / Non-IT / Legal, derived via `mapDepartmentToCategory()` keyword match)
- `role_type` = designation.level (one of 6 canonical levels)

### Preview for an employee (`GET /hr-document-templates/{id}/preview?employee_id=N`)
Returns:
- rendered_html (with tokens substituted)
- header_config + footer_config
- tokens_used (list)
- tokens_missing (unresolved tokens — drives warnings before generation)

### Generate filled DOCX (`GET /hr-document-templates/{id}/generate?employee_id=N`)
Resolves all tokens against employee data → clones template with substituted HTML → renders via `HrTemplateDocxRenderer::render()` → streams as `{employee_name} - {template_name}.docx`.

### Generate Document (3-step wizard at `/hr/doc-templates/:id/generate`)
For bulk generation across multiple employees:
1. **Step 1** — Pick employees (multi-select)
2. **Step 2** — Fill custom_values (operator-entered overrides per employee)
3. **Step 3** — Live preview + bulk generate

**Bulk generate** (`POST /hr-generated-documents`):
- Validates every employee in scope (in-transaction)
- Renders HTML with all tokens substituted + bolded for operator-entered values
- Inserts one `hr_generated_documents` row per employee with rendered_html + custom_values + resolved_vars

**Generated document statuses:**
Draft → Generated (Phase 1) → Sent → Viewed → Acknowledged → Signed (Phase 2 — placeholders)

**Download** (`GET /hr-generated-documents/{id}/download`) — non-persisted clone with content_html swapped for rendered_html → `HrTemplateDocxRenderer::render()` → streams DOCX named `{template_code}-{employee_code}.docx`

### Signing Workflow Runtime
`hr_document_signatures` table — one row per "send" of a template against an employee.

**Statuses:** Pending → In Progress → Completed (or Rejected / Cancelled)

**Send** (`POST /hr-document-signatures`):
1. Resolves template + employee
2. Builds resolved signers[] — maps each template signer's `role_name` to a real user_id via `resolveSignerUser()`:
   - "Reporting Manager" → employee.reportingManager
   - "Employee" → the subject employee
   - "CEO" / "Client" → first client_admin in same client
   - Otherwise → placeholder (admin can re-assign later)
3. Freezes content_html — runs `buildTokenContext()` + `resolveTokens()` to substitute all `{{Tokens}}` so later template edits don't retroactively change the run
4. Creates signature row with status=Pending, current_index=0, audit_log=[sent event]

**Take action** (`POST /hr-document-signatures/{id}/action`):
- Validates `action` in [Sign, Approve, Acknowledge]
- Only the CURRENT signer (resolved user_id matches caller) can act (403 otherwise)
- For Sign:
  - Requires `signed_name` (typed name, max 120 chars)
  - Optional `signature_image` (base64 data URL — PNG/JPG/GIF/WEBP/SVG up to 4MB)
  - Image persisted via `persistSignatureImage()` to `doc_templates/c<client>/signatures/`
  - Replaces `{{SignerNSign}}` in content_html with `<img>` of saved signature OR cursive-rendered name (Brush Script MT fallback)
  - Replaces `{{SignerNDate}}` with today's date
- For Approve/Acknowledge:
  - Captures optional `note`
  - No HTML mutation
- Updates current signer's state (status='Done', acted_at, signed_name, note)
- Advances `current_index` to next signer (or marks Completed if last)
- Appends event to audit_log

**Reject** (`POST /hr-document-signatures/{id}/reject`):
- Requires `reason` (max 500)
- Only current signer can reject
- Halts workflow (status='Rejected')

**Cancel** (`POST /hr-document-signatures/{id}/cancel`):
- Only sender (created_by) or super_admin / client_admin can cancel
- Sets status='Cancelled', appends audit event

### SignaturePad component (`/components/ui/SignaturePad.tsx` — 529 lines)
3-tab signature input:

1. **Type tab** — Gallery of 6 Google Fonts (Caveat / Dancing Script / Great Vibes / Sacramento / Pacifico / Allura). User picks a font; component renders the name into a canvas → PNG data URL. Auto-shrinks font size if name doesn't fit.
2. **Draw tab** — Pointer-event canvas (mouse/finger/stylus). Pencil cursor. Clear button. ResizeObserver re-sizes canvas + clears on container resize.
3. **Upload tab** — File picker + drag-drop zone. Accepts PNG/JPG/GIF/WEBP/SVG up to 4MB. Image preview with Remove button.

Single PNG data URL bubbles up to parent regardless of which tab was used. Backend gets one base64 image to persist.

### Final output
**Download signed DOCX** (`GET /hr-document-signatures/{id}/download`) — renders current content_html (with all collected signatures baked in) as DOCX.

**Download signed PDF** (`GET /hr-document-signatures/{id}/download-pdf`) — pipes through DomPDF. **Inlines all `/storage/...` `<img>` URLs as base64 data URIs** (via `inlineLocalImagesAsDataUris`) because DomPDF runs headless and can't fetch over HTTP. Header logo similarly inlined.

**Email to employee** (`POST /hr-document-signatures/{id}/email-employee`) — only when status=Completed. Builds DOCX attachment + sends via `SignedDocumentMail` to employee.email. Logs audit event.

**Per-employee signed docs** (`GET /employees/{slug}/signed-documents`) — accepts numeric id OR emp_code. Defaults to status=Completed. Drives the Vault → Signed Company Documents section on EmployeeProfile.

### Inbox & My Team integration
- **Inbox** (`/inbox`) — shows pending signatures where current_index points at the caller's user_id
- **My Team → Approvals tab** — same data but scoped to "my visible team" (direct reports for employee-managers, all branch/client for branch/client users)








