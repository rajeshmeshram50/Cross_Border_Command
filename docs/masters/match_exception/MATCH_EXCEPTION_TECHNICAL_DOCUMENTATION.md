# MATCH EXCEPTION TYPE MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Match Exception Type

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Model | `App\Models\Masters\MatchException` |
| Table | `master_match_exception` |
| Slug | `match_exception` |
| Soft deletes | No (`timestamps()` only — hard delete) |
| Relations | `client()`, `branch()`, `creator()` (BelongsTo) |
| Registered | `MasterController::MODELS['match_exception']` |

---

## 2. SCHEMA SPEC

Source: `MasterController::SCHEMAS['match_exception']`.

| Column | Type | Rules |
|---|---|---|
| exc_code | text | required, max 50 |
| exc_name | text | required, max 50 |
| tolerance_pct | number | nullable, numeric, **min:0, max:100** |
| blocks_payment | select | required, `Rule::in(Yes — Hard Block, Yes — Soft Block (Warning), No)` |
| resolver_role | text | required, max 50 |
| status | select | required, `Rule::in(Active, Inactive)` |

Ownership columns `client_id`, `branch_id`, `created_by` are stamped server-side. DB column widths are 255 (`string`) / `decimal(18,4)`; the 50-char cap is app-level. The `tolerance_pct` field carries a **0..100 numeric bound** (min:0 / max:100) appended by `validatePayload`.

---

## 3. UNIQUENESS MODEL

`uEach = [exc_code, exc_name]` — **independent per-field**, not composite. Each column is checked case-insensitively via `LOWER(col) = LOWER(?)`, scoped to the resolved `(client_id, branch_id)` tuple. No `is_system` column on this table, so the system-seed collision branch is skipped.

---

## 4. ENDPOINTS

| Verb | Path | Perm |
|---|---|---|
| GET | `/api/master-counts` | per-slug can_view |
| GET | `/api/master/match_exception` | can_view |
| GET | `/api/master/match_exception/{id}` | can_view |
| POST | `/api/master/match_exception` | can_add |
| PUT | `/api/master/match_exception/{id}` | can_edit |
| DELETE | `/api/master/match_exception/{id}` | can_delete |
| GET | `/api/master/match_exception/next-code` | can_view → `{code:null}` |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no uploads/sublists/refs/auto-codes; the only non-default is the 0..100 numeric bound on `tolerance_pct`.

---

## 6. SECURITY & SCOPING

`applyReadScope` (creator-hierarchy) governs list/read; `hierarchicalDenial` gates edit/delete (own row always OK; employees only own; else row tier ≤ user tier). Writes stamp ownership via `resolveOwnership`; a body `client_id` is honoured only for super admin. Every write calls `MasterBundleCache::bump()`.

---

## 7. METRICS

`/master-counts` returns `{active, inactive, total}` computed by a single SQL aggregate (status IN active/1/true/yes/enabled). Responses are bare and `orderByDesc(id)`. DB is PostgreSQL.

---
*Related documents: MATCH_EXCEPTION_FUNCTIONAL_DOCUMENTATION.md, MATCH_EXCEPTION_API_DOCUMENTATION.md, MATCH_EXCEPTION_CODE_WALKTHROUGH.md*
