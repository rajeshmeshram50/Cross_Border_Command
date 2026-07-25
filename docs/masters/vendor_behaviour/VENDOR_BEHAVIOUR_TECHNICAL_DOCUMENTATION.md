# SUPPLIER BEHAVIOUR MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Supplier Behaviour

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

## 1. Model & Table

| Item | Value |
|---|---|
| Slug | `vendor_behaviour` |
| Model | `App\Models\Masters\VendorBehaviour` |
| Table | `master_vendor_behaviour` (PostgreSQL) |
| Engine | `MasterController` (schema-driven) |
| Soft deletes | Yes |
| Fillable | client_id, branch_id, name, description, status, created_by |
| Relations | client, branch, creator (`created_by`) |

## 2. Schema Spec (`SCHEMAS['vendor_behaviour']`)

| n (column) | t | r | opts |
|---|---|---|---|
| name | text | true | — |
| description | textarea | false | — |
| status | select | true | `Active`, `Inactive` |

`uFields => ['name']`

## 3. Uniqueness Model

- `name` under **`uFields`** (single text field) → promoted to **case-insensitive** (`LOWER(name)`) uniqueness, scoped by `(client_id, branch_id)`.
- No `is_system` column → no system-seed collision check.

## 4. Endpoints

`{slug}` = `vendor_behaviour`; all under `auth:sanctum` + `user.active`.

| Verb | Path | Purpose |
|---|---|---|
| GET | /master-counts | Batch counts |
| GET | /master/vendor_behaviour | List (`?search=`, `?branch_id=`) |
| GET | /master/vendor_behaviour/{id} | Show |
| POST | /master/vendor_behaviour | Create |
| PUT | /master/vendor_behaviour/{id} | Update |
| DELETE | /master/vendor_behaviour/{id} | Soft delete |
| GET | /master/vendor_behaviour/next-code | `{code:null}` |

## 5. Special Handling

Standard schema-driven master — no system-seed lock, no auto-code, no sublists or file uploads.

## 6. Security & Scoping

- Read scope via `MasterVisibility::applyReadScope`.
- Ownership stamped by `resolveOwnership`; body `client_id` untrusted for non-super.
- Edit/delete gated by `hierarchicalDenial`.

## 7. Metrics

`/master-counts` single-aggregate active/inactive; every write bumps `MasterBundleCache`.

*Related documents: VENDOR_BEHAVIOUR_FUNCTIONAL_DOCUMENTATION.md, VENDOR_BEHAVIOUR_API_DOCUMENTATION.md, VENDOR_BEHAVIOUR_CODE_WALKTHROUGH.md*
