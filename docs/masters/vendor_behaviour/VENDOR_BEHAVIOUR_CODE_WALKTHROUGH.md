# SUPPLIER BEHAVIOUR MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Supplier Behaviour

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

## 0. How to read

Logic lives in `app/Http/Controllers/Api/MasterController.php` keyed by slug `vendor_behaviour`; model `App\Models\Masters\VendorBehaviour`. Registry: `MODELS` + `SCHEMAS`. Read scoping in `App\Support\MasterVisibility`.

## 1. List / Search — `list()`

- `authorizeMaster(...,'can_view')`; query with `OWNERSHIP_WITH`, `orderByDesc('id')`.
- `applyScope()` applies creator-hierarchy + `branch_id`.
- `?search=` ILIKE across `name` / `description` / `status`.
- Rows flattened via `withOwnership()`.

## 2. Create — `store()`

- `authorizeMaster(...,'can_add')`; `validatePayload()` (name required + `uFields` single-text case-insensitive uniqueness; status enum).
- No `is_system` column → system-seed collision block skipped.
- Ownership + `created_by` stamped; `MasterBundleCache::bump()`; 201.

## 3. Update — `update()`

- `authorizeMaster(...,'can_edit')`; row via `applyScope()`; `hierarchicalDenial()`.
- `is_system` check inert (column absent).
- `validatePayload(...,$id)` then `$row->update()`.

## 4. Delete — `destroy()`

- `authorizeMaster(...,'can_delete')`; row via `applyScope()`; `hierarchicalDenial()`.
- No slug-specific guard → `$row->delete()` (soft) + `MasterBundleCache::bump()`.

## Cross-cutting patterns

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster()` | `master.vendor_behaviour`; super bypass |
| Read scope | `MasterVisibility::applyReadScope` | creator-hierarchy + branch |
| Ownership stamp | `resolveOwnership()` | body client_id untrusted |
| Mutate gate | `hierarchicalDenial()` | own row OK; else tier ≤ user tier |
| Uniqueness | `validatePayload()` uFields | single text → case-insensitive |
| Cache | `MasterBundleCache::bump()` | every write |

## Notes

- No `AUTO_CODES` entry → `next-code` → `{code:null}`.
- Empty `description` coerced to `NULL`.

*Related documents: VENDOR_BEHAVIOUR_FUNCTIONAL_DOCUMENTATION.md, VENDOR_BEHAVIOUR_TECHNICAL_DOCUMENTATION.md, VENDOR_BEHAVIOUR_API_DOCUMENTATION.md*
