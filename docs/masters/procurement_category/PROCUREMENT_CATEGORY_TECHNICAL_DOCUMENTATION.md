# PROCUREMENT CATEGORY MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Procurement Category

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\ProcurementCategory` |
| Table | `master_procurement_category` |
| Slug | `procurement_category` |
| Soft deletes | No (`timestamps()` only — hard delete) |
| Relations | `client()`, `branch()`, `creator()` (BelongsTo) |
| Registered | `MasterController::MODELS['procurement_category']` |

---

## 2. SCHEMA SPEC

Source: `MasterController::SCHEMAS['procurement_category']`.

| Column | Type | Rules |
|---|---|---|
| cat_code | text | required, max 50 |
| cat_name | text | required, max 50 |
| match_logic | select | required, `Rule::in(3-Way Match (PO+VTI+GRN), 2-Way Match (PO+VTI), 4-Way Match (PO+VTI+GRN+QC))` |
| grn_required | select | required, `Rule::in(Yes — Physical Receipt, Yes — Service Confirmation, No)` |
| gst_applicable | select | required, `Rule::in(Yes, No, Reverse Charge)` |
| status | select | required, `Rule::in(Active, Inactive)` |

Ownership columns `client_id`, `branch_id`, `created_by` are stamped server-side. DB text column widths are 255 (`string`); the 50-char cap is app-level.

---

## 3. UNIQUENESS MODEL

`uEach = [cat_code, cat_name]` — **independent per-field**, not composite. Each column is checked case-insensitively via `LOWER(col) = LOWER(?)`, scoped to the resolved `(client_id, branch_id)` tuple. No `is_system` column on this table, so the system-seed collision branch is skipped.

---

## 4. ENDPOINTS

| Verb | Path | Perm |
|---|---|---|
| GET | `/api/master-counts` | per-slug can_view |
| GET | `/api/master/procurement_category` | can_view |
| GET | `/api/master/procurement_category/{id}` | can_view |
| POST | `/api/master/procurement_category` | can_add |
| PUT | `/api/master/procurement_category/{id}` | can_edit |
| DELETE | `/api/master/procurement_category/{id}` | can_delete |
| GET | `/api/master/procurement_category/next-code` | can_view → `{code:null}` |

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
*Related documents: PROCUREMENT_CATEGORY_FUNCTIONAL_DOCUMENTATION.md, PROCUREMENT_CATEGORY_API_DOCUMENTATION.md, PROCUREMENT_CATEGORY_CODE_WALKTHROUGH.md*
