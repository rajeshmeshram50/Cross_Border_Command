# SHELF / LEVEL MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Shelf / Level Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Slug `shelf_master` → model `ShelfMaster`, table `master_shelf_master`. Generic `MasterController`; scoping in `MasterVisibility`. Leaf of the warehouse chain, referencing the Rack master.

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($req,'shelf_master','can_view')`.
2. `::with(OWNERSHIP_WITH)->orderByDesc('id')` → `applyScope()`.
3. `?search=` → `ILIKE` over text/select fields: `shelf_name`, `shelf_type`, `status`. `rack_ref` is a numeric id, not searched by name.
4. Return `get()->map(withOwnership)`.

## 2. CREATE — `store()`

1. `authorizeMaster(... 'can_add')`.
2. `validatePayload()` — required: `rack_ref`, `shelf_name`, `level_no`, `shelf_type`, `status`; `rack_ref` `integer`; `level_no`/`max_weight` `numeric`; `shelf_type`/`status` via `Rule::in`; `uFields:['shelf_name']` → single text field promoted to case-insensitive unique probe, tenant-scoped.
3. `created_by` + `resolveOwnership()` stamp scope.
4. `create()` → `MasterBundleCache::bump()` → `201`.

## 3. UPDATE — `update()`

1. `authorizeMaster(... 'can_edit')`; scoped `findOrFail`.
2. `hierarchicalDenial('edit')` → 403 if cross-tier.
3. `validatePayload($req,slug,$id)` — `shelf_name` unique probe excludes current id.
4. `update()` → cache bump.

## 4. DELETE — `destroy()`

1. `authorizeMaster(... 'can_delete')`; scoped `findOrFail`.
2. `hierarchicalDenial('delete')` → 403 if cross-tier.
3. `$row->delete()` (hard) → cache bump.

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| AuthZ | `authorizeMaster()` | `master.shelf_master` per action |
| Read scope | `applyReadScope` | tenant tier + switcher |
| Write scope | `resolveOwnership()` | stamps client/branch |
| Mutate gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `uFields` shelf_name (single text → CI) |
| Reference | `rack_ref` field | `ref → racks`, `integer` only |
| Cache | `MasterBundleCache::bump()` | every write |

## NOTES

- `shelf_name` uniqueness is tenant-wide, not per-rack — plan a naming convention that encodes the rack.
- No auto-code (`next-code` → `{code:null}`).

---

*Related documents: SHELF_MASTER_FUNCTIONAL_DOCUMENTATION.md · SHELF_MASTER_TECHNICAL_DOCUMENTATION.md · SHELF_MASTER_API_DOCUMENTATION.md*
