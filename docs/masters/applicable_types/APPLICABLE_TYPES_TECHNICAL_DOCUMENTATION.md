# APPLICABLE PARTIES MASTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Applicable Parties

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial technical documentation |

## 1. Model & Table

| Item | Value |
|---|---|
| Slug | `applicable_types` |
| Model | `App\Models\Masters\ApplicableTypes` |
| Table | `master_applicable_types` (PostgreSQL) |
| Engine | `MasterController` (schema-driven) |
| Soft deletes | Yes |
| Fillable | client_id, branch_id, name, party_type, status, created_by |
| Relations | client, branch, creator (`created_by`) |

## 2. Schema Spec (`SCHEMAS['applicable_types']`)

| n (column) | t | r | opts |
|---|---|---|---|
| name | text | true | — |
| party_type | select | false | `Customer`, `Vendor`, `Third Party`, `Carrier`, `Other` |
| status | select | true | `Active`, `Inactive` |

`uFields => ['name']`

> The server `Rule::in` for `party_type` is the authoritative enum (`Vendor`, not `Supplier`). The frontend config lists `Supplier` as a label; posting `Supplier` fails validation.

## 3. Uniqueness Model

- `name` under **`uFields`** (single text field) → promoted to **case-insensitive** (`LOWER(name)`) uniqueness, scoped by `(client_id, branch_id)`.
- `party_type` is enum-validated but not part of uniqueness.
- No `is_system` column → no system-seed collision check.

## 4. Endpoints

`{slug}` = `applicable_types`; all under `auth:sanctum` + `user.active`.

| Verb | Path | Purpose |
|---|---|---|
| GET | /master-counts | Batch counts |
| GET | /master/applicable_types | List (`?search=`, `?branch_id=`) |
| GET | /master/applicable_types/{id} | Show |
| POST | /master/applicable_types | Create |
| PUT | /master/applicable_types/{id} | Update |
| DELETE | /master/applicable_types/{id} | Soft delete |
| GET | /master/applicable_types/next-code | `{code:null}` |

## 5. Special Handling

Standard schema-driven master — no system-seed lock, no auto-code, no sublists or file uploads. The only nuance is the `party_type` enum divergence between UI label (`Supplier`) and API value (`Vendor`).

## 6. Security & Scoping

- Read scope via `MasterVisibility::applyReadScope`.
- Ownership stamped by `resolveOwnership`; body `client_id` untrusted for non-super.
- Edit/delete gated by `hierarchicalDenial`.

## 7. Metrics

`/master-counts` single-aggregate active/inactive; every write bumps `MasterBundleCache`.

*Related documents: APPLICABLE_TYPES_FUNCTIONAL_DOCUMENTATION.md, APPLICABLE_TYPES_API_DOCUMENTATION.md, APPLICABLE_TYPES_CODE_WALKTHROUGH.md*
