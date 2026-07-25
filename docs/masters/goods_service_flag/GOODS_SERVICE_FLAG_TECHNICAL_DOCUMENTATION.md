# GOODS VS SERVICE FLAG MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Goods vs Service Flag

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\GoodsServiceFlag` |
| Table | `master_goods_service_flag` |
| Slug | `goods_service_flag` |
| Soft deletes | No (`timestamps()` only — hard delete) |
| Relations | `client()`, `branch()`, `creator()` (BelongsTo) |
| Registered | `MasterController::MODELS['goods_service_flag']` |

---

## 2. SCHEMA SPEC

Source: `MasterController::SCHEMAS['goods_service_flag']`.

| Column | Type | Rules |
|---|---|---|
| flag_code | text | required, max 50 |
| flag_name | text | required, max 50 |
| grn_screen | select | required, `Rule::in(Physical Receipt — Qty + Batch + Warehouse, Service Completion — Date + Proof Doc, Mixed — Partial Goods + Service)` |
| evidence_type | text | required, max 50 |
| status | select | required, `Rule::in(Active, Inactive)` |

Ownership columns `client_id`, `branch_id`, `created_by` are stamped server-side. DB text column widths are 255 (`string`); the 50-char cap is app-level.

---

## 3. UNIQUENESS MODEL

`uEach = [flag_code, flag_name]` — **independent per-field**, not composite. Each column is checked case-insensitively via `LOWER(col) = LOWER(?)`, scoped to the resolved `(client_id, branch_id)` tuple. No `is_system` column on this table, so the system-seed collision branch is skipped.

---

## 4. ENDPOINTS

| Verb | Path | Perm |
|---|---|---|
| GET | `/api/master-counts` | per-slug can_view |
| GET | `/api/master/goods_service_flag` | can_view |
| GET | `/api/master/goods_service_flag/{id}` | can_view |
| POST | `/api/master/goods_service_flag` | can_add |
| PUT | `/api/master/goods_service_flag/{id}` | can_edit |
| DELETE | `/api/master/goods_service_flag/{id}` | can_delete |
| GET | `/api/master/goods_service_flag/next-code` | can_view → `{code:null}` |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no uploads, sublists, refs, or auto-codes.

---

## 6. SECURITY & SCOPING

`applyReadScope` (creator-hierarchy) governs list/read; `hierarchicalDenial` gates edit/delete (own row always OK; employees only own; else row tier ≤ user tier). Writes stamp ownership via `resolveOwnership`; a body `client_id` is honoured only for super admin. Every write calls `MasterBundleCache::bump()`.

---

## 7. METRICS

`/master-counts` returns `{active, inactive, total}` computed by a single SQL aggregate (status IN active/1/true/yes/enabled) against PostgreSQL. Responses are bare and `orderByDesc(id)`.

---
*Related documents: GOODS_SERVICE_FLAG_FUNCTIONAL_DOCUMENTATION.md, GOODS_SERVICE_FLAG_API_DOCUMENTATION.md, GOODS_SERVICE_FLAG_CODE_WALKTHROUGH.md*
