# DOCUMENT TYPES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Document Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

All behaviour is in `app/Http/Controllers/Api/MasterController.php`, driven by the `document_type` schema (uFields `title`). No dedicated controller. Read scope in `MasterVisibility.php`.

---

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster(...,'can_view')`.
2. Query + `OWNERSHIP_WITH` + `orderByDesc('id')`; `applyScope()` restricts to caller's tier.
3. `?search=` → ILIKE OR across `title`, `applicable_to`, `is_mandatory`, `status`.
4. Map rows through `withOwnership` (flattens client/branch/creator names).

---

## 2. CREATE — `store()`

1. `authorizeMaster(...,'can_add')`.
2. `validatePayload()` — required/enum rules; `uFields=[title]` single-text → case-insensitive uniqueness.
3. Stamp `created_by` + `resolveOwnership()`, `create()`, bump cache, `201`.

---

## 3. UPDATE — `update()` (is_system 403)

1. `authorizeMaster(...,'can_edit')`, fetch under scope, `hierarchicalDenial()`.
2. Generic `if (!empty($row->is_system)) → 403` — inert here (no seeds).
3. `validatePayload($id)` re-runs uniqueness ignoring current id; `update()`, bump cache.

---

## 4. DELETE — `destroy()`

1. `authorizeMaster(...,'can_delete')`, fetch under scope, `hierarchicalDenial()`.
2. No per-slug guard for `document_type` — `$row->delete()` (soft) + cache bump.

---

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster` | `master.document_type`; super_admin bypass |
| Read scope | `applyReadScope` | creator-hierarchy tiers |
| Write ownership | `resolveOwnership` | stamps client/branch/created_by |
| Uniqueness | `validatePayload` (single-text uFields) | LOWER() ci on `title` |
| Cache | `MasterBundleCache::bump` | after every write |

---

## NOTES

- `uFields` with one column is treated as a promoted case-insensitive single-field check, not a composite check.
- `next-code` → `{code:null}`.

---
*Related documents: DOCUMENT_TYPE_FUNCTIONAL_DOCUMENTATION.md, DOCUMENT_TYPE_TECHNICAL_DOCUMENTATION.md, DOCUMENT_TYPE_API_DOCUMENTATION.md*
