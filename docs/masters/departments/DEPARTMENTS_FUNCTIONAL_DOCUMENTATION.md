# DEPARTMENT MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Department Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **Department Master** (`departments`) defines the organizational departments (Sales, HR, Accounts, Software Development, …), their hierarchy, owning head and contact. Each department carries an auto-generated `DEPT-###` code. It is a schema-driven master served by `MasterController` + `MasterPage.tsx`.

**Downstream consumers:** departments are referenced by the Roles, Designations and Employee/HR modules (department assignment, reporting structure) and by department-scoped approvals. The self-referential `parent_id` builds a departmental tree.

---

## 2. ROLES & ACCESS

Permissioned module `master.departments` (`can_view / can_add / can_edit / can_delete`). Super admin bypasses.

| Role | Visibility |
|---|---|
| Super Admin | All rows, all tenants; may seed globals |
| Client Admin / Client User | Own client's rows + globals; branch-switcher narrows |
| Branch User | Globals + client-level + own branch rows |
| Employee | Globals + client-level + only own rows |

This master is **tenant-scoped** — the `DEPT-###` sequence is computed per tenant so each client/branch gets its own DEPT-001…N series.

---

## 3. FIELDS

| Field / Label | Type | Required | Options / Ref | Rules & Notes |
|---|---|---|---|---|
| name / Department Name | text | Yes | — | Unique (case-insensitive); UI blocks digits/symbols |
| code / Department Code | text | Yes | — | Auto `DEPT-###` (pre-filled from `next-code`); unique (case-insensitive) |
| parent_id / Parent Department | select | No | ref departments (self) | Optional parent; "— None (Root Department) —" for top-level |
| head / Department Head | select | No | — | Persists the selected person's name (string) |
| email / Department Email | email | No | — | Valid email |
| status / Status | select | Yes | Active, Inactive | |

*(The model is also fillable for `description`, though it is not part of the current form schema.)*

---

## 4. BUSINESS RULES

- **Uniqueness (`uEach`):** `name` and `code` are **each** independently unique (case-insensitive), scoped to the tenant `(client_id, branch_id)`. The same department name may recur across branches of one client.
- **Auto-code (`DEPT-###`):** registered in `AUTO_CODES` (`col=code, prefix=DEPT-, pad=3`). The `next-code` endpoint returns the next code (computed over the rows the user can see), and the form pre-fills it; the value is still submitted and validated. A frontend fallback computes the same formula if `next-code` errors.
- **Tenant scoping:** `tenantScoped = true` — the DEPT sequence is isolated per tenant.
- **Self-reference:** `parent_id` points to another department; the dropdown resolves parent names.
- **No uploads, no sublist, no system-seed.** Empty strings → NULL.

---

## 5. SCREEN

Lives under Masters → **Department Master** (`/masters/departments`). Add/Edit modal auto-fills the Code from `/master/departments/next-code`; Parent Department and Head are dropdowns. List columns: Code, Department Name, Parent Dept, Head, Status. A KPI strip shows totals, head-assigned/no-head, missing-config (no email), and inactive counts.

---

## 6. KNOWN LIMITATIONS

- `head` stores a plain name string (from a static option list in the UI), not a foreign key to an employee — renaming/removing an employee does not cascade.
- No cycle-prevention on `parent_id` (a department could in theory be set as its own ancestor via the API).
- Delete has no in-use guard against roles/designations/employees that reference the department.

---
*Related documents: DEPARTMENTS_TECHNICAL_DOCUMENTATION.md, DEPARTMENTS_API_DOCUMENTATION.md, DEPARTMENTS_CODE_WALKTHROUGH.md*
