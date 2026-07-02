# PLAN MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Billing → Plans (subscription tiers & module gating)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the Plan module is
A **Plan** is a subscription tier (Starter, Basic, Pro, Business, Enterprise). It defines pricing, limits (`max_branches`, `max_users`, storage), trial days, a yearly discount, and — crucially — the **set of modules** it unlocks (module gating). Super-admins manage the plan catalogue; clients pick a plan and pay (see the Payment module). Assigning/activating a plan stamps `clients.plan_id` + `plan_type` and regrants the client-admin's permissions from the plan's modules.

The link is: **Plan —(plan_modules)→ Module**, with an `access_level` (`full` / `limited` / `addon` / `not_included`) on each join row.

### 1.2 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                │
│  Plans.tsx        (super-admin catalogue — Swiper carousel)         │
│  AddPlan.tsx      (create/edit plan + Module Access selector)       │
│  PlanSelection.tsx(client checkout — see Payment module)           │
└─────────────────────────────────────────────────────────────────────┘
                                   │  auth JSON
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       APPLICATION LAYER (Laravel 12)                 │
│  ┌────────────────────┐         ┌──────────────────────────────┐   │
│  │ PlanController      │         │ SubscriptionController        │   │
│  │ index/store/show/   │         │ plans/status/createOrder/     │   │
│  │ update/destroy      │         │ verifyPayment → activatePlan  │   │
│  │ (catalogue CRUD)    │         │ (assigns plan to a client)    │   │
│  └────────────────────┘         └──────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  MODELS:  Plan ─(hasMany)→ PlanModule ─(belongsTo)→ Module     │ │
│  │           Plan ─(belongsToMany modules via plan_modules)       │ │
│  │           Plan ─(hasMany)→ Client / Payment                    │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)               │
│  plans · plan_modules (pivot, UNIQUE plan+module) · modules (tree)   │
│  clients (plan_id / plan_type / plan_expires_at) · permissions        │
│  Seeded by PlanSeeder (5 plans) + ModuleSeeder (module tree)         │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module Structure

```
app/
├── Http/Controllers/Api/
│   ├── PlanController.php           # plan catalogue CRUD (5 apiResource methods)
│   └── SubscriptionController.php    # assigns/activates a plan for a client (Payment module)
├── Models/
│   ├── Plan.php                     # subscription tier
│   ├── PlanModule.php               # pivot: plan ↔ module (+ access_level)
│   └── Module.php                   # module catalogue (self-ref tree)
database/
├── migrations/
│   ├── 2026_04_14_000001_create_plans_table.php
│   ├── 2026_04_14_000002_create_modules_table.php
│   └── 2026_04_14_000003_create_plan_modules_table.php
└── seeders/
    ├── PlanSeeder.php               # Starter/Basic/Pro/Business/Enterprise
    └── ModuleSeeder.php             # the full module tree
resources/js/pages/plan/
├── Plans.tsx                        # catalogue (carousel)
├── AddPlan.tsx                      # create/edit + module access
└── PlanSelection.tsx               # client checkout (Payment module)
```

---

## 2. TECHNOLOGY STACK

### 2.1 Backend
| Component | Technology | Purpose |
|---|---|---|
| PHP 8.2+ / Laravel 12 | — | API |
| PostgreSQL (`c_b_c`) | — | plans / plan_modules / modules |
| Sanctum 4 | — | Bearer-token auth |
| MasterBundleCache | — | Invalidated on plan change (plans feed the client form) |

### 2.2 Frontend
| Component | Technology | Purpose |
|---|---|---|
| React 19 + TS + Vite | — | UI |
| reactstrap + Bootstrap + Tailwind | — | Velzon theme |
| Swiper | — | Plan carousels |
| SweetAlert2 | — | Delete confirm |

---

## 3. DATABASE SCHEMA

### 3.1 ERD

```
┌────────────────────────┐        ┌──────────────────────┐        ┌────────────────────────┐
│         plans          │        │     plan_modules     │        │        modules         │
├────────────────────────┤        ├──────────────────────┤        ├────────────────────────┤
│ id             PK       │ 1   * │ id            PK      │ *   1 │ id             PK       │
│ name / slug (UNIQUE)    │───────┤ plan_id  FK (cascade) │───────┤ parent_id FK (self, null│
│ price / period          │hasMany│ module_id FK (cascade)│belongs│   OnDelete)             │
│ max_branches / max_users│       │ access_level          │  To   │ name / slug (UNIQUE)    │
│ storage_limit           │       │  (full/limited/addon/ │       │ icon / route_name       │
│ support_level           │       │   not_included)       │       │ route_prefix            │
│ is_featured / badge     │       │ usage_limit / notes   │       │ sort_order              │
│ color / description     │       │ UNIQUE(plan_id,       │       │ is_active               │
│ best_for / status       │       │        module_id)     │       │ is_default (all plans)  │
│ sort_order / trial_days │       └──────────────────────┘       └────────────────────────┘
│ yearly_discount         │                                              ▲
│ is_custom               │       ┌──────────────────────┐               │ self-ref tree
└──────────┬─────────────┘        │       clients        │               │ (parent → children)
           │ hasMany              ├──────────────────────┤               │
           ├───────────────────► │ plan_id  FK (nullOnDel│               │
           │                      │ plan_type (free/paid) │        modules ─(belongsToMany)→ plans
           │ hasMany              │ plan_expires_at       │        via plan_modules
           └───────────────────► │ status               │
                 payments        └──────────────────────┘
```

### 3.2 Table: `plans` (no soft deletes, hard delete)
| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigint PK | no | — | |
| name | varchar(100) | yes | — | |
| slug | varchar(100) | yes | — | **unique** |
| price | decimal(10,2) | yes | 0 | |
| period | varchar(20) | yes | month | month/quarter/year (the billing cycle) |
| max_branches | integer | yes | — | 0/null = unlimited |
| max_users | integer | yes | — | 0/null = unlimited |
| storage_limit | varchar(20) | yes | — | e.g. `25GB` |
| support_level | varchar(50) | yes | — | |
| is_featured | boolean | yes | false | |
| badge | varchar(50) | yes | — | e.g. "Most Popular" |
| color | varchar(7) | yes | — | hex |
| description | text | yes | — | |
| best_for | varchar(255) | yes | — | |
| status | varchar(20) | yes | active | active/inactive |
| sort_order | integer | yes | 0 | |
| trial_days | integer | yes | — | |
| yearly_discount | decimal(5,2) | yes | — | percent (applied to year) |
| is_custom | boolean | yes | false | |

> No separate `billing_cycle` column — `period` is the cycle. No FKs on `plans`.

### 3.3 Table: `modules` (self-referential tree)
| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigint PK | no | — | |
| parent_id | bigint FK | yes | — | → modules.id nullOnDelete |
| name | varchar(255) | yes | — | |
| slug | varchar(255) | yes | — | **unique** |
| icon | varchar(100) | yes | — | lucide icon |
| description | text | yes | — | |
| route_name / route_prefix | varchar(255) | yes | — | |
| sort_order | integer | yes | 0 | |
| is_active | boolean | yes | true | |
| is_default | boolean | yes | false | granted in every plan |

### 3.4 Table: `plan_modules` (pivot)
| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigint PK | no | — | |
| plan_id | bigint FK | yes | — | → plans.id cascadeOnDelete |
| module_id | bigint FK | yes | — | → modules.id cascadeOnDelete |
| access_level | varchar(20) | yes | full | full/limited/addon/not_included |
| usage_limit | integer | yes | — | for `limited` |
| notes | text | yes | — | |
| — | — | — | — | **UNIQUE(plan_id, module_id)** |

> `not_included` rows are **never persisted** — the controller filters them out on save.

---

## 4. MODELS

### 4.1 Plan (`app/Models/Plan.php`)
```php
class Plan extends Model {   // no SoftDeletes
    protected $casts = [
        'price'=>'decimal:2','max_branches'=>'integer','max_users'=>'integer',
        'is_featured'=>'boolean','sort_order'=>'integer','trial_days'=>'integer',
        'yearly_discount'=>'decimal:2','is_custom'=>'boolean',
    ];
    public function clients()     { return $this->hasMany(Client::class); }
    public function payments()    { return $this->hasMany(Payment::class); }
    public function planModules() { return $this->hasMany(PlanModule::class); }
    public function modules()     { return $this->belongsToMany(Module::class, 'plan_modules')
                                        ->withPivot('access_level','usage_limit','notes')->withTimestamps(); }
    public function isActive(): bool { return $this->status === 'active'; }
    public function isFree():   bool { return $this->price <= 0; }
}
```

### 4.2 PlanModule
```php
class PlanModule extends Model {
    protected $casts = ['usage_limit' => 'integer'];
    public function plan()   { return $this->belongsTo(Plan::class); }
    public function module() { return $this->belongsTo(Module::class); }
}
```

### 4.3 Module
```php
class Module extends Model {
    protected $casts = ['sort_order'=>'integer','is_active'=>'boolean','is_default'=>'boolean'];
    public function parent()   { return $this->belongsTo(Module::class, 'parent_id'); }
    public function children() { return $this->hasMany(Module::class, 'parent_id')->orderBy('sort_order'); }
    public function plans()    { return $this->belongsToMany(Plan::class, 'plan_modules')->withPivot(...); }
    public function permissions() { return $this->hasMany(Permission::class); }
    public function isParent(): bool  { return $this->parent_id === null; }
    public function hasChildren(): bool { return $this->children()->exists(); }
}
```

### 4.4 Module-gating chain
`Plan → PlanModule (access_level) → Module`. At activation (`SubscriptionController::activatePlan`), for every active Module: if the plan includes it (`full`/`limited`) **or** the module is `is_default`, the client-admin gets a permission — `can_view` always, add/edit if `full` or default, delete/export/import/approve only if `full`.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::apiResource('plans', PlanController::class);   // index/store/show/update/destroy
    // catalogue for checkout + assignment live on SubscriptionController (Payment module):
    Route::get ('/subscription/plans',  [SubscriptionController::class, 'plans']);
    Route::post('/subscription/create-order',   [SubscriptionController::class, 'createOrder']);
    Route::post('/subscription/verify-payment', [SubscriptionController::class, 'verifyPayment']);
});
```
Full detail in **PLAN_API_DOCUMENTATION.md**. Plans are **global** (no tenant scoping — they carry no `client_id`).

---

## 6. CONTROLLER ANALYSIS (`PlanController`)

| Method | Purpose | Notes |
|---|---|---|
| `index` | List plans + `clients_count` + modules | `search` ILIKE on name; ordered `sort_order` |
| `store` | Create plan + plan_modules | Derives unique slug; **forces sort_order = max+1**; skips `not_included`; transaction; `MasterBundleCache::bump()` |
| `show` | Detail + counts + planModules | — |
| `update` | Update plan + **replace** module set | Slug validated but **never rewritten**; deletes+reinserts plan_modules; transaction |
| `destroy` | **Hard delete** | 422 if any client references the plan; deletes plan_modules then plan |

> No tenant/role scoping in this controller — plans are super-admin catalogue records. Slug uniqueness enforced procedurally + DB unique.

---

## 7. SEEDERS

### PlanSeeder — 5 plans
| slug | name | price | max_branches | max_users | storage | flags | modules |
|---|---|---|---|---|---|---|---|
| starter | Starter | 0 | 1 | 3 | 1GB | — | branches, employees → limited |
| basic | Basic | 1999 | 5 | 15 | 5GB | trial 7 | branches,employees→full; permissions→limited |
| pro | Pro | 4999 | 25 | 50 | 25GB | featured, "Most Popular", yearly 20%, trial 14 | branches,employees,permissions,settings→full |
| business | Business | 9999 | 50 | 100 | 100GB | yearly 25% | all except dashboard/profile/clients/plans/payments → full |
| enterprise | Enterprise | 14999 | 0 (∞) | 0 (∞) | 500GB+ | custom, yearly 30% | all except dashboard/profile/clients/plans/payments → full |

### ModuleSeeder
Builds the entire module tree: 13 top-level modules (dashboard, clients, branches, employees, plans, payments, permissions, master, hr, sales, clm, settings, profile) + header groups (credentials-vault, project-navigator, p2p, gts, inventory, developers) and their subtrees (~60 master leaves, HR/Sales/CLM/P2P leaves). `is_default = true`: dashboard, profile, developers(+ops/shipment).

---

## 8. FRONTEND COMPONENTS

| Component | Purpose | Endpoints |
|---|---|---|
| `Plans.tsx` | Super-admin catalogue (Swiper cards) + delete | `GET /plans`, `DELETE /plans/{id}` |
| `AddPlan.tsx` | Create/edit; Module Access tile grid (cycle Not Included → Full → Limited → Add-on) | `GET /modules`, `GET /plans/{id}`, `POST/PUT /plans` |
| `PlanSelection.tsx` | Client checkout (Payment module) | `GET /subscription/plans`, checkout endpoints |

### 8.1 Routing & role gating
- `/plans` (super-admin only), `/plans/new`, `/plans/:id/edit` → catalogue CRUD.
- `/my-plan` → `PlanSelection` (client-admin). `/plan-blocked` → inline expired/no-plan screen.
- Menu: `plans` (super-admin), `my-plan` (client-admin). Expired/missing plan bounces client-admin → `/my-plan`, branch-user → `/plan-blocked` (enforced in `App.tsx`).
- Types are **local per file** (no shared `Plan`/`Module` type in `types.ts`).

---

## 9. SECURITY & CAVEATS

- **Plans are global** (no `client_id`); catalogue CRUD is a super-admin function (menu-gated).
- **`plan_type` cannot be set to `paid`** via client create/update — only via subscription activation.
- **`PlanController::update` never rewrites `slug`** even when the name changes.
- **`not_included` module rows are never persisted.**
- **Hard delete**, blocked while any client references the plan (422).
- **Free-plan activation** still sets `client.plan_type='paid'` (no reset-to-free path).
- **`period` is the billing cycle** (no separate column); pricing multipliers live in `SubscriptionController::computePricing`.

---

## 10. PERFORMANCE

| Optimization | Where |
|---|---|
| `withCount('clients')` + eager modules | `index()` |
| `MasterBundleCache::bump()` on change | plan CRUD (plans feed the client form bundle) |
| Client-side carousel rendering | `Plans.tsx` |

---

## 11. CODE QUALITY METRICS

| Metric | Value |
|---|---|
| PlanController LOC | ~230 |
| Routes | 5 (apiResource) + subscription catalogue |
| Models | Plan, PlanModule, Module |
| Migrations | 3 (plans, modules, plan_modules) |
| Seeders | PlanSeeder (5), ModuleSeeder (tree) |
| Test coverage | none automated |

---

*Related documents: PLAN_FUNCTIONAL_DOCUMENTATION.md · PLAN_CODE_WALKTHROUGH.md · PLAN_API_DOCUMENTATION.md*
