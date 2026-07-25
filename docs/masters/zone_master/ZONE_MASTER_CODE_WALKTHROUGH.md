# ZONE MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Zone Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Slug `zone_master` → model `ZoneMaster`, table `master_zone_master`. All logic is the generic `MasterController` (`app/Http/Controllers/Api/MasterController.php`); scoping in `MasterVisibility`.

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($req,'zone_master','can_view')`.
2. `::with(OWNERSHIP_WITH)->orderByDesc('id')`, then `applyScope()` (tenant tier + `?branch_id`).
3. `?search=` → `ILIKE` over `zone_id`, `zone_name`, `zone_type`, `purpose`, `cold_chain`, `hazardous`, `status` (text/select fields).
4. Return `get()->map(withOwnership)`.

## 2. CREATE — `store()`

1. `authorizeMaster(... 'can_add')`.
2. `validatePayload()` — `zone_id`/`zone_name`/`zone_type`/`warehouse`/`status` required; `warehouse` rule = `integer`; `zone_type`/`status` via `Rule::in`; `uEach` unique probes on `zone_id` + `zone_name` (CI, tenant-scoped).
3. `created_by` + `resolveOwnership()` stamp scope.
4. `create()` → `MasterBundleCache::bump()` → `201`.

## 3. UPDATE — `update()`

1. `authorizeMaster(... 'can_edit')`; `findOrFail` within scope.
2. `hierarchicalDenial('edit')` → 403 if cross-tier.
3. `validatePayload($req,slug,$id)` — unique probes exclude current id, reuse existing tenant tuple.
4. `update()` → cache bump.

## 4. DELETE — `destroy()`

1. `authorizeMaster(... 'can_delete')`; scoped `findOrFail`.
2. `hierarchicalDenial('delete')` → 403 if cross-tier.
3. `$row->delete()` (hard) → cache bump → `{message:"Deleted"}`. No dependent-rack guard.

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| AuthZ | `authorizeMaster()` | `master.zone_master` per action |
| Read scope | `applyReadScope` | tenant tier + switcher |
| Write scope | `resolveOwnership()` | stamps client/branch |
| Mutate gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `uEach` zone_id + zone_name, CI |
| Reference | `warehouse` field | `ref → warehouse_master`, validated `integer` only |
| Cache | `MasterBundleCache::bump()` | every write |

## NOTES

- The `warehouse` cascade is a UI/label convenience; the backend does not verify the parent exists.
- No auto-code (`next-code` → `{code:null}`).

---

*Related documents: ZONE_MASTER_FUNCTIONAL_DOCUMENTATION.md · ZONE_MASTER_TECHNICAL_DOCUMENTATION.md · ZONE_MASTER_API_DOCUMENTATION.md*
