# CUSTOMER CONSIGNEE TYPE MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Customer Consignee Type

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

## 1. Overview

Customer Consignee Type is a buyer-classification lookup that labels each customer / consignee (e.g. **Retailer**, **Wholesaler**) and records whether GST applies to that class. It is served by the schema-driven Masters engine (`MasterController` + `MasterPage.tsx`) under slug `customer_types`.

**Consumers:** customer and consignee records reference a Customer Consignee Type via their `customer_type` field; the `gst_applicable` flag on the chosen type feeds downstream pricing and invoice GST handling.

## 2. Roles & Access

| Role | Visibility | Create / Edit / Delete |
|---|---|---|
| super_admin | All tenants' rows | Full (bypasses permission checks) |
| client_admin / client_user | Global (system) rows + own client's rows | Own client rows |
| branch_user | Globals + client-level + own branch | Own branch rows |
| employee | Globals + client-level + own rows | Only rows they created |

Menu/API access is gated by permission module `master.customer_types` (view / add / edit / delete).

## 3. Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| name | text | Yes | Unique per tenant (case-insensitive). UI label "Customer Consignee Type" |
| gst_applicable | select | No | `Yes` / `No` — drives invoice GST handling |
| status | select | Yes | `Active` / `Inactive` |

System columns stamped automatically: `client_id`, `branch_id`, `created_by`, `is_system`.

## 4. Business Rules

- **Name uniqueness** — `name` must be unique within the tenant scope (client + branch), compared case-insensitively, so "Retailer" and "retailer" cannot coexist.
- **System-seeded rows** — **Retailer** and **Wholesaler** ship as global `is_system` rows (client_id / branch_id NULL). They are:
  - **Not editable** — any update returns 403 (system-managed).
  - **Not deletable** — delete returns 403 (referenced by customer records via `customer_type`).
  - **Not re-creatable by name** — attempting to create a row named "Retailer" / "Wholesaler" under any tenant is rejected as a system-managed collision.
- **Tenant isolation** — the same custom name may recur across different branches of a client; body `client_id` is never trusted (derived from the authenticated user).

## 5. Screen

Reached from **Masters → Party & Classification → Customer Consignee Type**. Standard master grid with KPI tiles (Total Types, Active, GST Yes, System Fixed), search box, and an add/edit modal. Rows flagged `is_system` show as pinned/locked.

## 6. Known Limitations

- No cascade or usage warning on delete of a custom (non-system) type even if customers reference it — only the two seeded rows are protected.
- `gst_applicable` is a plain flag; there is no per-type GST rate — the actual rate comes from other masters.
- No bulk import; rows are added one at a time.

*Related documents: CUSTOMER_TYPES_TECHNICAL_DOCUMENTATION.md, CUSTOMER_TYPES_API_DOCUMENTATION.md, CUSTOMER_TYPES_CODE_WALKTHROUGH.md*
