# SUPPLIER DIRECTORY MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Supplier Directory

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Supplier Directory has no bespoke controller — it flows through `App\Http\Controllers\Api\MasterController` keyed by slug `vendor_directory`. Field/rule definitions live in `MasterController::SCHEMAS['vendor_directory']`; the model is `App\Models\Masters\VendorDirectory`.

---

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($request,'vendor_directory','can_view')`.
2. `resolveModel` → `VendorDirectory`; query eager-loads **only** `client/branch/creator` (not segment/state), `orderByDesc('id')`.
3. `applyScope` → `MasterVisibility::applyReadScope` applies creator-hierarchy + optional `?branch_id`.
4. `?search=` → `orWhere(col,'ilike',"%term%")` over text/email/textarea/select fields (vendor_company_name, contact_person, mobile_number, email_id, address, city, country, mapping_mode, status).
5. The `country_id` cascade filter is skipped — this master has a `country` enum, not a `country_id` column.
6. Rows mapped through `withOwnership` (flattened names); `segment_id`/`state` stay raw integer ids.

---

## 2. CREATE — `store()`

1. `authorizeMaster(...,'can_add')`.
2. `validatePayload` builds rules from the schema — `vendor_company_name` honours `maxLen` 512, `email_id` is `email|max:255`, `segment_id` and `state` validate as **integer** references — then runs the `uEach` case-insensitive check on `vendor_company_name`, `mobile_number` and `email_id` (each independently).
3. `created_by` set; `resolveOwnership` stamps `client_id/branch_id`.
4. `VendorDirectory::create($data)`; `MasterBundleCache::bump()`; returns 201.

---

## 3. UPDATE — `update()`

1. `authorizeMaster(...,'can_edit')`; row fetched under read scope.
2. `hierarchicalDenial` — own row OK; employees only own; else row tier ≤ user tier (else 403).
3. No `is_system` on this table, so that lock never fires.
4. `validatePayload($request,'vendor_directory',$id)` re-checks uEach ignoring self; `update()`; cache bump.

---

## 4. DELETE — `destroy()`

1. `authorizeMaster(...,'can_delete')`; `hierarchicalDenial`.
2. No special guards for this slug → `$row->delete()` (**hard delete**, no SoftDeletes trait); cache bump.

---

## CROSS-CUTTING PATTERNS

| Concern | Mechanism |
|---|---|
| Tenant scope | `MasterVisibility::applyReadScope` |
| Edit/delete gate | `hierarchicalDenial` |
| Ownership stamp | `resolveOwnership` (body `client_id` honoured only for super admin) |
| Uniqueness | `uEach` → `LOWER()` per-field on vendor_company_name / mobile_number / email_id |
| References | `segment_id` → segments, `state` → states — validated as integer |
| Enum guard | `Rule::in` on `country`, `mapping_mode`, `status` |
| Cache | `MasterBundleCache::bump()` on every write |

---

## NOTES

- `segment_id` and `state` are validated as integers (references to the segments/states masters) even though the `MasterSelect` may post a string.
- `vendor_company_name` is a textarea whose 512-char cap is honoured via the schema `maxLen`.
- `next-code` is not configured (`AUTO_CODES` has no `vendor_directory` entry) → `{code:null}`.

---
*Related documents: VENDOR_DIRECTORY_FUNCTIONAL_DOCUMENTATION.md, VENDOR_DIRECTORY_TECHNICAL_DOCUMENTATION.md, VENDOR_DIRECTORY_API_DOCUMENTATION.md*
