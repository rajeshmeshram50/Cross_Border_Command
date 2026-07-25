# PORTS OF LOADING MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Ports of Loading

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Ports of Loading** master lists the **origin ports** from which shipments depart. These appear on shipping bills and export invoices as the port of origin. It is one of ~56 masters served by the schema-driven engine (`MasterController` + `MasterPage.tsx`).

**Downstream consumers:** shipment / export document generation prints the loading port (name + code); quotation/PI and shipment-order forms select a port of loading.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rows, all tenants; may seed global rows |
| Client Admin / Client User | Client rows + globals; branch-switcher narrowable |
| Branch User | Globals + client-level rows + own branch rows |
| Employee | Globals + client-level rows + only own rows |

Permissioned module: `master.port_of_loading`.

---

## 3. FIELDS

| Field | Label · Type · Required | Options / Ref | Rules & Notes |
|---|---|---|---|
| `name` | Port Name · text · **required** | — | Max 50; case-insensitive unique. e.g. "Chennai Port". |
| `code` | Port Code · text · **required** | — | Max 50; case-insensitive unique. e.g. `INMAA`. |
| `address` | Address · textarea · optional | — | Free text, uncapped length. |
| `status` | Status · select · **required** | Active / Inactive | Enforced via `Rule::in`. |

Plus engine-managed `client_id`, `branch_id`, `created_by`.

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach` = `name` + `code`)** — port name and port code are **each independently unique**, case-insensitive (`LOWER()`), scoped to the `(client_id, branch_id)` tuple. Prevents two "Chennai Port" entries with different codes coexisting, and vice-versa.
- **Empty → NULL** — an empty `address` is stored as `NULL`.
- No normalization, no reference/cascade, no system-seed lock, no `lockedFixed`.

---

## 5. SCREEN

Path: `/masters/port_of_loading`. Standard master shell — searchable list, KPI strip, Add/Edit modal, soft delete. List columns: Port Name · Port Code · Status.

---

## 6. KNOWN LIMITATIONS

- Port codes are free text (max 50) with no format pattern — the UN/LOCODE convention (e.g. `INMAA`) is not enforced.
- No `country_id` on this master (unlike Ports of Discharge), so origin ports cannot be cascaded/filtered by country.
- Frontend prototype `uFields: ['code']` is narrower than the authoritative backend rule (`uEach: name + code`); the API is the source of truth.

---

*Related documents: PORT_OF_LOADING_TECHNICAL_DOCUMENTATION.md, PORT_OF_LOADING_API_DOCUMENTATION.md, PORT_OF_LOADING_CODE_WALKTHROUGH.md*
