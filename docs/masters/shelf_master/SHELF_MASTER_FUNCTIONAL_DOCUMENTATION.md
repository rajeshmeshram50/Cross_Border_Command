# SHELF / LEVEL MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Shelf / Level Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Shelf / Level Master** is the **innermost level** of the warehouse hierarchy:

```
Warehouse ▸ Zone ▸ Rack ▸ [ Shelf ]
```

A shelf (or level) is a horizontal storage layer **inside a rack**. Each shelf belongs to one **Rack** (reference to the Rack & Location Master), carries a level number (1 = bottom), a shelf type, a max weight, and an operational status. This is the leaf where physical stock ultimately sits. Served by the schema-driven Masters engine.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All shelves, all tenants; may seed globals |
| Client Admin / User | Own client's shelves + globals; switcher-narrowable |
| Branch User | Globals + client-level + own-branch shelves |
| Employee | Globals + client-level + only shelves they created |

Module **`master.shelf_master`** (`can_view / can_add / can_edit / can_delete`).

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `rack_ref` | Rack | select (ref) | ✅ | → Rack & Location Master (`rackName`) |
| `shelf_name` | Shelf Name | text | ✅ | e.g. `Shelf A1-L1` |
| `level_no` | Level Number | number | ✅ | 1 = bottom |
| `shelf_type` | Shelf Type | select | ✅ | Standard · Cold · Heavy Duty · Cantilever · Mesh · Wire Deck Shelf |
| `max_weight` | Max Weight (kg) | number | — | |
| `status` | Status | select | ✅ | Available · Partially Used · Full · Blocked · Under Maintenance |

---

## 4. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | **`shelf_name` is unique** (`uFields`, single text field → case-insensitive), per tenant |
| 2 | **`rack_ref` is required** — a shelf cannot exist without a parent rack; the dropdown cascades off the Rack master |
| 3 | `client_id` / `branch_id` stamped from the logged-in user |
| 4 | Edit/delete follow the tier ladder; creators manage own rows; employees peer-isolated |
| 5 | Every write bumps the form-bundle cache |

---

## 5. SCREEN

`/masters/shelf_master`: search, **Add Shelf**, table of Shelf Name · Rack · Level · Type · Max Weight · Status. The modal cascades Warehouse → Rack, then captures level number, type, weight, and status. (Seed data is empty by default — shelves are tenant-created.)

---

## 6. KNOWN LIMITATIONS

| Area | Limitation |
|---|---|
| Rack validity | `rack_ref` validates as `integer` only — no FK existence check |
| Uniqueness scope | `shelf_name` is unique per tenant, not per rack — two racks can't reuse "Shelf L1" |
| Delete | Hard delete (no `SoftDeletes` trait) |
| Search | `ILIKE` across text/select fields only (`shelf_name`, `shelf_type`, `status`) |

---

*Related documents: SHELF_MASTER_TECHNICAL_DOCUMENTATION.md · SHELF_MASTER_API_DOCUMENTATION.md · SHELF_MASTER_CODE_WALKTHROUGH.md*
