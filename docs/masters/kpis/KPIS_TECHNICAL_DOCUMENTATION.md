# KPI MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → KPI Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

- **Model:** `App\Models\Masters\Kpis`
- **Table:** `master_kpis`
- **Fillable:** `client_id, branch_id, name, code, description, role_id, target_type, priority, status, created_by`
- **Relations:** `client()`, `branch()`, `creator()`, `role()` → `Roles` on `role_id`
- **Booted hooks:** none.

---

## 2. SCHEMA SPEC (from `SCHEMAS['kpis']`)

| Field | t | r | ref | Validation |
|---|---|---|---|---|
| name | text | ✔ | — | required, string max 50, uFields (single text → case-insensitive) |
| description | textarea | — | — | nullable, string (uncapped) |
| role_id | select | ✔ | roles | required, integer |
| target_type | select | ✔ | — | Rule::in(Numeric, Percentage, Currency, Boolean, Date-based, Rating) |
| priority | select | ✔ | — | Rule::in(Critical, High, Medium, Low) |
| status | select | ✔ | — | Rule::in(Active, Inactive) |

`code` is fillable on the model but not in SCHEMAS (not validated, not auto-generated).

---

## 3. UNIQUENESS MODEL

`uFields = [name]` (single). `name` is text → promoted to case-insensitive single-field uniqueness (`LOWER(name) = LOWER(?)`) scoped to `(client_id, branch_id)`, ignoring the current id on update. No composite constraint.

---

## 4. ENDPOINTS (generic engine, scoped to `kpis`)

| Verb | Path | Notes |
|---|---|---|
| GET | `/api/master/kpis` | list; ?search=, ?branch_id= |
| POST | `/api/master/kpis` | store |
| GET | `/api/master/kpis/next-code` | `{code: null}` |
| GET | `/api/master/kpis/{id}` | show |
| PUT | `/api/master/kpis/{id}` | update |
| DELETE | `/api/master/kpis/{id}` | soft delete |

---

## 5. SPECIAL HANDLING

Standard schema-driven master. The only reference is `role_id` → `roles` (validated as an integer FK). No cascade filter, uploads, sublists, auto-code, or system-seed.

---

## 6. SECURITY & SCOPING

- `authorizeMaster('master.kpis', …)` per verb; super admin bypass.
- Reads via `applyReadScope`; writes stamp ownership via `resolveOwnership`.
- `hierarchicalDenial` gates edit/delete; `is_system` block present but unused here.

---

## 7. METRICS

| Metric | Value |
|---|---|
| Field count | 6 schema fields (+ fillable `code`) |
| Required fields | 5 (name, role_id, target_type, priority, status) |
| Uniqueness model | `uFields` single text → case-insensitive on `name` |
| Auto-code | No |
| Uploads / sublist | None |

---
*Related documents: KPIS_FUNCTIONAL_DOCUMENTATION.md, KPIS_API_DOCUMENTATION.md, KPIS_CODE_WALKTHROUGH.md*
