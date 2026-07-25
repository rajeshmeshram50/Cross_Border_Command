# RACK TYPE MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Rack Type Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

---

## 1. MODEL & TABLE

| Item | Value |
|---|---|
| Slug | `rack_type_master` |
| Model | `App\Models\Masters\RackTypeMaster` |
| Table | `master_rack_type_master` |
| Ownership cols | `client_id`, `branch_id`, `created_by` |
| Relations | `client()`, `branch()`, `creator()` |
| Soft deletes | **No** — hard delete |

## 2. SCHEMA SPEC

| Field | `t` | `r` | Notes |
|---|---|---|---|
| `type_code` | text | ✅ | — |
| `type_name` | text | ✅ | — |
| `description` | textarea | — | uncapped |
| `suitable_for` | select | — | 7 opts (General Inventory…All Types) |
| `max_load_per_shelf` | number | — | numeric |
| `typical_shelves` | number | — | numeric |
| `status` | select | ✅ | Active · Inactive |

No reference fields — this master is a **source** catalogue for the Rack master (`racks.rackType → rack_type_master`).

## 3. UNIQUENESS MODEL

`uEach: ['type_code', 'type_name']` — each independently unique, tenant-scoped, case-insensitive (both text → `LOWER()`).

## 4. ENDPOINTS

| Verb | Path | Permission |
|---|---|---|
| GET | `/api/master/rack_type_master` | `can_view` |
| GET | `/api/master/rack_type_master/{id}` | `can_view` |
| POST | `/api/master/rack_type_master` | `can_add` |
| PUT | `/api/master/rack_type_master/{id}` | `can_edit` |
| DELETE | `/api/master/rack_type_master/{id}` | `can_delete` |
| GET | `/api/master/rack_type_master/next-code` | `{code:null}` |

## 5. SPECIAL HANDLING

Standard schema-driven master — no cascade, no uploads, no sublists, no auto-code, no system-seed lock. It is referenced **by** the Rack master rather than referencing another master.

## 6. SECURITY & SCOPING

`applyReadScope` (tenant tier + switcher) · `resolveOwnership` (stamps client/branch; body untrusted) · `hierarchicalDenial` (own row / tier ladder).

## 7. METRICS

`/master-counts` aggregates `status` into Active vs Inactive.

---

*Related documents: RACK_TYPE_MASTER_FUNCTIONAL_DOCUMENTATION.md · RACK_TYPE_MASTER_API_DOCUMENTATION.md · RACK_TYPE_MASTER_CODE_WALKTHROUGH.md*
