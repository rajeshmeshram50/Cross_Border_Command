# ROLES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Roles

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

- **Model:** `App\Models\Masters\Roles`
- **Table:** `master_roles`
- **Fillable:** `client_id, branch_id, name, code, role_type, department_id, role_category, description, status, created_by`
- **Relations:** `client()`, `branch()`, `creator()`, `department()` → `Departments` on `department_id`
- **Booted hook:** `creating` — if `code` blank, sets `code = 'ROL-' + pad(max(id)+1, 2)`.

---

## 2. SCHEMA SPEC (from `SCHEMAS['roles']`)

| Field | t | r | ref | Validation |
|---|---|---|---|---|
| name | text | ✔ | — | required, string max 50, uFields (single text → case-insensitive) |
| code | text | — | — | nullable, string max 50 |
| role_type | select | ✔ | — | Rule::in(Primary, Ancillary) |
| department_id | select | — | departments | nullable, integer |
| role_category | select | — | — | Rule::in(Technical, Management, Operational, Support, Sales, Compliance, Finance, HR) |
| description | textarea | — | — | nullable, string (uncapped) |
| status | select | ✔ | — | Rule::in(Active, Inactive) |

---

## 3. UNIQUENESS MODEL

`uFields = [name]` with a single entry. Because `name` is a text field and the composite path requires `count > 1`, it is **promoted** to a single-field case-insensitive check (`singleTextUFields`): `LOWER(name) = LOWER(?)` scoped to `(client_id, branch_id)`, ignoring the current id on update. `code` is **not** part of uniqueness (auto-assigned, can repeat across tenants).

---

## 4. ENDPOINTS (generic engine, scoped to `roles`)

| Verb | Path | Notes |
|---|---|---|
| GET | `/api/master/roles` | list; ?search=, ?branch_id= |
| POST | `/api/master/roles` | store (code auto-assigned by model hook) |
| GET | `/api/master/roles/next-code` | `{code: null}` (not in AUTO_CODES) |
| GET | `/api/master/roles/{id}` | show |
| PUT | `/api/master/roles/{id}` | update |
| DELETE | `/api/master/roles/{id}` | soft delete |

---

## 5. SPECIAL HANDLING

- **Auto-code via model hook:** `Roles::creating` assigns `ROL-##` from `max(id)+1` (global, 2-pad, grows past 99). This is **not** the `AUTO_CODES` registry path, so `next-code` returns null.
- **Reference:** `department_id` → `departments` (validated as integer FK).
- No cascade filter, uploads, sublists, or system-seed.

---

## 6. SECURITY & SCOPING

- `authorizeMaster('master.roles', …)` per verb; super admin bypass.
- Reads via `applyReadScope`; writes stamp ownership via `resolveOwnership`.
- `hierarchicalDenial` gates edit/delete; `is_system` block present but unused here.

---

## 7. METRICS

| Metric | Value |
|---|---|
| Field count | 7 |
| Required fields | 3 (name, role_type, status) |
| Uniqueness model | `uFields` single text → case-insensitive on `name` |
| Auto-code | Yes — `ROL-##` via model hook (not next-code) |
| Uploads / sublist | None |

---
*Related documents: ROLES_FUNCTIONAL_DOCUMENTATION.md, ROLES_API_DOCUMENTATION.md, ROLES_CODE_WALKTHROUGH.md*
