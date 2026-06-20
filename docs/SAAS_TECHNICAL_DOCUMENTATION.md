# Cross_Border_Command — Technical Documentation

> The technical sheet: stack, architecture, request lifecycle, data model, the data-visibility engine (in depth), and infra.
> Audience: engineers + QA who need to know *how* it works under the hood.
>
> _Last updated: 2026-06-04._

---

## 1. Stack (exact, with corrections to CLAUDE.md)

### Backend
- **PHP 8.2+**, **Laravel 12** (`laravel/framework: ^12.0`)
- **Laravel Sanctum 4** — token auth (tokens in `localStorage`, no refresh token)
- **Database: PostgreSQL** — `.env` `DB_CONNECTION=pgsql`, DB `c_b_c` on port 5432. ⚠️ CLAUDE.md says MySQL/XAMPP; the live config is Postgres. PG advisory locks actually fire (used for code allocation).
- Key packages: `barryvdh/laravel-dompdf` (PDF), `phpoffice/phpword` (DOCX), `razorpay/razorpay`, `google/apiclient`, `chillerlan/php-qrcode`, `milon/barcode`, `league/flysystem-azure-blob-storage`
- **PHPUnit 11** — scaffolded only; tests are stubs, no real coverage.

### Frontend
- **React 19 + TypeScript 6**, **Vite 7** (build output → `public/build`, **not** `resources/dist`)
- **React Router 7**, **Redux Toolkit 2** (Velzon theme/UI state only — business data goes through Context + Axios)
- **Bootstrap 5.3 + reactstrap + Tailwind 4** (mixed; Velzon admin template is the base)
- **TipTap 3** (CLM rich text), **face-api.js 0.22** (browser face descriptors), **Recharts 3**, **@tanstack/react-table 8**, **xlsx**, **pdfjs-dist**, **sweetalert2**

### Runtime drivers (infra)
- cache / queue / session drivers all **`database`** (no Redis)
- mail **smtp**
- queue: `php artisan queue:listen` (jobs table). Lead sync is **manual**, not cron.
- SPA served via `welcome.blade.php`.

---

## 2. Architecture

```
React 19 SPA (resources/js/)
  - Contexts: Auth, BranchSwitcher, Settings, Confirm, Toast, Layout, Theme, Variant
  - Axios client (resources/js/api.ts):
      · injects Authorization: Bearer <sanctum_token>
      · auto-injects ?branch_id=<active> on GETs
      · 401 → wipe token, redirect /login
        │  HTTPS / JSON
        ▼
Laravel 12 API (routes/api.php → app/Http/Controllers/Api/*)
  Middleware: auth:sanctum → user.active (EnsureUserActive)
  Controllers scope by client_id (always) + branch_id / MasterVisibility
  Services: RazorpayService, ZohoSignService, IndiaMartLeadSyncService,
            ConsigneeKycMirror, HrTemplateDocxRenderer, AnnouncementMailer,
            InvoiceMailer, BrandingResolver
        │
        ▼
PostgreSQL (228 migrations) + local public disk / Azure Blob; DB queue

External: Razorpay · Zoho Sign · Google OAuth · IndiaMart · Azure Blob
```

### Request lifecycle (authenticated GET)
1. React fires `api.get('/customers')`.
2. Axios interceptor adds `Authorization: Bearer <token>` + `?branch_id=<active>`.
3. `auth:sanctum` → `user.active` middleware.
4. Controller resolves `auth()->user()`, derives `client_id` (always) and applies `MasterVisibility::applyReadScope()` (or a flat client/branch scope) to the Eloquent query.
5. JSON returned; on 401 the response interceptor wipes token → `/login`.

---

## <a id="data-visibility"></a>3. DATA VISIBILITY ENGINE (in depth)

**File:** [app/Support/MasterVisibility.php](../app/Support/MasterVisibility.php). Models expose it via a `scopeForUser($user)` query scope (Customer, Consignee, Vendor, ClmSignatureRequest, master models). This is the authoritative answer to "who sees what". Every branch is an equal, isolated peer.

### 3.1 Tenant tree & tiers
```
Client
 └── Branches (all equal, isolated peers — no privileged "main")
       ├── Branch branch_user  (branch admin — scoped to own branch)
       └── Branch employees    (peer-isolated)
```
Tier constants: `super=5 > client=4 > branch=2 > none=0`.

### 3.2 READ scope — `applyReadScope(Builder $q, $user, ?int $branchFilter)`

The method short-circuits per role:

| Role | SQL effect |
|---|---|
| no user | `WHERE 1=0` (sees nothing) |
| `super_admin` | no client filter; if `$branchFilter` set → `WHERE branch_id = ?` |
| `client_admin` / `client_user` | `WHERE client_id IS NULL OR client_id = <client>` + optional switcher narrowing |
| `employee` | globals **OR** (`client_id = <client>` AND (`branch_id IS NULL` **OR** `created_by = self`)). Switcher ignored. |
| `branch_user` | globals **OR** (`client_id = <client>` AND (`branch_id IS NULL` **OR** `branch_id = <own>`)). Switcher ignored — own branch only. |
| unknown `user_type` | `WHERE 1=0` |

There is no cross-branch "reference data" cascade — a branch user sees only their own branch's rows (plus globals and client-level rows).

### 3.3 WRITE/DELETE gate — `hierarchicalDenial(?User $user, $row, string $action): ?string`
Returns `null` if allowed, else a human-readable denial string (used to 403 in `update`/`destroy`). Order of checks:

1. `super_admin` → allow.
2. **own row** (`created_by == user->id`) → allow.
3. **employee** viewer → deny unless own (short-circuits before the tier ladder, so even a same-branch peer/admin row is off-limits). Message: *"employees can only manage rows they created themselves."*
4. Compute **row tier from the row's own stamps** (not the creator's current state):
   - no `client_id` → super tier
   - `client_id` but no `branch_id` → client tier
   - else → branch tier
5. Allow iff `rowTier <= userTier`; else 403 *"it was created by {another Branch / a Client user / a Super Admin}"*.

**Why row tier comes from stamps, not the live creator:** if a creator later moves between branches, their old rows must stay classified by where they were stamped — otherwise another branch's users could suddenly reach them. The `created_by` user is resolved only to refine the error label. The fallback to stamps is also what protects rows with NULL/stale/deleted `created_by` (seeded/migrated data) from becoming deletable by any tier.

### 3.4 Branch Switcher narrowing — `applySwitcherBranchFilter`
Only roles that pass through it (super, client_admin, client_user) honour `?branch_id`. A `branch_id` not belonging to the caller's client is silently dropped. Branch users and employees never reach it (they're locked to their own branch).

### 3.5 Quick lookup matrix
| Viewer | Reads | Can edit/delete |
|---|---|---|
| super_admin | all | all |
| client_admin/user | whole client + globals | row tier ≤ client (everything in client) |
| branch_user | own branch + client-level + globals | own rows + rows with tier ≤ branch (own branch) |
| employee | own rows + client-level + globals | **own rows only** |

---

## 4. Authentication internals

| Path | Controller | Notes |
|---|---|---|
| `/login` | AuthController@login | Password-history trait; brute-force lockout 5/15min via shared cache key (gated by `security.bruteForce`) |
| `/login/face` | AuthController@faceLogin | Matches 128-d descriptor vs `face_biometrics`; **threshold 0.50** |
| `/google-login` | AuthController@googleLogin | `google/apiclient`; existing email required |
| forgot-password | ForgotPasswordController | OTP send→verify→reset; PasswordHistory blocks reuse |

- No refresh token; Sanctum token until logout/401.
- Public PDF links signed at email-send, **60-day** expiry, `signed` middleware.
- Public onboarding token (64-char) + `throttle:30,1`.

---

## 5. Data model conventions

- **228 migrations** under [database/migrations/](../database/migrations/).
- Most business tables carry `client_id`; many also `branch_id`; and visibility-scoped tables carry `created_by`.
- **Soft deletes** (`deleted_at`) on most business tables.
- Files stored as `/storage/...` paths, resolved to absolute URLs on the frontend via [utils/resolveFileUrl.ts](../resources/js/utils/resolveFileUrl.ts). Azure Blob is an alternative disk.
- **Seeders only, no factories:** DatabaseSeeder, GeographySeeder, LeaveSeeder, MasterDataSeeder, ModuleSeeder, OrganizationTypeSeeder, PlanSeeder.
- Code sequences allocated under a **Postgres advisory/row lock** on `clients` (Quotation `QT/`, PI `INV/`, etc.) to prevent race duplicates.
- ERD: see [ERD.md](ERD.md).

---

## 6. Services layer

| Service | Responsibility |
|---|---|
| `RazorpayService` | Order creation + payment verify; webhook reconciliation |
| `ZohoSignService` | E-signature send/status/recall; certificate retrieval |
| `IndiaMartLeadSyncService` | Inbound CRM lead pull (called from `SalesLeadController::syncFromCrm`, manual) |
| `ConsigneeKycMirror` | Deep-clone customer KYC docs+owners onto a consignee (idempotent) |
| `HrTemplateDocxRenderer` | `{{token}}` merge into DOCX via phpoffice/phpword |
| `AnnouncementMailer` / `InvoiceMailer` | Outbound mail |
| `BrandingResolver` | Per-tenant logo/colors for emails + PDFs |
| `App\Support\MasterVisibility` | Creator-hierarchy read scope + mutate authorization |
| `App\Support\Settings` | Tenant setting reads (security toggles, etc.) |
| `App\Support\MasterBundleCache` | Cached master dropdown bundles |

---

## 7. Critical invariants (don't break)

1. Face thresholds: **login 0.50**, **attendance 0.55** (both enforced server-side).
2. Attendance punch direction alternates strictly; same-direction repeat → 422.
3. Quotation/PI codes are per-client sequential under a lock — never bypass the lock.
4. PI code prefix is `INV/` (not `PI/`).
5. Consignee KYC mirror is idempotent (409 on re-clone); update the mirror if either schema changes.
6. Signed PDF URLs expire after 60 days.
7. Onboarding rate limit 30/min/IP.
8. Branch switcher auto-injects `branch_id` on GETs — decide branch-scoped vs not for every new GET.
9. Tenant isolation — derive `client_id` from `auth()->user()`, never the request body.
10. DOCX `{{placeholder}}` rendering is fragile around special chars, line breaks, tables.

---

## 8. External integrations

| Service | Purpose | Code |
|---|---|---|
| Razorpay | Subscription billing | `app/Services/RazorpayService.php`, RazorpayWebhookController; [RAZORPAY_INTEGRATION.md](../RAZORPAY_INTEGRATION.md) |
| Zoho Sign | E-signature | `app/Services/ZohoSignService.php`, ClmSignatureController |
| Google OAuth | Login | `google/apiclient`; AuthController@googleLogin; [GOOGLE_SIGNIN_SETUP.md](../GOOGLE_SIGNIN_SETUP.md) |
| IndiaMart | Inbound lead sync | `IndiaMartLeadSyncService` |
| Azure Blob | File storage | `config/filesystems.php` |
| face-api.js | Browser face descriptors | ClockIn + login |
| dompdf / phpword | PDF / DOCX | SalesPdfController, HrTemplateDocxRenderer, CLM controllers |

---

## 9. Local development

```powershell
composer install
copy .env.example .env
php artisan key:generate
php artisan migrate --seed
npm install
npm run build
```
Run all-in-one: `composer dev` (spawns `artisan serve` + `queue:listen` + `pail` + `vite`). Manual: `php artisan serve` (`:8000`), `php artisan queue:listen`, `npm run dev` (`:5173`). Tests: `php artisan test` (stubs only).

---

## 10. Known gaps & gotchas

- No real test coverage; no factories.
- Several CLM pages are stubs.
- Sales/CLM API endpoints not yet flag-enforced server-side (frontend menu/page gating only).
- Mixed UI libraries; Redux is theme-only (don't add business slices).
- Branch-switcher edge case: some nested routes need to opt out of `branch_id` injection.
- Quotation→PI conversion copies items/costing; edits after conversion must not orphan items.
- Zoho Sign webhook vs manual poll race — reconciliation must be idempotent.
- Doc/code mismatches to keep in mind: DB is Postgres (not MySQL), PI prefix `INV/` (not `PI/`), face-login 0.50 (not 0.55), idle-timeout values historically inconsistent.

> See also: [SAAS_API_DOCUMENTATION.md](SAAS_API_DOCUMENTATION.md) · [SAAS_FUNCTIONAL_DOCUMENTATION.md](SAAS_FUNCTIONAL_DOCUMENTATION.md) · [SAAS_CODE_WALKTHROUGH.md](SAAS_CODE_WALKTHROUGH.md)
