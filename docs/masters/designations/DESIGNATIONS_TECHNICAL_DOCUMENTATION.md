# DESIGNATIONS MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Designations

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

- **Model:** `App\Models\Masters\Designations`
- **Table:** `master_designations`
- **Fillable:** `client_id, branch_id, name, code, department_id, level, reports_to_id, description, status, created_by`
- **Relations:** `client()`, `branch()`, `creator()`, `department()` → `Departments`, `reportsTo()` → self on `reports_to_id`
- **Booted hook:** `creating` — if `code` blank, sets `code = 'DGN-' + pad(max(id)+1, 2)`.

---

## 2. SCHEMA SPEC (from `SCHEMAS['designations']`)

| Field | t | r | ref | Validation |
|---|---|---|---|---|
| name | text | ✔ | — | required, string max 50, uFields (single text → case-insensitive) |
| code | text | — | — | nullable, string max 50 |
| department_id | select | — | departments | nullable, integer |
| level | select | ✔ | — | Rule::in(Director / CEO, Head of Department (HOD), Team Leader, Executive, Employee, Intern / Trainee) |
| reports_to_id | select | — | designations | nullable, integer |
| status | select | ✔ | — | Rule::in(Active, Inactive) |

---

## 3. UNIQUENESS MODEL

`uFields = [name]` (single). `name` is text → promoted to case-insensitive single-field uniqueness (`LOWER(name) = LOWER(?)`) scoped to `(client_id, branch_id)`, ignoring the current id on update. `code` is auto-assigned and not part of uniqueness. *(Backend enforces `name` only, despite the frontend config listing `name, code`.)*

---

## 4. ENDPOINTS (generic engine, scoped to `designations`)

| Verb | Path | Notes |
|---|---|---|
| GET | `/api/master/designations` | list; ?search=, ?branch_id= |
| POST | `/api/master/designations` | store (code auto-assigned by model hook) |
| GET | `/api/master/designations/next-code` | `{code: null}` |
| GET | `/api/master/designations/{id}` | show |
| PUT | `/api/master/designations/{id}` | update |
| DELETE | `/api/master/designations/{id}` | soft delete |

---

## 5. SPECIAL HANDLING

- **Auto-code via model hook:** `Designations::creating` assigns `DGN-##` from `max(id)+1`. Not the `AUTO_CODES` path, so `next-code` returns null.
- **Self-reference:** `reports_to_id` → `designations`; frontend renders `{name} ({level})`.
- **Reference:** `department_id` → `departments`.
- No cascade filter, uploads, sublists, or system-seed.

---

## 6. SECURITY & SCOPING

- `authorizeMaster('master.designations', …)` per verb; super admin bypass.
- Reads via `applyReadScope`; writes stamp ownership via `resolveOwnership`.
- `hierarchicalDenial` gates edit/delete; `is_system` block present but unused here.

---

## 7. METRICS

| Metric | Value |
|---|---|
| Field count | 6 schema fields (+ fillable `description`) |
| Required fields | 3 (name, level, status) |
| Uniqueness model | `uFields` single text → case-insensitive on `name` |
| Auto-code | Yes — `DGN-##` via model hook (not next-code) |
| Uploads / sublist | None |

---
*Related documents: DESIGNATIONS_FUNCTIONAL_DOCUMENTATION.md, DESIGNATIONS_API_DOCUMENTATION.md, DESIGNATIONS_CODE_WALKTHROUGH.md*
