# ADVANCE PAYMENT RULES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Advance Payment Rules

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\AdvancePaymentRules` |
| Table | `master_advance_payment_rules` |
| Slug | `advance_payment_rules` |
| Soft deletes | No (hard delete) |
| Relations | `client()`, `branch()`, `creator()` |

---

## 2. SCHEMA SPEC

Source: `MasterController::SCHEMAS['advance_payment_rules']`.

| Column | Type | Rules |
|---|---|---|
| vendor_type | text | required, max 50 |
| procurement_cat | text | nullable, max 50 |
| max_advance_pct | number | required, numeric, min:0, max:100 |
| approval_above | number | nullable, numeric |
| approver_role | text | nullable, max 50 |
| attachment_required | select | required, `Rule::in(Yes, No)` |
| status | select | required, `Rule::in(Active, Inactive)` |

Ownership columns (`client_id`, `branch_id`, `created_by`) stamped server-side.

---

## 3. UNIQUENESS MODEL

**Composite** — `uFields = [vendor_type, procurement_cat]` (`count > 1` → composite path). Because **both** columns are text, **both** are compared case-insensitively via `LOWER()` in one combined query. Scoped to `(client_id, branch_id)`. On update the current id is excluded. Violation message keys on the first field (`vendor_type`).

---

## 4. ENDPOINTS

| Verb | Path | Perm |
|---|---|---|
| GET | `/api/master-counts` | can_view |
| GET | `/api/master/advance_payment_rules` | can_view |
| GET | `/api/master/advance_payment_rules/{id}` | can_view |
| POST | `/api/master/advance_payment_rules` | can_add |
| PUT | `/api/master/advance_payment_rules/{id}` | can_edit |
| DELETE | `/api/master/advance_payment_rules/{id}` | can_delete |
| GET | `/api/master/advance_payment_rules/next-code` | `{code:null}` |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no uploads, sublists, refs, or auto-codes. The non-default aspects are **composite uniqueness** (see §3) and the **0..100 bound** on `max_advance_pct`.

---

## 6. SECURITY & SCOPING

`applyReadScope` for list/read; `hierarchicalDenial` for edit/delete; `resolveOwnership` for write stamping (body `client_id` trusted only for super admin). Cache bumped on write.

---

## 7. METRICS

`/master-counts` → `{active, inactive, total}` via single SQL aggregate. Bare responses, `orderByDesc(id)`. Numeric fields echo as decimal strings.

---
*Related documents: ADVANCE_PAYMENT_RULES_FUNCTIONAL_DOCUMENTATION.md, ADVANCE_PAYMENT_RULES_API_DOCUMENTATION.md, ADVANCE_PAYMENT_RULES_CODE_WALKTHROUGH.md*
