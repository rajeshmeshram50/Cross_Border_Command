# BRANCH MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Tenancy → Branch (a tenant's office)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the Branch module is
A **Branch** is the middle tier of the tenancy hierarchy **Client → Branch → User** — an office/location belonging to a Client. Almost every business table carries `branch_id`, and data is scoped to a branch throughout the API. The module lets a **client-admin** create, view, edit and deactivate branches, each with its own **branch-user login**, branding, and letterhead/compliance details used on Quotation/PI PDFs. A **BranchSwitcher** lets client-admins scope the whole app to one branch (branch users are pinned to their own).

### 1.2 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │            React 19 + TypeScript SPA (Vite dev :5173)          │ │
│  │  resources/js/pages/branch/                                    │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐                   │ │
│  │  │ Branches  │ │ BranchForm│ │ BranchView│                   │ │
│  │  │ (list+KPI)│ │ (6-section)│ │ (profile) │                   │ │
│  │  └───────────┘ └───────────┘ └───────────┘                   │ │
│  │  BranchSwitcherContext → active branch (localStorage)         │ │
│  │  api.ts → Bearer token + auto-inject ?branch_id on GETs       │ │
│  │  Branches menu: client_admin only                             │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │  HTTPS / JSON (multipart on file upload)
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY                                 │
│           Laravel 12 · routes/api.php  (prefix /api)                 │
│      middleware: auth:sanctum → user.active                         │
│      authz: in-method client_id ownership checks (no role mw)       │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       APPLICATION LAYER                              │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │        BranchController.php  (773 lines · 7 routes)            │ │
│  │  index() store() show() update() destroy()                     │ │
│  │  nextCode() formBundle()                                       │ │
│  │  create/update run in DB::transaction, provision a branch_user │ │
│  │  destroy = DEACTIVATE (never removes the row)                  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  helpers/services used inside methods:                              │
│   LogoDarkVariantGenerator · MasterVisibility::applyReadScope ·    │
│   MasterBundleCache · BrandingResolver · Settings::shouldSendMail ·│
│   WelcomeCredentialsMail / PasswordChangedMail ·                    │
│   Facades: Cache, Crypt, DB, Hash, Log, Mail, Storage             │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  MODELS                                                         │ │
│  │  Branch ─┬─ belongsTo Client                                   │ │
│  │          ├─ hasMany User (branch_user)                         │ │
│  │          ├─ hasMany Employee / Department / Permission         │ │
│  │          └─ hasMany ApprovalQueue / ActivityLog               │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER                                   │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │        PostgreSQL  (database: c_b_c, :5432)                    │ │
│  │  branches · users (branch_id) · employees · departments       │ │
│  │  (+ personal_access_tokens for token revocation)              │ │
│  │  Branding + signature files on the 'public' disk              │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  Scoping: App\Support\MasterVisibility (branch_user = globals +    │
│  client-level + own branch; sibling branches hidden)              │
└─────────────────────────────────────────────────────────────────────┘
```

> **Stack note:** PostgreSQL (`DB_CONNECTION=pgsql`, `c_b_c`), not MySQL. Search uses `ilike`.

### 1.3 Access & scoping model
- `/branches*` routes carry `auth:sanctum` + `user.active`. There is **no role middleware**; authorization is **in-method** — every mutating method compares `$branch->client_id` to `auth()->user()->client_id` (super-admin exempt).
- **Create requires a `client_id`** on the user (a client-admin); otherwise 403.
- **BranchSwitcher:** the Axios interceptor injects `?branch_id=<active>` on GETs. Only `index()` honours it (after verifying the branch belongs to the caller's client). `client_admin` can switch; `branch_user` is pinned to their own branch via `MasterVisibility` scoping.
- **The "main branch" concept was removed (2026-06-20)** — all branches are equal, isolated peers; sibling branches are hidden from branch users.

### 1.4 Module Structure

```
app/
├── Http/Controllers/Api/
│   └── BranchController.php          # 7 endpoints; create/update provision a branch_user
├── Models/
│   ├── Branch.php                    # office entity (SoftDeletes, URL accessors)
│   ├── Client.php                    # parent tenant
│   └── User.php                      # branch_user (branch_id link, dual password)
├── Support/
│   ├── MasterVisibility.php          # branch-user read/mutate scoping
│   ├── MasterBundleCache.php         # per-user cache-key helper
│   ├── BrandingResolver.php          # per-tenant branding for emails/PDFs
│   └── Settings.php                  # mail gating
├── Services/
│   └── LogoDarkVariantGenerator.php  # dark-mode logo variant
└── Mail/
    ├── WelcomeCredentialsMail.php     # branch-user welcome (plaintext password)
    └── PasswordChangedMail.php        # password-change email

database/migrations/
├── 2026_04_14_000005_create_branches_table.php
├── 2026_04_15_000001_add_fields_to_branches_table.php          # district…max_users
├── 2026_04_29_114812_add_brand_colors_to_branches.php
├── 2026_05_09_000001_add_profile_photo_to_clients_and_branches.php
├── 2026_05_26_000100_add_letterhead_fields_to_branches_table.php   # GST state code, CIN, IEC, signature…
├── 2026_06_20_000001_drop_is_main_from_branches_table.php          # main-branch concept removed
└── 2026_04_14_000007_modify_users_table.php                       # users.branch_id FK

resources/js/
├── pages/branch/
│   ├── Branches.tsx                  # list + KPI + export
│   ├── BranchForm.tsx                # 6-section add/edit
│   ├── BranchView.tsx                # read-only profile
│   └── branchFormBundleCache.ts      # sessionStorage cache for form-bundle
├── contexts/BranchSwitcherContext.tsx  # active-branch scoping
├── velzon/Layouts/IdimsHeader.tsx      # mounted header (switcher UI)
├── pages/dashboard/BranchDashboard.tsx # branch_user dashboard
└── types.ts                          # Branch interface (lines 132-179)
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
| Encryption | `Crypt` (AES via APP_KEY) | — | Reversible branch-user password mirror |
| Hashing | `Hash` (bcrypt) | — | Auth password |
| File storage | `public` disk (flysystem) | — | Logo / profile photo / signature |
| Mail | Laravel Mail (SMTP) | — | Welcome / password-changed emails |

### 2.2 Frontend
| Component | Technology | Version | Purpose |
|---|---|---|---|
| Framework | React | 19 | UI |
| Language | TypeScript | 6 | Type safety |
| Build | Vite | 7 | Bundler → `public/build/` |
| UI | reactstrap + Bootstrap 5.3 + Tailwind 4 | — | Velzon theme |
| Tables | @tanstack/react-table | 8 | Grids |
| Charts | Recharts | 3 | Dashboard charts |
| Export | xlsx + file-saver | — | Client-side Excel |
| HTTP | Axios | 1.x | `resources/js/api.ts` (branch_id auto-inject) |

---

## 3. DATABASE SCHEMA

### 3.1 Entity Relationship Diagram

```
┌──────────────────────┐
│       clients        │
├──────────────────────┤
│ id            PK      │
└──────────┬───────────┘
           │ 1  hasMany
           ▼ *
┌──────────────────────────────────────────┐
│                branches                    │
├──────────────────────────────────────────┤
│ id                 PK                      │
│ client_id          FK → clients (cascade) │  ◄─ indexed
│ name / code (BR-###)                       │
│ email / phone / contact_person / website  │
│ branch_type / industry / description      │
│ ── Legal / Letterhead ──                  │
│ gst_number / gst_state_code / pan_number  │
│ cin / iec / drug_license / pcpndt_no      │
│ aeo_code / one_star_file_no / _udin_no    │
│ registration_number / signature_path      │
│ ── Branding ──                            │
│ logo / profile_photo                       │
│ primary_color / secondary_color            │
│ ── Address ──                             │
│ address / city / district / taluka /      │
│ state / pincode / country (def India)     │
│ ── Ops ──                                 │
│ max_users (def 0) / established_at         │
│ status (def active)  ◄─ indexed           │
│ notes / created_by FK → users (nullOnDel) │
│ deleted_at (soft delete)                  │
│ (is_main DROPPED 2026-06-20)              │
└──────────┬───────────────────────────────┘
           │ 1  hasMany (branch_id)
           ├──────────────► users (branch_user)
           ├──────────────► employees
           ├──────────────► departments
           ├──────────────► permissions
           ├──────────────► approval_queue
           └──────────────► activity_logs
```

### 3.2 Table: `branches` (final schema after 6 migrations)
`SoftDeletes`. FKs: `client_id → clients` (cascade), `created_by → users` (nullOnDelete). Indexes: `client_id`, `status`. **No unique constraints** (`code` is not unique).

| Column | Type | Null | Default | Group |
|---|---|---|---|---|
| id | bigint PK | no | auto | |
| client_id | bigint FK | yes | — | tenancy (indexed) |
| name | varchar(255) | yes | — | identity |
| code | varchar(50) | yes | — | identity (auto `BR-###`) |
| email / phone / contact_person | varchar | yes | — | contact |
| website | varchar(500) | yes | — | contact |
| branch_type / industry | varchar | yes | — | classification |
| description | text | yes | — | |
| gst_number | varchar(20) | yes | — | legal |
| gst_state_code | varchar(8) | yes | — | letterhead |
| pan_number | varchar(20) | yes | — | legal |
| cin | varchar(32) | yes | — | letterhead |
| iec | varchar(32) | yes | — | letterhead |
| drug_license | varchar(128) | yes | — | letterhead |
| pcpndt_no | varchar(64) | yes | — | letterhead |
| aeo_code | varchar(64) | yes | — | letterhead |
| one_star_file_no | varchar(64) | yes | — | letterhead (DGFT) |
| one_star_udin_no | varchar(64) | yes | — | letterhead |
| registration_number | varchar(50) | yes | — | legal |
| logo | varchar(500) | yes | — | branding |
| signature_path | varchar(500) | yes | — | letterhead signature |
| profile_photo | varchar(500) | yes | — | branding |
| primary_color / secondary_color | varchar(7) | yes | — | branding (hex) |
| address | text | yes | — | address |
| city / district / taluka / state | varchar(100) | yes | — | address |
| pincode | varchar(10) | yes | — | address |
| country | varchar(100) | yes | 'India' | address |
| max_users | integer | yes | 0 | ops (0 = unlimited) |
| established_at | date | yes | — | ops |
| status | varchar(20) | yes | 'active' | ops (indexed) |
| notes | text | yes | — | |
| created_by | bigint FK | yes | — | → users nullOnDelete |
| created_at / updated_at / deleted_at | timestamp | yes | — | |

> **`is_main` was dropped** by `2026_06_20_000001` (with its index). Do not treat any branch as a "main branch."

### 3.3 Migration timeline
| Migration | Adds |
|---|---|
| `create_branches_table` | base identity/address/status + `is_main` (later dropped) |
| `add_fields_to_branches_table` | district, taluka, branch_type, industry, website, description, gst_number, pan_number, registration_number, logo, max_users, established_at |
| `add_brand_colors_to_branches` | primary_color, secondary_color |
| `add_profile_photo_to_clients_and_branches` | profile_photo |
| `add_letterhead_fields_to_branches_table` | gst_state_code, cin, iec, drug_license, pcpndt_no, aeo_code, one_star_file_no, one_star_udin_no, signature_path |
| `drop_is_main_from_branches_table` | **drops** is_main + index (2026-06-20) |

### 3.4 `users.branch_id`
Added by `2026_04_14_000007_modify_users_table`: `branch_id` FK → `branches` **cascadeOnDelete**, indexed. A `branch_user` is pinned to `client_id` + `branch_id`. `User::effectiveClient()` resolves the tenant via `client_id`, else via `branch->client`.

---

## 4. MODEL RELATIONSHIPS

### 4.1 Branch (`app/Models/Branch.php`)
```php
class Branch extends Model {
    use SoftDeletes;
    protected $appends = ['logo_url', 'profile_photo_url', 'signature_url'];
    protected function casts(): array { return ['max_users' => 'integer', 'established_at' => 'date']; }

    // URL accessors (via file_url() helper; null for bare basenames)
    public function getLogoUrlAttribute()         { return file_url($this->logo); }
    public function getProfilePhotoUrlAttribute() { return file_url($this->profile_photo); }
    public function getSignatureUrlAttribute()    { return file_url($this->signature_path); } // signed Quotation/PI PDFs

    // Relationships
    public function client()        { return $this->belongsTo(Client::class); }
    public function createdBy()     { return $this->belongsTo(User::class, 'created_by'); }
    public function users()         { return $this->hasMany(User::class); }
    public function employees()     { return $this->hasMany(Employee::class); }
    public function departments()   { return $this->hasMany(Department::class); }
    public function permissions()   { return $this->hasMany(Permission::class); }
    public function approvalQueue() { return $this->hasMany(ApprovalQueue::class); }
    public function activityLogs()  { return $this->hasMany(ActivityLog::class); }

    public function isActive(): bool { return $this->status === 'active'; }
}
```
> No `$hidden`, no boot logic, no query scopes. 38 fillable fields (all letterhead + branding + ops columns). `is_main` is not fillable (dropped).

### 4.2 Scoping — `MasterVisibility::applyReadScope()`
For a **branch_user**: rows are restricted to `client_id IS NULL` (globals) **OR** (`client_id = user.client_id` AND (`branch_id IS NULL` client-level OR `branch_id = user.branch_id`)). **Sibling branches are hidden**, and the BranchSwitcher param is ignored. `client_admin`/`client_user` see client-level rows and *may* narrow via the switcher. `super_admin` sees all.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum', 'user.active'])->group(function () {
    Route::get('/branches/next-code',   [BranchController::class, 'nextCode']);    // before apiResource
    Route::get('/branches/form-bundle', [BranchController::class, 'formBundle']);  // before apiResource
    Route::apiResource('branches', BranchController::class);
    //  GET    /branches            index
    //  POST   /branches            store    (201)
    //  GET    /branches/{branch}   show
    //  PUT    /branches/{branch}   update
    //  DELETE /branches/{branch}   destroy  (= deactivate)
});
```
No `/branches/{id}/...` sub-routes exist (logo/signature/letterhead are multipart fields on store/update). No dedicated switcher endpoint — the switcher lists via `GET /branches?per_page=100`. Full request/response detail is in **BRANCH_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER METHOD ANALYSIS

| Method | Line | Transaction | Purpose |
|---|---|---|---|
| `index` | 29 | — | Paginated list (client-scoped); excludes HO unless `include_head_office=1`; honours switcher `branch_id` |
| `store` | 88 | ✅ | Create branch + branch_user; plan `max_branches` gate; auto `BR-###` code; welcome email |
| `show` | 344 | — | Single branch (ownership 403); `password_plain` to super-admin or owning client-admin |
| `update` | 387 | ✅ | Update branch (+ optional user); active↔inactive cascades (deactivate/restore) |
| `destroy` | 635 | ✅ | **Deactivate** — soft-delete users/employees, revoke tokens, set status inactive; branch row kept |
| `nextCode` | 697 | — | Preview next `BR-###` without allocating |
| `formBundle` | 738 | — | Cached countries + states + next_code |

Private helpers: `normalizeGstPanInput()`, `revokeAllUserTokensForBranch()`, `relativePath()`, `allocateBranchCode()` (row-locked), `peekNextBranchCode()`, `buildNextBranchCode()`, `isUniqueEmailViolation()`.

---

## 7. FRONTEND COMPONENTS

### 7.1 Routing (`App.tsx`) & role gating
| Path | Component |
|---|---|
| `/branches` | `Branches` |
| `/branches/new` | `BranchForm` (create) |
| `/branches/:id` | `BranchView` |
| `/branches/:id/edit` | `BranchForm` (edit) |
| `/branches/:id/users` | `UsersPage` |
| `/clients/:id/branches` | `ClientBranches` (super-admin viewing a client's branches) |

The **Branches menu is `client_admin`-only** (`constants.ts` + `IdimsHeader.tsx`).

### 7.2 Components
| Component | Purpose | Key endpoints |
|---|---|---|
| `Branches.tsx` | List + KPI + XLSX export (incl. all letterhead fields) | `GET /branches?per_page=9999`, `DELETE /branches/{id}`, `GET /branches/form-bundle` (warm-up) |
| `BranchForm.tsx` | 6-section add/edit (multipart with logo/photo/signature) | `GET /branches/form-bundle`, `GET /branches/{id}`, `POST/PUT /branches` |
| `BranchView.tsx` | Read-only profile + completeness meter | `GET /branches/{id}` |
| `branchFormBundleCache.ts` | sessionStorage cache (`branch:form-bundle:v2`, 5-min) | — |
| `BranchSwitcherContext.tsx` | Active-branch scoping (localStorage per user) | `GET /branches?per_page=100` |
| `BranchDashboard.tsx` | branch_user / client_user dashboard | `GET /dashboard/client-stats` |

### 7.3 BranchSwitcher
- Context shape: `{ branches, selectedBranchId, selectedBranch, canSwitch, setBranch, loading }`.
- `canSwitch = (user_type === 'client_admin')`; `branch_user` is hard-pinned to their own branch (setBranch is a no-op).
- Active branch persisted in `localStorage` key `cbc_selected_branch_id_<userId>`; `setBranch` reloads the page so all lists refetch under the new scope.
- The Axios interceptor auto-injects `?branch_id=<id>` on GETs (except `/branches`, `/me`, auth endpoints); pages opt out with `branch_id: ''`.

### 7.4 `Branch` TypeScript interface
Defined in `resources/js/types.ts` (lines 132-179) — mirrors the `branches` columns incl. all letterhead fields, plus `users_count?`, `departments_count?`. `logo_url` / `profile_photo_url` come from the backend accessors and are read via `(branch as any)`.

---

## 8. SECURITY IMPLEMENTATION

### 8.1 Authentication & authorization
- `/branches*` require `auth:sanctum` + `user.active`.
- **In-method tenant ownership:** every mutating method rejects (403) when `$branch->client_id !== auth user's client_id` (super-admin exempt). Create requires the user to have a `client_id`.

### 8.2 Password handling (reversible — CRITICAL)
The branch-user password is stored **twice** on the `users` row: `password` (bcrypt) + `password_encrypted` (reversible Crypt). `show()` returns `password_plain` (decrypted) **only** to a super-admin or the owning client-admin; welcome/password-changed emails carry it in cleartext. Anyone with DB + `APP_KEY` can decrypt.

### 8.3 Multi-tenancy & lifecycle
- Branch scoping via `MasterVisibility` — branch users see only globals + client-level + their own branch (siblings hidden; switcher ignored).
- **Deactivation (active → inactive)** revokes all the branch's Sanctum tokens and soft-deletes its users + employees. **Reactivation** restores them.
- **Delete is a deactivate** — the branch row is never removed (preserves historical FKs).
- **Plan gate:** create enforces `plan.max_branches` (422 if exceeded).

### 8.4 Input validation & files
- GST/PAN validated with Indian formats (unique per client). `BR-###` codes allocated under a row lock (race-safe).
- Three uploads — `logo`, `profile_photo`, `signature_path` — each ≤2MB on the `public` disk (relative paths); logo generates a dark-mode variant.

---

## 9. ERROR HANDLING

| Condition | HTTP | Source |
|---|---|---|
| Not authenticated | 401 | `auth:sanctum` |
| User inactive | 403 | `user.active` |
| Cross-tenant / non-client-admin create | 403 | in-method ownership check |
| Plan `max_branches` reached | 422 | `store()` |
| Validation failure | 422 | inline `validate()` → `{ message, errors }` |
| Duplicate branch-user email | 422 | `QueryException` (23505) → `user_email` error |
| Branch not found | 404 | route-model binding |

Email failures (welcome / password-changed) are caught, logged, and surfaced as `mail_warning` — they never fail the request.

### 9.1 Known caveats
1. **No route-level role guard** — client-admin restriction is menu-visibility + in-method ownership.
2. **Reversible branch-user password** returned to super-admin / owning client-admin and emailed in cleartext.
3. **Delete ≠ remove** — `destroy` deactivates; the row persists.
4. `code` is **not unique** and has no index.
5. `is_main` is dropped — no privileged branch.
6. Per-branch `max_users` is stored but **not enforced** by this controller (only `plan.max_branches` on create is).

---

## 10. PERFORMANCE

| Optimization | Where |
|---|---|
| `form-bundle` cached per-user (5-min), countries+states only | `formBundle()` / `branchFormBundleCache.ts` |
| `withCount('users','departments')` (no N+1) | `index()` |
| Client-side pagination (`per_page=9999`) | `Branches.tsx` |
| Switcher lists `per_page=100` with AbortController | `BranchSwitcherContext.tsx` |
| Row-locked code allocation | `allocateBranchCode()` |
| Client-side XLSX build | `Branches.tsx` export |

---

## 11. CODE QUALITY METRICS

| Metric | Value |
|---|---|
| BranchController LOC | ~773 |
| Public routes | 7 (5 apiResource + next-code + form-bundle) |
| DB transactions | store / update / destroy |
| branches columns | ~40 (across 6 migrations) |
| Frontend components | 3 pages + switcher context + cache helper |
| FormRequest classes | none (inline validation) |
| Test coverage | none automated |

---

*Related documents: BRANCH_FUNCTIONAL_DOCUMENTATION.md · BRANCH_CODE_WALKTHROUGH.md · BRANCH_API_DOCUMENTATION.md*
