# SOURCING TYPE MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Sourcing Type

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Sourcing Type has no bespoke controller — it flows through `App\Http\Controllers\Api\MasterController` keyed by slug `sourcing_type`. Field/rule definitions live in `MasterController::SCHEMAS['sourcing_type']`; the model is `App\Models\Masters\SourcingType`.

---

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($request,'sourcing_type','can_view')`.
2. `resolveModel` → `SourcingType`; query eager-loads `client/branch/creator`, `orderByDesc('id')`.
3. `applyScope` → `MasterVisibility::applyReadScope` applies creator-hierarchy + optional `?branch_id`.
4. `?search=` → `orWhere(col,'ilike',"%term%")` over text/email/textarea/select fields.
5. Rows mapped through `withOwnership` (flattened names).

---

## 2. CREATE — `store()`

1. `authorizeMaster(...,'can_add')`.
2. `validatePayload` builds rules from the schema, then runs the `uEach` case-insensitive check on `type_code` and `type_name` (each independently).
3. `created_by` set; `resolveOwnership` stamps `client_id/branch_id`.
4. `SourcingType::create($data)`; `MasterBundleCache::bump()`; returns 201.

---

## 3. UPDATE — `update()`

1. `authorizeMaster(...,'can_edit')`; row fetched under read scope.
2. `hierarchicalDenial` — own row OK, else row tier ≤ user tier (else 403).
3. No `is_system` on this table, so that lock never fires.
4. `validatePayload($request,'sourcing_type',$id)` re-checks uEach ignoring self; `update()`; cache bump.

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
| Uniqueness | `uEach` → `LOWER()` per-field, tenant-scoped |
| Enum guard | `Rule::in` on `quotation_required`, `approval_required`, `urgency_flag`, `status` |
| Cache | `MasterBundleCache::bump()` on every write |

---

## NOTES

- `urgency_flag` is the only non-required field — empty submissions persist as NULL.
- `next-code` is not configured (`AUTO_CODES` has no `sourcing_type` entry) → `{code:null}`.

---
*Related documents: SOURCING_TYPE_FUNCTIONAL_DOCUMENTATION.md, SOURCING_TYPE_TECHNICAL_DOCUMENTATION.md, SOURCING_TYPE_API_DOCUMENTATION.md*
