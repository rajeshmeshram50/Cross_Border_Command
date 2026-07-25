# PRODUCT CONDITIONS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Product Conditions

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

**Product Conditions** describe the storage and handling state of goods (Organic, Fresh, Processed, Raw, Ambient, Cold Chain, Frozen). They are tagged on products and can influence storage routing.

Served by the generic engine (`MasterController` + `MasterPage.tsx`) over table `master_conditions`.

### Downstream consumers
| Consumer | How it uses a condition |
|---|---|
| Products | Condition tag on the product record |
| Warehouse / storage routing | Cold Chain / Frozen route to freezer or cold zone |
| Packing & export documents | Handling state noted on shipping docs |

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rows, all tenants; may seed globals |
| Client Admin / Client User | Own client + globals; branch switcher narrows |
| Branch User | Globals + client-level + own branch |
| Employee | Globals + client-level + own rows |

Permissioned module: `master.conditions` (`can_view/add/edit/delete`). Super admins bypass.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `title` | Condition Title | text | Yes | e.g. Organic, Cold Chain, Frozen; max 50 |
| `status` | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness** — `title` is unique within the tenant scope, case-insensitive (`uFields = ['title']`, a single text field promoted to the case-insensitive path).
- **Digit guard on title** — the frontend applies a name pattern that rejects digit-only titles. (Frontend-only; the backend schema for `conditions` enforces only required + max-length, with no regex.)
- **Deletion** — soft delete, no in-use reference guard.

---

## 5. SCREEN

`/masters/conditions` — searchable list (search over `title`, `status`), KPI strip, Add/Edit modal with the two fields.

---

## 6. KNOWN LIMITATIONS

- The title digit guard is enforced on the frontend only; the backend accepts any string within the length cap.
- Deleting a condition does not check for referencing products.
- Storage-routing behaviour (e.g. Cold Chain → freezer) is applied by downstream modules, not configured on this master.

---
*Related documents: CONDITIONS_TECHNICAL_DOCUMENTATION.md, CONDITIONS_API_DOCUMENTATION.md, CONDITIONS_CODE_WALKTHROUGH.md*
