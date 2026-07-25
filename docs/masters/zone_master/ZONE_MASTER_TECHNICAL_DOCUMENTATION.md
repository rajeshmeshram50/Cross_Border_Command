# ZONE MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Zone Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `zone_master` |
| Model | `App\Models\Masters\ZoneMaster` |
| Table | `master_zone_master` |
| Ownership cols | `client_id`, `branch_id`, `created_by` |
| Relations | `client()`, `branch()`, `creator()` |
| Soft deletes | **No** — `destroy()` hard-deletes |

## 2. SCHEMA SPEC

| Field | `t` | `r` | Ref / Cascade |
|---|---|---|---|
| `zone_id` | text | ✅ | — |
| `zone_name` | text | ✅ | — |
| `zone_type` | select | ✅ | 9 opts (Storage…Regulated Zone) |
| `warehouse` | select | ✅ | **ref → `warehouse_master`** (label `wh_name`) |
| `purpose` | textarea | — | — |
| `cold_chain` | select | — | No · Yes |
| `hazardous` | select | — | No · Yes |
| `status` | select | ✅ | Active · Inactive |

`warehouse` is a reference field → validated as `integer`; the frontend renders it as a cascading dropdown off Warehouse Master.

## 3. UNIQUENESS MODEL

`uEach: ['zone_id', 'zone_name']` — each independently unique, tenant-scoped, case-insensitive (both text → `LOWER()`). Zone id/name are unique **across the tenant**, not per-warehouse.

## 4. ENDPOINTS

| Verb | Path | Permission |
|---|---|---|
| GET | `/api/master/zone_master` | `can_view` |
| GET | `/api/master/zone_master/{id}` | `can_view` |
| POST | `/api/master/zone_master` | `can_add` |
| PUT | `/api/master/zone_master/{id}` | `can_edit` |
| DELETE | `/api/master/zone_master/{id}` | `can_delete` |
| GET | `/api/master/zone_master/next-code` | `{code:null}` |

## 5. SPECIAL HANDLING — REFERENCE CASCADE

The `warehouse` field references **Warehouse Master**. On the frontend the Warehouse dropdown is populated from `/master/warehouse_master`; the Rack master in turn cascades its Zone dropdown off `zone_master`. Reference ids are validated as `integer` only — **no FK existence check** in `validatePayload`, so a non-existent warehouse id passes validation.

## 6. SECURITY & SCOPING

Same engine model: `applyReadScope` (tenant tier + switcher), `resolveOwnership` (stamps client/branch), `hierarchicalDenial` (own row / tier ladder). Body `client_id` untrusted for non-super.

## 7. METRICS

`/master-counts` aggregate over `status` (Active vs Inactive). Cold-chain / hazardous flags are not aggregated by the dashboard.

---

*Related documents: ZONE_MASTER_FUNCTIONAL_DOCUMENTATION.md · ZONE_MASTER_API_DOCUMENTATION.md · ZONE_MASTER_CODE_WALKTHROUGH.md*
