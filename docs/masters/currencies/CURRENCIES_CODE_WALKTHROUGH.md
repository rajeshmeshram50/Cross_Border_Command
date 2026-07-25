# CURRENCIES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Currencies

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS

Logic lives in `app/Http/Controllers/Api/MasterController.php` (generic engine) and `app/Support/MasterVisibility.php` (scoping). The model `app/Models/Masters/Currencies.php` is a plain Eloquent model. Line numbers approximate.

---

## 1. LIST / SEARCH  (`list()` ~L261)

1. `authorizeMaster(..., 'can_view')`.
2. Eager-load `client/branch/creator`, `orderByDesc('id')`, `applyScope()`.
3. `?search=` → `ILIKE %term%` OR over `name`, `code`, `symbol`, `status`.
4. `withOwnership()` flattens ownership names (no special flags for this master).

---

## 2. CREATE  (`store()` ~L316)

1. `authorizeMaster(..., 'can_add')`.
2. `validatePayload('currencies')` — required `name/code/symbol`, nullable numeric `exchange_rate`, then the `uEach` case-insensitive checks on `name` and `code` separately.
3. `resolveOwnership()` stamps; `create()`; cache bump; `201`.

---

## 3. UPDATE  (`update()` ~L366)

1. Load within scope; `hierarchicalDenial()`; `is_system` block (n/a).
2. `validatePayload(..., $id)` — both uniqueness checks ignore current id.
3. `update()`; cache bump.

---

## 4. DELETE  (`destroy()` ~L469)

1. Load within scope; `hierarchicalDenial()` gate.
2. No slug-specific guard for `currencies`.
3. `$row->delete()` (soft); cache bump.

---

## SPECIAL PATH

None — standard schema-driven master. The only nuance is the dual `uEach` (`name` + `code`): `validatePayload()` iterates `$caseInsensitiveCols` (~L994) and runs one `LOWER()` existence probe per field.

---

## CROSS-CUTTING PATTERNS

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster()` | `master.currencies.*`; super bypass |
| Read scope | `applyReadScope` | peer-isolated employees |
| Write ownership | `resolveOwnership()` | client/branch/created_by |
| Edit/delete gate | `hierarchicalDenial()` | own row / tier ladder |
| Uniqueness | `validatePayload()` | `name` + `code`, each case-insensitive |
| Cache | `MasterBundleCache::bump()` | on writes |

---

## NOTES

- `exchange_rate` is stored as-is; no conversion logic runs at this master.
- Same name/code can recur across sibling branches because uniqueness is tenant-tuple-scoped.

---
*Related documents: CURRENCIES_FUNCTIONAL_DOCUMENTATION.md, CURRENCIES_TECHNICAL_DOCUMENTATION.md, CURRENCIES_API_DOCUMENTATION.md*
