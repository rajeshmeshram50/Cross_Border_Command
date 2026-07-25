# RACK TYPE MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Rack Type Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Slug `rack_type_master` → model `RackTypeMaster`, table `master_rack_type_master`. Served by the generic `MasterController`; scoping in `MasterVisibility`.

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($req,'rack_type_master','can_view')`.
2. `::with(OWNERSHIP_WITH)->orderByDesc('id')` → `applyScope()`.
3. `?search=` → `ILIKE` over `type_code`, `type_name`, `description`, `suitable_for`, `status`.
4. Return `get()->map(withOwnership)`.

## 2. CREATE — `store()`

1. `authorizeMaster(... 'can_add')`.
2. `validatePayload()` — `type_code`/`type_name`/`status` required; numbers validated `numeric`; `suitable_for`/`status` via `Rule::in`; `uEach` probes on `type_code` + `type_name` (CI, tenant-scoped).
3. `created_by` + `resolveOwnership()` stamp scope.
4. `create()` → `MasterBundleCache::bump()` → `201`.

## 3. UPDATE — `update()`

1. `authorizeMaster(... 'can_edit')`; scoped `findOrFail`.
2. `hierarchicalDenial('edit')` → 403 if cross-tier.
3. `validatePayload($req,slug,$id)` (excludes current id).
4. `update()` → cache bump.

## 4. DELETE — `destroy()`

1. `authorizeMaster(... 'can_delete')`; scoped `findOrFail`.
2. `hierarchicalDenial('delete')` → 403 if cross-tier.
3. `$row->delete()` (hard) → cache bump.

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| AuthZ | `authorizeMaster()` | `master.rack_type_master` per action |
| Read scope | `applyReadScope` | tenant tier + switcher |
| Write scope | `resolveOwnership()` | stamps client/branch |
| Mutate gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `uEach` type_code + type_name, CI |
| Cache | `MasterBundleCache::bump()` | every write |

## NOTES

- No cascade — this catalogue is consumed by the Rack master, not the other way around.
- No auto-code (`next-code` → `{code:null}`).

---

*Related documents: RACK_TYPE_MASTER_FUNCTIONAL_DOCUMENTATION.md · RACK_TYPE_MASTER_TECHNICAL_DOCUMENTATION.md · RACK_TYPE_MASTER_API_DOCUMENTATION.md*
