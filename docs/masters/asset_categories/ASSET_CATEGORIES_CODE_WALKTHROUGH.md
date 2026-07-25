# ASSET CATEGORIES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Asset Categories

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. How to read

Served by the generic `MasterController` (slug `asset_categories`); no dedicated controller. Paths below are in `app/Http/Controllers/Api/MasterController.php`. Model: `app/Models/Masters/AssetCategories.php`.

## 1. List / Search — `list()`

1. `authorizeMaster($request, 'asset_categories', 'can_view')`.
2. Eager-load `OWNERSHIP_WITH`, `orderByDesc('id')`, `applyScope()`.
3. `?search=` → `ilike` OR over text/select fields (`name`, `status`).
4. `withOwnership()` flattens `client_name` / `branch_name` / `creator_name`.

## 2. Create — `store()`

1. `authorizeMaster(..., 'can_add')`.
2. `validatePayload()` — rules from schema; `uFields ['name']` promoted to case-insensitive uniqueness on the resolved tenant tuple.
3. `resolveOwnership()` stamps `client_id`/`branch_id`; `created_by = user.id`.
4. `AssetCategories::create($data)`; `MasterBundleCache::bump()`; 201.

(No `absorbUploads` effect — no file fields. No auto-code.)

## 3. Update — `update()`

1. `authorizeMaster(..., 'can_edit')` + scoped `findOrFail`.
2. `hierarchicalDenial('edit')` → 403 if row outranks caller and isn't theirs.
3. **`is_system` guard:** `if (!empty($row->is_system))` → 403 (fully locked).
4. `validatePayload($id)` (uniqueness excludes current row) → `update()` → cache bump.

## 4. Delete — `destroy()` (the system-seed guard)

1. `authorizeMaster(..., 'can_delete')` + scoped `findOrFail`.
2. `hierarchicalDenial('delete')`.
3. **Guard:**
```php
if ($slug === 'asset_categories' && !empty($row->is_system)) {
    return response()->json(
        ['message' => 'This category is system-managed and cannot be deleted.'], 403);
}
```
   Employee onboarding Stage 1 pulls asset lists by category name — deleting a seeded category would break it.
4. Non-system rows: `$row->delete()` (soft) + `MasterBundleCache::bump()`.

## Cross-cutting patterns

| Concern | Where |
|---|---|
| Permission gate | `authorizeMaster()` |
| Read scope | `MasterVisibility::applyReadScope` |
| Write ownership | `resolveOwnership()` |
| Edit/delete tier gate | `hierarchicalDenial()` |
| Uniqueness (name) | `validatePayload()` `uFields` |
| System-seed edit lock | `update()` `is_system` |
| System-seed delete lock | `destroy()` `asset_categories` branch |
| Cache refresh | `MasterBundleCache::bump()` |

## Notes

- The `is_system` locks apply even to super admins (permission bypass ≠ integrity bypass).
- No cascade check when deleting a non-system category still used by assets — the guard is specifically for onboarding-critical seeds.

---

*Related documents: ASSET_CATEGORIES_FUNCTIONAL_DOCUMENTATION.md, ASSET_CATEGORIES_TECHNICAL_DOCUMENTATION.md, ASSET_CATEGORIES_API_DOCUMENTATION.md*
