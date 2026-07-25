# OVERRIDE / DEVIATION REASON MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Override / Deviation Reason

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Override / Deviation Reason has no bespoke controller — it flows through `App\Http\Controllers\Api\MasterController` keyed by slug `deviation_reason`. Field/rule definitions live in `MasterController::SCHEMAS['deviation_reason']`; the model is `App\Models\Masters\DeviationReason`.

---

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($request,'deviation_reason','can_view')`.
2. `resolveModel` → `DeviationReason`; query eager-loads `client/branch/creator`, `orderByDesc('id')`.
3. `applyScope` → `MasterVisibility::applyReadScope` applies creator-hierarchy + optional `?branch_id`.
4. `?search=` → `orWhere(col,'ilike',"%term%")` over text/select fields.
5. Rows mapped through `withOwnership` (flattened names).

---

## 2. CREATE — `store()`

1. `authorizeMaster(...,'can_add')`.
2. `validatePayload` builds rules from the schema (`Rule::in` on `module`, `attachment_required`, `requires_approval`, `status`), then runs the `uEach` case-insensitive check on `reason_code` and `reason_name` (each independently).
3. `created_by` set; `resolveOwnership` stamps `client_id/branch_id`.
4. `DeviationReason::create($data)`; `MasterBundleCache::bump()`; returns 201.

---

## 3. UPDATE — `update()`

1. `authorizeMaster(...,'can_edit')`; row fetched under read scope.
2. `hierarchicalDenial` — own row OK, else row tier ≤ user tier (else 403).
3. No `is_system` on this table, so that lock never fires.
4. `validatePayload($request,'deviation_reason',$id)` re-checks uEach ignoring self; `update()`; cache bump.

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
| Enum guard | `Rule::in` on `module`, `attachment_required`, `requires_approval`, `status` |
| Cache | `MasterBundleCache::bump()` on every write |

---

## NOTES

- Frontend declares fewer unique fields than the backend — the backend `uEach` is the source of truth.
- The frontend `module` option "Supplier Comparison" does not match the backend enum "Vendor Comparison"; backend validation is authoritative.
- `next-code` is not configured (`AUTO_CODES` has no `deviation_reason` entry) → `{code:null}`.

---
*Related documents: DEVIATION_REASON_FUNCTIONAL_DOCUMENTATION.md, DEVIATION_REASON_TECHNICAL_DOCUMENTATION.md, DEVIATION_REASON_API_DOCUMENTATION.md*
