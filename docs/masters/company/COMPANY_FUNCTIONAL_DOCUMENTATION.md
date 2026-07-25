# COMPANY DETAILS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Company Details

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Company Details** master (`company`) stores the tenant's own legal trading identity — legal name, tax registrations (GSTIN, PAN, CIN, IEC) and registered contact/address. It is one of ~56 masters served by the shared schema-driven engine (`MasterController` + `MasterPage.tsx`).

**Downstream consumers:** the company identity, GSTIN, PAN and IEC printed on export documents — quotations, proforma invoices, shipping/trade PDFs — and used as the "from" party across the Sales and CLM modules. Keeping this accurate is what makes every generated document legally correct.

---

## 2. ROLES & ACCESS

Permissioned module `master.company` with `can_view / can_add / can_edit / can_delete`. Super admin bypasses all checks.

| Role | Visibility |
|---|---|
| Super Admin | All companies, all tenants; may seed global rows (`client_id = NULL`) |
| Client Admin / Client User | Own client's rows + globals; branch-switcher can narrow |
| Branch User | Globals + client-level rows + own branch rows (siblings hidden) |
| Employee | Globals + client-level rows + only rows they created (peer-isolated) |

Edit/delete of another tier's row is blocked by `hierarchicalDenial` (own row always allowed).

---

## 3. FIELDS

| Field / Label | Type | Required | Options / Ref | Rules & Notes |
|---|---|---|---|---|
| company_name / Company Name | text | Yes | — | Unique (case-insensitive), max 50 |
| short_code / Short Code | text | Yes | — | max 50 |
| gstin / GSTIN | text | Yes | — | Uppercased on save; unique (case-insensitive) |
| pan / PAN Number | text | Yes | — | Uppercased on save; unique (case-insensitive) |
| cin / CIN | text | No | — | Uppercased on save |
| iec / IEC Code | text | No | — | max 50 |
| email / Email | email | No | — | Valid email, max 255 |
| mobile / Mobile | text | No | — | max 50 |
| city / City | text | No | — | max 50 |
| state / State | text | No | — | Free text (not a State master ref), max 50 |
| address / Registered Address | textarea | No | — | Uncapped |
| status / Status | select | Yes | Active, Inactive | Enum enforced server-side |

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach`):** `company_name`, `gstin` and `pan` are each **independently** unique within the tenant scope, compared case-insensitively (`LOWER()`), so "AADCI6120M" and "aadci6120m" collide.
- **Normalization:** `gstin`, `pan`, `cin` are uppercased before validation and storage.
- **No auto-code, no uploads, no sublist, no system-seed** on this master.
- **Empty strings → NULL** on save.
- Every create/update/delete bumps the master dropdown-bundle cache.

---

## 5. SCREEN

Lives under Masters → **Company Details** (`/masters/company`). Standard shell: searchable list (search runs ILIKE over text/email/textarea/select fields), Add/Edit modal, delete confirm. The list columns are Company Name, Short Code, GSTIN, City, Status.

---

## 6. KNOWN LIMITATIONS

- `state` is a free-text field, not linked to the States master — spelling is not validated.
- No format regex on `gstin` / `pan` / `iec` / `cin` — only uppercase normalization and uniqueness apply.
- No in-use guard on delete: removing a company row does not check whether any document referenced it.

---
*Related documents: COMPANY_TECHNICAL_DOCUMENTATION.md, COMPANY_API_DOCUMENTATION.md, COMPANY_CODE_WALKTHROUGH.md*
