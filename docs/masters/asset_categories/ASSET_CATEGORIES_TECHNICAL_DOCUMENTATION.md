# ASSET CATEGORIES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Asset Categories

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. Model & Table

- **Model:** `App\Models\Masters\AssetCategories`
- **Table:** `master_asset_categories` (PostgreSQL, SoftDeletes)
- **Slug:** `asset_categories`
- **Fillable:** `client_id`, `branch_id`, `name`, `depreciation_rate`, `useful_life_years`, `status`, `created_by`.
- **Relations:** `client`, `branch`, `creator` (`created_by`).
- No file-path columns; no auto-code hook.

## 2. Schema Spec (`SCHEMAS['asset_categories']`)

| n | t | r | opts |
|---|---|---|---|
| name | text | yes | |
| depreciation_rate | number | no | |
| useful_life_years | number | no | |
| status | select | yes | Active / Inactive |

`uFields` = `['name']` (single-field uniqueness).

## 3. Uniqueness Model

- Single text `uFields` (`name`) is promoted to a **case-insensitive** (`LOWER`) check.
- Scoped to the row's `(client_id, branch_id)` tuple from `resolveOwnership`, so each tenant has its own category name space.

## 4. Endpoints

| Verb | Path | Action |
|---|---|---|
| GET | `/master/asset_categories?search=&branch_id=` | list |
| GET | `/master/asset_categories/{id}` | show |
| POST | `/master/asset_categories` | create |
| PUT | `/master/asset_categories/{id}` | update (blocks `is_system`) |
| DELETE | `/master/asset_categories/{id}` | delete (blocks `is_system`) |
| GET | `/master/asset_categories/next-code` | `{code: null}` (no auto-code) |

## 5. Special Handling — system-seed guard

- **DELETE:** `destroy()` has an explicit branch — `if ($slug === 'asset_categories' && !empty($row->is_system))` → **403**. Rationale: employee onboarding Stage 1 pulls asset lists by category name; deleting the underlying category breaks that screen.
- **UPDATE:** the generic `if (!empty($row->is_system))` guard in `update()` returns **403** for any seeded row.
- No uploads, no references-out, no sublists.

## 6. Security & Scoping

- `auth:sanctum` + `user.active` + `authorizeMaster('master.asset_categories', …)`; super admin bypasses permission (but **not** the `is_system` delete/edit locks).
- Reads via `MasterVisibility::applyReadScope`; writes stamp ownership from the token; edits/deletes pass `hierarchicalDenial`.

## 7. Metrics

- Bare JSON responses, ownership names flattened, `orderByDesc('id')`.
- Every write bumps `MasterBundleCache` so the Assets category dropdown stays fresh.

---

*Related documents: ASSET_CATEGORIES_FUNCTIONAL_DOCUMENTATION.md, ASSET_CATEGORIES_API_DOCUMENTATION.md, ASSET_CATEGORIES_CODE_WALKTHROUGH.md*
