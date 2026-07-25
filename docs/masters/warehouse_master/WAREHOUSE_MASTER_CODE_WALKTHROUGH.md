# WAREHOUSE MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Warehouse Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

One generic controller serves this master; the slug `warehouse_master` selects the model (`WarehouseMaster`) and schema. All entry points live in `app/Http/Controllers/Api/MasterController.php`; scoping helpers in `app/Support/MasterVisibility.php`.

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($req, 'warehouse_master', 'can_view')` — checks `master.warehouse_master` permission (super bypass).
2. Query built with `::with(OWNERSHIP_WITH)->orderByDesc('id')`.
3. `applyScope()` → `MasterVisibility::applyReadScope()` narrows by tenant tier + optional `?branch_id`.
4. `?search=` wraps an `orWhere ... ILIKE` over text/email/textarea/select fields (`wh_id`, `wh_name`, `wh_type`, `city`, `state`, `pincode`, `contact_person`, `contact_phone`, `address`, `status`).
5. Returns `$q->get()->map(withOwnership)` — bare array with flattened owner names.

## 2. CREATE — `store()`

1. `authorizeMaster(... 'can_add')`.
2. `validatePayload()` — builds rules from the schema (required/nullable, `wh_type`/`status` via `Rule::in`, `area_sqft` numeric) and adds the `uEach` unique probes for `wh_id` + `wh_name`, tenant-scoped and case-insensitive.
3. `created_by = user->id`; `resolveOwnership()` sets `client_id`/`branch_id` (body ignored for non-super).
4. `create($data)` → `MasterBundleCache::bump()` → reload owners → `201` with flattened row.

## 3. UPDATE — `update()`

1. `authorizeMaster(... 'can_edit')`; fetch row within scope (`findOrFail`).
2. `hierarchicalDenial()` — 403 if the row is above the caller's tier and not their own.
3. `is_system` check (unused here — warehouses aren't seeded as system rows).
4. `validatePayload($req, slug, $id)` — unique probes ignore the current id and reuse the existing row's tenant tuple.
5. `update()` → `MasterBundleCache::bump()` → flattened row.

## 4. DELETE — `destroy()`

1. `authorizeMaster(... 'can_delete')`; fetch within scope.
2. `hierarchicalDenial('delete')` → 403 if cross-tier.
3. No warehouse-specific in-use guard → `$row->delete()` (hard delete — no `SoftDeletes` trait) → `MasterBundleCache::bump()` → `{message:"Deleted"}`.

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| AuthZ | `authorizeMaster()` | `master.warehouse_master` per action; super bypass |
| Read scope | `MasterVisibility::applyReadScope` | tenant-tier + branch switcher |
| Write scope | `resolveOwnership()` | stamps client/branch; body untrusted |
| Mutate gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `uEach` wh_id + wh_name, CI, tenant-scoped |
| Cache | `MasterBundleCache::bump()` | every write refreshes dropdowns |

## NOTES

- Warehouse is the cascade **root**; deleting one is not blocked even if zones/racks/freezers still reference it.
- `next-code` is not configured (`AUTO_CODES` lacks this slug) → `{code:null}`.

---

*Related documents: WAREHOUSE_MASTER_FUNCTIONAL_DOCUMENTATION.md · WAREHOUSE_MASTER_TECHNICAL_DOCUMENTATION.md · WAREHOUSE_MASTER_API_DOCUMENTATION.md*
