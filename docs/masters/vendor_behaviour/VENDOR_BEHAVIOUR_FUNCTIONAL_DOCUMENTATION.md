# SUPPLIER BEHAVIOUR MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Supplier Behaviour

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

## 1. Overview

Supplier Behaviour holds performance tags (e.g. **Excellent**, **Good**, **Average**, **Poor**) used to rate vendors during purchase-order review. Served by the schema-driven Masters engine under slug `vendor_behaviour`.

**Consumers:** supplier records / PO workflows apply a behaviour rating during vendor evaluation.

## 2. Roles & Access

| Role | Visibility | Create / Edit / Delete |
|---|---|---|
| super_admin | All tenants | Full (bypass) |
| client_admin / client_user | Globals + own client | Own client rows |
| branch_user | Globals + client-level + own branch | Own branch rows |
| employee | Globals + client-level + own rows | Only rows they created |

Gated by permission module `master.vendor_behaviour`.

## 3. Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| name | text | Yes | Unique per tenant (case-insensitive). UI label "Behaviour Type" |
| description | textarea | No | What qualifies for this rating |
| status | select | Yes | `Active` / `Inactive` |

System columns: `client_id`, `branch_id`, `created_by`.

## 4. Business Rules

- **Name uniqueness** — `name` unique within tenant scope (client + branch), case-insensitive.
- **No system-seeded rows** — no `is_system` protection; all rows are ordinary tenant data.
- **Tenant isolation** — the same name may recur across branches; body `client_id` never trusted.

## 5. Screen

**Masters → Party & Classification → Supplier Behaviour.** Standard master grid (behaviour type / description / status), search box, add/edit modal.

## 6. Known Limitations

- No reference check on delete.
- Rating is a label only; no scoring/threshold logic held by this master.
- No bulk import.

*Related documents: VENDOR_BEHAVIOUR_TECHNICAL_DOCUMENTATION.md, VENDOR_BEHAVIOUR_API_DOCUMENTATION.md, VENDOR_BEHAVIOUR_CODE_WALKTHROUGH.md*
