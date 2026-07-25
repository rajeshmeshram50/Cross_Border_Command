# PAYMENT TERMS MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Payment Terms

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\PaymentTerms` |
| Table | `master_payment_terms` |
| Slug | `payment_terms` |
| Soft deletes | No (`timestamps()` only — hard delete) |
| Relations | `client()`, `branch()`, `creator()` (BelongsTo) |
| Registered | `MasterController::MODELS['payment_terms']` |

---

## 2. SCHEMA SPEC

Source: `MasterController::SCHEMAS['payment_terms']`.

| Column | Type | Rules |
|---|---|---|
| term_code | text | required, max 50 |
| term_name | text | required, max 50 |
| credit_days | number | required, numeric |
| advance_pct | number | nullable, numeric |
| payment_type | select | required, `Rule::in(Full Advance, Partial Advance, Credit, Milestone-Based, COD)` |
| milestone_desc | text | nullable, max 50 |
| status | select | required, `Rule::in(Active, Inactive)` |

Ownership columns `client_id`, `branch_id`, `created_by` are stamped server-side. DB column widths are 255 (`string`) / `decimal(18,4)`; the 50-char cap is app-level.

---

## 3. UNIQUENESS MODEL

`uEach = [term_code, term_name]` — **independent per-field**, not composite. Each column is checked case-insensitively via `LOWER(col) = LOWER(?)`, scoped to the resolved `(client_id, branch_id)` tuple. No `is_system` column on this table, so the system-seed collision branch is skipped.

---

## 4. ENDPOINTS

| Verb | Path | Perm |
|---|---|---|
| GET | `/api/master-counts` | per-slug can_view |
| GET | `/api/master/payment_terms` | can_view |
| GET | `/api/master/payment_terms/{id}` | can_view |
| POST | `/api/master/payment_terms` | can_add |
| PUT | `/api/master/payment_terms/{id}` | can_edit |
| DELETE | `/api/master/payment_terms/{id}` | can_delete |
| GET | `/api/master/payment_terms/next-code` | can_view → `{code:null}` |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no uploads, sublists, refs, or auto-codes.

---

## 6. SECURITY & SCOPING

`applyReadScope` (creator-hierarchy) governs list/read; `hierarchicalDenial` gates edit/delete (own row always OK; else row tier ≤ user tier). Writes stamp ownership via `resolveOwnership`; a body `client_id` is honoured only for super admin. Every write calls `MasterBundleCache::bump()`.

---

## 7. METRICS

`/master-counts` returns `{active, inactive, total}` computed by a single SQL aggregate (status IN active/1/true/yes/enabled). Responses are bare and `orderByDesc(id)`.

---
*Related documents: PAYMENT_TERMS_FUNCTIONAL_DOCUMENTATION.md, PAYMENT_TERMS_API_DOCUMENTATION.md, PAYMENT_TERMS_CODE_WALKTHROUGH.md*
