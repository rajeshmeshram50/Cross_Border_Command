# FREEZER MANAGEMENT — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Freezer Management

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Slug `freezers` → model `Freezers`, table `master_freezers`. Served by the generic `MasterController`; scoping in `MasterVisibility`. References the Warehouse master and uses a **composite** uniqueness key.

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($req,'freezers','can_view')`.
2. `::with(OWNERSHIP_WITH)->orderByDesc('id')` → `applyScope()`.
3. `?search=` → `ILIKE` over text/select fields: `name`, `status`. `warehouse` is a numeric id, not searched by name.
4. Return `get()->map(withOwnership)`.

## 2. CREATE — `store()`

1. `authorizeMaster(... 'can_add')`.
2. `validatePayload()` — required: `name`, `warehouse`, `capacity`, `status`; `warehouse` `integer`; `capacity` `numeric`; `status` via `Rule::in`. `uFields:['name','warehouse']` has **2 fields → composite** path: the unique probe checks the combination, LOWER-casing the text `name` and matching the `warehouse` id exactly, all within the tenant tuple.
3. `created_by` + `resolveOwnership()` stamp scope.
4. `create()` → `MasterBundleCache::bump()` → `201`.

## 3. UPDATE — `update()`

1. `authorizeMaster(... 'can_edit')`; scoped `findOrFail`.
2. `hierarchicalDenial('edit')` → 403 if cross-tier.
3. `validatePayload($req,slug,$id)` — composite probe excludes current id, reuses existing tenant tuple.
4. `update()` → cache bump.

## 4. DELETE — `destroy()`

1. `authorizeMaster(... 'can_delete')`; scoped `findOrFail`.
2. `hierarchicalDenial('delete')` → 403 if cross-tier.
3. `$row->delete()` (hard) → cache bump.

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| AuthZ | `authorizeMaster()` | `master.freezers` per action |
| Read scope | `applyReadScope` | tenant tier + switcher |
| Write scope | `resolveOwnership()` | stamps client/branch |
| Mutate gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `uFields` name(CI) + warehouse(exact) — composite |
| Reference | `warehouse` field | `ref → warehouse_master`, `integer` only |
| Cache | `MasterBundleCache::bump()` | every write |

## NOTES

- Composite key = the same freezer name can repeat across warehouses but not within one.
- `occupancy` is a frontend-computed column, not a persisted or validated field.
- No auto-code (`next-code` → `{code:null}`).

---

*Related documents: FREEZERS_FUNCTIONAL_DOCUMENTATION.md · FREEZERS_TECHNICAL_DOCUMENTATION.md · FREEZERS_API_DOCUMENTATION.md*
