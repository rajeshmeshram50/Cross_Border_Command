# APPLICABLE PARTIES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Applicable Parties

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

## 0. How to read

Logic lives in `app/Http/Controllers/Api/MasterController.php` keyed by slug `applicable_types`; model `App\Models\Masters\ApplicableTypes`. Registry: `MODELS` + `SCHEMAS`. Read scoping in `App\Support\MasterVisibility`.

## 1. List / Search — `list()`

- `authorizeMaster(...,'can_view')`; query with `OWNERSHIP_WITH`, `orderByDesc('id')`.
- `applyScope()` applies creator-hierarchy + `branch_id`.
- `?search=` ILIKE across `name` / `party_type` / `status` (text + select fields).
- Rows flattened via `withOwnership()`.

## 2. Create — `store()`

- `authorizeMaster(...,'can_add')`; `validatePayload()`:
  - `name` required + `uFields` single-text case-insensitive uniqueness.
  - `party_type` validated via `Rule::in(['Customer','Vendor','Third Party','Carrier','Other'])` — note this differs from the UI label "Supplier".
  - `status` enum.
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
| Permission | `authorizeMaster()` | `master.applicable_types`; super bypass |
| Read scope | `MasterVisibility::applyReadScope` | creator-hierarchy + branch |
| Ownership stamp | `resolveOwnership()` | body client_id untrusted |
| Mutate gate | `hierarchicalDenial()` | own row OK; else tier ≤ user tier |
| Uniqueness | `validatePayload()` uFields | single text → case-insensitive |
| Enum guard | `Rule::in` on `party_type` | server value `Vendor` (UI shows `Supplier`) |
| Cache | `MasterBundleCache::bump()` | every write |

## Notes

- No `AUTO_CODES` entry → `next-code` → `{code:null}`.
- Empty `party_type` coerced to `NULL`.

*Related documents: APPLICABLE_TYPES_FUNCTIONAL_DOCUMENTATION.md, APPLICABLE_TYPES_TECHNICAL_DOCUMENTATION.md, APPLICABLE_TYPES_API_DOCUMENTATION.md*
