# PERMISSION MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Access Control → Permissions (per-user, per-module)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the Permission module is
The Permission module is the app's **per-user, per-module access control**. Each grant is one row in `permissions` for a `(user, leaf-module)` pair carrying **seven independent action booleans**: `can_view, can_add, can_edit, can_delete, can_export, can_import, can_approve`. A **PermissionMatrix** UI lets a higher-tier user grant a subset of their own permissions to a lower-tier user, following a strict cascade (super-admin → client-admin → branch-user → employee).

A key invariant is **action-implies-view**: setting any action flag forces `can_view = true` — enforced in the API, the UI, and a one-time backfill migration.

> **Important scope note:** enforcement is predominantly **frontend/menu-level + login-payload-level**. Business API controllers are largely **not** flag-enforced server-side — the permission map gates the SPA (menus/pages), not most endpoints. The only server-side permission logic in this module is the grant-scope checks inside `savePermissions`.

### 1.2 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                │
│  PermissionMatrix.tsx  (shared 7-action tree/grid component)         │
│  used by:                                                            │
│    pages/permission/Permissions.tsx   (sidebar /permissions)        │
│    pages/employee/EmployeePermissions.tsx  (per-employee)           │
│    pages/client/ClientPermissions.tsx      (per client-admin)       │
│  AuthContext holds user.permissions (keyed by module slug)          │
│  Sidebar/TopNav gate menus on perms[slug].can_view                  │
└─────────────────────────────────────────────────────────────────────┘
                                   │  auth JSON
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       APPLICATION LAYER (Laravel 12)                 │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  PermissionController                                           │ │
│  │  modules() · manageableUsers() · getUserPermissions() ·        │ │
│  │  savePermissions()  (grant-scope + action-implies-view +       │ │
│  │                      leaf-only + cascade-clear-downstream)     │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  AuthController::formatUser() → builds the login `permissions` map  │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  MODELS:  Permission (user, client, branch, module, 7 flags)   │ │
│  │           Module (self-ref tree; leaves hold permissions)      │ │
│  └───────────────────────────────────────────────────────────────┘ │
│  (no permission middleware — auth:sanctum + user.active only)       │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)               │
│  permissions (1 row per user+leaf-module; NO unique constraint)      │
│  modules (tree; slug unique)                                         │
│  backfill migration: can_view forced true where any action true     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module Structure

```
app/
├── Http/Controllers/Api/
│   ├── PermissionController.php     # modules / manageableUsers / getUserPermissions / savePermissions
│   ├── AuthController.php           # formatUser() builds the login permissions map
│   ├── EmployeeController.php       # grantSelfServicePermissions (dashboard+profile baseline)
│   └── OnboardingController.php     # wider self-service baseline on public onboarding
├── Http/Middleware/
│   └── EnsureUserActive.php          # status check only (NO permission logic)
├── Models/
│   ├── Permission.php              # the grant row (7 booleans)
│   └── Module.php                  # module tree
database/migrations/
├── 2026_04_14_000009_create_permissions_table.php
├── 2026_04_14_000002_create_modules_table.php
├── 2026_06_04_000100_backfill_can_view_for_action_permissions.php   # action-implies-view backfill
└── 2026_05_01_000003_backfill_employee_permissions.php
resources/js/
├── components/PermissionMatrix.tsx  # shared matrix
├── pages/permission/Permissions.tsx # standalone page
├── pages/employee/EmployeePermissions.tsx
├── pages/client/ClientPermissions.tsx
├── layouts/Sidebar.tsx · TopNav.tsx # menu gating
└── utils/menuAccess.ts              # moduleVisible() helper
```

---

## 2. TECHNOLOGY STACK

### 2.1 Backend
| Component | Technology | Purpose |
|---|---|---|
| PHP 8.2+ / Laravel 12 | — | API |
| PostgreSQL (`c_b_c`) | — | `permissions`, `modules` |
| Sanctum 4 | — | Auth (login payload carries permissions) |

### 2.2 Frontend
| Component | Technology | Purpose |
|---|---|---|
| React 19 + TS + Vite | — | UI |
| reactstrap + Bootstrap + Tailwind | — | Velzon theme |
| AuthContext | — | Holds & refreshes `user.permissions` |

---

## 3. DATABASE SCHEMA

### 3.1 ERD

```
┌──────────────┐        ┌────────────────────────────────┐        ┌────────────────────┐
│    users     │ 1    * │           permissions          │ *    1 │       modules      │
├──────────────┤────────┤────────────────────────────────┤────────┤────────────────────┤
│ id      PK   │        │ id            PK                │        │ id          PK     │
│ user_type    │        │ user_id    FK (cascade)         │        │ parent_id FK(self, │
└──────────────┘        │ client_id  FK (cascade)         │        │   nullOnDelete)    │
                        │ branch_id  FK (cascade)         │        │ slug  UNIQUE       │
┌──────────────┐        │ module_id  FK (cascade) ────────┼───────►│ name / icon        │
│   clients    │◄───────┤ role       (string)             │        │ is_active          │
└──────────────┘        │ can_view / can_add / can_edit / │        │ is_default         │
┌──────────────┐        │ can_delete / can_export /       │        │ sort_order         │
│   branches   │◄───────┤ can_import / can_approve  (bool)│        └────────────────────┘
└──────────────┘        │ granted_by FK (nullOnDelete)    │   permissions attach ONLY
                        │ (NO unique(user_id, module_id)) │   to LEAF modules
                        └────────────────────────────────┘
```

### 3.2 Table: `permissions` (no soft deletes)
| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigint PK | no | — | |
| user_id | bigint FK | yes | — | → users cascadeOnDelete |
| client_id | bigint FK | yes | — | → clients cascadeOnDelete (copied from target) |
| branch_id | bigint FK | yes | — | → branches cascadeOnDelete (copied from target) |
| role | varchar(50) | yes | — | copied from target user_type |
| module_id | bigint FK | yes | — | → modules cascadeOnDelete |
| can_view | boolean | yes | false | forced true if any action true |
| can_add | boolean | yes | false | |
| can_edit | boolean | yes | false | |
| can_delete | boolean | yes | false | |
| can_export | boolean | yes | false | |
| can_import | boolean | yes | false | |
| can_approve | boolean | yes | false | |
| granted_by | bigint FK | yes | — | → users nullOnDelete |

**Indexes:** `(client_id, role)`, `user_id`, `module_id`, `branch_id`. **No `UNIQUE(user_id, module_id)`** — uniqueness is procedural (savePermissions deletes-then-inserts).

### 3.3 Table: `modules` (self-referential tree)
`slug` unique; `parent_id → modules.id nullOnDelete`; `is_active` (default true), `is_default` (default false — granted in all plans/baseline). Permissions attach only to **leaf** modules.

### 3.4 Data-fixing migrations
- `2026_06_04_000100_backfill_can_view_for_action_permissions` — one-time: set `can_view=true` on any legacy row where an action flag is true (the action-implies-view rule, retroactive).
- `2026_05_01_000003_backfill_employee_permissions` — copies each user's `master.departments` flags onto a new `master.employees` row.

---

## 4. MODELS

### 4.1 Permission (`app/Models/Permission.php`)
```php
class Permission extends Model {
    protected $fillable = ['user_id','client_id','branch_id','role','module_id',
        'can_view','can_add','can_edit','can_delete','can_export','can_import','can_approve','granted_by'];
    protected $casts = [ /* all 7 can_* => boolean */ ];
    public function user()      { return $this->belongsTo(User::class); }
    public function client()    { return $this->belongsTo(Client::class); }
    public function branch()    { return $this->belongsTo(Branch::class); }
    public function module()    { return $this->belongsTo(Module::class); }
    public function grantedBy() { return $this->belongsTo(User::class, 'granted_by'); }
}
```

### 4.2 Module
Self-referential tree (`parent()`, `children()`), `isParent()`, `hasChildren()`, `plans()` (belongsToMany via `plan_modules`), `permissions()` (hasMany). Leaves carry permissions; parents are grouping nodes.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get ('/modules',                   [PermissionController::class, 'modules']);
    Route::get ('/permissions/users',         [PermissionController::class, 'manageableUsers']);
    Route::get ('/permissions/user/{userId}', [PermissionController::class, 'getUserPermissions']);
    Route::post('/permissions/user/{userId}', [PermissionController::class, 'savePermissions']);
});
```
There is **no** ModuleController — `GET /modules` is served by `PermissionController`. There is **no** per-permission PUT/DELETE; `POST /permissions/user/{id}` is a **full replace**. Full detail in **PERMISSION_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS (`PermissionController`)

| Method | Purpose | Access |
|---|---|---|
| `modules` | Full active module catalogue (tree built client-side) | any authed (global) |
| `manageableUsers` | Users the caller may grant to (role-scoped picker) | super→client_admin; client_admin→branch_user/employee; branch_user→employee |
| `getUserPermissions` | Read a user's saved grants | self / super / client_admin (same client or orphan) / branch_user (own-branch employee) |
| `savePermissions` | **Write** — replace a user's grants | grant cascade + can't-grant-what-you-don't-have + leaf-only + action-implies-view |

### 6.1 `savePermissions` pipeline
```
authorize grant scope (super→client_admin; client_admin→branch_user; branch_user→employee)
   ↳ orphan adoption: client_admin saving a client_id=null target adopts it into their tenant
can't-grant-what-you-don't-have: 422 if granting a flag the caller lacks
leaf-only: parent/group modules skipped
replace: delete all rows for target, then insert (NOT in a transaction)
action-implies-view: any action true ⇒ can_view=true; all-false rows skipped
insert: copies client_id/branch_id/role from TARGET, granted_by = caller
cascade-clear-downstream: only when super-admin saves a client_admin — strips downstream flags the admin lost
```

### 6.2 Action keys (canonical 7)
`can_view · can_add · can_edit · can_delete · can_export · can_import · can_approve`

---

## 7. ENFORCEMENT (where it actually gates)

| Layer | Where |
|---|---|
| **Login payload** | `AuthController::formatUser()` builds `permissions` keyed by module slug (super-admin bypasses) |
| **Sidebar / TopNav** | `Sidebar.canView(id)` / `TopNav` gate on `perms[id]?.can_view` (super-admin all; some temporary rollout bypasses for sales/clm/developers) |
| **Menu helper** | `utils/menuAccess.ts moduleVisible()` — visible if super-admin or `perms[slug].can_view` (or any child) |
| **Per-page guards** | Some pages render a "grant view" block if lacking (e.g. Sales worksheet, HR dashboard, MasterPage) |
| **API** | Mostly **not** flag-enforced; the only server-side permission logic is the grant checks in `savePermissions` |

**Action-implies-view enforced in 3 places** (2026-06-04): API (`savePermissions`), UI (`PermissionMatrix.withImpliedView` + locked View checkbox), and the backfill migration.

---

## 8. FRONTEND COMPONENTS

### 8.1 PermissionMatrix (`components/PermissionMatrix.tsx`)
Controlled tree/grid. Columns: **All** + View, Add, Edit, Delete, Export, Import, Approve. Props: `modules`, `matrix`, `onChange`, `grantableBy` (keyed by slug; `null` = super-admin all-enabled), `loading`, `autoExpandMasterCategories`. Parent rows show aggregate `on/total` pills; leaves show per-cell checkboxes. `is_default` leaves are all-checked + disabled. `extractLeafPermissions()` builds the save payload (leaf-only).

### 8.2 Pages
| Page | Purpose | Endpoints |
|---|---|---|
| `Permissions.tsx` | Standalone `/permissions` (user picker + matrix) | `GET /permissions/users`, `GET /modules`, `GET/POST /permissions/user/{id}` |
| `EmployeePermissions.tsx` | Per-employee (resolves employee → user_id) | `GET /employees/{param}`, `GET /modules`, `GET/POST /permissions/user/{id}` |
| `ClientPermissions.tsx` | Per client-admin (super-admin) | `GET /clients/{id}` (embeds admin_permissions), `GET /modules`, `POST /permissions/user/{id}` |

### 8.3 Grant cascade (`grantableBy`)
| Granter | Grants to | grantableBy |
|---|---|---|
| super_admin | client_admin | `null` (all enabled) |
| client_admin | branch_user | own perms |
| branch_user | employee | own perms |

Non-super granters AND each flag with their own perms before sending (defence-in-depth over the server check). `HIDDEN_SLUGS` (clients, plans, payments, settings, permissions, master.organization_types) are excluded from the matrix.

### 8.4 Routing & role gating
- `/permissions` → `Permissions` (menu roles: super_admin, client_admin, branch_user).
- `/clients/:id/permissions` → `ClientPermissions`; `/hr/employees/:id/permissions` → `EmployeePermissions`.
- Gating is **menu-visibility based** — there is no route-level permission guard; direct URLs generally still resolve.

---

## 9. SECURITY & CAVEATS

1. **No permission middleware** — `EnsureUserActive` checks status only; most API endpoints are not flag-gated (the map gates the SPA).
2. **No `UNIQUE(user_id, module_id)`** — uniqueness is procedural (delete-then-insert); `savePermissions` is **not** wrapped in a DB transaction.
3. **Grant cascade + can't-grant-what-you-don't-have** are enforced server-side in `savePermissions`.
4. **Action-implies-view** enforced in API + UI + backfill.
5. **Super-admins bypass permissions** entirely (login payload skips them).
6. **Temporary UI rollout bypasses** currently surface `sales.*`, `clm.*`, `developers.*` to branch_user/employee unconditionally.
7. **Defaults:** new employees get only Dashboard + Profile (EmployeeController); public onboarding grants a wider `master.*` baseline mirroring the granting admin.

---

## 10. CODE QUALITY METRICS

| Metric | Value |
|---|---|
| PermissionController methods | 4 public (+ cascade helper) |
| Routes | 4 |
| Action flags | 7 |
| Models | Permission, Module |
| Migrations | permissions + modules (+ 2 backfills) |
| Frontend | 1 shared matrix + 3 pages |
| Test coverage | none automated |

---

*Related documents: PERMISSION_FUNCTIONAL_DOCUMENTATION.md · PERMISSION_CODE_WALKTHROUGH.md · PERMISSION_API_DOCUMENTATION.md*
