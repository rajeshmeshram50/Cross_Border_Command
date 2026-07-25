# PACKAGING MATERIALS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Packaging Materials

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

**Packaging Materials** capture the box, carton, bag and wrapping types used when packing goods (PP Bag, Gunny Bag, Plastic Crate, Corrugated Box, Master Carton, Pallet…). Each carries a title and an optional material-type classification.

Served by the generic engine (`MasterController` + `MasterPage.tsx`) over table `master_packaging_material`.

### Downstream consumers
| Consumer | How it uses a packaging material |
|---|---|
| Packaging / packing module | Selectable material on packing records |
| Packing lists & export documents | Material type printed on shipping docs |
| Products | Default packaging on the product record |

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rows, all tenants; may seed globals |
| Client Admin / Client User | Own client + globals; branch switcher narrows |
| Branch User | Globals + client-level + own branch |
| Employee | Globals + client-level + own rows |

Permissioned module: `master.packaging_material` (`can_view/add/edit/delete`). Super admins bypass.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `title` | Packaging Material | text | Yes | e.g. PP Bag, Gunny Bag; max 50 |
| `material_type` | Material Type | select | No | Bag / Box / Crate / Drum / Pallet / Wrap / Other |
| `status` | Status | select | Yes | Active / Inactive |

---

## 4. BUSINESS RULES

- **Uniqueness** — `title` is unique within the tenant scope, case-insensitive (`uEach = ['title']`). "PP Bag" and "pp bag" collide.
- **Material type** — optional classification; must be one of the fixed options if supplied.
- **Deletion** — soft delete, no in-use reference guard.

---

## 5. SCREEN

`/masters/packaging_material` — searchable list (search over `title`, `material_type`, `status`), KPI strip, Add/Edit modal with the three fields.

---

## 6. KNOWN LIMITATIONS

- Deleting a packaging material does not check for referencing packing records or products.
- No structured attributes beyond title/type (e.g. dimensions, tare weight are not modelled here).

---
*Related documents: PACKAGING_MATERIAL_TECHNICAL_DOCUMENTATION.md, PACKAGING_MATERIAL_API_DOCUMENTATION.md, PACKAGING_MATERIAL_CODE_WALKTHROUGH.md*
