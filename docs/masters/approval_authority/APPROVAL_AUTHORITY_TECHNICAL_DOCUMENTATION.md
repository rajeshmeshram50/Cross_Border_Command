# APPROVAL AUTHORITY MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Approval Authority

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\ApprovalAuthority` |
| Table | `master_approval_authority` |
| Slug | `approval_authority` |
| Soft deletes | No (hard delete) |
| Relations | `client()`, `branch()`, `creator()` |

---

## 2. SCHEMA SPEC

Source: `MasterController::SCHEMAS['approval_authority']`.

| Column | Type | Rules |
|---|---|---|
| role_name | text | required, max 50 |
| module_scope | select | required, `Rule::in(Purchase Order, Payment, VTI, GRN, All)` |
| min_value | number | nullable, numeric |
| max_value | number | required, numeric |
| currency | select | nullable, `Rule::in(INR, USD, EUR, GBP)` |
| escalate_to | text | nullable, max 50 |
| status | select | required, `Rule::in(Active, Inactive)` |

Ownership columns stamped server-side.

---

## 3. UNIQUENESS MODEL

**Composite** — `uFields = [role_name, module_scope]` (`count > 1` → composite path). The combination is checked in one query: `role_name` via `LOWER()` (text field), `module_scope` via exact `where` (select → not a text field). Scoped to `(client_id, branch_id)`. On update the current id is excluded. Violation message keys on the first field (`role_name`).

---

## 4. ENDPOINTS

| Verb | Path | Perm |
|---|---|---|
| GET | `/api/master-counts` | can_view |
| GET | `/api/master/approval_authority` | can_view |
| GET | `/api/master/approval_authority/{id}` | can_view |
| POST | `/api/master/approval_authority` | can_add |
| PUT | `/api/master/approval_authority/{id}` | can_edit |
| DELETE | `/api/master/approval_authority/{id}` | can_delete |
| GET | `/api/master/approval_authority/next-code` | `{code:null}` |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no uploads, sublists, refs, or auto-codes. The only non-default aspect is composite uniqueness (see §3).

---

## 6. SECURITY & SCOPING

`applyReadScope` for list/read; `hierarchicalDenial` for edit/delete; `resolveOwnership` for write stamping (body `client_id` trusted only for super admin). Cache bumped on write.

---

## 7. METRICS

`/master-counts` → `{active, inactive, total}` via single SQL aggregate. Bare responses, `orderByDesc(id)`.

---
*Related documents: APPROVAL_AUTHORITY_FUNCTIONAL_DOCUMENTATION.md, APPROVAL_AUTHORITY_API_DOCUMENTATION.md, APPROVAL_AUTHORITY_CODE_WALKTHROUGH.md*
