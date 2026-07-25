# WAREHOUSE MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Warehouse Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `warehouse_master` |
| Model | `App\Models\Masters\WarehouseMaster` |
| Table | `master_warehouse_master` |
| Ownership cols | `client_id`, `branch_id`, `created_by` |
| Relations | `client()`, `branch()`, `creator()` (all `belongsTo`) |
| Soft deletes | **No** `SoftDeletes` trait — `destroy()` performs a hard delete |

---

## 2. SCHEMA SPEC

`MasterController::SCHEMAS['warehouse_master']`:

| Field | `t` | `r` | Ref / Cascade |
|---|---|---|---|
| `wh_id` | text | ✅ | — |
| `wh_name` | text | ✅ | — |
| `wh_type` | select | ✅ | opts: Own Warehouse · Third Party Warehouse |
| `city` | text | ✅ | — |
| `state` | text | — | — |
| `pincode` | text | — | — |
| `contact_person` | text | — | — |
| `contact_phone` | text | — | — |
| `area_sqft` | number | — | — |
| `address` | textarea | — | — |
| `status` | select | ✅ | opts: Active · Inactive |

No reference fields — root of the warehouse hierarchy; Zone/Rack/Freezer masters reference **this** slug.

---

## 3. UNIQUENESS MODEL

`uEach: ['wh_id', 'wh_name']` — each field **independently unique**, tenant-scoped (matched to the `client_id`/`branch_id` tuple the row will be stamped with). Both are text → compared case-insensitively via `LOWER()`. Empty optional values normalize to `NULL` and skip the check.

---

## 4. ENDPOINTS

| Verb | Path | Permission |
|---|---|---|
| GET | `/api/master-counts` | any viewable master |
| GET | `/api/master/warehouse_master` | `can_view` |
| GET | `/api/master/warehouse_master/{id}` | `can_view` |
| POST | `/api/master/warehouse_master` | `can_add` |
| PUT | `/api/master/warehouse_master/{id}` | `can_edit` |
| DELETE | `/api/master/warehouse_master/{id}` | `can_delete` |
| GET | `/api/master/warehouse_master/next-code` | `can_view` → `{code:null}` (no auto-code) |

All under `auth:sanctum` + `user.active`.

---

## 5. SPECIAL HANDLING

Standard schema-driven master. No file uploads, no sublists, no auto-code, no system-seed locks. It is the **cascade root**: warehouse dropdowns in `zone_master`, `racks`, and `freezers` resolve their options from this table via `ref: 'warehouse_master'` (label `wh_name`).

---

## 6. SECURITY & SCOPING

- Reads scoped by `MasterVisibility::applyReadScope` (super=all; client=globals+own; branch=globals+client-level+own branch; employee=globals+client-level+own rows).
- Writes: `resolveOwnership` stamps `client_id`/`branch_id`; body `client_id` ignored for non-super.
- Edit/delete gated by `hierarchicalDenial` (own row OK; employee only own; else row-tier ≤ user-tier).

---

## 7. METRICS

`/master-counts` runs one aggregate: `COUNT(*)` total and `SUM(status IN ('active','1','true','yes','enabled'))` active; inactive = total − active. Card shows Active/Inactive pills; 0/0 on permission-deny or query error.

---

*Related documents: WAREHOUSE_MASTER_FUNCTIONAL_DOCUMENTATION.md · WAREHOUSE_MASTER_API_DOCUMENTATION.md · WAREHOUSE_MASTER_CODE_WALKTHROUGH.md*
