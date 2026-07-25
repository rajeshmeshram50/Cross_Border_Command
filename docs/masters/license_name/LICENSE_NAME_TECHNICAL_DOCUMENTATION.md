# LICENSE TYPES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → License Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `license_name` |
| Model | `App\Models\Masters\LicenseName` |
| Table | `master_license_name` |
| Soft deletes | Yes (`deleted_at`) |
| Ownership columns | `client_id`, `branch_id`, `created_by` |
| Fillable | `client_id, branch_id, name, license_code, issuing_authority, validity_months, status, created_by` |
| Relations | `client()`, `branch()`, `creator()` (→ `User` via `created_by`) |

---

## 2. SCHEMA SPEC (from `MasterController::SCHEMAS`)

```php
'license_name' => ['fields' => [
    ['n'=>'name','t'=>'text','r'=>true],
    ['n'=>'license_code','t'=>'text'],
    ['n'=>'issuing_authority','t'=>'text'],
    ['n'=>'validity_months','t'=>'number'],
    ['n'=>'status','t'=>'select','r'=>true,'opts'=>['Active','Inactive']],
], 'uEach' => ['name','license_code']],
```

Validation applied per field: `required|nullable`, text → `string|max:50`, number → `numeric`, select → `Rule::in([...])`. Empty strings normalize to NULL after validation.

---

## 3. UNIQUENESS MODEL

- **`uEach = [name, license_code]`** — each column independently unique. Both are text, so both are checked case-insensitively via `whereRaw('LOWER(col) = LOWER(?)')`, scoped to the row's `(client_id, branch_id)` tuple.
- Nullable `license_code`: empty value skips its check.
- No `is_system` seed rows exist, so the system-seed collision branch never fires for this master.

---

## 4. ENDPOINTS

| Verb | Path | Method |
|---|---|---|
| GET | `/master/license_name` | `list` |
| POST | `/master/license_name` | `store` |
| GET | `/master/license_name/next-code` | `nextCode` → `{code:null}` |
| GET | `/master/license_name/{id}` | `show` |
| PUT | `/master/license_name/{id}` | `update` |
| DELETE | `/master/license_name/{id}` | `destroy` (soft) |

All under `auth:sanctum` + `user.active`. `next-code` returns `{code:null}` (no auto-code configured).

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no per-slug branches in `store/update/destroy`. The generic `is_system` edit-lock and hierarchical denial still apply if a row were ever seeded, but none ship.

---

## 6. SECURITY & SCOPING

- Reads scoped by `MasterVisibility::applyReadScope` (creator hierarchy + optional `?branch_id` switcher for client admins).
- Writes stamp `client_id`/`branch_id`/`created_by` via `resolveOwnership`; body `client_id` is trusted only for `super_admin`.
- Edit/delete gated by `hierarchicalDenial` — own row OK; else row tier must be ≤ user tier, else 403.

---

## 7. METRICS

Responses are bare arrays/objects (no envelope), ordered `orderByDesc('id')`, with flattened `client_name`/`branch_name`/`creator_name`. Every write bumps `MasterBundleCache`. DB is PostgreSQL.

---
*Related documents: LICENSE_NAME_FUNCTIONAL_DOCUMENTATION.md, LICENSE_NAME_API_DOCUMENTATION.md, LICENSE_NAME_CODE_WALKTHROUGH.md*
