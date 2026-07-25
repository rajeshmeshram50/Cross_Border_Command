# CUSTOMER CLASSIFICATIONS MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Customer Classifications

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

## 0. How to read

Logic lives in `app/Http/Controllers/Api/MasterController.php` keyed by slug `customer_classifications`; model `App\Models\Masters\CustomerClassifications`. Registry: `MODELS` + `SCHEMAS`. Read scoping in `App\Support\MasterVisibility`.

## 1. List / Search — `list()`

- `authorizeMaster(...,'can_view')`; query with `OWNERSHIP_WITH`, `orderByDesc('id')`.
- `applyScope()` applies creator-hierarchy + `branch_id`.
- `?search=` ILIKE across `name` / `status` (text/select fields).
- Rows flattened via `withOwnership()`.

## 2. Create — `store()`

- `authorizeMaster(...,'can_add')`; `validatePayload()` (name required/unique; credit_limit + payment_terms `numeric`; status enum).
- **System-seed collision:** the `uEach` case-insensitive pass, seeing an `is_system` column, rejects re-creating "Standard"/"VIP" (422).
- Ownership + `created_by` stamped; `MasterBundleCache::bump()`; 201.

## 3. Update — `update()`

- `authorizeMaster(...,'can_edit')`; `hierarchicalDenial()`.
- **`if (!empty($row->is_system))` → 403** "system-managed and cannot be edited" — locks Standard/VIP entirely (name, credit, terms, status).
- Otherwise `validatePayload(...,$id)` then `$row->update()`.

## 4. Delete — `destroy()`

- `authorizeMaster(...,'can_delete')`; row via `applyScope()`; `hierarchicalDenial()`.
- **`customer_classifications` + `is_system` guard** → 403 "This customer classification is system-managed and cannot be deleted." (protects customer credit-tier links).
- Otherwise `$row->delete()` (soft) + `MasterBundleCache::bump()`.

## Cross-cutting patterns

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster()` | `master.customer_classifications`; super bypass |
| Read scope | `MasterVisibility::applyReadScope` | creator-hierarchy + branch |
| Ownership stamp | `resolveOwnership()` | body client_id untrusted |
| Mutate gate | `hierarchicalDenial()` | own row OK; else tier ≤ user tier |
| Uniqueness | `validatePayload()` uEach | case-insensitive, tenant-scoped |
| System seed | update + destroy + collision | 403 / 422 for Standard, VIP |
| Cache | `MasterBundleCache::bump()` | every write |

## Notes

- `credit_limit`/`payment_terms` empty strings are coerced to `NULL` before save.
- `next-code` → `{code:null}` (not in `AUTO_CODES`).

*Related documents: CUSTOMER_CLASSIFICATIONS_FUNCTIONAL_DOCUMENTATION.md, CUSTOMER_CLASSIFICATIONS_TECHNICAL_DOCUMENTATION.md, CUSTOMER_CLASSIFICATIONS_API_DOCUMENTATION.md*
