# PRODUCT CONDITIONS MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Product Conditions

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS

Logic lives in `app/Http/Controllers/Api/MasterController.php` (generic engine) and `app/Support/MasterVisibility.php` (scoping). The model `app/Models/Masters/Conditions.php` is a plain Eloquent model. Line numbers approximate.

---

## 1. LIST / SEARCH  (`list()` ~L261)

1. `authorizeMaster(..., 'can_view')`.
2. Eager-load `client/branch/creator`, `orderByDesc('id')`, `applyScope()`.
3. `?search=` → `ILIKE %term%` OR over `title`, `status`.
4. `withOwnership()` flattens ownership names.

---

## 2. CREATE  (`store()` ~L316)

1. `authorizeMaster(..., 'can_add')`.
2. `validatePayload('conditions')` — required `title`; `uFields=['title']` (single text) → promoted to case-insensitive uniqueness check.
3. `resolveOwnership()` stamps; `create()`; cache bump; `201`.

---

## 3. UPDATE  (`update()` ~L366)

1. Load within scope; `hierarchicalDenial()`; `is_system` block (n/a).
2. `validatePayload(..., $id)` — uniqueness ignores current id.
3. `update()`; cache bump.

---

## 4. DELETE  (`destroy()` ~L469)

1. Load within scope; `hierarchicalDenial()` gate.
2. No slug-specific guard for `conditions`.
3. `$row->delete()` (soft); cache bump.

---

## SPECIAL PATH

None — standard schema-driven master. Note `uFields=['title']` with one text column follows the `singleTextUFields` promotion path (`validatePayload` ~L853), so it behaves like a `uEach` on `title`.

---

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster()` | `master.conditions.*`; super bypass |
| Read scope | `applyReadScope` | peer-isolated employees |
| Write ownership | `resolveOwnership()` | client/branch/created_by |
| Edit/delete gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `title` case-insensitive |
| Cache | `MasterBundleCache::bump()` | on writes |

---

## NOTES

- The frontend digit-guard pattern has no backend counterpart for this slug.

---
*Related documents: CONDITIONS_FUNCTIONAL_DOCUMENTATION.md, CONDITIONS_TECHNICAL_DOCUMENTATION.md, CONDITIONS_API_DOCUMENTATION.md*
