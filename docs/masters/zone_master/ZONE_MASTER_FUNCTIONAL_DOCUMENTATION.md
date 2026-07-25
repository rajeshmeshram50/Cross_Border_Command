# ZONE MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Zone Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Zone Master** is the **second level** of the warehouse hierarchy:

```
Warehouse ▸ [ Zone ] ▸ Rack ▸ Shelf
```

A zone is a logical area **inside a warehouse** — Storage, Cold Chain, Hazardous, Dispatch, Holding, QC Hold, etc. Each zone **belongs to one warehouse** (reference to Warehouse Master) and carries cold-chain / hazardous permission flags. Racks are later created inside a zone. Served by the schema-driven Masters engine.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All zones, all tenants; may seed globals |
| Client Admin / User | Own client's zones + globals; switcher-narrowable by branch |
| Branch User | Globals + client-level + own-branch zones |
| Employee | Globals + client-level + only zones they created |

Module **`master.zone_master`** (`can_view / can_add / can_edit / can_delete`).

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `zone_id` | Zone ID | text | ✅ | e.g. `ZN-001` |
| `zone_name` | Zone Name | text | ✅ | e.g. Zone A — Storage |
| `zone_type` | Zone Type | select | ✅ | Storage · Cold Chain · Hazardous · Dispatch · Holding · QC Hold · Overflow · Blocked · Regulated |
| `warehouse` | Warehouse | select (ref) | ✅ | → Warehouse Master (`wh_name`) |
| `purpose` | Zone Purpose | textarea | — | |
| `cold_chain` | Cold Chain Allowed | select | — | No · Yes |
| `hazardous` | Hazardous Allowed | select | — | No · Yes |
| `status` | Status | select | ✅ | Active · Inactive |

---

## 4. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | **`zone_id` and `zone_name` are each independently unique** (`uEach`), case-insensitive, per tenant |
| 2 | **`warehouse` is required** — a zone cannot exist without a parent warehouse; the dropdown cascades off Warehouse Master |
| 3 | `client_id` / `branch_id` stamped from the logged-in user, never from the body |
| 4 | Edit/delete follow the tier ladder; creators manage own rows; employees peer-isolated |
| 5 | Every write bumps the form-bundle cache so the Rack master's Zone dropdown refreshes |

---

## 5. SCREEN

`/masters/zone_master`: search, **Add Zone**, table of Zone ID · Zone Name · Zone Type · Warehouse · Cold Chain · Hazardous · Status. The Add/Edit modal presents a Warehouse dropdown fed by Warehouse Master, followed by zone type and permission toggles.

---

## 6. KNOWN LIMITATIONS

| Area | Limitation |
|---|---|
| Warehouse validity | `warehouse` is validated as an integer only — no FK existence check; a stale id is accepted |
| Delete | No in-use guard against racks that reference the zone; delete is permanent (no `SoftDeletes`) |
| Search | `ILIKE` across text/select fields only |

---

*Related documents: ZONE_MASTER_TECHNICAL_DOCUMENTATION.md · ZONE_MASTER_API_DOCUMENTATION.md · ZONE_MASTER_CODE_WALKTHROUGH.md*
