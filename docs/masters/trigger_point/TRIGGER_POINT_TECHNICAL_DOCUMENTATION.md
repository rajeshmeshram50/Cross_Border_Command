# TRIGGER POINT MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Trigger Point Master

## DOCUMENT CONTROL

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. Model & Table

| Item | Value |
|---|---|
| Slug | `trigger_point` |
| Model | `App\Models\Masters\TriggerPoints` |
| Table | `master_trigger_points` (PostgreSQL `c_b_c`) |
| Traits | Eloquent `Model` + SoftDeletes semantics (`deleted_at`) |
| Fillable | `client_id`, `branch_id`, `module_name`, `description`, `status`, `created_by` |
| Relations | `client()` → `Client`, `branch()` → `Branch`, `creator()` → `User` (`created_by`) |

Registered in `MasterController::MODELS['trigger_point']` and `MasterController::SCHEMAS['trigger_point']`.

---

## 2. Schema Spec

```php
'trigger_point' => [
    'fields' => [
        ['n' => 'module_name', 't' => 'text',     'r' => true],
        ['n' => 'description', 't' => 'textarea'],
        ['n' => 'status',      't' => 'select', 'r' => true, 'opts' => ['Active','Inactive']],
    ],
    'uFields'     => ['module_name'],
    'tenantScoped' => true,
],
```

| Field | `t` | Required | Validation |
|---|---|---|---|
| `module_name` | text | yes | string, max 50, tenant-unique (case-insensitive) |
| `description` | textarea | no | string, nullable |
| `status` | select | yes | `Rule::in(['Active','Inactive'])` |

---

## 3. Uniqueness Model

- **`uFields` = `['module_name']`** — single-field uniqueness. `module_name` is checked case-insensitively (`LOWER(module_name)`) within the resolved tenant scope. On create, and on update (excluding the current row id), a collision returns `422`.
- Because the master is `tenantScoped`, uniqueness is evaluated within the `(client, branch)` scope resolved for the actor, not globally across all tenants.

---

## 4. Endpoints (generic, scoped)

All under `Route::middleware(['auth:sanctum','user.active'])`; `{slug}` = `trigger_point`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/master-counts` | Active/inactive counts for dashboard cards |
| GET | `/master/trigger_point` | List (`?search=` ILIKE, `?branch_id=`) |
| POST | `/master/trigger_point` | Create |
| GET | `/master/trigger_point/next-code` | Returns `{code:null}` (no code field) |
| GET | `/master/trigger_point/{id}` | Show one |
| PUT | `/master/trigger_point/{id}` | Update |
| DELETE | `/master/trigger_point/{id}` | Soft delete |

---

## 5. Special Handling

Standard schema-driven master; `tenantScoped`. No custom store/update hooks, no system-seed collision list, no code generation, no `normalize`/`pattern` rules. Behaviour is entirely driven by the generic `store` / `update` / `destroy` / `validatePayload` path in `MasterController`.

---

## 6. Security & Scoping

- **Read:** `MasterVisibility::applyReadScope` filters by actor tier (super = all; client roles = globals + own client; branch = + own branch; employee = own rows only).
- **Write ownership:** `resolveOwnership` stamps `client_id` / `branch_id` / `created_by`; body `client_id` ignored for non-super.
- **Authorization:** `authorizeMaster` checks the `master.trigger_point` permission flags; `super_admin` bypasses.
- **Edit/delete gate:** `hierarchicalDenial` — own row OK; employees own-only; otherwise row tier must be ≤ actor tier else `403`.

---

## 7. Metrics

- Responses are **bare** (no `{data}` envelope), `orderByDesc(id)`.
- Flattened fields injected on read: `client_name`, `branch_name`, `creator_name`, `creator_user_type`.
- Every write bumps `MasterBundleCache` so the frontend master bundle refreshes.
- KPIs (frontend-computed): Total Triggers, Active, Inactive.

---

*Related documents: TRIGGER_POINT_FUNCTIONAL_DOCUMENTATION.md, TRIGGER_POINT_API_DOCUMENTATION.md, TRIGGER_POINT_CODE_WALKTHROUGH.md*
