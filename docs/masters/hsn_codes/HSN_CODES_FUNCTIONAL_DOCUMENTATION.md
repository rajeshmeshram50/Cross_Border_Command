# HSN CODES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → HSN Codes

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

**HSN Codes** (Harmonised System of Nomenclature; SAC for services) are the 4–10 digit numeric commodity codes required on GST invoices and customs filings. Each code carries a description and an optional link to a GST rate slab.

Served by the generic engine (`MasterController` + `MasterPage.tsx`) over table `master_hsn_codes`.

### Downstream consumers
| Consumer | How it uses an HSN code |
|---|---|
| Products | A product carries its HSN/SAC code for invoicing & customs |
| GST Percentage master | Each HSN row references a `gst_rate_id` → the applicable slab |
| Quotations / Proforma Invoices / export docs | HSN printed on B2B invoices for GST filing |

The `gst_rate_id` link makes HSN Codes a **consumer of** the GST Percentage master — which is why a GST rate referenced by any HSN code cannot be deleted (see that master's 409 guard).

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rows, all tenants; may seed globals |
| Client Admin / Client User | Own client + globals; branch switcher narrows |
| Branch User | Globals + client-level + own branch |
| Employee | Globals + client-level + own rows |

Permissioned module: `master.hsn_codes` (`can_view/add/edit/delete`). Super admins bypass.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `hsn_code` | HSN / SAC Code | text | Yes | Regex `^[0-9]{4,10}$` — 4 to 10 digits |
| `description` | Description | textarea | Yes | Commodity description (uncapped) |
| `gst_rate_id` | GST Rate | select (ref) | No | Reference to a `gst_percentage` row |
| `status` | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Numeric format** — `hsn_code` must be 4 to 10 digits only. Invalid input returns *"HSN/SAC code must be 4 to 10 digits."* The frontend strips non-digits as the user types (so `0802-1200` auto-corrects to `08021200`).
- **Uniqueness** — `hsn_code` is unique within the tenant scope (case-insensitive `uEach`). The same code cannot exist twice under one (client, branch).
- **GST rate reference** — `gst_rate_id` points at a GST Percentage row; the dropdown renders each option as `{percentage}%`. It is optional (nullable).
- **Deletion** — soft delete, no in-use guard on HSN itself. (The guard lives on the *GST rate* side: you cannot delete a GST slab while any HSN code still references it.)

---

## 5. SCREEN

`/masters/hsn_codes` — searchable list (search over `hsn_code`, `description`, `status`), KPI strip, Add/Edit modal. The GST Rate dropdown is populated live from the GST Percentage master.

---

## 6. KNOWN LIMITATIONS

- Deleting an HSN code does not check whether products still reference it.
- `gst_rate_id` is validated only as an integer, not as a foreign key existence check at the master layer — pick from the dropdown to stay consistent.
- Description is uncapped at the master layer.

---
*Related documents: HSN_CODES_TECHNICAL_DOCUMENTATION.md, HSN_CODES_API_DOCUMENTATION.md, HSN_CODES_CODE_WALKTHROUGH.md*
