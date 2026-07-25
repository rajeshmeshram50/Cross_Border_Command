# LEGAL ENTITIES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Legal Entities

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Legal Entities** master (`legal_entities`) registers each distinct incorporated body the tenant operates under — entity/legal name, CIN, incorporation date, business type/sector, registered address, currency, financial year, a **logo** used on documents, and one or more **bank accounts** captured inline.

**Downstream consumers:** entity identity, logo and bank details feed export/trade documents and financial reporting; the currency + financial year drive money formatting and period logic. Each entity carries an auto-generated `entity_code` (`LE-0001…`) used as its stable reference.

---

## 2. ROLES & ACCESS

Permissioned module `master.legal_entities` (`can_view / can_add / can_edit / can_delete`). Super admin bypasses.

| Role | Visibility |
|---|---|
| Super Admin | All entities, all tenants; may seed globals |
| Client Admin / Client User | Own client's rows + globals; branch-switcher narrows |
| Branch User | Globals + client-level + own branch rows |
| Employee | Globals + client-level + only own rows |

---

## 3. FIELDS

| Field / Label | Type | Required | Options / Ref | Rules & Notes |
|---|---|---|---|---|
| entity_code | text (auto) | Auto | — | `LE-####`, generated on create by model hook if blank |
| logo_path / Logo | file | No | .png/.jpg/.jpeg ≤2MB | Stored on public disk; path saved to `logo_path` |
| country_id / Country | select | Yes | ref countries | |
| entity_name / Entity Name | text | Yes | — | Unique (case-insensitive) |
| legal_name / Legal Name | text | Yes | — | Unique (case-insensitive) |
| cin / CIN | text | Yes | — | Unique (case-insensitive) |
| date_of_incorporation | date | Yes | — | Cast to date |
| type_of_business | select | Yes | Manufacturing, Trading, Services, IT / ITeS, Healthcare, … | |
| sector | select | Yes | Healthcare, IT, Finance, Manufacturing, … | |
| nature_of_business | select | No | Private Limited, Public Limited, LLP, Partnership, … | |
| address_line1 | text | Yes | — | |
| address_line2 | text | No | — | |
| city | text | Yes | — | |
| state_id / State | select | Yes | ref states | Cascades off Country in UI |
| zip_code | text | Yes | — | |
| currency_id / Currency | select | No | ref currencies | |
| financial_year | select | No | April - March, January - December, July - June | |
| status | select | Yes | Active, Inactive | |
| **banks[]** (sublist) | sublist | Yes (≥1) | — | Inline bank accounts, see §4 |

**Bank sub-fields:** `bank_name` (letters only), `branch_name` (required, letters only), `account_number` (9–18 digits), `ifsc_code` (11-char IFSC), `account_type` (Current/Savings), `is_primary` (Yes/No).

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach`):** `entity_name`, `cin`, `legal_name` each independently unique (case-insensitive), tenant-scoped.
- **Auto entity_code:** on create, if `entity_code` is blank the model's `creating` hook assigns the next `LE-####` (4-pad) from the highest existing suffix. *(Note: computed globally over the table, not per-tenant; the generic `next-code` endpoint returns `null` for this slug.)*
- **Logo upload:** a multipart `logo_path` file is stored under `master/legal_entities` on the `public` disk; on update the previous file is deleted before the new path replaces it.
- **Bank sublist (`banks[]`):** at least one bank with a `bank_name` is **mandatory** (else 422 `Please add at least one bank account.`). The controller re-validates each bank server-side (name charset, mandatory branch + IFSC, numeric 9–18 account, IFSC format). Sync is **true-sync**: banks not in the incoming list are deleted; existing ids are updated; new ones created.
- **Empty strings → NULL.**

---

## 5. SCREEN

Lives under Masters → **Legal Entities** (`/masters/legal_entities`). The Add/Edit modal is sectioned: Identity, Address, Financial, and Bank Details (repeatable bank cards with an inline primary-account flag). List columns: Entity Name, Legal Name, CIN, Country, Type of Business, Sector, Status. Edit pre-fills the `banks[]` cards inline (returned on the row payload).

---

## 6. KNOWN LIMITATIONS

- `entity_code` auto-number is computed over the whole table (not per tenant), so LE codes are globally sequential rather than per-client.
- No format regex on `cin`; only uniqueness applies.
- Delete has no in-use guard against documents that referenced the entity.

---
*Related documents: LEGAL_ENTITIES_TECHNICAL_DOCUMENTATION.md, LEGAL_ENTITIES_API_DOCUMENTATION.md, LEGAL_ENTITIES_CODE_WALKTHROUGH.md*
