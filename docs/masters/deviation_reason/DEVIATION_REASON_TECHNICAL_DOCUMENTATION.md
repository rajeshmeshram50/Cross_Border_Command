# OVERRIDE / DEVIATION REASON MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Override / Deviation Reason

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\DeviationReason` |
| Table | `master_deviation_reason` |
| Slug | `deviation_reason` |
| Soft deletes | No (`timestamps()` only — hard delete) |
| Relations | `client()`, `branch()`, `creator()` (BelongsTo) |
| Registered | `MasterController::MODELS['deviation_reason']` |

---

## 2. SCHEMA SPEC

Source: `MasterController::SCHEMAS['deviation_reason']`.

| Column | Type | Rules |
|---|---|---|
| reason_code | text | required, max 50 |
| reason_name | text | required, max 50 |
| module | select | required, `Rule::in(Purchase Order, Vendor Comparison, VTI, GRN, Payment, All)` |
| attachment_required | select | required, `Rule::in(Yes, No)` |
| requires_approval | select | required, `Rule::in(Yes, No)` |
| status | select | required, `Rule::in(Active, Inactive)` |

Ownership columns `client_id`, `branch_id`, `created_by` are stamped server-side. DB column widths are 255 (`string`); the 50-char cap is app-level.

---

## 3. UNIQUENESS MODEL

`uEach = [reason_code, reason_name]` — **independent per-field**, not composite. Each column is checked case-insensitively via `LOWER(col) = LOWER(?)`, scoped to the resolved `(client_id, branch_id)` tuple. No `is_system` column on this table, so the system-seed collision branch is skipped.

---

## 4. ENDPOINTS

| Verb | Path | Perm |
|---|---|---|
| GET | `/api/master-counts` | per-slug can_view |
| GET | `/api/master/deviation_reason` | can_view |
| GET | `/api/master/deviation_reason/{id}` | can_view |
| POST | `/api/master/deviation_reason` | can_add |
| PUT | `/api/master/deviation_reason/{id}` | can_edit |
| DELETE | `/api/master/deviation_reason/{id}` | can_delete |
| GET | `/api/master/deviation_reason/next-code` | can_view → `{code:null}` |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no uploads, sublists, refs, or auto-codes.

---

## 6. SECURITY & SCOPING

`applyReadScope` (creator-hierarchy) governs list/read; `hierarchicalDenial` gates edit/delete (own row always OK; employees only own; else row tier ≤ user tier). Writes stamp ownership via `resolveOwnership`; a body `client_id` is honoured only for super admin. Every write calls `MasterBundleCache::bump()`. DB is PostgreSQL.

---

## 7. METRICS

`/master-counts` returns `{active, inactive, total}` computed by a single SQL aggregate (status IN active/1/true/yes/enabled). Responses are bare and `orderByDesc(id)`.

---
*Related documents: DEVIATION_REASON_FUNCTIONAL_DOCUMENTATION.md, DEVIATION_REASON_API_DOCUMENTATION.md, DEVIATION_REASON_CODE_WALKTHROUGH.md*
