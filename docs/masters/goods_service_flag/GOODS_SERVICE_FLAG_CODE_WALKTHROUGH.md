# GOODS VS SERVICE FLAG MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Goods vs Service Flag

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

Goods vs Service Flag has no bespoke controller — it flows through `App\Http\Controllers\Api\MasterController` keyed by slug `goods_service_flag`. Field/rule definitions live in `MasterController::SCHEMAS['goods_service_flag']`; the model is `App\Models\Masters\GoodsServiceFlag`.

---

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster($request,'goods_service_flag','can_view')`.
2. `resolveModel` → `GoodsServiceFlag`; query eager-loads `client/branch/creator`, `orderByDesc('id')`.
3. `applyScope` → `MasterVisibility::applyReadScope` applies creator-hierarchy + optional `?branch_id`.
4. `?search=` → `orWhere(col,'ilike',"%term%")` over text/email/textarea/select fields.
5. Rows mapped through `withOwnership` (flattened names).

---

## 2. CREATE — `store()`

1. `authorizeMaster(...,'can_add')`.
2. `validatePayload` builds rules from the schema, then runs the `uEach` case-insensitive check on `flag_code` and `flag_name` (each independently).
3. `created_by` set; `resolveOwnership` stamps `client_id/branch_id`.
4. `GoodsServiceFlag::create($data)`; `MasterBundleCache::bump()`; returns 201.

---

## 3. UPDATE — `update()`

1. `authorizeMaster(...,'can_edit')`; row fetched under read scope.
2. `hierarchicalDenial` — own row OK, else row tier ≤ user tier (else 403).
3. No `is_system` on this table, so that lock never fires.
4. `validatePayload($request,'goods_service_flag',$id)` re-checks uEach ignoring self; `update()`; cache bump.

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
| Enum guard | `Rule::in` on `grn_screen`, `status` |
| Cache | `MasterBundleCache::bump()` on every write |

---

## NOTES

- `next-code` is not configured (`AUTO_CODES` has no `goods_service_flag` entry) → `{code:null}`.
- `grn_screen` is a fixed three-option enum that drives the GRN capture form; the walkthrough logic is otherwise identical to any standard schema-driven master.

---
*Related documents: GOODS_SERVICE_FLAG_FUNCTIONAL_DOCUMENTATION.md, GOODS_SERVICE_FLAG_TECHNICAL_DOCUMENTATION.md, GOODS_SERVICE_FLAG_API_DOCUMENTATION.md*
