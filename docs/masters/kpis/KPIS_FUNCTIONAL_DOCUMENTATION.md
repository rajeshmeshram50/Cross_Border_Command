# KPI MASTER — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters → KPI Master

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. OVERVIEW

The **KPI Master** (`kpis`) defines the performance indicators tracked against roles — a KPI name, its target type (Numeric / Percentage / Currency / Boolean / Date-based / Rating), a priority, and the **Role** it is assigned to. It is a schema-driven master served by `MasterController` + `MasterPage.tsx`.

**Downstream consumers:** KPIs are assigned to roles from the Roles master and feed performance-tracking / appraisal views. Each KPI's `role_id` binds it to a role so a role's holders inherit their measurable targets.

---

## 2. ROLES & ACCESS

Permissioned module `master.kpis` (`can_view / can_add / can_edit / can_delete`). Super admin bypasses.

| Role | Visibility |
|---|---|
| Super Admin | All rows, all tenants; may seed globals |
| Client Admin / Client User | Own client's rows + globals; branch-switcher narrows |
| Branch User | Globals + client-level + own branch rows |
| Employee | Globals + client-level + only own rows |

---

## 3. FIELDS

| Field / Label | Type | Required | Options / Ref | Rules & Notes |
|---|---|---|---|---|
| name / KPI Name | text | Yes | — | Unique (case-insensitive) |
| description / Description | textarea | No | — | Free text (uncapped) |
| role_id / Role | select | Yes | ref roles | Assigns the KPI to a role |
| target_type / Target Type | select | Yes | Numeric, Percentage, Currency, Boolean, Date-based, Rating | |
| priority / Priority | select | Yes | Critical, High, Medium, Low | |
| status / Status | select | Yes | Active, Inactive | |

*(The model is also fillable for `code`, though it is not part of the current form schema and has no auto-generation.)*

---

## 4. BUSINESS RULES

- **Uniqueness (`uFields` = [name]):** single text field → **case-insensitive** unique check within the tenant scope, so "Revenue Growth" and "revenue growth" collide.
- **No auto-code, no uploads, no sublist, no system-seed, no cascade filter.**
- **Empty strings → NULL.**

---

## 5. SCREEN

Lives under Masters → **KPI Master** (`/masters/kpis`). Add/Edit modal: KPI Name, Role (from Role Master), Target Type, Priority, Status and a description textarea. List columns: KPI Name, Role, Target Type, Priority, Status.

---

## 6. KNOWN LIMITATIONS

- `role_id` is validated only as an integer FK — no check that the referenced role belongs to the same tenant scope.
- No target value/threshold fields on the master itself (only the target *type*); actual numeric targets live downstream.
- Delete has no in-use guard against appraisal records referencing the KPI.

---
*Related documents: KPIS_TECHNICAL_DOCUMENTATION.md, KPIS_API_DOCUMENTATION.md, KPIS_CODE_WALKTHROUGH.md*
