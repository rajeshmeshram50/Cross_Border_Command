# CUSTOMER CONSIGNEE TYPE MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Customer Consignee Type

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

## 1. Model & Table

| Item | Value |
|---|---|
| Slug | `customer_types` |
| Model | `App\Models\Masters\CustomerTypes` |
| Table | `master_customer_types` (PostgreSQL) |
| Engine | `MasterController` (schema-driven) |
| Soft deletes | Yes (`deleted_at`) |
| Fillable | client_id, branch_id, name, gst_applicable, status, created_by |
| Relations | client, branch, creator (`created_by`) |

## 2. Schema Spec (`SCHEMAS['customer_types']`)

| n (column) | t | r | opts |
|---|---|---|---|
| name | text | true | — |
| gst_applicable | select | false | `Yes`, `No` |
| status | select | true | `Active`, `Inactive` |

`uEach => ['name']`

## 3. Uniqueness Model

- `name` declared under **`uEach`** → per-field, tenant-scoped, **case-insensitive** (`LOWER(name)`), scoped by `(client_id, branch_id)`.
- Because the `master_customer_types` table carries an `is_system` column, the uniqueness pass also runs the **system-seed collision check** against global `is_system` rows.

## 4. Endpoints

All under `auth:sanctum` + `user.active`; `{slug}` = `customer_types`.

| Verb | Path | Purpose |
|---|---|---|
| GET | /master-counts | Batch active/inactive/total |
| GET | /master/customer_types | List (`?search=`, `?branch_id=`) |
| GET | /master/customer_types/{id} | Show |
| POST | /master/customer_types | Create |
| PUT | /master/customer_types/{id} | Update |
| DELETE | /master/customer_types/{id} | Soft delete |
| GET | /master/customer_types/next-code | Returns `{code:null}` (no auto-code) |

## 5. Special Handling

System-seed protection (Retailer / Wholesaler, seeded global `is_system`):
- **Update** — `update()` returns 403 when `is_system` is set (fully locked).
- **Delete** — `destroy()` has an explicit `customer_types` + `is_system` 403 guard ("referenced by customer records").
- **Create** — `validatePayload()` rejects a name matching a global system row.

## 6. Security & Scoping

- Reads scoped by `MasterVisibility::applyReadScope` (creator-hierarchy: super=all; client=globals+own; branch=+own branch; employee=+own rows).
- Writes stamp `client_id` / `branch_id` / `created_by` via `resolveOwnership`; non-super users cannot spoof `client_id`.
- Edit/delete additionally gated by `hierarchicalDenial` (row tier ≤ user tier, own-row always allowed).

## 7. Metrics

Every create/update/delete calls `MasterBundleCache::bump()` to refresh cached form dropdowns. `/master-counts` computes active/inactive with a single SQL aggregate.

*Related documents: CUSTOMER_TYPES_FUNCTIONAL_DOCUMENTATION.md, CUSTOMER_TYPES_API_DOCUMENTATION.md, CUSTOMER_TYPES_CODE_WALKTHROUGH.md*
