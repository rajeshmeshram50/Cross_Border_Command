# UNITS OF MEASUREMENT MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Units of Measurement

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

**Units of Measurement (UOM)** define the units (Kilogram, Metric Ton, Liter, Piece, Box, Carton, CBM…) used on product and shipment records. Each has a title, a short code, and an optional unit type classification.

Served by the generic engine (`MasterController` + `MasterPage.tsx`) over table `master_uom`.

### Downstream consumers
| Consumer | How it uses a UOM |
|---|---|
| Products | Base/selling unit of the product |
| Shipment / Procurement records | Quantity units on line items |
| Packing lists & export documents | Unit printed alongside quantities |

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rows, all tenants; may seed globals |
| Client Admin / Client User | Own client + globals; branch switcher narrows |
| Branch User | Globals + client-level + own branch |
| Employee | Globals + client-level + own rows |

Permissioned module: `master.uom` (`can_view/add/edit/delete`). Super admins bypass.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `title` | Unit Title | text | Yes | e.g. Kilogram; frontend blocks digit-only names |
| `short_code` | Short Code | text | Yes | e.g. KG — **auto-suggested from title**, editable |
| `unit_type` | Unit Type | select | No | Weight / Volume / Length / Area / Count / Other |
| `status` | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness** — `title` **and** `short_code` must each be independently unique within the tenant scope, case-insensitive (`uEach = ['title','short_code']`).
- **Auto-derived short code** — as the user types the Unit Title, the frontend auto-suggests a short code (e.g. "Kilogram" → "KG"). It remains editable, so the user can override before saving. This is a frontend convenience; the backend simply persists whatever `short_code` is submitted.
- **Digit guard on title** — the frontend applies a name pattern that rejects digit-only titles. (This is a frontend rule; the backend schema for `title` enforces only required + max-length.)
- **Deletion** — soft delete, no in-use reference guard.

---

## 5. SCREEN

`/masters/uom` — searchable list (search over `title`, `short_code`, `unit_type`, `status`), KPI strip, Add/Edit modal. Typing the Unit Title live-fills the Short Code field.

---

## 6. KNOWN LIMITATIONS

- The short-code auto-derive is frontend-only; a direct API call must supply `short_code` explicitly (it is required).
- The title digit guard is enforced on the frontend only; the backend accepts any string within the length cap.
- Deleting a UOM does not check for referencing products or shipments.

---
*Related documents: UOM_TECHNICAL_DOCUMENTATION.md, UOM_API_DOCUMENTATION.md, UOM_CODE_WALKTHROUGH.md*
