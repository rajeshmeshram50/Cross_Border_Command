# SUPPLIER TYPES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Supplier Types

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

## 1. Overview

Supplier Types classify vendors/suppliers for procurement (e.g. **Farmer**, **Trader**, **Manufacturer**, **Supplier**). Served by the schema-driven Masters engine under slug `vendor_types`.

**Consumers:** supplier / vendor records reference a Supplier Type; the type is shown on purchase orders and procurement reports.

## 2. Roles & Access

| Role | Visibility | Create / Edit / Delete |
|---|---|---|
| super_admin | All tenants | Full (bypass) |
| client_admin / client_user | Globals + own client | Own client rows |
| branch_user | Globals + client-level + own branch | Own branch rows |
| employee | Globals + client-level + own rows | Only rows they created |

Gated by permission module `master.vendor_types`.

## 3. Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| name | text | Yes | Unique per tenant (case-insensitive). UI label "Supplier Type" |
| description | textarea | No | Free-text description |
| status | select | Yes | `Active` / `Inactive` |

System columns: `client_id`, `branch_id`, `created_by`.

## 4. Business Rules

- **Name uniqueness** — `name` must be unique within the tenant scope (client + branch), case-insensitive.
- **No system-seeded rows** — this master has no `is_system` protection; all rows are ordinary tenant data (create/edit/delete all allowed subject to the hierarchy).
- **Tenant isolation** — the same name may recur across branches; body `client_id` never trusted.

## 5. Screen

**Masters → Party & Classification → Supplier Types.** Standard master grid (name / description / status), search box, add/edit modal.

## 6. Known Limitations

- No usage/reference check on delete — removing a type that suppliers reference is not blocked.
- Plain text classification only; no procurement-rule fields attached to the type itself.
- No bulk import.

*Related documents: VENDOR_TYPES_TECHNICAL_DOCUMENTATION.md, VENDOR_TYPES_API_DOCUMENTATION.md, VENDOR_TYPES_CODE_WALKTHROUGH.md*
