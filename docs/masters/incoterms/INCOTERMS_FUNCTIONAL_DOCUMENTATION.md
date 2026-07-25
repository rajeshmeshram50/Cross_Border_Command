# INCOTERMS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Incoterms

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

**Incoterms** are the standardized international trade terms (FOB, CIF, EXW, DDP…) that define delivery point and risk transfer between buyer and seller. Each carries a short code, full name, and an optional transport mode.

Served by the generic engine (`MasterController` + `MasterPage.tsx`) over table `master_incoterms`.

### Downstream consumers
| Consumer | How it uses an incoterm |
|---|---|
| Quotations / Proforma Invoices | Delivery term printed on the invoice |
| Sales / export documents | Defines delivery point + risk transfer |
| Shipment records | Terms of carriage |

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rows, all tenants; may seed globals |
| Client Admin / Client User | Own client + globals; branch switcher narrows |
| Branch User | Globals + client-level + own branch |
| Employee | Globals + client-level + own rows |

Permissioned module: `master.incoterms` (`can_view/add/edit/delete`). Super admins bypass.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `code` | Incoterm Code | text | Yes | e.g. FOB, CIF; max 50 |
| `full_name` | Full Name | text | Yes | e.g. Free On Board |
| `transport_mode` | Transport Mode | select | No | Sea/Inland Waterway / Any Mode / Air / Road / Rail |
| `status` | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness** — both `code` **and** `full_name` must each be independently unique within the tenant scope, case-insensitive (`uEach = ['code','full_name']`).
  - *Note:* the frontend config hints only `code`, but the backend enforces both — the authoritative rule.
- **Digit guard on full name** — the frontend applies a name pattern rejecting digit-only full names (frontend-only; the backend has no regex on this field).
- **Transport mode** — optional; must be one of the fixed options if supplied.
- **Deletion** — soft delete, no in-use reference guard.

---

## 5. SCREEN

`/masters/incoterms` — searchable list (search over `code`, `full_name`, `transport_mode`, `status`), KPI strip, Add/Edit modal with the four fields.

---

## 6. KNOWN LIMITATIONS

- Deleting an incoterm does not check for referencing quotations/invoices.
- The frontend's uniqueness hint (`code` only) is narrower than the backend's actual rule (`code` + `full_name`).
- The full-name digit guard is frontend-only.

---
*Related documents: INCOTERMS_TECHNICAL_DOCUMENTATION.md, INCOTERMS_API_DOCUMENTATION.md, INCOTERMS_CODE_WALKTHROUGH.md*
