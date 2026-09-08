# HOLIDAY MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Holiday

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |
| 2.0 | 2026-09-08 | System | `ScopesHolidayTenant` trait, opt-in pagination + year options, N+1 removal (`stripGroupCounts`, `withCount`), company-holiday resolution in payroll/attendance, import group mapping, duplicate guards, `DocumentNumber` code allocation for groups. |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is

Two tenant-scoped tables and two controllers sharing one permission slug:

- **`holiday_groups`** — named calendars (`HGRP-####`), assigned to employees via `employees.holiday_group_id`.
- **`holidays`** — dated rows (`HOL-###`) belonging to a group, **or to no group at all**.

`holiday_group_id` on a holiday is **nullable and that nullability is load-bearing**. A null group means a *company-wide* holiday covering every employee of the client, not a holiday belonging to nobody. Payroll (QA #93) and attendance (#85) were both fixed to resolve company + group holidays together; the employee-facing read endpoints still resolve only the group half (see §9).

Both controllers share tenant scoping through the `ScopesHolidayTenant` trait and the `hr.holiday` permission module. Neither has any write-side workflow — no approvals, no state machine.

### 1.2 High-level architecture

```
+-----------------------------------------------------------------------+
|                            CLIENT LAYER                                |
|  HrHoliday.tsx              admin list, filters, paging, import,       |
|                             holiday modal, Manage Groups modal         |
|  HolidayCalendarPanel.tsx   employee profile: list + month grid        |
|  HrEmployees.tsx            holiday_group_id assignment dropdown       |
|  HrLeave.tsx                marks holidays on the leave calendar       |
+-------------------------------+---------------------------------------+
                                | auth JSON (xlsx parsed client-side)
                                v
+-----------------------------------------------------------------------+
|                     APPLICATION LAYER (Laravel 12)                     |
|  HolidayController        (7 routes)                                   |
|    index (opt-in paging + years) / show / store / update / destroy     |
|    import (bulk) / my (employee self-service)                          |
|  HolidayGroupController   (5 routes, apiResource)                      |
|  ScopesHolidayTenant      resolveOwnership / applyScope / switcher     |
|  EmployeeController::holidays  (1 route) - profile calendar            |
+-------------------------------+---------------------------------------+
                                |
                                v
+-----------------------------------------------------------------------+
|                       DATA LAYER (PostgreSQL)                          |
|  holiday_groups  <---- holiday_group_id ----  holidays                 |
|         ^                                                              |
|         +---- employees.holiday_group_id                               |
|                                                                        |
|  Readers that bypass the API and hit the table directly:               |
|    PayrollService::holidayDateSet()/holidayAggregates()  paid days     |
|    AttendanceController::holidayDatesForGroups()         compliance    |
|    LeaveRequestController                                working days  |
+-----------------------------------------------------------------------+
```

### 1.3 Module structure

```
app/Http/Controllers/Api/
  HolidayController.php        (581 lines)
  HolidayGroupController.php   (209 lines)
  ScopesHolidayTenant.php      (76 lines - shared trait)
app/Models/
  Holiday.php                  (50 lines)
  HolidayGroup.php             (76 lines)
app/Support/DocumentNumber.php (group code allocation)
database/migrations/
  2026_06_09_000001_create_holidays_table.php
  2026_06_09_000002_seed_holiday_module_and_permissions.php
  2026_06_09_000003_create_holiday_groups_table.php
  2026_06_09_000004_add_holiday_group_id_to_holidays_and_employees.php
resources/js/
  pages/hrms/HrHoliday.tsx                  (974 lines)
  pages/employee/HolidayCalendarPanel.tsx   (377 lines)
```

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · **PostgreSQL** · Sanctum |
| Search | `ilike` (Postgres case-insensitive LIKE) on name / code / description |
| Import | Parsed **client-side** with `xlsx` (SheetJS); the API receives JSON rows, never a file |
| Export | Excel template generated client-side (`XLSX.writeFile`) |
| Dates | `date:Y-m-d` cast — the API never emits a time component |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) · TanStack Table |

> There is **no file upload** anywhere in this module and no PDF/DOCX generation. The only "file" is the client-generated Excel template.

---

## 3. DATABASE SCHEMA

### 3.1 `holidays` — SoftDeletes, no DB FKs

| Group | Columns |
|---|---|
| Tenancy | `client_id` (nullable, indexed), `branch_id` (nullable, indexed) |
| Grouping | `holiday_group_id` (**nullable**, indexed) — null = company-wide |
| Identity | `code` varchar(20) indexed (`HOL-###`) |
| Data | `name` varchar(191)\*, `date` date\*, `type` varchar(30) default `Public`, `is_recurring` boolean default false, `description` text |
| Audit | `created_by`, `updated_by`, timestamps, `deleted_at` |

Composite index `holidays_tenant_date_idx` on `(client_id, branch_id, date)` — the shape every reader queries by.

### 3.2 `holiday_groups` — SoftDeletes, no DB FKs

| Group | Columns |
|---|---|
| Tenancy | `client_id` (nullable, indexed), `branch_id` (nullable, indexed) |
| Identity | `code` varchar(20) indexed (`HGRP-####`) |
| Data | `name` varchar(191)\*, `description` text, `status` varchar(20) default `Active` |
| Audit | `created_by`, `updated_by`, timestamps, `deleted_at` |

Composite index `holiday_groups_tenant_idx` on `(client_id, branch_id)`.

### 3.3 `employees.holiday_group_id`

Nullable, indexed, added after `leave_plan`. This single column is the whole assignment mechanism — there is no pivot table, so an employee belongs to exactly one group or none.

### 3.4 Migration history

| Migration | What it does |
|---|---|
| `..._000001_create_holidays_table` | Base table + tenant/date composite index |
| `..._000002_seed_holiday_module_and_permissions` | Registers `hr.holiday` under `hr.time_pay` and **clones every user's `hr.leave` flags** onto a new `hr.holiday` permission row (idempotent) |
| `..._000003_create_holiday_groups_table` | Groups table |
| `..._000004_add_holiday_group_id_to_holidays_and_employees` | Adds the FK-less link column to both `holidays` and `employees` |

---

## 4. MODELS

### Holiday (`app/Models/Holiday.php`)

- `SoftDeletes`.
- Casts: `date => date:Y-m-d`, `is_recurring => boolean`.
- Relations: `group()` (belongsTo HolidayGroup on `holiday_group_id`), `client()`, `branch()`, `creator()`, `updater()`.

### HolidayGroup (`app/Models/HolidayGroup.php`)

- `SoftDeletes`.
- Relations: `holidays()` (hasMany), `employees()` (hasMany Employee on `holiday_group_id`), `client()`, `branch()`, `creator()`.
- **`$appends = ['holidays_count', 'employees_count']`** — both resolve through `resolveCount()`, which prefers a `withCount` attribute, then a loaded relation, and only then fires its own `COUNT`.

> `employees_count` is the "in use" signal that drives every lock in the module. Because `Employee` uses SoftDeletes, a soft-deleted employee does not hold a group hostage.

**The append is also a performance trap.** Serialising a group without `withCount` costs two COUNT queries. `HolidayGroupController::index` therefore always calls `withCount(['holidays','employees'])`, and `HolidayController` strips the appends off nested group rows (see §6).

---

## 5. API SURFACE

| # | Method | Endpoint | Controller |
|---|---|---|---|
| 1 | GET | `/api/holidays` | `HolidayController@index` |
| 2 | POST | `/api/holidays` | `@store` |
| 3 | GET | `/api/holidays/{id}` | `@show` |
| 4 | PUT/PATCH | `/api/holidays/{id}` | `@update` |
| 5 | DELETE | `/api/holidays/{id}` | `@destroy` |
| 6 | GET | `/api/holidays/my` | `@my` |
| 7 | POST | `/api/holidays/import` | `@import` |
| 8-12 | — | `/api/holiday-groups` (apiResource) | `HolidayGroupController` |
| 13 | GET | `/api/employees/{id}/holidays` | `EmployeeController@holidays` |

All sit behind `auth:sanctum` + `user.active`. `/holidays/my` and `/holidays/import` are declared **before** the `apiResource`, so `my` and `import` are not swallowed by `holidays/{id}`.

---

## 6. CONTROLLER ANALYSIS

### HolidayController (581 lines, 17 methods)

| Concern | Implementation |
|---|---|
| Permission | `authorizeAction($request, 'can_view'\|'can_add'\|'can_edit'\|'can_delete')`; super admin returns early; missing module row falls back to allowing `client_admin` / `branch_user` |
| Scoping | `ScopesHolidayTenant::applyScope` on every read, `resolveOwnership` on every write |
| Listing | `with(['group:id,name'])` only; **`creator` is deliberately not eager-loaded** |
| **Paging** | **Opt-in** — an envelope is returned only when `page` or `per_page` is present. Other callers (HrLeave) read a plain array |
| Page size | Clamped to `MAX_PER_PAGE = 200`; a junk or non-positive value falls back to `DEFAULT_PER_PAGE = 25` rather than to 1 |
| Year options | `yearOptions()` rides along in the paginated payload as `years[]`; **deliberately ignores the request's own filters** so picking a year never collapses the dropdown to that one year |
| N+1 | `stripGroupCounts()` clears `$appends` on each nested `group` — without it a 10-row page cost ~26 queries and the unpaginated list over 400 |
| Ordering | `date` then `id` — a stable tie-break so the SPA's running Sr. No. is deterministic |
| Code | `allocateCode()` — `lockForUpdate()` + `withTrashed()`, scans `HOL-(\d+)`, pads to 3 |

### HolidayGroupController (209 lines, 9 methods)

| Concern | Implementation |
|---|---|
| Listing | `withCount(['holidays','employees'])`, ordered by `code` so auto-ids read as a clean series |
| Uniqueness | Case-insensitive `ilike` name check within the tenant, excluding the row being edited |
| Delete guard | Refuses while `Employee::where('holiday_group_id', $id)->count() > 0` |
| Delete effect | Inside a transaction: `holidays.holiday_group_id = null` for its rows, then soft-delete the group |
| Code | `DocumentNumber::next(HolidayGroup::class, 'code', 'HGRP', …, withTrashed: true)` — **pad defaults to 4**, hence `HGRP-0001` against the holiday's `HOL-001` |

### ScopesHolidayTenant (76 lines)

| Method | Behaviour |
|---|---|
| `resolveOwnership` | super_admin → request body's `client_id`/`branch_id`; client_admin/client_user → `[client_id, null]`; branch_user/employee → `[client_id, branch_id]`; otherwise `[null, null]` |
| `applyScope` | super_admin → optional branch filter only; client tier → `client_id IS NULL OR = own` plus switcher filter; branch tier → globals + client rows whose branch is null or their own; anything else → `1 = 0` |
| `applySwitcherBranchFilter` | Applies `branch_id` only after verifying the branch belongs to the caller's client — a forged id is ignored, not honoured |

---

## 7. FRONTEND

### `HrHoliday.tsx` (974 lines)

Server-side paged list (page size persisted under `cbc.hr.holidays.perPage.v1`, auto-fitted to the viewport), four filters (search, group, type, year), TanStack Table columns *Holiday ID · Holiday Name · Description · Group · Date · Day · Type · Actions*.

`Day` is computed client-side from the date. `Group` renders `Ungrouped` when `holiday_group_id` is null. Delete is disabled with an explanatory tooltip when the row's group is in use.

Two nested modals: `HolidayModal` (create/edit, date picker floored at tomorrow) and `ManageGroupsModal` (group table + inline form). The Excel template is built in the browser with `XLSX.json_to_sheet` and downloaded as `Holiday_Import_Template.xlsx`.

### `HolidayCalendarPanel.tsx` (377 lines)

Reads `GET /employees/{id}/holidays?year=`. List and month-grid views over `byDate: Map<'YYYY-MM-DD', Holiday[]>`, with year/month navigation. Renders "No holiday calendar assigned" when the response carries no group.

---

## 8. INTEGRATIONS

These read the `holidays` table **directly through the query builder**, not through the API — so any change to the resolution rules must be mirrored in all three.

### Payroll (`PayrollService`)

`holidayDateSet($employee, $start, $end)` builds the applicable set as:

```
(holiday_group_id IS NULL AND client_id = :client AND (branch_id IS NULL OR branch_id = :branch))
OR (holiday_group_id = :employeeGroup)          -- only when the employee has a group
```

Two rules worth stating explicitly:

- **`client_id` must MATCH, never "match or null."** A null `client_id` is an unscoped row, not a global one; treating it as global would hand one tenant's calendar to every tenant.
- **`branch_id` IS "match or null"** — a company holiday entered without a branch covers every office of that client.

Results are memoised per `(group, client, branch)` in `masterCache`. Recurring rows are anchored onto **every** year the window touches, not just the start year.

`holidayAggregates()` then counts those dates, **skipping any that fall on the employee's own weekly off** (`WeekOff::isOff`) so the same day is not paid twice. This was previously hardcoded to Sunday and double-counted for anyone with a Saturday off.

### Attendance (`AttendanceController::holidayDatesForGroups`)

Signature `(array $groupIds, Carbon $start, Carbon $end, ?int $clientId, ?int $branchId)`. `whereIn('holiday_group_id', $groupIds)` never matches NULL, so ungrouped holidays were once invisible to attendance while payroll was already crediting them — the two modules disagreed about what a holiday is. The client/branch parameters exist to pull company-wide holidays in alongside the group ones, and the early return on an empty `$groupIds` was removed with it.

### Leave (`LeaveRequestController`)

Weekly-offs and holidays inside a requested range are not counted as leave days. A company holiday carries no group (QA #93), so this lookup is unconditional rather than gated on the employee having one.

---

## 9. SECURITY & CAVEATS

| Area | Note |
|---|---|
| Tenant isolation | Every read passes through `applyScope`; `resolveRow` uses `firstOrFail`, so a cross-tenant id reads as 404 with no information leak |
| `holiday_group_id` from the body | Never trusted — `resolveGroupId()` re-checks the id against the caller's scope and silently degrades to `null` (company-wide) when it is out of scope |
| Import group names | Resolved against a pre-built map of **this tenant's** groups only; an unknown name is rejected rather than re-pointed |
| Permission fallback | A missing `hr.holiday` module row lets any `client_admin` / `branch_user` through. Intentional for fresh installs, but it is an open door until `ModuleSeeder` has run |
| **Employee-facing reads are group-only** | `HolidayController::my()` and `EmployeeController::holidays()` both start from `$employee->holiday_group_id` and return `[]` when it is null. Company-wide holidays never appear there, so the employee's calendar can disagree with their payslip |
| Timezone | `DISPLAY_TZ = 'Asia/Kolkata'` is declared in `HolidayController` **but never used**. `config/app.timezone` is `UTC`, so the import's `date <= today` comparison runs against UTC |
| Code allocation | `HolidayController::allocateCode()` pulls **every** code for the tenant under `lockForUpdate()` and scans them in PHP. Correct, but O(n) per insert — a 1,000-row import repeats it 1,000 times inside one transaction |
| No FKs | Neither table has a database foreign key; orphaned `holiday_group_id` values are prevented by application code alone |
| Group status | `Active` / `Inactive` is never read by any query |

---

## 10. METRICS

| Metric | Value |
|---|---|
| Controllers | 2 (790 lines combined) + 1 shared trait (76) |
| API routes | 13 (7 holidays · 5 groups · 1 employee calendar) |
| Permission slug | `hr.holiday` |
| Tables | 2 (+ 1 column on `employees`) |
| Migrations | 4 |
| Soft deletes | both tables |
| DB foreign keys | none |
| Direct table readers | 3 (payroll, attendance, leave) |
| Frontend | 2 pages (1,351 lines) |
| Test coverage | none automated |

---

*Related documents: HOLIDAY_FUNCTIONAL_DOCUMENTATION.md · HOLIDAY_CODE_WALKTHROUGH.md · HOLIDAY_API_DOCUMENTATION.md*
