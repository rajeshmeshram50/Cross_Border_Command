# ASSET CATEGORIES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Asset Categories

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. Overview

**Asset Categories** group physical assets by type (Laptop, Desktop Computer, Machinery, Office Furniture…) and carry the **depreciation rate** and **useful-life** used by fixed-asset accounting. Every row in the **Assets** master points at a category via `asset_type_id`.

**Consumers**
- **Assets master** — category dropdown (`asset_type_id` → this master's `name`).
- **HR / Employee Onboarding** — Stage 1 pulls assignable asset lists **by category name** (e.g. "Laptop", "Mobile"); this is why certain seeded categories are protected from deletion.
- **Depreciation reporting** — reads `depreciation_rate` + `useful_life_years`.

It is part of the **Operations & Support** category and runs on the schema-driven Masters engine.

---

## 2. Roles & Access

| Role | View | Add | Edit | Delete |
|---|---|---|---|---|
| Super admin | All tenants | Yes (bypass) | Yes | Yes* |
| Client admin / user | Global + own client | Yes | Own-tier | Own-tier |
| Branch user / employee | Global + client-level + own rows | Yes | Own rows | Own rows |

Gated by `master.asset_categories` permission flags. *System-seeded categories cannot be deleted by anyone (see §4).

---

## 3. Fields

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `name` | Category Name | text | Yes | e.g. Laptop, Machinery |
| `depreciation_rate` | Depreciation Rate (% pa) | number | No | e.g. 33 |
| `useful_life_years` | Useful Life (years) | number | No | e.g. 3 |
| `status` | Status | select | Yes | Active / Inactive |

---

## 4. Business Rules

1. **Uniqueness** — `name` is unique per tenant, case-insensitive. Duplicate → 422.
2. **System-seed delete lock** — categories seeded as `is_system` (e.g. Laptop / Mobile referenced by employee onboarding) **cannot be deleted**; the API returns **403** ("This category is system-managed and cannot be deleted."). Deleting them would silently break the onboarding asset picker.
3. **System-seed edit lock** — any `is_system` row is also fully edit-locked (403); create a custom category if you need different depreciation values.
4. **Referenced by Assets** — categories feed the Asset master's category dropdown.
5. **Soft delete** — non-system rows are soft-deleted (`deleted_at`).

---

## 5. Screen

Masters dashboard → **Operations & Support → Asset Categories**. Standard list with search, an Add/Edit modal (Name, Depreciation Rate, Useful Life, Status), and Edit/Delete actions. System-managed rows surface a blocked delete (403 toast).

---

## 6. Known Limitations

- No cascade guard on the category side when a **non-system** category is deleted while assets still reference it — the asset's `asset_type_id` can be left pointing at a soft-deleted row.
- Depreciation rate / useful life are stored but this master does not itself compute depreciation.

---

*Related documents: ASSET_CATEGORIES_TECHNICAL_DOCUMENTATION.md, ASSET_CATEGORIES_API_DOCUMENTATION.md, ASSET_CATEGORIES_CODE_WALKTHROUGH.md*
