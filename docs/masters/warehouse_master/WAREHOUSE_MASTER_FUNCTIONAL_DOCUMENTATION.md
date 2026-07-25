# WAREHOUSE MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Warehouse Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Warehouse Master** is the **root** of the warehouse hierarchy:

```
Warehouse ▸ Zone ▸ Rack ▸ Shelf   (+ Rack Types · Temperature Classes · Freezers · Digital Twin)
```

It registers every physical storage location the tenant operates — both **Own Warehouse** and **Third Party Warehouse** sites — with address and contact detail. Every downstream warehouse master (Zone, Rack, Freezer) references a warehouse row, so this master is created **first**. It is served by the schema-driven Masters engine (`MasterController` + `MasterPage.tsx`); only its field/rule set is unique.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All warehouses, all tenants; may seed globals (`client_id = NULL`) |
| Client Admin / User | Own client's warehouses + globals; may narrow by branch via the switcher |
| Branch User | Globals + client-level + own-branch warehouses (sibling branches hidden) |
| Employee | Globals + client-level + only warehouses they created (peer-isolated) |

Permissioned as module **`master.warehouse_master`** (`can_view / can_add / can_edit / can_delete`). Super admins bypass.

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `wh_id` | Warehouse ID | text | ✅ | Unique code, e.g. `WH-001` |
| `wh_name` | Warehouse Name | text | ✅ | e.g. Pune Main |
| `wh_type` | Warehouse Type | select | ✅ | Own Warehouse · Third Party Warehouse |
| `city` | City | text | ✅ | |
| `state` | State | text | — | Free text |
| `pincode` | PIN Code | text | — | |
| `contact_person` | Contact Person | text | — | Warehouse in-charge |
| `contact_phone` | Contact Phone | text | — | |
| `area_sqft` | Area (sq. ft.) | number | — | |
| `address` | Full Address | textarea | — | |
| `status` | Status | select | ✅ | Active · Inactive |

---

## 4. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | **`wh_id` and `wh_name` are each independently unique** (`uEach`), case-insensitive, per tenant scope |
| 2 | This master has **no parent reference** — it is the top of the warehouse tree |
| 3 | `client_id` / `branch_id` are stamped from the logged-in user, never trusted from the request body |
| 4 | Edit/delete follow the tier ladder (super > client > branch); creators always manage their own rows; employees are peer-isolated |
| 5 | Any create/edit/delete bumps the form-bundle cache so warehouse dropdowns (Zone, Rack, Freezer) refresh immediately |

---

## 5. SCREEN

Generic Master page (`/masters/warehouse_master`): search box, **Add Warehouse** button, and a table showing WH ID · Warehouse Name · Type · City · Contact Person · Status, plus a **Created By** sub-label and Edit/Delete actions. The Add/Edit modal renders the fields above; a "How this works" strip walks through ID → type → location → contact.

---

## 6. KNOWN LIMITATIONS

| Area | Limitation |
|---|---|
| Delete | No in-use guard — deleting a warehouse still referenced by zones/racks/freezers leaves those children pointing at a missing id |
| Search | Server-side `ILIKE` across text/select fields only (not `area_sqft`) |
| State | `state` is free text, not linked to the States master |
| Delete type | This model has no `SoftDeletes` trait, so delete is permanent (no `deleted_at` recovery) |

---

*Related documents: WAREHOUSE_MASTER_TECHNICAL_DOCUMENTATION.md · WAREHOUSE_MASTER_API_DOCUMENTATION.md · WAREHOUSE_MASTER_CODE_WALKTHROUGH.md*
