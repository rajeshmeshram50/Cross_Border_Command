# CUSTOMER CLASSIFICATIONS MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Customer Classifications

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

## 1. Overview

Customer Classifications define buyer tiers (e.g. **Standard**, **VIP**, "Tier A / Key Account") that carry a credit limit and payment-terms window. Served by the schema-driven Masters engine under slug `customer_classifications`.

**Consumers:** customer records reference a classification; the tier's `credit_limit` and `payment_terms` feed the customer's credit profile (max credit extended, days allowed).

## 2. Roles & Access

| Role | Visibility | Create / Edit / Delete |
|---|---|---|
| super_admin | All tenants | Full (bypass) |
| client_admin / client_user | Globals + own client | Own client rows |
| branch_user | Globals + client-level + own branch | Own branch rows |
| employee | Globals + client-level + own rows | Only rows they created |

Gated by permission module `master.customer_classifications`.

## 3. Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| name | text | Yes | Unique per tenant (case-insensitive) |
| credit_limit | number | No | Max credit (₹) extended to this tier |
| payment_terms | number | No | Credit window in days |
| status | select | Yes | `Active` / `Inactive` |

System columns: `client_id`, `branch_id`, `created_by`, `is_system`.

## 4. Business Rules

- **Name uniqueness** — case-insensitive, tenant-scoped (client + branch).
- **System-seeded rows** — **Standard** and **VIP** ship as global `is_system` rows:
  - **Not editable** — update returns 403.
  - **Not deletable** — delete returns 403 (customer records reference these tiers for credit + payment terms).
  - **Not re-creatable by name** — creating "Standard"/"VIP" under any tenant is rejected as a system-managed collision.
- **Tenant isolation** — custom names may recur across branches; body `client_id` never trusted.

## 5. Screen

**Masters → Party & Classification → Customer Classifications.** Grid with KPI tiles (Total Tiers, Active, Avg Credit ₹, System Fixed), search, add/edit modal. `is_system` rows locked.

## 6. Known Limitations

- `credit_limit` / `payment_terms` are static reference values — no automated enforcement of the limit at order time is guaranteed by this master alone.
- No usage warning when deleting a custom tier that customers reference (only Standard/VIP are protected).
- No bulk import.

*Related documents: CUSTOMER_CLASSIFICATIONS_TECHNICAL_DOCUMENTATION.md, CUSTOMER_CLASSIFICATIONS_API_DOCUMENTATION.md, CUSTOMER_CLASSIFICATIONS_CODE_WALKTHROUGH.md*
