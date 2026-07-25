# RACK & LOCATION MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Rack & Location Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Slug `racks` → model `Racks`, table `master_racks`. Served by the generic `MasterController`; scoping in `MasterVisibility`. This master joins four other warehouse masters via reference fields.

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($req,'racks','can_view')`.
2. `::with(OWNERSHIP_WITH)->orderByDesc('id')` → `applyScope()`.
3. `?search=` → `ILIKE` over text/select fields only: `whType`, `rackName`, `rackStatus`. The four ref fields are numeric ids, so name-search doesn't reach them.
4. Return `get()->map(withOwnership)` — refs stay as raw ids; the frontend maps them to names.

## 2. CREATE — `store()`

1. `authorizeMaster(... 'can_add')`.
2. `validatePayload()` — required: `whType`, `warehouse`, `zone`, `rackName`, `rackType`, `rackStatus`; refs validated `integer`; `whType`/`rackStatus` via `Rule::in`; `shelves`/`maxWeight`/`maxVolume` `numeric`; `uFields:['rackName']` → single text field promoted to case-insensitive unique probe, tenant-scoped.
3. `created_by` + `resolveOwnership()` stamp scope.
4. `create()` → `MasterBundleCache::bump()` → `201`.

## 3. UPDATE — `update()`

1. `authorizeMaster(... 'can_edit')`; scoped `findOrFail`.
2. `hierarchicalDenial('edit')` → 403 if cross-tier.
3. `validatePayload($req,slug,$id)` — `rackName` unique probe excludes current id, reuses existing tenant tuple.
4. `update()` → cache bump.

## 4. DELETE — `destroy()`

1. `authorizeMaster(... 'can_delete')`; scoped `findOrFail`.
2. `hierarchicalDenial('delete')` → 403 if cross-tier.
3. `$row->delete()` (hard) → cache bump. No dependent-shelf guard.

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| AuthZ | `authorizeMaster()` | `master.racks` per action |
| Read scope | `applyReadScope` | tenant tier + switcher |
| Write scope | `resolveOwnership()` | stamps client/branch |
| Mutate gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `uFields` rackName (single text → CI) |
| References | 4 ref fields | warehouse/zone/rackType/tempClass, `integer` only |
| Counts | `counts()` | reads `status` → not present → caught → 0/0 |
| Cache | `MasterBundleCache::bump()` | every write |

## NOTES

- The dashboard's Active/Inactive pills are meaningless for racks (no `status` column → the aggregate throws and the card shows 0/0).
- No auto-code (`next-code` → `{code:null}`); rack names are entered manually.

---

*Related documents: RACKS_FUNCTIONAL_DOCUMENTATION.md · RACKS_TECHNICAL_DOCUMENTATION.md · RACKS_API_DOCUMENTATION.md*
