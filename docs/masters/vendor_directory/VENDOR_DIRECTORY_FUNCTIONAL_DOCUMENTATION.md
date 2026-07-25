# SUPPLIER DIRECTORY MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Supplier Directory

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The Supplier Directory (slug `vendor_directory`) is the roster of suppliers/vendors a business trades with — capturing supplier identity, a primary contact, the business segment, and a full address. It is one of the **P2P (Procure-to-Pay) masters** and is served by the generic schema-driven master engine (`MasterController` + `MasterPage.tsx`).

**Downstream P2P consumers:** it is the source of supplier identity, contact, segment and address used when **raising Purchase Orders** and running **vendor comparison**, and when mapping a directory entry to a full Vendor Master record.

---

## 2. ROLES & ACCESS

| Role | Visibility |
|---|---|
| Super Admin | All tenants; may seed global rows (`client_id = NULL`) |
| Client Admin / User | Own client rows + globals; may narrow by branch switcher |
| Branch User | Globals + client-level + own branch rows |
| Employee | Globals + client-level + only own-created rows |

Permissioned module: `master.vendor_directory` (`can_view / can_add / can_edit / can_delete`). Super admin bypasses.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| vendor_company_name | Vendor Company Name | textarea | Yes | capped at **512 chars** (not the default 50) |
| contact_person | Contact Person | text | Yes | max 50 chars |
| mobile_number | Mobile Number | text | Yes | max 50 chars |
| email_id | Email Id | email | Yes | valid email, max 255 |
| segment_id | Segment | select | Yes | **reference** to `segments` master (integer id) |
| address | Address | text | Yes | max 50 chars |
| country | Country | select | Yes | **fixed enum**: India / USA / UAE / UK / Germany / Australia / Singapore / Other |
| state | State | select | Yes | **reference** to `states` master (integer id) |
| city | City | text | Yes | max 50 chars |
| mapping_mode | Mapping Mode | select | Yes | Map from Vendor Master / Map New Vendor |
| status | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach`)** — `vendor_company_name`, `mobile_number` **and** `email_id` are **each independently unique**, case-insensitive, within the tenant `(client_id, branch_id)` scope.
- `vendor_company_name` is a textarea allowing up to **512 characters**; email is capped at 255.
- `country` is a **fixed enum select** (not a foreign key), while `state` is a real **reference** to the states master (integer id). `segment_id` is a reference to the segments master.
- Plain text fields (`contact_person`, `address`, `city`) cap at 50 chars; empty optional values are stored as NULL.
- Delete is a **hard delete** (this table has no soft-delete column).

---

## 5. SCREEN

Rendered by the generic `MasterPage.tsx` shell: searchable list, Add/Edit modal, delete confirm. List columns include Vendor Company Name, Contact Person, Mobile, Email, Segment, Country, State, City, Status. Search runs an ILIKE across the text/email/textarea/select fields. Segment and State names are resolved on the frontend from its cached master bundle (the list endpoint returns raw integer ids).

---

## 6. KNOWN LIMITATIONS

- The list endpoint does **not** eager-load segment/state — the UI resolves those names from its cached master bundle; a missing bundle entry shows a raw id.
- No auto-code generation — there is no supplier code (`next-code` returns `{code:null}`).
- `country` is a hardcoded enum list; adding a country requires a schema change, not a master row.

---
*Related documents: VENDOR_DIRECTORY_TECHNICAL_DOCUMENTATION.md, VENDOR_DIRECTORY_API_DOCUMENTATION.md, VENDOR_DIRECTORY_CODE_WALKTHROUGH.md*
