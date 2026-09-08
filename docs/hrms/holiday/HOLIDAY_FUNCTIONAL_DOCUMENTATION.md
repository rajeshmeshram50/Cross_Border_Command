# HOLIDAY MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Holiday

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |
| 2.0 | 2026-09-08 | System | Company-wide (ungrouped) holidays, per-row Group column in the import, future-date-only import rule, name validation, duplicate guards, opt-in pagination with year options, edit-vs-delete lock split, group delete now ungroups. Corrected the "every employee must be in a group" claim. |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose

The Holiday module maintains the company holiday calendar. HR builds named **Holiday Groups** — one calendar per region, entity or employee population — and files holidays under them. Employees are assigned a group and see its dates.

A holiday filed under **no group at all is a company-wide holiday**: it applies to every employee of that client, whether or not they belong to a group. This is how organisation-wide closures (Republic Day, a foundation day) are entered, and it is the normal case for tenants that never set groups up.

Holidays are not just a display: attendance stops counting them against compliance, and payroll credits them as paid days.

### 1.2 Business value

| Benefit | Description |
|---|---|
| Accurate calendars | Per-group holiday lists reflect regional and entity differences |
| Company-wide closures | A holiday with no group covers the whole client without per-group duplication |
| Fair attendance | A holiday is never marked Absent and never counts against compliance |
| Correct pay | Holidays are credited as paid days, never loss-of-pay |
| No double credit | A holiday landing on the employee's own weekly off is not paid twice |
| Recurring support | An annual holiday is defined once and repeats every year |
| Bulk setup | A whole year is imported from Excel/CSV, group per row |
| Change safety | A calendar people already depend on cannot be deleted out from under them |

### 1.3 Key features

- **Holiday Groups** — named calendars (`HGRP-####`), Active/Inactive, assigned to employees.
- **Holidays** — name, date, type, recurring flag, description, optional group (`HOL-###`).
- **Five types** — Public, Restricted, Company, Regional, Optional.
- **Company-wide holidays** — leave the group blank and it applies to everyone.
- **Excel/CSV import** — up to 1,000 rows, group named per row, partial import with a per-row error report.
- **Downloadable template** — pre-filled sample sheet with the exact column names.
- **Employee calendar** — list and month-grid views on the employee profile, year navigation.
- **In-use protection** — a group assigned to employees cannot be deleted, nor can its holidays.
- **Search, type / year / group filters, and opt-in pagination.**

---

## 2. ROLES & ACCESS

Access is governed by the `hr.holiday` permission module (`can_view` / `can_add` / `can_edit` / `can_delete`).

| Role | Access |
|---|---|
| Employee | View their own calendar (profile → Holidays); no admin screen |
| HR / Admin with `hr.holiday` | Full CRUD on holidays and groups, plus import |
| Client Admin / Branch User | Full access where the module row has not been seeded yet (fallback) |
| Super Admin | All, cross-tenant; bypasses the permission check entirely |

> When the `hr.holiday` module row does not exist in the database, client admins and branch users are allowed through as a fallback so a freshly migrated environment still works. Everyone else is refused.

**Scope.** Client admins see global and their own client's rows; branch users and employees see global, client-level and their own branch's rows. The Branch Switcher narrows a client admin's view to one branch.

---

## 3. BUSINESS PROCESS FLOW

### 3.1 Setting up a calendar

```
   HR creates a HOLIDAY GROUP            e.g. "Indian Employees", "UAE Office"
     - name (must contain a letter), description, Active/Inactive
     - code HGRP-0001 allocated automatically
        |
        v
   HR adds HOLIDAYS to it
     - one at a time (Add Holiday), or
     - in bulk from Excel/CSV (Import)
        |
        v
   HR assigns the GROUP to employees
     - on the Employee form (holiday_group_id)
        |
        v
   EMPLOYEES see the calendar
     - profile -> Holidays tab, list or month grid
        |
        v
   ATTENDANCE + PAYROLL consume the same dates
     - attendance: the day is a Holiday, not an Absence
     - payroll:    the day is credited as paid
```

### 3.2 Grouped vs company-wide holidays

```
                        A HOLIDAY IS ADDED
                               |
             +-----------------+------------------+
             v                                    v
       GROUP SELECTED                       NO GROUP (blank)
       a group calendar                     a COMPANY holiday
             |                                    |
    applies to employees                 applies to EVERY employee
    assigned to that group               of the client - branch-wide
             |                           when a branch is set, all
             |                           branches when it is not
             v                                    v
      +--------------------------------------------------+
      |  Attendance and Payroll read BOTH, together      |
      |  The employee's own calendar screen reads only   |
      |  the GROUP half - see section 7, Limitations     |
      +--------------------------------------------------+
```

### 3.3 Holiday types

| Type | Meaning |
|---|---|
| Public | Statutory / national holiday |
| Restricted | Optional holiday from a restricted list |
| Company | Company-declared closure |
| Regional | Applies to a region or location |
| Optional | Employee may choose to take it |

The type is a **label**. Attendance and payroll treat all five identically — every holiday in scope is a non-working, paid day. An unrecognised type on an imported row silently becomes `Public`.

### 3.4 Recurring holidays

A holiday marked recurring repeats every year: the stored date is the anchor, and the day/month is re-projected onto whichever year is being viewed or paid. A fixed-date festival (Republic Day, a foundation day) is entered once. A movable festival (Holi, Eid) must not be marked recurring — its date shifts each year.

### 3.5 Bulk import

The Excel/CSV sheet is parsed in the browser and posted as JSON rows. Columns: **Name, Date, Type, Recurring, Group, Description**. A downloadable template carries the exact headers and three sample rows.

```
   Upload sheet  ->  parsed in browser  ->  posted as rows[]
        |
        v
   EACH ROW IS JUDGED ON ITS OWN
        |- blank name or date                -> error, row reported
        |- name with no letter ("2026")      -> error, row reported
        |- unparseable date                  -> error, row reported
        |- date today or in the past         -> error, row reported
        |- Group column names an unknown grp -> error, row reported
        |- no group at all (column blank and -> error, row reported
        |  none picked in the UI)
        |- same (group, date) already exists -> skipped as duplicate
        +- otherwise                         -> imported
        |
        v
   RESULT: "Imported N holiday(s), skipped M duplicate(s)"
           plus a per-row error list - a bad row never aborts the batch
```

Duplicates are judged **within a group**: the same date may legitimately exist in two different group calendars.

### 3.6 Changing a calendar people already use

| Action | While the group is assigned to employees |
|---|---|
| Edit a holiday | **Allowed** — the change propagates to every employee on that group automatically |
| Delete a holiday | **Blocked** — reassign the employees to another group first |
| Delete the group | **Blocked** — reassign the employees first |
| Delete a group with no employees | Allowed — its holidays are **kept but ungrouped**, so the dates are never lost |

Editing was deliberately opened up: an admin correcting a wrong date should not have to empty a group to do it. Deleting stays locked because it removes a paid day from a calendar attendance and payroll are already scoring against.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Holiday admin (`HrHoliday.tsx`)

```
+----------------------------------------------------------------------+
|  Holiday Calendar        [Template] [Import] [Groups] [+ Add Holiday] |
|  search...      Group v All Groups   Type v All Types   Year v All    |
|  +----------------------------------------------------------------+  |
|  | Holiday ID | Holiday Name | Description | Group | Date | Day |  |  |
|  | Type | Actions (Edit / Delete)                                 |  |
|  +----------------------------------------------------------------+  |
|  rows per page v                                    < page n of m >   |
+----------------------------------------------------------------------+
```

- **Group** shows `Ungrouped` for a company-wide holiday.
- **Day** is derived from the date (Sunday…Saturday), not stored.
- **Delete** is disabled with a tooltip when the holiday's group is assigned to employees.
- The **Year** dropdown lists every year present in the tenant's calendar — not just the years on the current page, and it does not shrink as other filters are applied.
- Page size adapts to the viewport and is remembered per browser.

### 4.2 Holiday form (Add / Edit)

Holiday Name\*, Type\*, Holiday Group\*, Date\*, Recurring toggle, Description. The date picker blocks today and every past date — a holiday is always entered ahead of time. Names must contain at least one letter; `2026` on its own is refused with an explanatory message.

### 4.3 Manage Groups modal

A table of Sr No · Code · Group Name · Holidays (count) · Actions, with an inline Add/Edit Group form (name, description, Active/Inactive). Delete is refused while employees are assigned, naming how many.

### 4.4 Employee Holidays tab (`HolidayCalendarPanel.tsx`)

Two views over the same year:

- **List** — every holiday with its weekday, formatted `Tue, 16-Jun-2026`.
- **Calendar** — a month grid with holidays marked, month and year navigation.

An employee with no group assigned sees **"No holiday calendar assigned"**.

### 4.5 Elsewhere in HRMS

- **Employee form** (`HrEmployees.tsx`) — the Holiday Group dropdown that makes the assignment.
- **Leave calendar** (`HrLeave.tsx`) — marks holidays so leave is not applied on them.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Everything is tenant-scoped; a holiday or group id from another tenant reads as "not found" |
| 2 | Codes are allocated automatically: `HOL-###` for holidays, `HGRP-####` for groups |
| 3 | A holiday name must contain at least one letter; numbers, spaces, dots, apostrophes and hyphens are allowed alongside it |
| 4 | A group name must contain at least one letter; numbers, spaces and hyphens are allowed alongside it |
| 5 | Group names are unique per tenant, case-insensitively |
| 6 | Two holidays cannot share a date **within the same group**; the same date in another group is fine |
| 7 | A holiday with no group is a company-wide holiday and applies to every employee of the client |
| 8 | A company holiday with no branch covers every branch; with a branch, only that branch |
| 9 | Holiday dates must be in the future when created or imported — today and past dates are refused |
| 10 | Recurring holidays repeat by day/month onto whichever year is being viewed |
| 11 | A holiday's group can be changed and its date corrected at any time; the change propagates automatically |
| 12 | A holiday cannot be deleted while its group is assigned to employees |
| 13 | A group cannot be deleted while employees are assigned to it |
| 14 | Deleting an unused group keeps its holidays and ungroups them |
| 15 | Import accepts at most 1,000 rows per request and imports valid rows even when others fail |
| 16 | An import row naming a group that does not exist is rejected — the import never creates groups |
| 17 | An unrecognised type on an import row falls back to `Public` |
| 18 | A holiday falling on the employee's own weekly off is not credited twice in payroll |
| 19 | All actions require the matching `hr.holiday` permission; super admins bypass it |

---

## 6. STATUS MODEL

Holidays have no lifecycle — they exist or they do not. Two flags carry state:

**Group status** — `Active` / `Inactive`. Informational: an Inactive group is still assignable and its holidays still count. Nothing enforces the flag.

**Recurring** — `is_recurring` true/false. Decides whether the stored date is a one-off or a yearly anchor.

Both holidays and groups are **soft-deleted**, so a removed row is retained and its code is never reissued.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| **Employee calendar vs payroll** | The employee-facing screens (profile Holidays tab, `/holidays/my`) show **only the assigned group's** holidays. Company-wide holidays with no group are credited by payroll and honoured by attendance, but do **not** appear on the employee's own calendar — and an employee with no group sees an empty calendar while still being paid for company holidays |
| Backfilling | Holidays must be future-dated, so a mid-year go-live cannot enter the current year's holidays that have already passed |
| Timezone | The "is this date in the past" check runs against server time (**UTC**), not the tenant's timezone, so late-evening IST entries near midnight can be judged against the next day. A display-timezone constant exists in the code but is not applied |
| Group status | `Active` / `Inactive` is stored and shown but never enforced anywhere |
| Holiday type | All five types behave identically in attendance and payroll — the distinction is descriptive only |
| Groups list | Not paginated (the holiday list is), so a tenant with very many groups loads them all |
| Change notification | Editing a holiday silently rewrites the calendar for everyone on that group — no notification is sent |
| Code format | Holiday codes are 3-digit (`HOL-001`) while group codes are 4-digit (`HGRP-0001`) |
| Integrity | No database foreign keys on either table |
| Import scope | Import only creates holidays; it cannot update or delete existing ones |

---

*Related documents: HOLIDAY_TECHNICAL_DOCUMENTATION.md · HOLIDAY_CODE_WALKTHROUGH.md · HOLIDAY_API_DOCUMENTATION.md*
