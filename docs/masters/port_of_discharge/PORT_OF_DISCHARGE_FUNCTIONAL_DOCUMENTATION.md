# PORTS OF DISCHARGE MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Ports of Discharge

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Ports of Discharge** master lists the **destination ports** where shipments arrive. These print on packing lists and shipping documents as the port of discharge and are linked to a destination **country**. It is one of ~56 masters served by the schema-driven engine (`MasterController` + `MasterPage.tsx`).

**Downstream consumers:** export/packing document generation prints the discharge port (name + code + country); shipment-order and quotation/PI forms select a port of discharge, often cascaded off the destination country.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rows, all tenants; may seed global rows |
| Client Admin / Client User | Client rows + globals; branch-switcher narrowable |
| Branch User | Globals + client-level rows + own branch rows |
| Employee | Globals + client-level rows + only own rows |

Permissioned module: `master.port_of_discharge`.

---

## 3. FIELDS

| Field | Label · Type · Required | Options / Ref | Rules & Notes |
|---|---|---|---|
| `name` | Port Name · text · **required** | — | Max 50; case-insensitive unique. e.g. "Port Jebel Ali". |
| `code` | Port Code · text · **required** | — | Max 50; case-insensitive unique. e.g. `AEJEA`. |
| `country_id` | Country · select · **required** | ref → `countries` | FK; the destination country. Enables the country cascade filter. |
| `city` | City · text · optional | — | Max 50; port city. |
| `status` | Status · select · **required** | Active / Inactive | Enforced via `Rule::in`. |

Plus engine-managed `client_id`, `branch_id`, `created_by`.

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach` = `name` + `code`)** — port name and port code are **each independently unique**, case-insensitive (`LOWER()`), scoped to the `(client_id, branch_id)` tuple.
- **Country cascade** — this master **has** a `country_id` column, so the list endpoint's `?country_id=` filter works: forms can load only the destination country's ports.
- **Empty → NULL** — an empty `city` is stored as `NULL`.
- No normalization, no system-seed lock, no `lockedFixed`.

---

## 5. SCREEN

Path: `/masters/port_of_discharge`. Standard master shell; the Country field is a cascading select (referencing Countries). List columns: Port Name · Code · Country · City · Status.

---

## 6. KNOWN LIMITATIONS

- Port codes are free text (max 50) with no format pattern — UN/LOCODE (e.g. `AEJEA`) is not enforced.
- Uniqueness is on name/code alone (not per-country), so the same port code cannot repeat across two countries within one tenant scope.
- Frontend prototype `uFields: ['code']` is narrower than the authoritative backend rule (`uEach: name + code`); the API is the source of truth.

---

*Related documents: PORT_OF_DISCHARGE_TECHNICAL_DOCUMENTATION.md, PORT_OF_DISCHARGE_API_DOCUMENTATION.md, PORT_OF_DISCHARGE_CODE_WALKTHROUGH.md*
