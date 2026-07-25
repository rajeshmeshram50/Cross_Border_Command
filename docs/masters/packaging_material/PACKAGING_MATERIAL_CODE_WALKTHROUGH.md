# PACKAGING MATERIALS MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Packaging Materials

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS

Logic lives in `app/Http/Controllers/Api/MasterController.php` (generic engine) and `app/Support/MasterVisibility.php` (scoping). The model `app/Models/Masters/PackagingMaterial.php` is a plain Eloquent model. Line numbers approximate.

---

## 1. LIST / SEARCH  (`list()` ~L261)

1. `authorizeMaster(..., 'can_view')`.
2. Eager-load `client/branch/creator`, `orderByDesc('id')`, `applyScope()`.
3. `?search=` → `ILIKE %term%` OR over `title`, `material_type`, `status`.
4. `withOwnership()` flattens ownership names.

---

## 2. CREATE  (`store()` ~L316)

1. `authorizeMaster(..., 'can_add')`.
2. `validatePayload('packaging_material')` — required `title`, nullable `material_type ∈ opts`, then `uEach` case-insensitive check on `title`.
3. `resolveOwnership()` stamps; `create()`; cache bump; `201`.

---

## 3. UPDATE  (`update()` ~L366)

1. Load within scope; `hierarchicalDenial()`; `is_system` block (n/a).
2. `validatePayload(..., $id)` — uniqueness ignores current id.
3. `update()`; cache bump.

---

## 4. DELETE  (`destroy()` ~L469)

1. Load within scope; `hierarchicalDenial()` gate.
2. No slug-specific guard for `packaging_material`.
3. `$row->delete()` (soft); cache bump.

---

## SPECIAL PATH

None — standard schema-driven master.

---

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster()` | `master.packaging_material.*`; super bypass |
| Read scope | `applyReadScope` | peer-isolated employees |
| Write ownership | `resolveOwnership()` | client/branch/created_by |
| Edit/delete gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `title` case-insensitive |
| Cache | `MasterBundleCache::bump()` | on writes |

---

## NOTES

- The enum `material_type` is validated server-side via `Rule::in`.

---
*Related documents: PACKAGING_MATERIAL_FUNCTIONAL_DOCUMENTATION.md, PACKAGING_MATERIAL_TECHNICAL_DOCUMENTATION.md, PACKAGING_MATERIAL_API_DOCUMENTATION.md*
