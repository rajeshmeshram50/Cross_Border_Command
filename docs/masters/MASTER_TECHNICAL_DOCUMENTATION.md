# MASTER DATA MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters (schema-driven reference data engine)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Master Data is a **single schema-driven CRUD engine** that serves **56 masters** through one controller (`MasterController`) and one React page (`MasterPage.tsx`). Two PHP constant registries drive everything: `MODELS` (slug → Eloquent class) and `SCHEMAS` (slug → field/validation/uniqueness spec). Adding a master is mostly a matter of registering a model + schema on the backend and a config entry on the frontend — no bespoke controller or page. Tenant isolation and edit/delete authority are centralised in `App\Support\MasterVisibility` (the creator-hierarchy engine), and dropdown caches are versioned by `App\Support\MasterBundleCache`.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                             CLIENT LAYER                               │
│  MasterDashboard.tsx  (10 category groups · Active/Inactive pills)     │
│  MasterPage.tsx       (generic list/add/edit/delete · one shell/all)   │
│  masterConfigs.ts     (56 declarative configs: fields/cols/refs/kpis)  │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON (+ ?branch_id on GET)
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  MasterController:  counts · list · show · store · update · destroy    │
│                     · nextCode   (routed by {slug})                    │
│    · MODELS registry (56)   · SCHEMAS registry (55 generic)            │
│    · validatePayload (rules + uFields/uEach uniqueness + system-seed)  │
│    · absorbUploads (*_file→*_file_path)  · syncSublists (banks)        │
│  MasterVisibility:  applyReadScope · hierarchicalDenial (tier ladder)  │
│  MasterBundleCache: version bump on every write (dropdown freshness)   │
│  OrganizationTypeController: organization_types (super-admin only)     │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  56 tables — mostly `master_*` (App\Models\Masters\*), plus            │
│  organization_types. Each row: client_id/branch_id/created_by stamps,  │
│  status, SoftDeletes. is_system flag on seeded-global masters.         │
│  Consumers: Sales, CLM, Procurement, HR, Warehouse, Billing dropdowns  │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/
  MasterController.php              # the schema-driven engine (~1100 LOC)
  OrganizationTypeController.php    # organization_types (super-admin platform master)
app/Support/
  MasterVisibility.php              # creator-hierarchy read scope + edit/delete gate
  MasterBundleCache.php             # versioned dropdown-cache invalidation
app/Models/Masters/                 # 55 master models (master_* tables)
  Company.php · LegalEntities.php · Countries.php · … · TriggerPoints.php
app/Models/OrganizationType.php     # the one non-Masters-namespace master
resources/js/pages/
  MasterDashboard.tsx               # category cards + batch counts
  master/MasterPage.tsx             # generic renderer (~4600 LOC)
  master/masterConfigs.ts           # 56 declarative configs (~2000 LOC)
routes/api.php                      # /master-counts, /master/{slug}[...]
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum |
| Validation | Laravel Validator (rules built per-schema) + manual LOWER() uniqueness |
| Auth | `auth:sanctum` + `user.active`; per-master module permission (`master.<slug>`) |
| Cache | database driver; `MasterBundleCache` monotonic version key |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) · Axios |

---

## 3. KEY CONSTANTS & INVARIANTS
| Constant | Value | Meaning |
|---|---|---|
| `MODELS` | 56 slugs | slug → Eloquent model class (incl. organization_types) |
| `SCHEMAS` | 55 specs | slug → fields/uFields/uEach (organization_types has its own controller) |
| `OWNERSHIP_WITH` | client, branch, creator, creator.branch | eager-loaded on every list/show |
| `AUTO_CODES` | departments `DEPT-`/3, expense_category `EXC-`/2 | server-generated per-tenant sequences |
| Default text cap | 50 chars | overridable per field via `maxLen` |
| GST active tokens | active/1/true/yes/enabled | case-insensitive "active" test in counts |
| Tenant tiers | super 5 · client 4 · branch 2 · none 0 | `MasterVisibility` ladder |

**Core invariants:**
1. `client_id` / `branch_id` are derived from `auth()->user()` on write — never from the request body (non-super-admins can't spoof).
2. Uniqueness (`uFields` composite, `uEach` per-field) is always evaluated **within the row's own (client_id, branch_id) scope**, case-insensitive on text columns.
3. `is_system` global rows are immutable (edit/delete blocked) and can't be shadow-created by name in any tenant.
4. Every write calls `MasterBundleCache::bump()` so cached dropdown bundles refresh.

---

## 4. DATABASE SCHEMA

### 4.1 Common columns (nearly all master tables)
| Column | Purpose |
|---|---|
| `id` | PK |
| `client_id` (nullable FK) | owning tenant; `NULL` = global/super-admin row |
| `branch_id` (nullable FK) | owning branch; `NULL` = client-level row |
| `created_by` (nullable FK users) | creator — drives hierarchy + "Created By" label |
| `status` | Active/Inactive (+ master-specific states) |
| `is_system` (some masters) | seeded-global lock flag |
| `deleted_at` | SoftDeletes |
| timestamps | created_at / updated_at |

Table naming: `App\Models\Masters\*` models map to **`master_*`** tables (e.g. `master_departments`, `master_legal_entities`, `master_hsn_codes`). The lone exception is `OrganizationType` → `organization_types`.

### 4.2 Notable schema specifics
- **`master_legal_entities`** — parent of **`master_legal_entity_banks`** (`legal_entity_id` FK); auto `entity_code` (`LE-0001`) generated in the model's `creating` hook.
- **`master_states`** / **`master_state_codes`** — large geography tables; list endpoints eager-load only `id,name,country_id` and support a `country_id` cascade filter to avoid loading the whole table.
- **`master_assets`** — file columns `invoice_file_path`, `warranty_card_file_path` (path only; files on the `public` disk under `master/assets`).
- **`is_system`-bearing masters** — address_types, customer_types, customer_classifications, risk_levels, asset_categories (seeds locked).

### 4.3 Referenced-master (FK) relationships
`ref` schema keys create dropdown FKs, e.g. states→countries, state_codes→states, port_of_discharge→countries, hsn_codes→gst_percentage, roles/designations→departments, kpis→roles, assets→asset_categories & vendor_directory, zone_master/racks/freezers→warehouse_master, racks→zone/rack_type/temp_class, shelf_master→racks, vendor_directory→segments & states, legal_entities→countries/states/currencies.

---

## 5. MODELS

All 55 `Masters\*` models follow the same shape: `protected $table = 'master_*'`, a `$fillable` list including `client_id`/`branch_id`/`created_by`/`status`, and `client()` / `branch()` / `creator()` `belongsTo` relations (the ones `OWNERSHIP_WITH` eager-loads). Reference masters add extra `belongsTo` for their FK columns.

**Distinctive models:**
- `LegalEntities` — `booted()` auto-generates `entity_code` (`LE-NNNN`); `banks()` hasMany; extra `country/state/currency` relations.
- `GstPercentage` — surfaced with an `in_use` flag by the controller (products/HSN references).
- `OrganizationType` — lives under `App\Models` (predates the Masters namespace); registered in `MODELS` **only** so `/master-counts` includes it.

> Most masters use SoftDeletes; the `status` column is plain text (not an enum cast), which is why the counts query normalises it case-insensitively.

---

## 6. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/master-counts',           [MasterController::class, 'counts']);   // dashboard batch
    Route::get   ('/master/{slug}',           [MasterController::class, 'list']);     // list (+search, +country_id)
    Route::post  ('/master/{slug}',           [MasterController::class, 'store']);    // create
    Route::get   ('/master/{slug}/next-code', [MasterController::class, 'nextCode']); // DEPT-/EXC- preview
    Route::get   ('/master/{slug}/{id}',      [MasterController::class, 'show']);     // read one
    Route::put   ('/master/{slug}/{id}',      [MasterController::class, 'update']);   // update
    Route::delete('/master/{slug}/{id}',      [MasterController::class, 'destroy']);  // soft delete
});

// organization_types uses its OWN controller (super-admin platform master)
Route::apiResource('organization-types', OrganizationTypeController::class);
```
Full request/response detail in **MASTER_API_DOCUMENTATION.md**.

---

## 7. CONTROLLER ANALYSIS

### 7.1 MasterController
| Method | Purpose |
|---|---|
| `counts` | Single batch of `{slug:{active,inactive,total}}` for the dashboard; permission-filtered; SQL aggregate (no whole-table loads); per-model try/catch so one bad table can't break the batch |
| `list` | Scoped list with `OWNERSHIP_WITH` + `orderByDesc(id)`; `search` → ILIKE over text fields; `country_id` cascade filter; `state_codes` eager-loads state name |
| `show` | Scoped `findOrFail` + ownership flatten |
| `store` | authorize `can_add` → address_types 403 → validate → stamp created_by + resolveOwnership → absorbUploads → create → syncSublists → cache bump → 201 |
| `update` | authorize `can_edit` → scoped find → hierarchicalDenial → is_system 403 → validate → absorbUploads(delete old) → update → syncSublists → cache bump |
| `destroy` | authorize `can_delete` → scoped find → hierarchicalDenial → per-master system/in-use guards → soft delete → cache bump |
| `nextCode` | Returns the next `DEPT-###` / `EXC-##` computed over the same scope the list shows (avoids handing back a code that collides with a visible row) |

**`validatePayload` pipeline:** normalize (upper/lower) → build Laravel rules per field (required/type/enum/regex/numeric-bounds/maxLen) → single-field exact `Rule::unique` for numeric/FK uFields → validate → manual **case-insensitive** LOWER() checks for `uEach` + text `uFields` (tenant-scoped) → **system-seed collision** check on `is_system` tables → composite `uFields` combination check → strip empty strings to NULL.

**Ownership stamping (`resolveOwnership`):** super_admin may pass client_id/branch_id; client_admin/client_user → (own client, NULL branch); branch_user/employee → (own client, own branch). This keeps auto-code sequences and uniqueness scopes tenant-isolated.

### 7.2 MasterVisibility (App\Support)
- `applyReadScope($q,$user,$branchFilter)` — super sees all (optionally switcher-narrowed); client sees globals + own client (switcher-narrowable); branch_user sees globals + client-level + own branch; **employee** sees globals + client-level + own rows only. **Exception:** CLM (`clm_*`) tables are branch-shared for employees.
- `hierarchicalDenial($user,$row,$action)` — returns a denial string or null. super/own-row always pass; employees may mutate only their own rows; otherwise the row's tier (from its client_id/branch_id stamps) must be ≤ the user's tier. Customers/Consignees are intentionally open.

### 7.3 OrganizationTypeController
Dedicated CRUD for `organization_types` (super-admin platform master). Registered in `MasterController::MODELS` solely so the dashboard's `/master-counts` card isn't stuck at 0/0.

---

## 8. FRONTEND

### 8.1 `masterConfigs.ts`
A `Record<slug, MasterConfig>` of 56 entries. Each config declares `fields` (typed with `t`, `r`, `opts`, `ref`, `pattern`, `min/max`, `maxLen`, `cascadeFrom`, `autogenApi`, `subFields`…), `cols`/`colL` (table columns), `uFields`, optional `kpis`, `lockedFixed`, and a `wtd` step strip. Shared regex constants (name/account/IFSC/AD) are mirrored server-side.

### 8.2 `MasterPage.tsx`
Routes by `useParams().slug` → `getMasterConfig(slug)`. Loads the list from `masterEndpoint(cfg)` (default `/master/{slug}`, override for organization_types), pre-loads referenced masters for dropdowns, enforces `master.<slug>` permissions from `/me`, renders the schema-driven form (including sublists, cascades, auto-derive and `next-code` fetch), and mirrors the server validation client-side.

### 8.3 `MasterDashboard.tsx`
Category-grouped cards fed by `/master-counts`; navigates to `/masters/{slug}`.

---

## 9. INTEGRATION: DOWNSTREAM CONSUMERS
Master rows feed cached **form-bundle** endpoints (`/customers/master-bundle`, `/products/master-bundle`, `/vendors/master-bundle`, P2P `/p2p/form-masters`, client/branch forms). These bundles cache per-user for 5 minutes; `MasterBundleCache::bump()` on any master write advances the version so the next request rebuilds with the new/edited/deleted row.

---

## 10. SECURITY & CAVEATS
1. **Tenant stamps derived server-side** — `resolveOwnership` blocks cross-tenant spoofing.
2. **Per-master permissions** — `authorizeMaster` requires an explicit `permissions` row per action (super admins bypass).
3. **System-seed locks** — edit/delete/re-create blocked on `is_system` rows.
4. **Hierarchical mutate gate** — descendants can't modify ancestor-tier rows even when visible.
5. **Referential guard** — GST rate delete blocked while referenced by products/HSN (409).
6. **Uploads** — only `*_file`→`*_file_path` keys the model declares are absorbed; stale files deleted on replace.
7. **Search** covers text fields only; large geography tables use cascade filters + aggregate counts to stay fast.

---

## 11. METRICS
| Metric | Value |
|---|---|
| Masters (registered models) | 56 |
| Generic schema specs | 55 (+ organization_types via own controller) |
| Categories | 10 |
| CRUD endpoints | 7 (counts, list, show, store, update, destroy, next-code) |
| Auto-code masters | 3 (departments, expense_category, legal_entities) |
| Uniqueness models | 2 (uFields composite · uEach per-field) |
| Test coverage | none automated |

---

*Related documents: MASTER_FUNCTIONAL_DOCUMENTATION.md · MASTER_CODE_WALKTHROUGH.md · MASTER_API_DOCUMENTATION.md*
