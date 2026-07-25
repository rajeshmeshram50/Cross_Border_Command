# TRIGGER POINT MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Trigger Point Master

## DOCUMENT CONTROL

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. Overview

The **Trigger Point Master** defines lifecycle *trigger modules* (e.g. Onboarding, Offboarding, Event Based) that document-generation rules can be wired into. Each row names a module and, optionally, describes when the trigger activates and which documents it generates. It is one of the schema-driven masters served by the generic `MasterController` and rendered by `MasterPage.tsx`, so it inherits the full engine behaviour (search, tenant scoping, permissions, soft delete).

- **Category:** Document & Evidence
- **Slug:** `trigger_point`
- **Table:** `master_trigger_points`
- **Tenant-scoped:** Yes — rows belong to a specific `(client, branch)`.

---

## 2. Roles & Access

Access is governed by the `master.trigger_point` permission module (`can_view` / `can_add` / `can_edit` / `can_delete`). `super_admin` bypasses permission checks.

| Role | Visibility (read) | Create / Edit / Delete |
|---|---|---|
| super_admin | All rows, all tenants | Any row |
| client_admin / client_user | Global rows (`client_id` NULL) + own client (branch switcher narrows) | Own-tier rows |
| branch_user | Globals + client-level + own branch | Own branch / own rows |
| employee | Globals + client-level + own rows only | Own rows only |

Edit/delete beyond your own rows follows the hierarchical tier gate: a row's tier (super > client > branch) must be **≤** your tier, else `403`.

---

## 3. Fields

| Field | Label | Type | Required | Notes |
|---|---|---|---|---|
| `module_name` | Module Name | text | Yes | Unique per tenant (case-insensitive). e.g. Onboarding, Offboarding, Event Based |
| `description` | Description | textarea | No | When the trigger activates / what docs it generates |
| `status` | Status | select | Yes | `Active` or `Inactive` |

System-managed columns (not user-entered): `id`, `client_id`, `branch_id`, `created_by`, `created_at`, `updated_at`, `deleted_at`. Read responses also flatten `client_name`, `branch_name`, `creator_name`, `creator_user_type`.

---

## 4. Business Rules

1. **Unique module name (`uFields`)** — `module_name` must be unique within the tenant scope, compared case-insensitively (`LOWER()`). Adding "onboarding" when "Onboarding" exists is rejected with a `422`.
2. **Tenant-scoped rows** — every write stamps `client_id` / `branch_id` / `created_by` from the authenticated user; a `client_id` in the request body is never trusted for non-super users.
3. **Status gate** — `status` must be exactly `Active` or `Inactive`.
4. **Empty optional fields** stored as `NULL` (blank `description` → NULL).
5. **Soft delete** — deletes set `deleted_at`; rows are excluded from lists but retained in the table.

---

## 5. Screen

- **Route:** `/masters/trigger_point`
- **List:** grid of Module Name · Description · Status (columns `module_name`, `description`, `status`), newest first.
- **KPI cards:** Total Triggers, Active, Inactive.
- **Add / Edit modal:** Module Name (full width), Description (full width), Status select.
- **"What to do" guidance:** Name the Trigger → Add a Description → Activate (active triggers can be wired into doc-generation rules).
- **Search:** free-text box performs `ILIKE` matching on text fields.

---

## 6. Known Limitations

- Triggers are a **catalogue only** — creating an Active trigger does not by itself generate any document; wiring into generation rules is a separate concern.
- No dedicated `next-code`: the endpoint exists but returns `{code:null}` (this master has no code field).
- No relationship to specific document templates is modelled on this table.
- Branch switcher narrows client-admin views; branch users are locked to their own branch and cannot widen scope.

---

*Related documents: TRIGGER_POINT_TECHNICAL_DOCUMENTATION.md, TRIGGER_POINT_API_DOCUMENTATION.md, TRIGGER_POINT_CODE_WALKTHROUGH.md*
