# RACK & LOCATION MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Rack & Location Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `racks` |
| Model | `App\Models\Masters\Racks` |
| Table | `master_racks` |
| Ownership cols | `client_id`, `branch_id`, `created_by` |
| Relations | `client()`, `branch()`, `creator()` |
| Soft deletes | **No** — hard delete |

## 2. SCHEMA SPEC

| Field | `t` | `r` | Ref / Cascade |
|---|---|---|---|
| `whType` | select | ✅ | Own · Third Party Warehouse |
| `warehouse` | select | ✅ | **ref → `warehouse_master`** (`wh_name`) |
| `zone` | select | ✅ | **ref → `zone_master`** (`zone_name`) |
| `rackName` | text | ✅ | — |
| `rackType` | select | ✅ | **ref → `rack_type_master`** (`type_name`) |
| `rackStatus` | select | ✅ | 6 opts (Partially Filled…Empty) |
| `tempClass` | select | — | **ref → `temp_class_master`** (`class_name`) |
| `shelves` | number | — | — |
| `maxWeight` | number | — | — |
| `maxVolume` | number | — | — |

**No `status` column** — operational state lives in `rackStatus`.

## 3. UNIQUENESS MODEL

`uFields: ['rackName']` — a single text field, so promoted to **case-insensitive** single-field uniqueness (`LOWER()`), tenant-scoped. Rack names are unique **across the tenant**, not per-zone.

## 4. ENDPOINTS

| Verb | Path | Permission |
|---|---|---|
| GET | `/api/master/racks` | `can_view` |
| GET | `/api/master/racks/{id}` | `can_view` |
| POST | `/api/master/racks` | `can_add` |
| PUT | `/api/master/racks/{id}` | `can_edit` |
| DELETE | `/api/master/racks/{id}` | `can_delete` |
| GET | `/api/master/racks/next-code` | `{code:null}` |

## 5. SPECIAL HANDLING — REFERENCE CASCADES

Four reference fields resolve into other warehouse masters:

| Field | → Master | Label |
|---|---|---|
| `warehouse` | `warehouse_master` | `wh_name` |
| `zone` | `zone_master` | `zone_name` |
| `rackType` | `rack_type_master` | `type_name` |
| `tempClass` | `temp_class_master` | `class_name` |

On the frontend these cascade (pick Warehouse → filter Zones, etc.). Each is validated only as `integer` — no existence check. This master is in turn referenced **by** the Shelf master (`shelf_master.rack_ref → racks`, label `rackName`).

**Dashboard-count quirk:** `/master-counts` aggregates a `status` column that `master_racks` lacks. The query throws, the batch loop catches it, and the racks card falls back to `{active:0, inactive:0, total:0}` regardless of real row count.

## 6. SECURITY & SCOPING

`applyReadScope` (tenant tier + switcher) · `resolveOwnership` (stamps client/branch; body untrusted) · `hierarchicalDenial` (own row / tier ladder).

## 7. METRICS

Effectively none via the dashboard (no `status` column → 0/0). Row-level occupancy is tracked by `rackStatus`, surfaced on the list/Digital Twin, not the counts endpoint.

---

*Related documents: RACKS_FUNCTIONAL_DOCUMENTATION.md · RACKS_API_DOCUMENTATION.md · RACKS_CODE_WALKTHROUGH.md*
