# CUSTOMER CLASSIFICATIONS MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Customer Classifications

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

## 1. Model & Table

| Item | Value |
|---|---|
| Slug | `customer_classifications` |
| Model | `App\Models\Masters\CustomerClassifications` |
| Table | `master_customer_classifications` (PostgreSQL) |
| Engine | `MasterController` (schema-driven) |
| Soft deletes | Yes |
| Fillable | client_id, branch_id, name, credit_limit, payment_terms, status, created_by |
| Relations | client, branch, creator (`created_by`) |

## 2. Schema Spec (`SCHEMAS['customer_classifications']`)

| n (column) | t | r | opts |
|---|---|---|---|
| name | text | true | — |
| credit_limit | number | false | — |
| payment_terms | number | false | — |
| status | select | true | `Active`, `Inactive` |

`uEach => ['name']`

## 3. Uniqueness Model

- `name` under **`uEach`** → tenant-scoped, **case-insensitive** (`LOWER(name)`), scoped by `(client_id, branch_id)`.
- Table has an `is_system` column, so the uniqueness pass also runs the **system-seed collision check** against global `is_system` rows.
- `credit_limit` / `payment_terms` are numeric, validated `numeric` (with frontend min/max hints); not part of uniqueness.

## 4. Endpoints

`{slug}` = `customer_classifications`; all under `auth:sanctum` + `user.active`.

| Verb | Path | Purpose |
|---|---|---|
| GET | /master-counts | Batch counts |
| GET | /master/customer_classifications | List (`?search=`, `?branch_id=`) |
| GET | /master/customer_classifications/{id} | Show |
| POST | /master/customer_classifications | Create |
| PUT | /master/customer_classifications/{id} | Update |
| DELETE | /master/customer_classifications/{id} | Soft delete |
| GET | /master/customer_classifications/next-code | `{code:null}` |

## 5. Special Handling

System-seed protection (Standard / VIP, global `is_system`):
- **Update** — 403 in `update()` when `is_system` set (fully locked).
- **Delete** — explicit `customer_classifications` + `is_system` 403 guard in `destroy()`.
- **Create** — name collision against global system rows rejected (422).

## 6. Security & Scoping

- Read scope via `MasterVisibility::applyReadScope` (super/client/branch/employee tiers).
- Ownership stamped by `resolveOwnership`; body `client_id` untrusted for non-super.
- Edit/delete gated by `hierarchicalDenial` (own row OK; else row tier ≤ user tier).

## 7. Metrics

`/master-counts` single-aggregate active/inactive; every write bumps `MasterBundleCache`.

*Related documents: CUSTOMER_CLASSIFICATIONS_FUNCTIONAL_DOCUMENTATION.md, CUSTOMER_CLASSIFICATIONS_API_DOCUMENTATION.md, CUSTOMER_CLASSIFICATIONS_CODE_WALKTHROUGH.md*
