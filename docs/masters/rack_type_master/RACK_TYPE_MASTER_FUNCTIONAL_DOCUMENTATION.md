# RACK TYPE MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Rack Type Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Rack Type Master** is a **classification catalogue** for the warehouse hierarchy. It does not sit on the physical `Warehouse ▸ Zone ▸ Rack ▸ Shelf` chain directly; instead it defines the **kinds of rack** (Pallet Rack, Cool Rack, Hazardous Rack, Cantilever, Floor Rack…) that the **Rack & Location Master** picks from when a physical rack is created. Each type records load and shelf-level characteristics. Served by the schema-driven Masters engine.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All rack types, all tenants; may seed globals |
| Client Admin / User | Own client's types + globals; switcher-narrowable |
| Branch User | Globals + client-level + own-branch types |
| Employee | Globals + client-level + only types they created |

Module **`master.rack_type_master`** (`can_view / can_add / can_edit / can_delete`).

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `type_code` | Type Code | text | ✅ | e.g. `PLT` |
| `type_name` | Rack Type Name | text | ✅ | e.g. Pallet Rack |
| `description` | Description | textarea | — | |
| `suitable_for` | Suitable For | select | — | General Inventory · Cold Chain · Hazardous · Heavy Duty · Retail · Pharma · All Types |
| `max_load_per_shelf` | Max Load Per Shelf (kg) | number | — | |
| `typical_shelves` | Typical Shelf Levels | number | — | |
| `status` | Status | select | ✅ | Active · Inactive |

---

## 4. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | **`type_code` and `type_name` are each independently unique** (`uEach`), case-insensitive, per tenant |
| 2 | No parent reference — this is a catalogue consumed by the Rack master's `rackType` dropdown |
| 3 | `client_id` / `branch_id` stamped from the logged-in user |
| 4 | Edit/delete follow the tier ladder; creators manage own rows; employees peer-isolated |
| 5 | Every write bumps the form-bundle cache so the Rack master's Rack Type dropdown refreshes |

---

## 5. SCREEN

`/masters/rack_type_master`: search, **Add Rack Type**, table of Code · Rack Type · Suitable For · Max Load/Shelf · Typical Levels · Status. The modal captures code → name → suitability → load specs.

---

## 6. KNOWN LIMITATIONS

| Area | Limitation |
|---|---|
| Delete | No in-use guard against racks that reference the type; delete is permanent (no `SoftDeletes`) |
| Bounds | `max_load_per_shelf` / `typical_shelves` accept any numeric, no upper cap |
| Search | `ILIKE` across text/select fields only (not numeric columns) |

---

*Related documents: RACK_TYPE_MASTER_TECHNICAL_DOCUMENTATION.md · RACK_TYPE_MASTER_API_DOCUMENTATION.md · RACK_TYPE_MASTER_CODE_WALKTHROUGH.md*
