# TEMPERATURE CLASS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Temperature Class Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Temperature Class Master** is a **classification catalogue** in the warehouse hierarchy. It defines the temperature bands used for controlled storage — Ambient, Room Temperature, Cold Chain, Frozen, Hazardous — with a min/max °C range and monitoring rules. The **Rack & Location Master** references a temperature class (`tempClass`) when a physical rack is defined, so this catalogue is created up-front alongside Rack Types. Served by the schema-driven Masters engine.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All classes, all tenants; may seed globals |
| Client Admin / User | Own client's classes + globals; switcher-narrowable |
| Branch User | Globals + client-level + own-branch classes |
| Employee | Globals + client-level + only classes they created |

Module **`master.temp_class_master`** (`can_view / can_add / can_edit / can_delete`).

---

## 3. FIELDS

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `class_code` | Class Code | text | ✅ | e.g. `AMB` |
| `class_name` | Temperature Class | text | ✅ | e.g. Ambient |
| `temp_range_min` | Min Temperature (°C) | number | — | may be negative (e.g. −25) |
| `temp_range_max` | Max Temperature (°C) | number | — | |
| `description` | Description | textarea | — | |
| `requires_monitoring` | Requires Monitoring | select | — | No · Yes |
| `alert_threshold` | Alert Threshold (°C) | number | — | |
| `suitable_products` | Suitable Products | text | — | |
| `status` | Status | select | ✅ | Active · Inactive |

---

## 4. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | **`class_code` and `class_name` are each independently unique** (`uEach`), case-insensitive, per tenant |
| 2 | No parent reference — consumed by the Rack master's Temperature Class dropdown |
| 3 | `client_id` / `branch_id` stamped from the logged-in user |
| 4 | Edit/delete follow the tier ladder; creators manage own rows; employees peer-isolated |
| 5 | Every write bumps the form-bundle cache so the Rack master's Temp Class dropdown refreshes |

---

## 5. SCREEN

`/masters/temp_class_master`: search, **Add Temperature Class**, table of Code · Temperature Class · Min Temp · Max Temp · Monitoring · Status. The modal captures code → name → range → monitoring/alert → suitable products.

---

## 6. KNOWN LIMITATIONS

| Area | Limitation |
|---|---|
| Range order | No server rule enforces `temp_range_min ≤ temp_range_max`; inverted ranges are accepted |
| Delete | No in-use guard against racks referencing the class; delete is permanent (no `SoftDeletes`) |
| Search | `ILIKE` across text/select fields only (not the numeric temp columns) |

---

*Related documents: TEMP_CLASS_MASTER_TECHNICAL_DOCUMENTATION.md · TEMP_CLASS_MASTER_API_DOCUMENTATION.md · TEMP_CLASS_MASTER_CODE_WALKTHROUGH.md*
