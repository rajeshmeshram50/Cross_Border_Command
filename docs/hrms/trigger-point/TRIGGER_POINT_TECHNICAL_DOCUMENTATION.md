# TRIGGER POINT MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Trigger Point Master (lifecycle trigger modules)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Trigger Point Master defines **lifecycle trigger modules** (Onboarding, Exit Management, Exit Process, Promotion, …) that HR Document Templates bind to via `trigger_point_id`. At runtime the Onboarding and Exit screens surface the right templates by **keyword substring match** against the trigger's `module_name`. It is **not** a dedicated controller — it is one entry in the schema-driven generic **MasterController**, addressed by slug **`trigger_point`**.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  MasterPage.tsx (generic) rendering masterConfigs.ts['trigger_point']  │
│  TemplateForm.tsx (pick a trigger for a document template)            │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  MasterController (generic CRUD, slug 'trigger_point')                 │
│    permission slug master.trigger_point                               │
│  HrDocumentTemplateController::matchForEmployee (trigger_keyword LIKE) │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  master_trigger_points (module_name unique-ci per tenant; no FK; no    │
│    soft delete) ◀── hr_document_templates.trigger_point_id            │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/MasterController.php   # generic; slug 'trigger_point'
app/Models/Masters/TriggerPoints.php
database/migrations/
  2026_05_14_000001_create_master_trigger_points_table.php
  2026_05_14_000002_seed_master_trigger_point_module.php
  2026_05_15_000000_seed_canonical_trigger_points.php
  2026_05_18_120000_consolidate_canonical_trigger_points.php
  2026_05_20_000003_seed_default_trigger_points.php
resources/js/pages/master/masterConfigs.ts (trigger_point) · MasterPage.tsx
resources/js/pages/hrms/doc-templates/TemplateForm.tsx (trigger select)
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum · generic MasterController |
| Frontend | React 19 · TS · generic MasterPage + masterConfigs |

---

## 3. DATABASE SCHEMA

### 3.1 `master_trigger_points` (no SoftDeletes; no DB FKs)
| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| client_id / branch_id | bigint nullable, indexed | tenant (NULL = global canon) |
| module_name | varchar(255) | **unique (case-insensitive, tenant-scoped)** |
| description | text nullable | |
| status | enum(Active, Inactive) nullable | |
| created_by | bigint nullable | |

**No `deleted_at`, no `is_system`, no foreign keys.**

### 3.2 Link
`hr_document_templates.trigger_point_id` (nullable, indexed, FK-by-convention — no DB constraint) → `master_trigger_points.id`.

---

## 4. MODEL (`app/Models/Masters/TriggerPoints.php`)
```php
class TriggerPoints extends Model {   // no casts, no soft deletes
    protected $table = 'master_trigger_points';
    protected $fillable = ['client_id','branch_id','module_name','description','status','created_by'];
    public function client(); public function branch(); public function creator();  // belongsTo
}
// inverse: HrDocumentTemplate::triggerPoint() belongsTo TriggerPoints on trigger_point_id
```

---

## 5. API ENDPOINTS CONFIGURATION (generic Master)

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get   ('/master-counts',           [MasterController::class, 'counts']);
    Route::get   ('/master/{slug}',           [MasterController::class, 'list']);     // slug = trigger_point
    Route::post  ('/master/{slug}',           [MasterController::class, 'store']);
    Route::get   ('/master/{slug}/next-code', [MasterController::class, 'nextCode']); // null for trigger_point
    Route::get   ('/master/{slug}/{id}',      [MasterController::class, 'show']);
    Route::put   ('/master/{slug}/{id}',      [MasterController::class, 'update']);
    Route::delete('/master/{slug}/{id}',      [MasterController::class, 'destroy']);
});
// consumer: GET /hr-document-templates/match?trigger_keyword=…  → HrDocumentTemplateController
```
Effective endpoints: `GET|POST /master/trigger_point`, `GET|PUT|DELETE /master/trigger_point/{id}`. Full detail in **TRIGGER_POINT_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS (`MasterController`, slug `trigger_point`)

**Schema registration:**
```php
'trigger_point' => ['fields' => [
    ['n'=>'module_name','t'=>'text','r'=>true],
    ['n'=>'description','t'=>'textarea'],
    ['n'=>'status','t'=>'select','r'=>true,'opts'=>['Active','Inactive']],
], 'uFields' => ['module_name'], 'tenantScoped' => true],
```
- `module_name` required, **case-insensitive unique** (single `uFields` text → LOWER() comparison), **tenant-scoped** (per client_id/branch_id).
- **Permission slug `master.trigger_point`** via `authorizeMaster` (view/add/edit/delete); super-admin bypass.
- `resolveOwnership`: super-admin may create globals; others stamped by client/branch; `client_id` never trusted from the body.
- `applyScope` via `MasterVisibility::applyReadScope` (globals + own tenant).
- `destroy` is a **hard delete** (no `deleted_at`); trigger_point has no `is_system` lock, so canonical rows are deletable.

**Runtime matching** (`HrDocumentTemplateController::matchForEmployee`): given `trigger_keyword` (e.g. `onboarding`/`exit`), `LOWER(TRIM(module_name)) LIKE %keyword%` → matching trigger ids → templates `whereIn(trigger_point_id, ids)` (guards empty).

---

## 7. FRONTEND
- **Generic master** (`MasterPage.tsx` + `masterConfigs.ts['trigger_point']`): KPI cards (Total/Active/Inactive), table (Module Name, Description, Status), add/edit modal. Category "Document & Evidence"; permission `master.trigger_point`.
- **Template form** (`TemplateForm.tsx`): loads `GET /master/trigger_point`, renders a required trigger `MasterSelect` in Step 2, submits `trigger_point_id`.
- **Consumers**: `HrEmployeeOnboarding.tsx` (`trigger_keyword: 'onboarding'`) and `HrExitManagement.tsx` (`'exit'`) call `/hr-document-templates/match` and label templates with `trigger_point.module_name`.

---

## 8. SECURITY & CAVEATS
1. **Substring match** — `trigger_keyword` LIKE `%onboarding%` also matches "Pre-Onboarding"; `exit` matches both "Exit Management" and "Exit Process".
2. **Overlapping seed defaults** — the effective global canon is Onboarding, Exit Management, Exit Process, Promotion (two exit-flavoured rows both match `exit`).
3. **No FK / no soft delete / no `is_system`** — deleting a referenced trigger leaves `hr_document_templates.trigger_point_id` dangling (relation resolves null); even canonical rows are deletable by an authorized user.
4. **Case-insensitive uniqueness is tenant-scoped** — the same name can exist globally and per branch.

---

## 9. METRICS
| Metric | Value |
|---|---|
| Controller | generic MasterController (slug trigger_point) |
| Permission slug | master.trigger_point |
| Table | master_trigger_points |
| Fields | module_name, description, status |
| DB FKs / soft delete / is_system | none |
| Test coverage | none automated |

---

*Related documents: TRIGGER_POINT_FUNCTIONAL_DOCUMENTATION.md · TRIGGER_POINT_CODE_WALKTHROUGH.md · TRIGGER_POINT_API_DOCUMENTATION.md*
