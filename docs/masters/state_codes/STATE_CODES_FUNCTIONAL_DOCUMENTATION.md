# STATE CODES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → State Codes

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **State Codes** master pairs a state with its **2-digit GST state code** (e.g. 27 = Maharashtra, 24 = Gujarat). These codes are mandatory on GST invoices and tax filings. It is one of ~56 masters served by the schema-driven engine (`MasterController` + `MasterPage.tsx`).

**Downstream consumers:**
- GST invoice generation prints the state code as part of the GSTIN place-of-supply.
- Tax-filing / compliance screens key off the code.

The list endpoint **eager-loads the parent state** (`state:id,name,country_id`) so the grid shows the state name inline and the frontend can cascade State off Country — without downloading the entire `master_states` table (10k+ rows).

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rows, all tenants; may seed global rows |
| Client Admin / Client User | Client rows + globals; branch-switcher narrowable |
| Branch User | Globals + client-level rows + own branch rows |
| Employee | Globals + client-level rows + only own rows |

Permissioned module: `master.state_codes`.

---

## 3. FIELDS

| Field | Label · Type · Required | Options / Ref | Rules & Notes |
|---|---|---|---|
| `state_id` | State · select · **required** | ref → `states` | FK; the state this code belongs to. Eager-loaded on list. |
| `state_code` | State Code · text · **required** | — | Max 50 chars (2-digit GST code in practice); part of composite unique key. |
| `status` | Status · select · **required** | Active / Inactive | Enforced via `Rule::in`. |

Plus engine-managed `client_id`, `branch_id`, `created_by`.

---

## 4. BUSINESS RULES

- **Uniqueness (composite `uFields` = `state_id` + `state_code`)** — the combination must be unique. `state_id` is compared exactly (FK); `state_code` is compared case-insensitively (`LOWER()`). Scoped to the `(client_id, branch_id)` tuple.
- **Cascade** — State Codes does **not** have a `country_id` column, so the `?country_id=` list filter does not apply directly; instead the eager-loaded `state.country_id` rides along so the frontend can still filter the State dropdown by country.
- **Empty → NULL** for nullable fields.
- No normalization, no system-seed lock, no `lockedFixed`.

---

## 5. SCREEN

Path: `/masters/state_codes`. Standard master shell; the State column renders the inline state name from the eager-load. List columns: State · State Code · Status.

---

## 6. KNOWN LIMITATIONS

- `state_code` is a free-text field (max 50) — the "2 digits" convention is not enforced by a pattern, so longer/oddly-formatted codes are accepted.
- The `?country_id=` filter cannot filter state codes directly (no column); country cascading happens client-side off the eager-loaded `state.country_id`.
- No app-layer block on deleting a code still referenced by invoices — soft delete only.

---

*Related documents: STATE_CODES_TECHNICAL_DOCUMENTATION.md, STATE_CODES_API_DOCUMENTATION.md, STATE_CODES_CODE_WALKTHROUGH.md*
