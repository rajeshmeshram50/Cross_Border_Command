# DEPARTMENT MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Department Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

- **Model:** `App\Models\Masters\Departments`
- **Table:** `master_departments`
- **Fillable:** `client_id, branch_id, name, code, parent_id, head, email, description, status, created_by`
- **Relations:** `client()`, `branch()`, `creator()`
- **Booted hooks:** none (auto-code handled by the controller's `AUTO_CODES` / `nextCode`, not a model hook).

---

## 2. SCHEMA SPEC (from `SCHEMAS['departments']`)

| Field | t | r | ref | Validation |
|---|---|---|---|---|
| name | text | ✔ | — | required, string max 50, uEach |
| code | text | ✔ | — | required, string max 50, uEach |
| parent_id | select | — | departments | nullable, integer |
| head | select | — | — | nullable, string max 50 |
| email | email | — | — | nullable, email, max 255 |
| status | select | ✔ | — | Rule::in(Active, Inactive) |

`tenantScoped = true`.

---

## 3. UNIQUENESS MODEL

`uEach = [name, code]`. Both are text → each checked with case-insensitive `LOWER(col) = LOWER(?)` scoped to `(client_id, branch_id)`. A duplicate name **or** code throws 422 on that field. No composite constraint. *(The frontend config lists `uFields: ['code']`, but the backend enforces `uEach` on both name and code.)*

---

## 4. ENDPOINTS (generic engine, scoped to `departments`)

| Verb | Path | Notes |
|---|---|---|
| GET | `/api/master/departments` | list; ?search=, ?branch_id= |
| POST | `/api/master/departments` | store |
| GET | `/api/master/departments/next-code` | `{ code: "DEPT-001", prefix: "DEPT-" }` |
| GET | `/api/master/departments/{id}` | show |
| PUT | `/api/master/departments/{id}` | update |
| DELETE | `/api/master/departments/{id}` | soft delete |

---

## 5. SPECIAL HANDLING

- **Auto-code (`AUTO_CODES['departments']`):** `nextCode` scans `code` values over the user's read-scope (+ branch filter), finds the max `DEPT-(\d+)` suffix, and returns `DEPT-<max+1>` zero-padded to 3. Scope mirrors `list()` so a visible row can't be handed a colliding code.
- **Self-reference:** `parent_id` → `departments`; validated as an integer FK.
- **Tenant scoping:** `tenantScoped=true` isolates the DEPT sequence per tenant.
- No cascade filter (no `country_id`), no uploads, no sublists, no system-seed.

---

## 6. SECURITY & SCOPING

- `authorizeMaster('master.departments', …)` per verb; super admin bypass.
- Reads via `applyReadScope`; writes stamp ownership via `resolveOwnership`.
- `hierarchicalDenial` gates edit/delete; `is_system` block present but unused here.

---

## 7. METRICS

| Metric | Value |
|---|---|
| Field count | 6 schema fields (+ fillable `description`) |
| Required fields | 3 (name, code, status) |
| Uniqueness model | `uEach` (name, code) |
| Auto-code | Yes — `DEPT-###` via `AUTO_CODES` + `next-code` |
| Uploads / sublist | None |

---
*Related documents: DEPARTMENTS_FUNCTIONAL_DOCUMENTATION.md, DEPARTMENTS_API_DOCUMENTATION.md, DEPARTMENTS_CODE_WALKTHROUGH.md*
