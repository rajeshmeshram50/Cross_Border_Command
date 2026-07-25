# TEMPERATURE CLASS MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Temperature Class Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Slug `temp_class_master` → model `TempClassMaster`, table `master_temp_class_master`. Generic `MasterController`; scoping in `MasterVisibility`.

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($req,'temp_class_master','can_view')`.
2. `::with(OWNERSHIP_WITH)->orderByDesc('id')` → `applyScope()`.
3. `?search=` → `ILIKE` over `class_code`, `class_name`, `description`, `requires_monitoring`, `suitable_products`, `status` (text/select). Numeric temp columns excluded.
4. Return `get()->map(withOwnership)`.

## 2. CREATE — `store()`

1. `authorizeMaster(... 'can_add')`.
2. `validatePayload()` — `class_code`/`class_name`/`status` required; `temp_range_min/max`, `alert_threshold` validated `numeric`; `requires_monitoring`/`status` via `Rule::in`; `uEach` probes on `class_code` + `class_name` (CI, tenant-scoped).
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
| AuthZ | `authorizeMaster()` | `master.temp_class_master` per action |
| Read scope | `applyReadScope` | tenant tier + switcher |
| Write scope | `resolveOwnership()` | stamps client/branch |
| Mutate gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `uEach` class_code + class_name, CI |
| Cache | `MasterBundleCache::bump()` | every write |

## NOTES

- Numeric fields have no min/max bounds → negative and inverted ranges pass.
- No auto-code (`next-code` → `{code:null}`).

---

*Related documents: TEMP_CLASS_MASTER_FUNCTIONAL_DOCUMENTATION.md · TEMP_CLASS_MASTER_TECHNICAL_DOCUMENTATION.md · TEMP_CLASS_MASTER_API_DOCUMENTATION.md*
