# ORGANIZATION TYPES MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → Organization Types

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

**Organization Types** (`organization_types`) is the platform-level list of industry categories (Manufacturing, Logistics, Healthcare, …) offered in the **client registration** dropdown when a new tenant is onboarded. It is a **special master**: unlike the ~55 schema-driven masters, it is served by its own dedicated controller (`OrganizationTypeController`) at `/api/organization-types`, is **super-admin only**, and is platform-global (no `client_id`/`branch_id` scoping).

It appears in the Masters dashboard only so the batch `/master-counts` card can show its Active/Inactive tally — the CRUD itself does **not** go through `MasterController`.

**Downstream consumers:** the `name` of each type is stored on `clients.org_type` at registration and feeds the cached client form-bundle dropdown.

---

## 2. ROLES & ACCESS

- **Super Admin only.** `OrganizationTypeController::authorizeSuperAdmin` rejects any non-`super_admin` user with 403 (`Only super admin can manage organization types.`) on create/update/delete.
- The generic `master.<slug>` permission module does **not** govern this master. The `/master-counts` dashboard card still uses `master.organization_types` `can_view` to decide whether to show a count for non-super users, but they cannot manage the records.

---

## 3. FIELDS

| Field / Label | Type | Required | Options | Rules & Notes |
|---|---|---|---|---|
| name / Name | text | Yes | — | Unique across the whole table, max 100 |
| slug | text (auto) | Auto | — | Derived from `name` via `Str::slug` |
| icon / Icon | text | No | — | Remix Icon class, max 50 |
| description / Description | textarea | No | — | max 255 |
| sort_order / Sort Order | number | No | — | Integer ≥ 0; auto-set to `max+1` when blank |
| status / Status | select | Yes | active, inactive | **Lowercase** values (unlike the "Active/Inactive" used by schema masters) |

---

## 4. BUSINESS RULES

- **Uniqueness:** `name` is globally unique (`unique:organization_types,name`) — not tenant-scoped, because this is a platform master.
- **Slug:** auto-generated from `name` on create, and regenerated on update only when the name changes.
- **Sort order:** defaults to `max(sort_order) + 1` when not supplied; list is ordered by `sort_order` then `name`.
- **Delete guard:** a type referenced by any client (`clients.org_type = name`) cannot be deleted → HTTP 422 (`Cannot delete — this organization type is used by existing clients.`).
- Every write bumps the master dropdown-bundle cache.
- No file uploads, no sublist, no auto-code sequence, no system-seed flag.

---

## 5. SCREEN

Reached via Masters → **Organization Types** (`/masters/organization_types`, `endpoint: /organization-types`). Standard list + Add/Edit modal + delete confirm, but visible/usable to super admins only. `active_only=1` can filter the list to active types (used by the registration dropdown).

---

## 6. KNOWN LIMITATIONS

- Status values are lowercase (`active`/`inactive`) — inconsistent with the schema-driven masters, so shared UI helpers that expect `Active`/`Inactive` must special-case this master.
- Referential link to clients is by `name` string (`org_type`), not a foreign key — renaming a type does not cascade to existing clients.
- Not multi-tenant: all tenants share the same global type list.

---
*Related documents: ORGANIZATION_TYPES_TECHNICAL_DOCUMENTATION.md, ORGANIZATION_TYPES_API_DOCUMENTATION.md, ORGANIZATION_TYPES_CODE_WALKTHROUGH.md*
