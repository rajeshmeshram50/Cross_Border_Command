# COUNTRIES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Countries

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Countries** master is the root geography lookup for the whole ERP. Every trade document, address, port and legal entity resolves a country from this list. It is one of ~56 masters served by the single schema-driven engine (`MasterController` + `MasterPage.tsx`), so it shares the same list / add / edit / delete shell, permission model and tenant scoping as every other master.

**Downstream consumers (large cascade source):**
- **States** — `master_states.country_id` filters state dropdowns by country.
- **Ports of Discharge** — `country_id` links a destination port to a country.
- **Legal Entities**, **Vendor Directory** and address sub-forms resolve country.
- The `Countries::isoFor()` helper resolves a free-text country to its ISO code for compact, aligned Country columns on lists.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rows, all tenants; may seed **global** rows (`client_id = NULL`) |
| Client Admin / Client User | Client rows + globals; may narrow by branch via the switcher |
| Branch User | Globals + client-level rows + own branch rows |
| Employee | Globals + client-level rows + only rows they created (peer-isolated) |

Permissioned module: `master.countries` (`can_view / can_add / can_edit / can_delete`). Super admins bypass.

---

## 3. FIELDS

| Field | Label · Type · Required | Options / Ref | Rules & Notes |
|---|---|---|---|
| `name` | Country Name · text · **required** | — | Max 50 chars; case-insensitive unique (see §4). Frontend hints "no digits". |
| `iso_code` | ISO Code · text · optional | — | **Normalized to UPPERCASE** before validate/store; case-insensitive unique. e.g. `IN`, `AE`. |
| `status` | Status · select · **required** | Active / Inactive | Enforced server-side via `Rule::in`. |

Every row also carries engine-managed `client_id`, `branch_id`, `created_by` (stamped from the authenticated user, never trusted from the body).

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach`)** — `name` and `iso_code` are **each independently unique**, case-insensitive (`LOWER()`), scoped to the row's `(client_id, branch_id)` tuple. "India" / "india" / "INDIA" cannot coexist; the same name may recur across different branches of one client.
- **Normalization** — `iso_code` is uppercased first, so the stored value and the uniqueness check are case-canonical ("in" and "IN" collide).
- **Cascade source** — Countries is the top of the geography cascade; States and Ports of Discharge filter their lists by the chosen `country_id`.
- **Empty → NULL** — an empty `iso_code` is stored as `NULL` and skips the uniqueness check.
- No system-seed lock and no `lockedFixed` flag — countries are a normal editable master.

---

## 5. SCREEN

Path: `/masters/countries`. Standard master shell — searchable list (ILIKE over text/select fields), KPI/Active-Inactive strip, Add/Edit modal built from the schema fields above, soft-delete with confirm. List columns: Country Name · ISO Code · Status.

---

## 6. KNOWN LIMITATIONS

- No hard FK enforcement in the app layer preventing deletion of a country still referenced by states/ports — deletion is a soft delete and does not cascade or block.
- ISO code is optional, so rows without an ISO code are skipped by `isoFor()` and won't render a compact ISO column.
- Frontend seed/prototype `uFields: ['name']` is narrower than the authoritative backend rule (`uEach: name + iso_code`); the API is the source of truth.

---

*Related documents: COUNTRIES_TECHNICAL_DOCUMENTATION.md, COUNTRIES_API_DOCUMENTATION.md, COUNTRIES_CODE_WALKTHROUGH.md*
