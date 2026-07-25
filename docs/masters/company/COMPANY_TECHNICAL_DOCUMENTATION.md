# COMPANY DETAILS MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Company Details

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

- **Model:** `App\Models\Masters\Company`
- **Table:** `master_company` (PostgreSQL, SoftDeletes via engine convention)
- **Fillable:** `client_id, branch_id, company_name, short_code, gstin, pan, cin, iec, email, mobile, city, state, address, status, created_by`
- **Relations:** `client()`, `branch()`, `creator()` (→ `User` on `created_by`)
- **Booted hooks:** none (no auto-code).

---

## 2. SCHEMA SPEC (from `MasterController::SCHEMAS['company']`)

| Field | t | r | normalize | Validation |
|---|---|---|---|---|
| company_name | text | ✔ | — | required, string, max 50, uEach |
| short_code | text | ✔ | — | required, string, max 50 |
| gstin | text | ✔ | upper | required, string, max 50, uEach |
| pan | text | ✔ | upper | required, string, max 50, uEach |
| cin | text | — | upper | nullable, string, max 50 |
| iec | text | — | — | nullable, string, max 50 |
| email | email | — | — | nullable, email, max 255 |
| mobile | text | — | — | nullable, string, max 50 |
| city | text | — | — | nullable, string, max 50 |
| state | text | — | — | nullable, string, max 50 |
| address | textarea | — | — | nullable, string (uncapped) |
| status | select | ✔ | — | required, Rule::in(Active, Inactive) |

---

## 3. UNIQUENESS MODEL

`uEach = [company_name, gstin, pan]`. Each field is checked **independently** via a manual `whereRaw('LOWER(col) = LOWER(?)')` query scoped to the row's `(client_id, branch_id)` tuple. A duplicate on any one field throws HTTP 422 with a per-field message (e.g. `"This GSTIN is already registered…"`). No composite (`uFields`) constraint.

---

## 4. ENDPOINTS (generic engine, scoped to `company`)

| Verb | Path | Method |
|---|---|---|
| GET | `/api/master-counts` | `counts` (batch card counts) |
| GET | `/api/master/company` | `list` (?search=, ?branch_id=) |
| POST | `/api/master/company` | `store` |
| GET | `/api/master/company/next-code` | `nextCode` → `{code: null}` (no auto-code) |
| GET | `/api/master/company/{id}` | `show` |
| PUT | `/api/master/company/{id}` | `update` |
| DELETE | `/api/master/company/{id}` | `destroy` (soft delete) |

---

## 5. SPECIAL HANDLING

Standard schema-driven master — no cascade, uploads, sublists, auto-code, system-seed or in-use guard. Only special behaviour is the three-field `uEach` uniqueness and uppercase normalization of `gstin/pan/cin`.

---

## 6. SECURITY & SCOPING

- `authorizeMaster` enforces `master.company` permission per verb; super admin bypasses.
- Reads scoped by `MasterVisibility::applyReadScope`; writes stamp `client_id/branch_id/created_by` via `resolveOwnership` (body `client_id` never trusted for non-super).
- Edit/delete gated by `hierarchicalDenial` (own row OK; else row tier ≤ user tier).

---

## 7. METRICS

| Metric | Value |
|---|---|
| Field count | 12 |
| Required fields | 5 (company_name, short_code, gstin, pan, status) |
| Uniqueness model | `uEach` (company_name, gstin, pan) |
| Auto-code | No |
| Uploads / sublist | None |

---
*Related documents: COMPANY_FUNCTIONAL_DOCUMENTATION.md, COMPANY_API_DOCUMENTATION.md, COMPANY_CODE_WALKTHROUGH.md*
