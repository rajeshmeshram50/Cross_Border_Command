# FREEZER MANAGEMENT — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Freezer Management

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Freezer Management** master registers **cold-storage units** that sit inside a warehouse but **outside the rack/shelf chain** — freezers use direct placement (no bins/shelves required). Each freezer **belongs to one warehouse** (reference to Warehouse Master) and declares a box capacity. It is a peer of the Rack hierarchy under the same warehouse root:

```
Warehouse ▸ ( Zone ▸ Rack ▸ Shelf )   +   Warehouse ▸ [ Freezer ]
```

Served by the schema-driven Masters engine.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All freezers, all tenants; may seed globals |
| Client Admin / User | Own client's freezers + globals; switcher-narrowable |
| Branch User | Globals + client-level + own-branch freezers |
| Employee | Globals + client-level + only freezers they created |

Module **`master.freezers`** (`can_view / can_add / can_edit / can_delete`).

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `name` | Freezer Name | text | ✅ | e.g. Freezer Alpha |
| `warehouse` | Warehouse | select (ref) | ✅ | → Warehouse Master (`wh_name`) |
| `capacity` | Capacity (Boxes) | number | ✅ | total boxes the unit holds |
| `status` | Status | select | ✅ | Active · Inactive |

> The `occupancy` column shown in the grid is a display/derived value, not a persisted schema field.

---

## 4. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | **`name` + `warehouse` are unique as a combination** (`uFields`) — the same freezer name may repeat across different warehouses, but not twice in one warehouse. Name is compared case-insensitively; warehouse id exact |
| 2 | **`warehouse` is required** — a freezer must belong to a warehouse; the dropdown cascades off Warehouse Master |
| 3 | `client_id` / `branch_id` stamped from the logged-in user |
| 4 | Edit/delete follow the tier ladder; creators manage own rows; employees peer-isolated |
| 5 | Every write bumps the form-bundle cache |

---

## 5. SCREEN

`/masters/freezers`: search, **Add Freezer**, table of Freezer Name · Warehouse · Capacity · Occupancy · Status. The modal captures name → warehouse → capacity → status; the "How this works" strip covers naming, warehouse linking, capacity, and occupancy tracking.

---

## 6. KNOWN LIMITATIONS

| Area | Limitation |
|---|---|
| Warehouse validity | `warehouse` validates as `integer` only — no FK existence check |
| Occupancy | Occupancy is a computed/display metric, not enforced against `capacity` at the master level |
| Delete | Hard delete (no `SoftDeletes` trait) |
| Search | `ILIKE` on text/select fields only (`name`, `status`) — `capacity` and the numeric `warehouse` id are not name-searched |

---

*Related documents: FREEZERS_TECHNICAL_DOCUMENTATION.md · FREEZERS_API_DOCUMENTATION.md · FREEZERS_CODE_WALKTHROUGH.md*
