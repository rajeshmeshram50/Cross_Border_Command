# HOLIDAY MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Holiday (company holiday calendar)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Holiday is a per-tenant company holiday calendar built from **Holiday Groups** (named calendars, e.g. "Indian Employees") that own a set of **Holidays**. Each employee is assigned one group (`employees.holiday_group_id`) and inherits its holidays. Holidays feed **attendance compliance** (excluded from the working-day denominator) and **payroll** (credited as paid, never LOP). Recurring holidays are re-anchored to the requested year.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  HrHoliday.tsx (holidays list + group management + Excel import)       │
│  HolidayCalendarPanel.tsx (employee Holidays tab: list + calendar)     │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  HolidayController: index/show/store/update/destroy/import/my          │
│  HolidayGroupController: index/show/store/update/destroy               │
│  (both use trait ScopesHolidayTenant; permission slug hr.holiday)      │
│  EmployeeController::holidays (self/viewer calendar)                   │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  holiday_groups ─ hasMany ─ holidays ; employees.holiday_group_id (FK  │
│    by convention, no DB constraint)                                    │
│  Feeds: PayrollService holidayAggregates · AttendanceController        │
│    holidayDatesForGroups (both re-anchor recurring holidays)          │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/HolidayController.php · HolidayGroupController.php · ScopesHolidayTenant.php
app/Models/Holiday.php · HolidayGroup.php   (employees.holiday_group_id links)
database/migrations/
  2026_06_09_000001_create_holidays_table.php
  2026_06_09_000003_create_holiday_groups_table.php
  2026_06_09_000004_add_holiday_group_id_to_holidays_and_employees.php
  2026_06_09_000002_seed_holiday_module_and_permissions.php
resources/js/pages/hrms/HrHoliday.tsx · pages/employee/HolidayCalendarPanel.tsx
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum |
| Import | SheetJS-parsed Excel/CSV rows → bulk import endpoint |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) · xlsx |

---

## 3. DATABASE SCHEMA

### 3.1 `holidays` (SoftDeletes; no DB FKs)
`client_id`/`branch_id` (nullable, indexed), `holiday_group_id` (nullable, indexed), `created_by`/`updated_by`, `code` (`HOL-###`), `name`, `date` (date), `type` (default Public; Public/Restricted/Company/Regional/Optional), `is_recurring` (bool), `description`. Composite index `(client_id, branch_id, date)`.

### 3.2 `holiday_groups` (SoftDeletes; no DB FKs)
`client_id`/`branch_id`, `created_by`/`updated_by`, `code` (`HGRP-####`), `name`, `description`, `status` (default Active). Composite index `(client_id, branch_id)`.

### 3.3 `employees.holiday_group_id`
Nullable, indexed FK-by-convention (no DB constraint). The legacy `holiday_list` string column stores the group name for display. **No pivot table** — one group per employee.

---

## 4. MODELS

### Holiday (`app/Models/Holiday.php`)
SoftDeletes. Casts: `date` → `date:Y-m-d`, `is_recurring` → boolean. Relations: `group` (belongsTo HolidayGroup), client, branch, creator, updater.

### HolidayGroup (`app/Models/HolidayGroup.php`)
SoftDeletes. `appends`: `holidays_count`, `employees_count` (the latter drives the "in use" edit/delete lock). Relations: `holidays` hasMany, `employees` hasMany (via `holiday_group_id`), client, branch, creator.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get('/employees/{id}/holidays', [EmployeeController::class, 'holidays']);  // self/viewer calendar
    Route::apiResource('holiday-groups', HolidayGroupController::class);
    Route::get ('/holidays/my',     [HolidayController::class, 'my']);       // before apiResource
    Route::post('/holidays/import', [HolidayController::class, 'import']);
    Route::apiResource('holidays', HolidayController::class);
});
```
`/holidays/my` and `/holidays/import` are declared before `apiResource('holidays')` to avoid `{id}` shadowing. Full detail in **HOLIDAY_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS

**Permission slug `hr.holiday`** (shared by both controllers; flags view/add/edit/delete; import reuses can_add). Super-admin bypasses; unseeded-module fallback allows client_admin/branch_user.

### HolidayController
| Method | Purpose |
|---|---|
| `index` | List (filters: branch_id, holiday_group_id, search, type, year) |
| `store` | Create (transaction; `HOL-###` under lock; duplicate-date guard per group) |
| `update` | Edit (auto-propagates to the group's employees) |
| `destroy` | Delete — **blocked if the group is assigned to ≥1 employee** |
| `import` | Bulk import (≤1000 rows; unknown group name → row rejected; de-dupe by date) |
| `my` | Logged-in user's own group holidays, recurring-shifted to `?year` |

### HolidayGroupController
`index` (with `holidays_count`/`employees_count` + `setup_complete`), `store`/`update` (`HGRP-####`; duplicate-name guard), `destroy` (**blocked if ≥1 employee assigned**; otherwise ungroups its holidays then soft-deletes).

**Recurring handling:** `my` (and payroll/attendance) rewrite a recurring holiday's `date` to `Carbon::create($year, $month, $day)` and filter to the requested year.

---

## 7. FRONTEND

- **`HrHoliday.tsx`** — holidays list (Sr No, Holiday ID, Name, Group, Date, Day, Type, Actions) with filters (search/type/year/group); `HolidayModal` (add/edit: name, group, type, date [min tomorrow], description); `ManageGroupsModal` (group CRUD); Excel template download + import. Delete disabled when the holiday's group is in use.
- **`HolidayCalendarPanel.tsx`** — employee Holidays tab: year stepper + list/calendar views from `GET /employees/{id}/holidays?year=`.
- **`HrEmployees.tsx`** — "Holiday List (Group)" field sends `holiday_group_id` (+ `holiday_list` name).

---

## 8. INTEGRATIONS

### Payroll (`PayrollService::holidayAggregates`)
Reads the employee's group holidays in the window, re-anchors recurring, **excludes Sundays**, dedupes → whole-day count. `paidDays = min(effectiveWorkingDays, present + paidLeave + holidayDays)` — holidays are **paid, never LOP**, capped so they can't inflate paid days.

### Attendance (`AttendanceController::holidayDatesForGroups`)
Mirror of the payroll logic; company holidays are **excluded from the compliance denominator** and surfaced as status "Holiday".

> Four independent copies of the recurring-shift logic exist (`HolidayController::my`, `EmployeeController::holidays`, `PayrollService::holidayAggregates`, `AttendanceController::holidayDatesForGroups`) — they agree on what a holiday is; payroll/attendance additionally exclude off-days.

---

## 9. SECURITY & CAVEATS
1. **Both controllers gate on `hr.holiday`**; the employee `/employees/{id}/holidays` uses the employee `can_view`/self gate instead (a manager can view any employee's calendar without the Holiday grant).
2. **No DB foreign keys** on holidays/holiday_groups (app-level integrity).
3. **Delete guards:** a holiday/group can't be removed while its group is assigned to employees.
4. **Recurring** holidays are stored once and shifted to the requested year on read (4 code copies).
5. **`is_recurring`** is set only via Excel import (the add/edit modal has no toggle).

---

## 10. METRICS
| Metric | Value |
|---|---|
| Controllers | 2 (+ shared trait) |
| Permission slug | hr.holiday |
| Tables | 2 (holidays, holiday_groups) |
| DB FKs | none |
| Recurring-logic copies | 4 |
| Test coverage | none automated |

---

*Related documents: HOLIDAY_FUNCTIONAL_DOCUMENTATION.md · HOLIDAY_CODE_WALKTHROUGH.md · HOLIDAY_API_DOCUMENTATION.md*
