# HAZARD CLASSIFICATIONS MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Hazard Classifications

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

All behaviour is in `app/Http/Controllers/Api/MasterController.php`, driven by the `haz_class` schema (uFields `name`, two fields only). No dedicated controller. Read scope in `MasterVisibility.php`.

---

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster(...,'can_view')`.
2. Query + `OWNERSHIP_WITH` + `orderByDesc('id')`; `applyScope()`.
3. `?search=` → ILIKE OR across `name`, `status`.
4. Map rows through `withOwnership`.

---

## 2. CREATE — `store()`

1. `authorizeMaster(...,'can_add')`.
2. `validatePayload()` — `name` required ≤50, `status` enum; `uFields=[name]` single-text → case-insensitive uniqueness.
3. Stamp `created_by` + `resolveOwnership()`, `create()`, bump cache, `201`.

---

## 3. UPDATE — `update()` (is_system 403)

1. `authorizeMaster(...,'can_edit')`, fetch under scope, `hierarchicalDenial()`.
2. Generic `if (!empty($row->is_system)) → 403` — inert (no seeds).
3. `validatePayload($id)` re-runs uniqueness ignoring current id; `update()`, bump cache.

---

## 4. DELETE — `destroy()`

1. `authorizeMaster(...,'can_delete')`, fetch under scope, `hierarchicalDenial()`.
2. No per-slug guard — `$row->delete()` (soft) + cache bump.

---

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster` | `master.haz_class`; super_admin bypass |
| Read scope | `applyReadScope` | creator-hierarchy tiers |
| Write ownership | `resolveOwnership` | stamps client/branch/created_by |
| Uniqueness | `validatePayload` (single-text uFields) | LOWER() ci on `name` |
| Cache | `MasterBundleCache::bump` | after every write |

---

## NOTES

- Simplest shape in this batch: two fields (`name`, `status`).
- `next-code` → `{code:null}`.

---
*Related documents: HAZ_CLASS_FUNCTIONAL_DOCUMENTATION.md, HAZ_CLASS_TECHNICAL_DOCUMENTATION.md, HAZ_CLASS_API_DOCUMENTATION.md*
