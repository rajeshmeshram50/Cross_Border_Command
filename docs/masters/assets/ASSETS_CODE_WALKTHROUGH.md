# ASSETS MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Assets

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. How to read

Assets is served by the generic `MasterController` (slug `assets`). No dedicated controller. Everything below is `app/Http/Controllers/Api/MasterController.php` unless noted. The model `app/Models/Masters/Assets.php` adds the auto-code hook.

## 1. List / Search — `list()`

1. `authorizeMaster($request, 'assets', 'can_view')`.
2. Query with `OWNERSHIP_WITH` eager loads + `orderByDesc('id')`.
3. `applyScope()` → `MasterVisibility::applyReadScope` (globals + own client/branch, honours `?branch_id`).
4. `?search=` builds an `ilike` OR across text/select/textarea fields (`asset_name`, `code`, `description`, `status`).
5. Each row passed through `withOwnership()` to flatten `client_name` / `branch_name` / `creator_name`.

## 2. Create — `store()`

1. `authorizeMaster(..., 'can_add')`.
2. `validatePayload()` → normalize → build rules from schema → enforce `uEach` uniqueness (`asset_name`, `code`) against the resolved tenant tuple.
3. `resolveOwnership()` → stamp `client_id` / `branch_id`; `created_by = user.id`.
4. `absorbUploads()` → move `invoice_file` → `invoice_file_path`, `warranty_card_file` → `warranty_card_file_path`.
5. `Assets::create($data)` — the model's `creating` hook fills `code` (`AST-####`) if still empty.
6. `MasterBundleCache::bump()`; return row + 201.

## 3. Update — `update()`

1. `authorizeMaster(..., 'can_edit')` + `findOrFail` within scope.
2. `hierarchicalDenial()` — 403 if row outranks caller and isn't theirs.
3. `is_system` check (no seeded assets by default, but the guard is global).
4. `validatePayload($id)` (unique check excludes the current row's tuple).
5. `absorbUploads(..., $row)` — **deletes the old stored file** on the public disk before writing the new `*_file_path`.
6. `update()` + cache bump.

## 4. Delete — `destroy()`

1. `authorizeMaster(..., 'can_delete')` + scoped `findOrFail`.
2. `hierarchicalDenial('delete')`.
3. Soft delete + `MasterBundleCache::bump()`.

## Special path — upload convention

`absorbUploads()` (helper): key `foo_file` → column `foo_file_path`; skipped unless the column is fillable. Stored via `store("master/assets", 'public')`. This is the same generic absorber every file-bearing master uses; Assets is currently the primary consumer.

## Auto-code path

Unlike Expense Categories (which use the `AUTO_CODES` + `next-code` endpoint), the Asset ID is minted inside `Assets::booted()`:

```php
static::creating(function (self $row) {
    if (empty($row->code)) {
        $maxN = ... max('AST-(\d+)') ...;
        $row->code = 'AST-' . str_pad($maxN + 1, 4, '0', STR_PAD_LEFT);
    }
});
```

`MasterController::nextCode('assets')` returns `{code:null}`; the form previews the value client-side from the loaded records.

## Cross-cutting patterns

| Concern | Where |
|---|---|
| Permission gate | `authorizeMaster()` |
| Read scope | `MasterVisibility::applyReadScope` |
| Write ownership | `resolveOwnership()` |
| Edit/delete tier gate | `hierarchicalDenial()` |
| Uniqueness | `validatePayload()` `uEach` |
| File uploads | `absorbUploads()` |
| Auto code | `Assets::booted()` |
| Cache refresh | `MasterBundleCache::bump()` |

## Notes

- The frontend `masterConfigs.ts` lists `uFields: ['asset_name']`, but the **backend enforces both** `asset_name` and `code` via `uEach` — the server is authoritative.
- Invoice "MANDATORY" label is UI-only; no backend required rule exists for `invoice_file`.

---

*Related documents: ASSETS_FUNCTIONAL_DOCUMENTATION.md, ASSETS_TECHNICAL_DOCUMENTATION.md, ASSETS_API_DOCUMENTATION.md*
