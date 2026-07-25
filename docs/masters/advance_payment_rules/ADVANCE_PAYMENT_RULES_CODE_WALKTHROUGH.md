# ADVANCE PAYMENT RULES MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Advance Payment Rules

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

No bespoke controller — served by `MasterController` under slug `advance_payment_rules`. Schema in `MasterController::SCHEMAS['advance_payment_rules']`; model `App\Models\Masters\AdvancePaymentRules`.

---

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster(...,'can_view')`.
2. Query eager-loads ownership, `orderByDesc('id')`.
3. `applyScope` → creator-hierarchy + optional `?branch_id`.
4. `?search=` → ILIKE across text/select fields (`vendor_type`, `procurement_cat`, `approver_role`, `attachment_required`, `status`).
5. `withOwnership` flattens names.

---

## 2. CREATE — `store()`

1. `authorizeMaster(...,'can_add')`.
2. `validatePayload` builds field rules (including `max_advance_pct` → `required|numeric|min:0|max:100`), then the **composite** branch (`isComposite = count(uFields) > 1`) checks `vendor_type` + `procurement_cat`. **Both are text**, so both are compared via `LOWER()` as one combination.
3. `resolveOwnership` stamps client/branch; `created_by` set.
4. `create()`; `MasterBundleCache::bump()`; 201.

---

## 3. UPDATE — `update()`

1. `authorizeMaster(...,'can_edit')`; row loaded under read scope.
2. `hierarchicalDenial` (own row OK, else tier check).
3. `validatePayload(...,$id)` re-runs composite check excluding self; `update()`; cache bump.

---

## 4. DELETE — `destroy()`

1. `authorizeMaster(...,'can_delete')`; `hierarchicalDenial`.
2. No slug-specific guard → `$row->delete()` (**hard delete**); cache bump.

---

## CROSS-CUTTING PATTERNS

| Concern | Mechanism |
|---|---|
| Tenant scope | `MasterVisibility::applyReadScope` |
| Edit/delete gate | `hierarchicalDenial` |
| Ownership stamp | `resolveOwnership` |
| Uniqueness | Composite `uFields` — `vendor_type` LOWER + `procurement_cat` LOWER |
| Range guard | `min:0` / `max:100` on `max_advance_pct` |
| Enum guard | `Rule::in` on attachment_required/status |
| Cache | `MasterBundleCache::bump()` |

---

## NOTES

- Both composite keys (`vendor_type`, `procurement_cat`) are `text`, so both are lower-cased in the uniqueness check → case-insensitive on the whole pair.
- `next-code` not configured → `{code:null}`.

---
*Related documents: ADVANCE_PAYMENT_RULES_FUNCTIONAL_DOCUMENTATION.md, ADVANCE_PAYMENT_RULES_TECHNICAL_DOCUMENTATION.md, ADVANCE_PAYMENT_RULES_API_DOCUMENTATION.md*
