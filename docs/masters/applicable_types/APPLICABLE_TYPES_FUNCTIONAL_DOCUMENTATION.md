# APPLICABLE PARTIES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Applicable Parties

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

## 1. Overview

Applicable Parties defines the party roles that appear on trade documents — e.g. **Customer**, **Consignee**, **Notify Party**, **Supplier** — and tags each with a broad party type. Served by the schema-driven Masters engine under slug `applicable_types`.

**Consumers:** export invoices and trade documents reference these party roles when listing who appears on the document.

## 2. Roles & Access

| Role | Visibility | Create / Edit / Delete |
|---|---|---|
| super_admin | All tenants | Full (bypass) |
| client_admin / client_user | Globals + own client | Own client rows |
| branch_user | Globals + client-level + own branch | Own branch rows |
| employee | Globals + client-level + own rows | Only rows they created |

Gated by permission module `master.applicable_types`.

## 3. Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| name | text | Yes | Unique per tenant (case-insensitive). UI label "Party Name" |
| party_type | select | No | Enum — see below |
| status | select | Yes | `Active` / `Inactive` |

**`party_type` enum (server-enforced):** `Customer`, `Vendor`, `Third Party`, `Carrier`, `Other`.

> Note: the current UI form offers `Supplier` in place of `Vendor` as a label; the API validates against the server enum above (`Vendor`), so posting `Supplier` would fail server-side validation. Post one of the server values.

System columns: `client_id`, `branch_id`, `created_by`.

## 4. Business Rules

- **Name uniqueness** — `name` unique within tenant scope (client + branch), case-insensitive.
- **No system-seeded rows** — no `is_system` protection; all rows are ordinary tenant data.
- **Tenant isolation** — the same name may recur across branches; body `client_id` never trusted.

## 5. Screen

**Masters → Party & Classification → Applicable Parties.** Standard master grid (party name / party type / status), search box, add/edit modal.

## 6. Known Limitations

- `party_type` UI/label uses "Supplier" while the API enum uses "Vendor" — a mismatch to be aware of when scripting the API directly.
- No reference check on delete.
- No bulk import.

*Related documents: APPLICABLE_TYPES_TECHNICAL_DOCUMENTATION.md, APPLICABLE_TYPES_API_DOCUMENTATION.md, APPLICABLE_TYPES_CODE_WALKTHROUGH.md*
