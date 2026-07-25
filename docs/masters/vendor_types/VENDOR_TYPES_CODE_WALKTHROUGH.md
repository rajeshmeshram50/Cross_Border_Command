# SUPPLIER TYPES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Supplier Types

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

## 0. How to read

Logic lives in `app/Http/Controllers/Api/MasterController.php` keyed by slug `vendor_types`; model `App\Models\Masters\VendorTypes`. Registry: `MODELS` + `SCHEMAS`. Read scoping in `App\Support\MasterVisibility`.

## 1. List / Search — `list()`

- `authorizeMaster(...,'can_view')`; query with `OWNERSHIP_WITH`, `orderByDesc('id')`.
- `applyScope()` applies creator-hierarchy + `branch_id`.
- `?search=` ILIKE across `name` / `description` / `status`.
- Rows flattened via `withOwnership()`.

## 2. Create — `store()`

- `authorizeMaster(...,'can_add')`; `validatePayload()` (name required + case-insensitive `uFields` uniqueness; description string; status enum).
- No `is_system` column on `master_vendor_types`, so the system-seed collision block is skipped.
- Ownership + `created_by` stamped; `MasterBundleCache::bump()`; 201.

## 3. Update — `update()`

- `authorizeMaster(...,'can_edit')`; row via `applyScope()`; `hierarchicalDenial()` (403 if mutating a higher-tier row).
- `is_system` check is inert (column absent → `empty()` true → no 403).
- `validatePayload(...,$id)` (ignores self on uniqueness) then `$row->update()`.

## 4. Delete — `destroy()`

- `authorizeMaster(...,'can_delete')`; row via `applyScope()`; `hierarchicalDenial()`.
- No slug-specific delete guard for `vendor_types` → `$row->delete()` (soft) + `MasterBundleCache::bump()`.

## Cross-cutting patterns

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster()` | `master.vendor_types`; super bypass |
| Read scope | `MasterVisibility::applyReadScope` | creator-hierarchy + branch |
| Ownership stamp | `resolveOwnership()` | body client_id untrusted |
| Mutate gate | `hierarchicalDenial()` | own row OK; else tier ≤ user tier |
| Uniqueness | `validatePayload()` uFields | single text → case-insensitive |
| Cache | `MasterBundleCache::bump()` | every write |

## Notes

- No `AUTO_CODES` entry → `next-code` short-circuits to `{code:null}`.
- Empty `description` is coerced to `NULL` before save.

*Related documents: VENDOR_TYPES_FUNCTIONAL_DOCUMENTATION.md, VENDOR_TYPES_TECHNICAL_DOCUMENTATION.md, VENDOR_TYPES_API_DOCUMENTATION.md*
