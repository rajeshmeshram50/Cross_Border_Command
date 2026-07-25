# MATCH EXCEPTION TYPE MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Match Exception Type

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Match Exception Type has no bespoke controller — it flows through `App\Http\Controllers\Api\MasterController` keyed by slug `match_exception`. Field/rule definitions live in `MasterController::SCHEMAS['match_exception']`; the model is `App\Models\Masters\MatchException`.

---

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($request,'match_exception','can_view')`.
2. `resolveModel` → `MatchException`; query eager-loads `client/branch/creator`, `orderByDesc('id')`.
3. `applyScope` → `MasterVisibility::applyReadScope` applies creator-hierarchy + optional `?branch_id`.
4. `?search=` → `orWhere(col,'ilike',"%term%")` over text/select fields.
5. Rows mapped through `withOwnership` (flattened names).

---

## 2. CREATE — `store()`

1. `authorizeMaster(...,'can_add')`.
2. `validatePayload` builds rules from the schema — for `tolerance_pct` it appends `min:0` / `max:100` onto the `nullable|numeric` chain — then runs the `uEach` case-insensitive check on `exc_code` and `exc_name` (each independently).
3. `created_by` set; `resolveOwnership` stamps `client_id/branch_id` (body `client_id` only for super admin).
4. `MatchException::create($data)`; `MasterBundleCache::bump()`; returns 201.

---

## 3. UPDATE — `update()`

1. `authorizeMaster(...,'can_edit')`; row fetched under read scope.
2. `hierarchicalDenial` — own row OK, else row tier ≤ user tier (else 403).
3. No `is_system` on this table, so that lock never fires.
4. `validatePayload($request,'match_exception',$id)` re-checks uEach ignoring self and re-applies the 0..100 bound; `update()`; cache bump.

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
| Enum guard | `Rule::in` on `blocks_payment`, `status` |
| Numeric bound | `min:0` / `max:100` appended for `tolerance_pct` |
| Cache | `MasterBundleCache::bump()` on every write |

---

## NOTES

- `validatePayload` appends `min:0` / `max:100` rules for `tolerance_pct`, so out-of-range percentages 422 before the uEach check.
- `next-code` is not configured (`AUTO_CODES` has no `match_exception` entry) → `{code:null}`.

---
*Related documents: MATCH_EXCEPTION_FUNCTIONAL_DOCUMENTATION.md, MATCH_EXCEPTION_TECHNICAL_DOCUMENTATION.md, MATCH_EXCEPTION_API_DOCUMENTATION.md*
