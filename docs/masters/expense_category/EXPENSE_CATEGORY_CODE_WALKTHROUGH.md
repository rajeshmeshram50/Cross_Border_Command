# EXPENSE CATEGORIES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Expense Categories

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. How to read

Served by the generic `MasterController` (slug `expense_category`); no dedicated controller. Paths below are in `app/Http/Controllers/Api/MasterController.php`. Model: `app/Models/Masters/ExpenseCategories.php`.

## 1. List / Search — `list()`

1. `authorizeMaster($request, 'expense_category', 'can_view')`.
2. Eager-load `OWNERSHIP_WITH`, `orderByDesc('id')`, `applyScope()`.
3. `?search=` → `ilike` OR over text/textarea/select (`code`, `name`, `description`, `status`).
4. `withOwnership()` flattens owner names.

## 2. Create — `store()` (with next-code preview)

1. Frontend first calls `nextCode()` to pre-fill the `code` field (see below).
2. `authorizeMaster(..., 'can_add')`.
3. `validatePayload()` — schema rules; `uEach ['code','name']` each case-insensitive-unique on the resolved tenant tuple.
4. `resolveOwnership()` stamps `client_id`/`branch_id`; `created_by = user.id`.
5. `ExpenseCategories::create($data)`; `MasterBundleCache::bump()`; 201.

### `nextCode()` — the `EXC-##` generator

```php
private const AUTO_CODES = [
    'expense_category' => ['col' => 'code', 'prefix' => 'EXC-', 'pad' => 2],
];
```
- Guard: unconfigured slugs return `{code:null}`.
- Applies the **same `applyScope`** as the list (globals + own scope + active `branch_id`) — NOT a strict tuple — so the previewed code can't collide with a row the user already sees.
- Scans `code`, regex `^EXC-(\d+)$`, takes max, returns `EXC-<max+1>` padded to 2.
- Returns `{ code, prefix }`.

## 3. Update — `update()`

1. `authorizeMaster(..., 'can_edit')` + scoped `findOrFail`.
2. `hierarchicalDenial('edit')`; generic `is_system` guard (no seeds here in practice).
3. `validatePayload($id)` (unique check excludes current row) → `update()` → cache bump.

## 4. Delete — `destroy()`

1. `authorizeMaster(..., 'can_delete')` + scoped `findOrFail`.
2. `hierarchicalDenial('delete')`.
3. Soft delete + `MasterBundleCache::bump()`. (No slug-specific guard for this master.)

## Cross-cutting patterns

| Concern | Where |
|---|---|
| Permission gate | `authorizeMaster()` |
| Read scope | `MasterVisibility::applyReadScope` |
| Write ownership | `resolveOwnership()` |
| Edit/delete tier gate | `hierarchicalDenial()` |
| Uniqueness (code + name) | `validatePayload()` `uEach` |
| Auto code `EXC-##` | `nextCode()` + `AUTO_CODES` |
| Cache refresh | `MasterBundleCache::bump()` |

## Notes

- Frontend `masterConfigs.ts` sets `autogenApi: true` on `code`, so the form pulls the value from `next-code` (server) rather than computing locally like Assets does.
- The preview is not reserved — a race can 422 the second writer, who must fetch a fresh code and retry.

---

*Related documents: EXPENSE_CATEGORY_FUNCTIONAL_DOCUMENTATION.md, EXPENSE_CATEGORY_TECHNICAL_DOCUMENTATION.md, EXPENSE_CATEGORY_API_DOCUMENTATION.md*
