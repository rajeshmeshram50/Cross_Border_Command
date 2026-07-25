# SUPPLIER TYPES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Supplier Types

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

## 1. Model & Table

| Item | Value |
|---|---|
| Slug | `vendor_types` |
| Model | `App\Models\Masters\VendorTypes` |
| Table | `master_vendor_types` (PostgreSQL) |
| Engine | `MasterController` (schema-driven) |
| Soft deletes | Yes |
| Fillable | client_id, branch_id, name, description, status, created_by |
| Relations | client, branch, creator (`created_by`) |

## 2. Schema Spec (`SCHEMAS['vendor_types']`)

| n (column) | t | r | opts |
|---|---|---|---|
| name | text | true | — |
| description | textarea | false | — |
| status | select | true | `Active`, `Inactive` |

`uFields => ['name']`

## 3. Uniqueness Model

- `name` declared under **`uFields`** (single field). Being a text field, it is promoted to a **case-insensitive** (`LOWER(name)`) uniqueness check, scoped by `(client_id, branch_id)`.
- No `is_system` column → no system-seed collision check runs.

## 4. Endpoints

`{slug}` = `vendor_types`; all under `auth:sanctum` + `user.active`.

| Verb | Path | Purpose |
|---|---|---|
| GET | /master-counts | Batch counts |
| GET | /master/vendor_types | List (`?search=`, `?branch_id=`) |
| GET | /master/vendor_types/{id} | Show |
| POST | /master/vendor_types | Create |
| PUT | /master/vendor_types/{id} | Update |
| DELETE | /master/vendor_types/{id} | Soft delete |
| GET | /master/vendor_types/next-code | `{code:null}` |

## 5. Special Handling

Standard schema-driven master — no system-seed lock, no auto-code, no sublists or file uploads. Behaviour is the generic `MasterController` path.

## 6. Security & Scoping

- Read scope via `MasterVisibility::applyReadScope` (super/client/branch/employee tiers).
- Ownership stamped by `resolveOwnership`; body `client_id` untrusted for non-super.
- Edit/delete gated by `hierarchicalDenial` (own row OK; else row tier ≤ user tier).

## 7. Metrics

`/master-counts` single-aggregate active/inactive; every write bumps `MasterBundleCache`.

*Related documents: VENDOR_TYPES_FUNCTIONAL_DOCUMENTATION.md, VENDOR_TYPES_API_DOCUMENTATION.md, VENDOR_TYPES_CODE_WALKTHROUGH.md*
