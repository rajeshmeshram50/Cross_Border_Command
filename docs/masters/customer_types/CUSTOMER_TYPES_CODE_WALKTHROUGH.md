# CUSTOMER CONSIGNEE TYPE MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Customer Consignee Type

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

## 0. How to read

All logic lives in `app/Http/Controllers/Api/MasterController.php` keyed by slug `customer_types`; the model is `App\Models\Masters\CustomerTypes`. Registry entries: `MODELS['customer_types']` and `SCHEMAS['customer_types']`. Read scoping delegates to `App\Support\MasterVisibility`.

## 1. List / Search — `list()`

- `authorizeMaster($request,'customer_types','can_view')`.
- Builds query with `OWNERSHIP_WITH` eager-loads, `orderByDesc('id')`.
- `applyScope()` → `MasterVisibility::applyReadScope()` applies the creator-hierarchy + optional `branch_id`.
- `?search=` adds an ILIKE OR-group across text/select fields (`name`, `gst_applicable`, `status`).
- Each row is flattened via `withOwnership()`.

## 2. Create — `store()`

- `authorizeMaster(...,'can_add')`.
- `validatePayload()` validates (name required/unique, gst_applicable ∈ Yes/No, status ∈ Active/Inactive).
- **System-seed collision:** inside the `uEach` case-insensitive pass, because `master_customer_types` has an `is_system` column, a second lookup against global `is_system` rows rejects re-creating "Retailer"/"Wholesaler" (422).
- `created_by` + `resolveOwnership()` stamps stored; `MasterBundleCache::bump()`; returns 201.

## 3. Update — `update()`

- `authorizeMaster(...,'can_edit')`, row fetched under `applyScope()`.
- `hierarchicalDenial()` blocks mutating ancestor-tier rows (403).
- **`if (!empty($row->is_system))` → 403** "system-managed and cannot be edited" — fully locks Retailer/Wholesaler.
- Otherwise `validatePayload($request,'customer_types',$id)` (ignores self on uniqueness) then `$row->update()`.

## 4. Delete — `destroy()`

- `authorizeMaster(...,'can_delete')`, row fetched under `applyScope()`, `hierarchicalDenial()`.
- **`customer_types` + `is_system` guard** → 403 "This customer consignee type is system-managed and cannot be deleted." (protects the `customer_type` FK link).
- Otherwise `$row->delete()` (soft) + `MasterBundleCache::bump()`.

## Cross-cutting patterns

| Concern | Where | Behaviour |
|---|---|---|
| Permission | `authorizeMaster()` | `master.customer_types` flag; super bypass |
| Read scope | `MasterVisibility::applyReadScope` | creator-hierarchy + branch filter |
| Ownership stamp | `resolveOwnership()` | body client_id untrusted for non-super |
| Mutate gate | `hierarchicalDenial()` | own row OK; else tier ≤ user tier |
| Uniqueness | `validatePayload()` uEach | case-insensitive, tenant-scoped |
| System seed | update + destroy + collision | 403 / 422 for Retailer, Wholesaler |
| Cache | `MasterBundleCache::bump()` | every write |

## Notes

- The frontend form lists `gst_applicable` opts as `['No','Yes']` (No first for default); the backend `Rule::in` accepts both regardless of order.
- `next-code` short-circuits to `{code:null}` (not in `AUTO_CODES`).

*Related documents: CUSTOMER_TYPES_FUNCTIONAL_DOCUMENTATION.md, CUSTOMER_TYPES_TECHNICAL_DOCUMENTATION.md, CUSTOMER_TYPES_API_DOCUMENTATION.md*
