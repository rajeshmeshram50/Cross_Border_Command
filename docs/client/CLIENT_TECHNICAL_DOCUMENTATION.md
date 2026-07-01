# CLIENT MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Tenancy → Client (top-level tenant entity)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the Client module is
A **Client** is the company that has purchased the SaaS — the root of the multi-tenant hierarchy **Client → Branch → User**. The module lets a **super-admin** create, view, edit and (soft-)delete tenants. Creating a Client also provisions, in one transaction, the tenant's default **Head Office branch** and its **client-admin user**.

### 1.2 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER (super-admin console)         │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │            React 19 + TypeScript SPA (Vite dev :5173)          │ │
│  │  resources/js/pages/client/                                    │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────┐ │ │
│  │  │ Clients   │ │ ClientForm│ │ ClientView│ │ ClientBranches│ │ │
│  │  │ (list+KPI)│ │(add/edit) │ │ (profile) │ │ Permissions   │ │ │
│  │  └───────────┘ └───────────┘ └───────────┘ │ Payments      │ │ │
│  │                                             │ Settings      │ │ │
│  │  Menu gated to user_type = super_admin      └──────────────┘ │ │
│  │  api.ts → Bearer token (no branch_id needed here)             │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │  HTTPS / JSON (multipart on create)
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY                                 │
│           Laravel 12 · routes/api.php  (prefix /api)                 │
│      middleware: auth:sanctum → user.active                         │
│      (NO super_admin middleware / NO policy on /clients*)           │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       APPLICATION LAYER                              │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │        ClientController.php  (785 lines · 7 routes)            │ │
│  │  index() stats() store() show() update() destroy() formBundle()│ │
│  │  create/update run inside DB::transaction and provision        │ │
│  │  a Head Office branch + client_admin user                      │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  helpers/services used inside methods:                              │
│   LogoDarkVariantGenerator · MasterVisibility::applyReadScope ·    │
│   MasterBundleCache · Settings::shouldSendMail ·                    │
│   WelcomeCredentialsMail / PasswordChangedMail ·                    │
│   Facades: DB, Crypt, Hash, Cache, Mail, Storage, Log              │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  MODELS                                                         │ │
│  │  Client ─┬─ hasMany Branch ─┬─ hasMany User (client_admin,…)   │ │
│  │          ├─ hasMany User    ├─ …                               │ │
│  │          ├─ belongsTo Plan  ├─ hasMany ClientSetting           │ │
│  │          ├─ hasMany Payment └─ hasMany Permission              │ │
│  │          └─ hasMany Department / ApprovalQueue / ActivityLog   │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER                                   │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │        PostgreSQL  (database: c_b_c, :5432)                    │ │
│  │  clients · branches · users · client_settings · plans ·       │ │
│  │  payments · permissions   (+ personal_access_tokens for auth)  │ │
│  │  Branding files on the 'public' disk (clients/logos,…)         │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

> **Stack note:** the platform runs on **PostgreSQL** (`DB_CONNECTION=pgsql`, database `c_b_c`), not MySQL. Per-tenant email uniqueness relies on a Postgres **partial unique index**.

### 1.3 Access model (important)
- `/clients*` routes carry **only** `auth:sanctum` + `user.active` — **no `super_admin` middleware, no policy, no `$this->authorize()`**.
- There is **no `client_id` scoping** on `index`/`show`/`update`/`destroy`; `index()` returns every client platform-wide.
- Restriction to super-admins is a **frontend convention**: the "Clients" sidebar item only renders for `user_type === 'super_admin'` (`IdimsHeader.tsx`). There is no per-route role guard in `App.tsx` either.
- The **only** in-code role check shapes the `show()` response — it decrypts and returns the admin's plaintext password only for super-admins (not an access gate).

### 1.4 Module Structure

```
app/
├── Http/Controllers/Api/
│   └── ClientController.php          # 7 endpoints; create/update provision branch + admin
├── Models/
│   ├── Client.php                    # tenant entity (SoftDeletes, URL accessors)
│   ├── Branch.php                    # tenant office (SoftDeletes)
│   ├── User.php                      # tenant member (client_id/branch_id, dual password)
│   └── ClientSetting.php             # per-tenant feature flags / settings
├── Support/
│   ├── MasterVisibility.php          # creator-hierarchy read/mutate scoping
│   └── MasterBundleCache.php         # per-user cache-key helper
├── Services/
│   └── LogoDarkVariantGenerator.php  # dark-mode logo variant
└── Mail/
    ├── WelcomeCredentialsMail.php     # welcome email (contains plaintext password)
    └── PasswordChangedMail.php        # password-change email

database/migrations/
├── 2026_04_14_000004_create_clients_table.php
├── 2026_04_14_000005_create_branches_table.php
├── 2026_04_14_000007_modify_users_table.php            # user_type + client_id/branch_id
├── 2026_04_14_000013_create_client_settings_table.php
├── 2026_05_09_000001_add_profile_photo_to_clients_and_branches.php
├── 2026_05_15_170000_add_admin_password_plain_to_users.php   # password_encrypted
├── 2026_06_20_000001_drop_is_main_from_branches_table.php    # branches now equal peers
└── 2026_06_25_000001_users_email_unique_per_client.php       # per-tenant email

resources/js/
├── pages/client/
│   ├── Clients.tsx                   # list + KPI + donut + export
│   ├── ClientForm.tsx                # add/edit (7 sections, 1613 lines)
│   ├── ClientView.tsx                # read-only profile + completeness
│   ├── ClientBranches.tsx            # branches of a client (read-only)
│   ├── ClientPermissions.tsx         # client-admin permission matrix
│   ├── ClientPayments.tsx            # client payment history
│   ├── ClientSettings.tsx            # settings viewer (display-only)
│   └── clientFormBundleCache.ts      # sessionStorage cache for form-bundle
├── pages/dashboard/ClientDashboard.tsx  # the client_admin's own dashboard (different audience)
└── types.ts                          # Client interface (lines 97-130)
```

---

## 2. TECHNOLOGY STACK

### 2.1 Backend
| Component | Technology | Version | Purpose |
|---|---|---|---|
| Language | PHP | 8.2+ | Server-side |
| Framework | Laravel | 12.x | MVC / routing / ORM |
| Database | PostgreSQL | 14+ (`c_b_c` @ :5432) | Relational store |
| Auth | Laravel Sanctum | 4.x | Bearer-token API auth |
| Encryption | `Crypt` (AES via APP_KEY) | — | Reversible admin-password mirror |
| Hashing | `Hash` (bcrypt) | — | Auth password |
| Mail | Laravel Mail (SMTP) | — | Welcome / password-changed emails |
| File storage | `public` disk (flysystem) | — | Logo / favicon / profile photo |

### 2.2 Frontend
| Component | Technology | Version | Purpose |
|---|---|---|---|
| Framework | React | 19 | UI |
| Language | TypeScript | 6 | Type safety |
| Build | Vite | 7 | Bundler → `public/build/` |
| UI | reactstrap + Bootstrap 5.3 + Tailwind 4 | — | Velzon theme |
| Tables | @tanstack/react-table (TableContainer) | 8 | Grids |
| Charts | Recharts | 3 | Plan-distribution donut |
| Export | xlsx + file-saver | — | Client-side Excel |
| HTTP | Axios | 1.x | `resources/js/api.ts` |

---

## 3. DATABASE SCHEMA

### 3.1 Entity Relationship Diagram

```
┌──────────────────────┐        ┌──────────────────────┐
│        plans         │        │        users         │
├──────────────────────┤        ├──────────────────────┤
│ id            PK      │◄───┐   │ id            PK      │
│ name / price / period │    │   │ user_type            │
└──────────────────────┘    │   │ client_id  FK ───────┼──┐
        ▲ belongsTo plan_id │   │ branch_id  FK ───────┼─┐│
        │                   │   │ password (bcrypt)     │ ││
┌───────┴──────────────┐    │   │ password_encrypted    │ ││
│       clients        │    │   │   (Crypt, reversible) │ ││
├──────────────────────┤    │   └──────────────────────┘ ││
│ id            PK      │    │            ▲               ││
│ org_name             │    │            │ hasMany       ││
│ unique_number UNIQUE │    │            │               ││
│ email / phone        │    │   ┌────────┴───────────┐   ││
│ address / city / …   │    │   │      branches      │   ││
│ gst_number/pan_number│    │   ├────────────────────┤   ││
│ plan_id       FK ────┼────┘   │ id          PK     │   ││
│ plan_type(free/paid) │        │ client_id   FK ────┼───┘│  cascadeOnDelete
│ status               │        │ name / code (HO)   │    │
│ plan_expires_at      │  1  ►* │ status             │◄───┘
│ primary/secondary    │────────│ primary/secondary  │   (users.branch_id → branches)
│   _color             │hasMany │   _color (nullable)│
│ logo/favicon/        │        │ letterhead fields  │
│   profile_photo      │        └────────────────────┘
│ created_by    FK     │
│ deleted_at (softdel) │  1  ►* ┌────────────────────┐
└──────────┬───────────┘────────│  client_settings   │
           │ hasMany            ├────────────────────┤
           │                    │ id          PK     │
           │                    │ client_id   FK ────┼──► clients (cascade)
           ▼                    │ group / key / value│
     payments · permissions ·   │ type               │
     departments · activity_logs│ UNIQUE(client_id,  │
                                │        key)        │
                                └────────────────────┘
```

### 3.2 Table: `clients`
`SoftDeletes`. Default `country = 'India'`, `plan_type = 'free'`, `status = 'inactive'`, colors `#4F46E5` / `#10B981`.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigint PK | no | auto | |
| org_name | varchar(255) | yes | — | |
| unique_number | varchar(50) | yes | — | **UNIQUE** — auto `EA`+ts |
| email | varchar(255) | yes | — | unique (validation, not soft-deleted) |
| phone | varchar(20) | yes | — | |
| website | varchar(500) | yes | — | |
| address | text | yes | — | |
| city / state / district / taluka | varchar(100) | yes | — | |
| pincode | varchar(10) | yes | — | |
| country | varchar(100) | yes | 'India' | |
| org_type | varchar(50) | yes | — | Business / Sports / Education |
| sports / industry | varchar(100) | yes | — | |
| gst_number / pan_number | varchar(20) | yes | — | validated + unique |
| plan_id | bigint FK | yes | — | → `plans.id` nullOnDelete |
| plan_type | varchar(20) | yes | 'free' | free / paid |
| status | varchar(20) | yes | 'inactive' | active / inactive / suspended |
| plan_expires_at | date | yes | — | |
| primary_color / secondary_color | varchar(7) | yes | #4F46E5 / #10B981 | |
| logo / favicon / profile_photo | varchar(500) | yes | — | relative disk paths |
| notes | text | yes | — | |
| created_by | bigint FK | yes | — | → `users.id` nullOnDelete |
| created_at / updated_at / deleted_at | timestamp | yes | — | |

**Indexes:** `status`, `plan_type`, `org_type`. **Unique:** `unique_number`. **FKs:** `plan_id`, `created_by`. `profile_photo` added by the `2026_05_09` ALTER (the only ALTER on `clients`).

### 3.3 Table: `branches`
`SoftDeletes`. `client_id → clients.id cascadeOnDelete`. Default `country='India'`, `status='active'`.

Key columns: `id`, `client_id` (FK), `name`, `code` (the default is `HO` for Head Office), `email`, `phone`, `contact_person`, `branch_type`, `industry`, `address`, `city`, `district`, `taluka`, `state`, `pincode`, `country`, `gst_number`, `gst_state_code`, `pan_number`, `registration_number`, `cin`, `iec`, `drug_license`, `pcpndt_no`, `aeo_code`, `one_star_file_no`, `one_star_udin_no` (letterhead/compliance), `logo`, `signature_path`, `profile_photo`, `primary_color`, `secondary_color` (nullable — inherits client colors), `max_users`, `established_at`, `status`, `notes`, `created_by`.

> **`is_main` was dropped** (`2026_06_20_000001`) — all branches are now equal, isolated peers. Do not treat any branch as a "main branch."

### 3.4 Table: `users` (tenancy columns)
Added by `2026_04_14_000007_modify_users_table`: `user_type` varchar(20) default `branch_user`; `client_id` FK → `clients` cascade; `branch_id` FK → `branches` cascade; `department_id` FK → `departments` nullOnDelete. Indexes on `user_type`, `client_id`, `branch_id`, `status`.
- `user_type` ∈ `super_admin` · `client_admin` · `client_user` · `branch_user` (+ `employee` handled by MasterVisibility).
- `password_encrypted` (text, nullable) added by `2026_05_15_170000` — reversible Crypt mirror of the password.
- **Per-tenant email** (`2026_06_25_000001`): drops the global unique index and creates a partial unique index `users_email_client_unique ON users (COALESCE(client_id,0), email) WHERE deleted_at IS NULL` — the same email may exist under different clients.

### 3.5 Table: `client_settings`
No soft deletes. `client_id → clients.id cascadeOnDelete`. Columns: `id`, `client_id`, `group` (default `general`; general/branding/security/notification/approval), `key` varchar(100), `value` text, `type` varchar(20) default `string`, `description` text. **Unique `(client_id, key)`**; index `(client_id, group)`.

---

## 4. MODEL RELATIONSHIPS

### 4.1 Client (`app/Models/Client.php`)
```php
class Client extends Model {
    use SoftDeletes;
    protected $appends = ['logo_url', 'favicon_url', 'profile_photo_url'];
    protected function casts(): array { return ['plan_expires_at' => 'date']; }   // only cast

    // URL accessors (resolve relative paths → full URLs)
    public function getLogoUrlAttribute()         { return file_url($this->logo); }
    public function getFaviconUrlAttribute()      { return file_url($this->favicon); }
    public function getProfilePhotoUrlAttribute() { return file_url($this->profile_photo); }

    // Relationships
    public function plan()          { return $this->belongsTo(Plan::class, 'plan_id'); }
    public function createdBy()     { return $this->belongsTo(User::class, 'created_by'); }
    public function branches()      { return $this->hasMany(Branch::class); }
    public function users()         { return $this->hasMany(User::class); }
    public function departments()   { return $this->hasMany(Department::class); }
    public function payments()      { return $this->hasMany(Payment::class); }
    public function permissions()   { return $this->hasMany(Permission::class); }
    public function approvalQueue() { return $this->hasMany(ApprovalQueue::class); }
    public function activityLogs()  { return $this->hasMany(ActivityLog::class); }
    public function settings()      { return $this->hasMany(ClientSetting::class); }

    // Helpers
    public function isActive(): bool { return $this->status === 'active'; }
    public function isPaid(): bool   { return $this->plan_type === 'paid'; }
    public function getSetting(string $key, $default = null) { /* settings lookup */ }
}
```
> The Client model has **no `$hidden`, no password field, no boot logic, no global scope**. Billing linkage is via `plan()` + the scalar `plan_type`/`plan_expires_at` + `payments()` (there is no `subscription()` relation).

### 4.2 Branch
`client()` belongsTo Client · `createdBy()` belongsTo User · `users()` / `employees()` / `departments()` / `permissions()` / `approvalQueue()` / `activityLogs()` hasMany. Appends `logo_url`, `profile_photo_url`, `signature_url`.

### 4.3 User (tenancy)
`client()` belongsTo Client · `branch()` belongsTo Branch · `effectiveClient()` returns `$this->client ?? $this->branch->client`. `$hidden` includes both `password` and `password_encrypted`.

### 4.4 ClientSetting
`client()` belongsTo Client. `getTypedValue()` casts `value` by `type` (boolean / integer / json / string).

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum', 'user.active'])->group(function () {
    Route::get('/clients/stats',       [ClientController::class, 'stats']);        // before apiResource
    Route::get('/clients/form-bundle', [ClientController::class, 'formBundle']);   // before apiResource
    Route::apiResource('clients', ClientController::class);
    //  GET    /clients            index
    //  POST   /clients            store    (201)
    //  GET    /clients/{client}   show
    //  PUT    /clients/{client}   update
    //  DELETE /clients/{client}   destroy
});
```
Full request/response detail is in **CLIENT_API_DOCUMENTATION.md**. Response shapes are ad-hoc (no API Resource / no uniform `{data}` envelope); `index` returns a raw paginator.

---

## 6. CONTROLLER METHOD ANALYSIS

| Method | Line | Transaction | Purpose |
|---|---|---|---|
| `index` | 29 | — | Paginated list of all clients (+ optional stats); search on org_name/unique_number/email |
| `stats` | 103 | — | KPI totals + plan breakdown |
| `store` | 108 | ✅ | Create client + HO branch + client_admin user; force `plan_type=free`; dual password; welcome email |
| `show` | 349 | — | Full detail; super-admin gets `admin_user.password_plain`; embeds permissions + states |
| `update` | 436 | ✅ | Update client (+ optional admin); block free→paid; revoke tokens on deactivation |
| `destroy` | 628 | ✅ | Soft-delete cascade: tokens → users → branches → client |
| `formBundle` | 739 | — | Cached dropdown data (org types / plans / countries) |

Private helpers: `computeStats()`, `normalizeGstPanInput()` (uppercases GST/PAN, lowercases emails, strips phone digits), `revokeAllUserTokensForClient()` (raw delete on `personal_access_tokens`), `relativePath()` (legacy `/storage/` URL → disk-relative).

---

## 7. FRONTEND COMPONENTS

### 7.1 Routing (`App.tsx`) & role gating
| Path | Component |
|---|---|
| `/clients` | `Clients` |
| `/clients/new` | `ClientForm` (create) |
| `/clients/:id/edit` | `ClientForm` (edit) |
| `/clients/:id` | `ClientView` |
| `/clients/:id/branches` | `ClientBranches` |
| `/clients/:id/permissions` | `ClientPermissions` |
| `/clients/:id/payments` | `ClientPayments` |
| `/clients/:id/settings` | `ClientSettings` |

Menu visibility (`IdimsHeader.tsx`) shows "Clients" only to `super_admin`. There is **no per-route role guard**.

### 7.2 Components
| Component | Purpose | Key endpoints |
|---|---|---|
| `Clients.tsx` | List + KPI cards + plan donut + XLSX export | `GET /clients?include_stats=1`, `DELETE /clients/{id}`, `GET /clients/form-bundle` (warm-up) |
| `ClientForm.tsx` | 7-section add/edit form (multipart create; JSON/`_method=PUT` edit) | `GET /clients/form-bundle`, `GET /master/states`, `GET /clients/{id}`, `POST/PUT /clients` |
| `ClientView.tsx` | Read-only profile + completeness meter | `GET /clients/{id}` |
| `ClientBranches.tsx` | Branches of a client (read-only) | `GET /branches?client_id=` |
| `ClientPermissions.tsx` | Client-admin permission matrix | `GET /clients/{id}`, `GET /modules`, `POST /permissions/user/{id}` |
| `ClientPayments.tsx` | Client payment history | `GET /payments?client_id=` |
| `ClientSettings.tsx` | Settings viewer (display-only) | `GET /client-settings?client_id=` |
| `clientFormBundleCache.ts` | sessionStorage cache (`client:form-bundle:v3`, 5-min TTL) | — |

### 7.3 Component hierarchy
```
App.tsx (routes)
├─ Clients                → DeleteConfirmModal · TableContainer · Recharts donut
├─ ClientForm             → MasterSelect · color pickers · file inputs · strength meter
├─ ClientView             → hero · completeness · info cards
├─ ClientBranches         → KPI + read-only table
├─ ClientPermissions      → PermissionMatrix
├─ ClientPayments         → TableContainer
└─ ClientSettings         → grouped settings viewer
```

### 7.4 `Client` TypeScript interface
Defined in `resources/js/types.ts` (lines 97-130) — mirrors the `clients` columns plus `branches_count?`, `users_count?`, `plan?: {id,name,price}`. See the API doc §1.3 for the runtime shape.

---

## 8. SECURITY IMPLEMENTATION

### 8.1 Authentication
All `/clients*` routes require `auth:sanctum` + `user.active`. Access to the module is limited to super-admins **only by menu visibility** — there is no server-side role gate (documented risk).

### 8.2 Password handling (reversible — CRITICAL)
The client-admin password is stored **twice** on the `users` row:
- `password` = `Hash::make()` (bcrypt) — used for login.
- `password_encrypted` = `Crypt::encryptString()` (reversible, keyed off `APP_KEY`).

`show()` decrypts and returns `admin_user.password_plain` **only to super-admins**; the welcome/password-changed emails also carry the plaintext. Anyone with DB + `APP_KEY` can reverse it. The `User` model `$hidden` prevents accidental serialization; the controller deliberately bypasses it for super-admins.

### 8.3 Multi-tenancy
- Tenant scoping (`MasterVisibility`) applies to master/business data, **not** the `clients` table itself (client CRUD is a super-admin function).
- Deactivating a client (`active → non-active`) **revokes all Sanctum tokens** for that client's users.
- Delete is a **soft-delete cascade** (users → branches → client), recoverable.

### 8.4 Input validation & files
- GST regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`; PAN `^[A-Z]{5}[0-9]{4}[A-Z]{1}$` (India only, both frontend + backend).
- Uploads validated by mime + size (logo ≤2MB, favicon ≤512KB, profile photo ≤2MB); stored on the `public` disk as relative paths; logo generates a dark-mode variant.

---

## 9. ERROR HANDLING

| Condition | HTTP | Source |
|---|---|---|
| Not authenticated | 401 | `auth:sanctum` |
| User inactive | 403 | `user.active` (`EnsureUserActive`) |
| Client not found / soft-deleted | 404 | route-model binding |
| Validation failure | 422 | inline `$request->validate()` → `{ message, errors }` |

Email failures (welcome / password-changed) are caught and **do not** fail the create/update.

### 9.1 Known caveats (client-facing)
1. **No route-level role guard / no tenant scoping** on client CRUD — super-admin access is frontend-only.
2. **Reversible admin password** returned to super-admins and emailed in cleartext.
3. **`plan_type` cannot be set to `paid`** via this API — forced `free` on create, dropped on update escalation (billing handles activation).
4. **Per-tenant email** — same email allowed across clients.
5. `BrandingResolver` is imported in the controller but unused (dead import).
6. The Clients-list "Settings" action is a "Coming Soon" toast; `ClientSettings` is a display-only viewer (no write endpoint).

---

## 10. PERFORMANCE

| Optimization | Where |
|---|---|
| `form-bundle` cached per-user (5-min TTL), states excluded (lazy per-country) | `formBundle()` / `clientFormBundleCache.ts` |
| Single `include_stats=1` call for list + KPIs | `Clients.tsx` |
| `withCount` for branches/users (no N+1) | `index()` |
| Eager load `plan`, `createdBy` | `index()`, `show()` |
| Client-side XLSX build | `Clients.tsx` export |
| Lazy states fetch with AbortController | `ClientForm.tsx` |

---

## 11. CODE QUALITY METRICS

| Metric | Value |
|---|---|
| ClientController LOC | ~785 |
| Public routes | 7 (5 apiResource + stats + form-bundle) |
| DB transactions | store / update / destroy |
| clients columns | ~30 (+ profile_photo ALTER) |
| Frontend components | 7 pages + 1 cache helper |
| FormRequest classes | none (inline validation) |
| Test coverage | none automated |

---

*Related documents: CLIENT_FUNCTIONAL_DOCUMENTATION.md · CLIENT_CODE_WALKTHROUGH.md · CLIENT_API_DOCUMENTATION.md*
