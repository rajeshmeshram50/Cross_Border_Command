# STATES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → States

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **States** master holds the states / provinces / subdivisions for every country. It is the second level of the geography cascade and drives address forms and GST place-of-supply logic. It is one of ~56 masters served by the schema-driven engine (`MasterController` + `MasterPage.tsx`), sharing the same shell, permissions and tenant scoping.

**Downstream consumers:**
- **State Codes** — `master_state_codes.state_id` references a state and pairs it with a 2-digit GST code.
- **Legal Entities** / address sub-forms resolve `state_id`.
- GST place-of-supply (IGST vs CGST/SGST) keys off the state.

**Note:** this is a **very large table** (10k+ subdivisions worldwide). Lists therefore rely on the country cascade (`?country_id=`) rather than loading everything up front, and dashboard counts use a single SQL aggregate instead of pulling rows into PHP.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rows, all tenants; may seed global rows |
| Client Admin / Client User | Client rows + globals; branch-switcher narrowable |
| Branch User | Globals + client-level rows + own branch rows |
| Employee | Globals + client-level rows + only own rows |

Permissioned module: `master.states`.

---

## 3. FIELDS

| Field | Label · Type · Required | Options / Ref | Rules & Notes |
|---|---|---|---|
| `country_id` | Country · select · **required** | ref → `countries` | FK; the parent of this state. |
| `name` | State Name · text · **required** | — | Max 50 chars; part of the composite unique key. |
| `status` | Status · select · **required** | Active / Inactive | Enforced via `Rule::in`. |

Plus engine-managed `client_id`, `branch_id`, `created_by`.

---

## 4. BUSINESS RULES

- **Uniqueness (composite `uFields` = `name` + `country_id`)** — a state name must be unique **within its country**, so "Punjab" can exist under both India and Pakistan. `name` is compared case-insensitively (`LOWER()`); `country_id` is compared exactly (FK). Scoped to the `(client_id, branch_id)` tuple.
- **Cascade** — Countries is the parent; the list endpoint honours `?country_id=` to return only that country's states (this master *has* a `country_id` column). States is in turn the parent of the State Codes cascade.
- **Empty → NULL** for nullable fields.
- No normalization, no system-seed lock, no `lockedFixed`.

---

## 5. SCREEN

Path: `/masters/states`. Standard master shell. In dependent forms (ClientForm, BranchForm, vendor address) the State dropdown cascades off the chosen Country. List columns: State Name · Country · Status.

---

## 6. KNOWN LIMITATIONS

- Because the table is huge, unfiltered browsing is heavy; the UI expects a country filter first.
- No app-layer FK block on deleting a state still referenced by a state code or address — soft delete only.
- Frontend prototype `uFields` matches backend (`name + country_id`), but the API is authoritative.

---

*Related documents: STATES_TECHNICAL_DOCUMENTATION.md, STATES_API_DOCUMENTATION.md, STATES_CODE_WALKTHROUGH.md*
