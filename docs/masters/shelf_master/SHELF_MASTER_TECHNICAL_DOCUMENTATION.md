# SHELF / LEVEL MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Shelf / Level Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `shelf_master` |
| Model | `App\Models\Masters\ShelfMaster` |
| Table | `master_shelf_master` |
| Ownership cols | `client_id`, `branch_id`, `created_by` |
| Relations | `client()`, `branch()`, `creator()` |
| Soft deletes | **No** — hard delete |

## 2. SCHEMA SPEC

| Field | `t` | `r` | Ref / Cascade |
|---|---|---|---|
| `rack_ref` | select | ✅ | **ref → `racks`** (label `rackName`) |
| `shelf_name` | text | ✅ | — |
| `level_no` | number | ✅ | — |
| `shelf_type` | select | ✅ | 6 opts (Standard…Wire Deck Shelf) |
| `max_weight` | number | — | — |
| `status` | select | ✅ | 5 opts (Available…Under Maintenance) |

`rack_ref` is a reference field → validated `integer`; frontend renders it as a cascading dropdown off the Rack master.

## 3. UNIQUENESS MODEL

`uFields: ['shelf_name']` — single text field → promoted to **case-insensitive** single-field uniqueness (`LOWER()`), tenant-scoped. `level_no` is required but **not** part of the key, so uniqueness is by shelf name alone, across the whole tenant.

## 4. ENDPOINTS

| Verb | Path | Permission |
|---|---|---|
| GET | `/api/master/shelf_master` | `can_view` |
| GET | `/api/master/shelf_master/{id}` | `can_view` |
| POST | `/api/master/shelf_master` | `can_add` |
| PUT | `/api/master/shelf_master/{id}` | `can_edit` |
| DELETE | `/api/master/shelf_master/{id}` | `can_delete` |
| GET | `/api/master/shelf_master/next-code` | `{code:null}` |

## 5. SPECIAL HANDLING — REFERENCE CASCADE

`rack_ref → racks` (label `rackName`). On the frontend the Rack dropdown is filtered by the chosen warehouse. Validated `integer` only — no existence check. This master is the **leaf** of the warehouse chain; nothing references it.

## 6. SECURITY & SCOPING

`applyReadScope` (tenant tier + switcher) · `resolveOwnership` (stamps client/branch; body untrusted) · `hierarchicalDenial` (own row / tier ladder).

## 7. METRICS

`/master-counts` aggregates `status`; note this master uses warehouse-style statuses (`Available`, `Full`, …). Only `Active`-family tokens count as "active" — so `Available`/`Full`/etc. all fall into the **inactive** pill on the dashboard (none match `active/1/true/yes/enabled`).

---

*Related documents: SHELF_MASTER_FUNCTIONAL_DOCUMENTATION.md · SHELF_MASTER_API_DOCUMENTATION.md · SHELF_MASTER_CODE_WALKTHROUGH.md*
