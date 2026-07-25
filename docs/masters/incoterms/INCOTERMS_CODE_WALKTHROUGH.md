# INCOTERMS MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Incoterms

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS

Logic lives in `app/Http/Controllers/Api/MasterController.php` (generic engine) and `app/Support/MasterVisibility.php` (scoping). The model `app/Models/Masters/Incoterms.php` is a plain Eloquent model. Line numbers approximate.

---

## 1. LIST / SEARCH  (`list()` ~L261)

1. `authorizeMaster(..., 'can_view')`.
2. Eager-load `client/branch/creator`, `orderByDesc('id')`, `applyScope()`.
3. `?search=` → `ILIKE %term%` OR over `code`, `full_name`, `transport_mode`, `status`.
4. `withOwnership()` flattens ownership names.

---

## 2. CREATE  (`store()` ~L316)

1. `authorizeMaster(..., 'can_add')`.
2. `validatePayload('incoterms')` — required `code`/`full_name`, nullable `transport_mode ∈ opts`, then `uEach` case-insensitive checks on `code` and `full_name` separately.
3. `resolveOwnership()` stamps; `create()`; cache bump; `201`.

---

## 3. UPDATE  (`update()` ~L366)

1. Load within scope; `hierarchicalDenial()`; `is_system` block (n/a).
2. `validatePayload(..., $id)` — both uniqueness checks ignore current id.
3. `update()`; cache bump.

---

## 4. DELETE  (`destroy()` ~L469)

1. Load within scope; `hierarchicalDenial()` gate.
2. No slug-specific guard for `incoterms`.
3. `$row->delete()` (soft); cache bump.

---

## SPECIAL PATH

None — standard schema-driven master. The dual `uEach` (`code` + `full_name`) is handled by the `$caseInsensitiveCols` loop in `validatePayload()` (~L994), one `LOWER()` probe per field.

---

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster()` | `master.incoterms.*`; super bypass |
| Read scope | `applyReadScope` | peer-isolated employees |
| Write ownership | `resolveOwnership()` | client/branch/created_by |
| Edit/delete gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `code` + `full_name`, each case-insensitive |
| Cache | `MasterBundleCache::bump()` | on writes |

---

## NOTES

- The enum `transport_mode` is validated server-side via `Rule::in`.
- The frontend full-name digit-guard has no backend counterpart for this slug.

---
*Related documents: INCOTERMS_FUNCTIONAL_DOCUMENTATION.md, INCOTERMS_TECHNICAL_DOCUMENTATION.md, INCOTERMS_API_DOCUMENTATION.md*
