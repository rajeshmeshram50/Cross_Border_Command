# SOURCING TYPE MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Sourcing Type

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\SourcingType` |
| Table | `master_sourcing_type` |
| Slug | `sourcing_type` |
| Soft deletes | No (`timestamps()` only — hard delete) |
| Relations | `client()`, `branch()`, `creator()` (BelongsTo) |
| Registered | `MasterController::MODELS['sourcing_type']` |

---

## 2. SCHEMA SPEC

Source: `MasterController::SCHEMAS['sourcing_type']`.

| Column | Type | Rules |
|---|---|---|
| type_code | text | required, max 50 |
| type_name | text | required, max 50 |
| quotation_required | select | required, `Rule::in(Mandatory — Min 3 Quotes, Mandatory — Min 1 Quote, Optional, Not Required)` |
| approval_required | select | required, `Rule::in(Yes, No)` |
| urgency_flag | select | nullable, `Rule::in(Normal, Urgent, Emergency)` |
| status | select | required, `Rule::in(Active, Inactive)` |

Ownership columns `client_id`, `branch_id`, `created_by` are stamped server-side. DB column widths are 255 (`string`); the 50-char cap is app-level.

---

## 3. UNIQUENESS MODEL

`uEach = [type_code, type_name]` — **independent per-field**, not composite. Each column is checked case-insensitively via `LOWER(col) = LOWER(?)`, scoped to the resolved `(client_id, branch_id)` tuple. No `is_system` column on this table, so the system-seed collision branch is skipped.

---

## 4. ENDPOINTS

| Verb | Path | Perm |
|---|---|---|
| GET | `/api/master-counts` | per-slug can_view |
| GET | `/api/master/sourcing_type` | can_view |
| GET | `/api/master/sourcing_type/{id}` | can_view |
| POST | `/api/master/sourcing_type` | can_add |
| PUT | `/api/master/sourcing_type/{id}` | can_edit |
| DELETE | `/api/master/sourcing_type/{id}` | can_delete |
| GET | `/api/master/sourcing_type/next-code` | can_view → `{code:null}` |

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
*Related documents: SOURCING_TYPE_FUNCTIONAL_DOCUMENTATION.md, SOURCING_TYPE_API_DOCUMENTATION.md, SOURCING_TYPE_CODE_WALKTHROUGH.md*
