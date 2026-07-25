# UNITS OF MEASUREMENT MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Units of Measurement

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS

Backend logic lives in `app/Http/Controllers/Api/MasterController.php` (generic engine) and `app/Support/MasterVisibility.php` (scoping). The model `app/Models/Masters/Uom.php` is a plain Eloquent model. The short-code auto-derive is frontend-only, in `resources/js/pages/master/masterConfigs.ts` (`autoDeriveFrom: 'title'`) + `MasterPage.tsx`. Line numbers approximate.

---

## 1. LIST / SEARCH  (`list()` ~L261)

1. `authorizeMaster(..., 'can_view')`.
2. Eager-load `client/branch/creator`, `orderByDesc('id')`, `applyScope()`.
3. `?search=` → `ILIKE %term%` OR over `title`, `short_code`, `unit_type`, `status`.
4. `withOwnership()` flattens ownership names.

---

## 2. CREATE  (`store()` ~L316)

1. `authorizeMaster(..., 'can_add')`.
2. `validatePayload('uom')` — required `title`/`short_code`, nullable `unit_type ∈ opts`, then `uEach` case-insensitive checks on `title` and `short_code` separately.
3. `resolveOwnership()` stamps; `create()`; cache bump; `201`.

---

## 3. UPDATE  (`update()` ~L366)

1. Load within scope; `hierarchicalDenial()`; `is_system` block (n/a).
2. `validatePayload(..., $id)` — uniqueness ignores current id.
3. `update()`; cache bump.

---

## 4. DELETE  (`destroy()` ~L469)

1. Load within scope; `hierarchicalDenial()` gate.
2. No slug-specific guard for `uom`.
3. `$row->delete()` (soft); cache bump.

---

## SPECIAL PATH — short-code auto-derive (frontend)

- `masterConfigs.ts` marks `short_code` with `autoDeriveFrom: 'title'`.
- `MasterPage.tsx` watches the `title` input and live-fills `short_code` (still editable) before submit.
- The backend performs no derivation — it validates and stores whatever `short_code` arrives (required + unique).

---

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster()` | `master.uom.*`; super bypass |
| Read scope | `applyReadScope` | peer-isolated employees |
| Write ownership | `resolveOwnership()` | client/branch/created_by |
| Edit/delete gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `title` + `short_code`, each case-insensitive |
| Auto-derive | `MasterPage.tsx` | frontend only |
| Cache | `MasterBundleCache::bump()` | on writes |

---

## NOTES

- The title digit-guard (`P_NAME_NO_DIGITS`) is frontend-only; the backend accepts any string within the length cap.

---
*Related documents: UOM_FUNCTIONAL_DOCUMENTATION.md, UOM_TECHNICAL_DOCUMENTATION.md, UOM_API_DOCUMENTATION.md*
