# DIGITAL TWIN — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Digital Twin

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Slug `digital_twin` → model `DigitalTwin`, table `master_digital_twin`. Served by the generic `MasterController`; scoping in `MasterVisibility`. Minimal name+status master.

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($req,'digital_twin','can_view')`.
2. `::with(OWNERSHIP_WITH)->orderByDesc('id')` → `applyScope()`.
3. `?search=` → `ILIKE` over `name`, `status`.
4. Return `get()->map(withOwnership)`.

## 2. CREATE — `store()`

1. `authorizeMaster(... 'can_add')`.
2. `validatePayload()` — `name`/`status` required; `status` via `Rule::in`; `uFields:['name']` → single text field promoted to case-insensitive unique probe, tenant-scoped.
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
| AuthZ | `authorizeMaster()` | `master.digital_twin` per action |
| Read scope | `applyReadScope` | tenant tier + switcher |
| Write scope | `resolveOwnership()` | stamps client/branch |
| Mutate gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `uFields` name (single text → CI) |
| Cache | `MasterBundleCache::bump()` | every write |

## NOTES

- The master stores metadata only; the 3D/visual view is a frontend feature.
- No auto-code (`next-code` → `{code:null}`).

---

*Related documents: DIGITAL_TWIN_FUNCTIONAL_DOCUMENTATION.md · DIGITAL_TWIN_TECHNICAL_DOCUMENTATION.md · DIGITAL_TWIN_API_DOCUMENTATION.md*
