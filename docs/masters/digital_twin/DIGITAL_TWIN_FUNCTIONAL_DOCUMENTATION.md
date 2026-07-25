# DIGITAL TWIN — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Digital Twin

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Digital Twin** master registers named **visual warehouse views** — a saved entry point for a map that renders the full `Warehouse ▸ Zone ▸ Rack ▸ Shelf` hierarchy with live occupancy. It sits alongside the warehouse hierarchy rather than inside its physical chain: each row is simply a named view (e.g. "Pune Main 3D View") that the Digital Twin screen scopes to. The master itself is intentionally lightweight — just a name and a status. Served by the schema-driven Masters engine.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All views, all tenants; may seed globals |
| Client Admin / User | Own client's views + globals; switcher-narrowable |
| Branch User | Globals + client-level + own-branch views |
| Employee | Globals + client-level + only views they created |

Module **`master.digital_twin`** (`can_view / can_add / can_edit / can_delete`).

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `name` | View Name | text | ✅ | e.g. Pune Main 3D View |
| `status` | Status | select | ✅ | Active · Inactive |

---

## 4. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | **`name` is unique** (`uFields`, single text field → case-insensitive), per tenant |
| 2 | No parent reference — the visual view resolves warehouses/zones/racks at render time, not via a stored FK |
| 3 | `client_id` / `branch_id` stamped from the logged-in user |
| 4 | Edit/delete follow the tier ladder; creators manage own rows; employees peer-isolated |
| 5 | Every write bumps the form-bundle cache |

---

## 5. SCREEN

`/masters/digital_twin`: search, **Add Digital Twin Entry**, table of View Name · Status. The "How this works" strip describes the downstream visual map — Warehouse → Zone → Rack → Shelf hierarchy, live occupancy bars, click-through rack detail, and warehouse filtering. (Seed data is empty by default.)

---

## 6. KNOWN LIMITATIONS

| Area | Limitation |
|---|---|
| Scope | The master row is metadata only — it stores a name/status, not the warehouse it maps; view scoping is a frontend concern |
| Delete | Hard delete (no `SoftDeletes` trait) |
| Search | `ILIKE` on `name`/`status` only |

---

*Related documents: DIGITAL_TWIN_TECHNICAL_DOCUMENTATION.md · DIGITAL_TWIN_API_DOCUMENTATION.md · DIGITAL_TWIN_CODE_WALKTHROUGH.md*
