# APPROVAL AUTHORITY MASTER — CODE WALKTHROUGH

> Cross_Border_Command SaaS ERP · Masters → Approval Authority

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial code walkthrough |

---

## 0. HOW TO READ

No bespoke controller — served by `MasterController` under slug `approval_authority`. Schema in `MasterController::SCHEMAS['approval_authority']`; model `App\Models\Masters\ApprovalAuthority`.

---

## 1. LIST / SEARCH — `list()`

1. `authorizeMaster(...,'can_view')`.
2. Query eager-loads ownership, `orderByDesc('id')`.
3. `applyScope` → creator-hierarchy + optional `?branch_id`.
4. `?search=` → ILIKE across text/select fields (`role_name`, `module_scope`, `escalate_to`, `currency`, `status`).
5. `withOwnership` flattens names.

---

## 2. CREATE — `store()`

1. `authorizeMaster(...,'can_add')`.
2. `validatePayload` builds field rules, then the **composite** branch (`isComposite = count(uFields) > 1`) checks `role_name` (LOWER) + `module_scope` (exact) as one combination.
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
| Uniqueness | Composite `uFields` — `role_name` LOWER + `module_scope` exact |
| Enum guard | `Rule::in` on module_scope/currency/status |
| Cache | `MasterBundleCache::bump()` |

---

## NOTES

- Because `module_scope` is a `select`, it is treated as non-text → exact match in the composite check (case matters, but enum values are fixed).
- `next-code` not configured → `{code:null}`.

---
*Related documents: APPROVAL_AUTHORITY_FUNCTIONAL_DOCUMENTATION.md, APPROVAL_AUTHORITY_TECHNICAL_DOCUMENTATION.md, APPROVAL_AUTHORITY_API_DOCUMENTATION.md*
