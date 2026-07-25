# RACK & LOCATION MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Rack & Location Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Rack & Location Master** is the **third level** of the warehouse hierarchy and the busiest join in it:

```
Warehouse ▸ Zone ▸ [ Rack ] ▸ Shelf
```

A rack is a physical storage structure inside a **zone** of a **warehouse**. It pulls together four other masters at once: it belongs to a **Warehouse** and a **Zone**, is classified by a **Rack Type**, and (optionally) carries a **Temperature Class**. It records capacity (shelves, weight, volume) and an operational **rack status**. Shelves are later created against a rack. Served by the schema-driven Masters engine.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All racks, all tenants; may seed globals |
| Client Admin / User | Own client's racks + globals; switcher-narrowable |
| Branch User | Globals + client-level + own-branch racks |
| Employee | Globals + client-level + only racks they created |

Module **`master.racks`** (`can_view / can_add / can_edit / can_delete`).

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `whType` | Warehouse Type | select | ✅ | Own Warehouse · Third Party Warehouse |
| `warehouse` | Warehouse | select (ref) | ✅ | → Warehouse Master (`wh_name`) |
| `zone` | Zone | select (ref) | ✅ | → Zone Master (`zone_name`) |
| `rackName` | Rack Name | text | ✅ | e.g. `RC-001` |
| `rackType` | Rack Type | select (ref) | ✅ | → Rack Type Master (`type_name`) |
| `rackStatus` | Rack Status | select | ✅ | Partially Filled · Full · Blocked · Reserved · Under Maintenance · Empty |
| `tempClass` | Temperature Class | select (ref) | — | → Temperature Class Master (`class_name`) |
| `shelves` | Shelves / Levels | number | — | |
| `maxWeight` | Max Weight (kg) | number | — | |
| `maxVolume` | Max Volume (m³) | number | — | |

> There is **no `status` field** here — the operational state is `rackStatus`.

---

## 4. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | **`rackName` is unique** (`uFields`, single text field → case-insensitive), per tenant |
| 2 | **Four parents required at add time:** `warehouse`, `zone`, `rackType` (and `whType`); `tempClass` optional. Dropdowns cascade Warehouse → Zone → Rack Type / Temp Class |
| 3 | `client_id` / `branch_id` stamped from the logged-in user |
| 4 | Edit/delete follow the tier ladder; creators manage own rows; employees peer-isolated |
| 5 | Every write bumps the form-bundle cache so the Shelf master's Rack dropdown refreshes |

---

## 5. SCREEN

`/masters/racks`: search, **Add Rack**, table of Warehouse · Zone · Rack Name · Rack Type · Status · Temp Class. The modal cascades Warehouse → Zone, then Rack Type, operational status, optional Temp Class, and capacity (shelves/weight/volume).

---

## 6. KNOWN LIMITATIONS

| Area | Limitation |
|---|---|
| Dashboard counts | The card reads `status`, which this table does not have → `/master-counts` returns **0/0** for racks (query error is swallowed) |
| Reference validity | `warehouse`/`zone`/`rackType`/`tempClass` validate as `integer` only — no FK existence check |
| Delete | No in-use guard against shelves referencing the rack; delete is permanent (no `SoftDeletes`) |
| Search | `ILIKE` on text/select fields only (`rackName`, `whType`, `rackStatus`) — refs are numeric ids, not searched by name |

---

*Related documents: RACKS_TECHNICAL_DOCUMENTATION.md · RACKS_API_DOCUMENTATION.md · RACKS_CODE_WALKTHROUGH.md*
