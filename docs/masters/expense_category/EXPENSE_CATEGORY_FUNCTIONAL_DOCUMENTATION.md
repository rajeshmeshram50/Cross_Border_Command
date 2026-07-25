# EXPENSE CATEGORIES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Expense Categories

| Version | Date | Author | Notes |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. Overview

**Expense Categories** classify reimbursable spend (Travel, Meals, Internet…) used by HR **Expense Claims** and **Advance Requests**. Each row carries an auto-sequenced **code** (`EXC-01`, `EXC-02`…), a name, optional monthly/yearly limits, and a policy description.

**Consumers**
- **HR Expense Management** — expense claim / advance request forms pick a category here.
- Spend policy / limit reporting reads `monthly_limit` / `yearly_limit`.

Part of the **Operations & Support** category; runs on the schema-driven Masters engine. It is marked `tenantScoped` so each tenant maintains its own `EXC-` sequence and name space.

---

## 2. Roles & Access

| Role | View | Add | Edit | Delete |
|---|---|---|---|---|
| Super admin | All tenants | Yes (bypass) | Yes | Yes |
| Client admin / user | Global + own client | Yes | Own-tier | Own-tier |
| Branch user / employee | Global + client-level + own rows | Yes | Own rows | Own rows |

Gated by `master.expense_category` permission flags + hierarchical edit/delete rule.

---

## 3. Fields

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `code` | Category Code | text | Yes | Auto `EXC-##` (previewed from `next-code`) |
| `name` | Expense Name | text | Yes | e.g. Travel, Meals, Internet |
| `monthly_limit` | Monthly Limit | number | No | ₹ cap per month (decimal:2) |
| `yearly_limit` | Yearly Limit | number | No | ₹ cap per year (decimal:2) |
| `description` | Description | textarea | No | Policy notes / exclusions |
| `status` | Status | select | Yes | Active / Inactive |

---

## 4. Business Rules

1. **Auto code `EXC-##`** — on form open the frontend calls `next-code`, which computes the next sequence number over the tenant's visible rows (`EXC-01`, `EXC-02`, zero-padded to 2). The code field is still editable/required and validated for uniqueness.
2. **Uniqueness (per tenant, case-insensitive)** — **both** `code` and `name` must each be independently unique within the tenant scope. Duplicate of either → 422.
3. **Tenant-scoped** — the `EXC-` series and name space are isolated per tenant (`tenantScoped`), so two tenants can each have `EXC-01`.
4. **Feeds HR** — categories appear in expense claim / advance request dropdowns; deactivating (`status = Inactive`) removes them from new claims.
5. **Soft delete** — removing a category is a soft delete.

---

## 5. Screen

Masters dashboard → **Operations & Support → Expense Categories**. Standard list (Code, Expense Name, Status) with search, an Add/Edit modal that auto-fills the code via the API, and Edit/Delete actions.

---

## 6. Known Limitations

- `monthly_limit` / `yearly_limit` are stored but limit enforcement lives in the HR expense flow, not this master.
- The auto-code is a preview only — if two users open the form simultaneously they may both be offered the same `EXC-##`; the uniqueness check rejects the second save (must retry).

---

*Related documents: EXPENSE_CATEGORY_TECHNICAL_DOCUMENTATION.md, EXPENSE_CATEGORY_API_DOCUMENTATION.md, EXPENSE_CATEGORY_CODE_WALKTHROUGH.md*
