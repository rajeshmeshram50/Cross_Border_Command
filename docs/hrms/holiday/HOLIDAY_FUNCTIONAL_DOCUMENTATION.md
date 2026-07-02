# HOLIDAY MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Holiday

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The Holiday module maintains the company holiday calendar. HR creates **Holiday Groups** (e.g. per region/entity) and adds holidays to each; every employee is assigned a group and sees its holidays. Holidays are excluded from attendance compliance and paid (never LOP) in payroll.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Accurate calendars | Per-group holiday lists reflect regional/entity differences |
| Fair attendance | Holidays don't count against attendance compliance |
| Correct pay | Holidays are credited as paid days, never loss-of-pay |
| Recurring support | Annual holidays are defined once and repeat each year |
| Bulk setup | Import a year's holidays from Excel/CSV |

### 1.3 Key features
- **Holiday Groups** with employee assignment.
- **Holidays** (name, date, type, recurring, description) with auto codes.
- **Excel import** of holidays (with per-row group mapping).
- **Employee calendar** (list + month grid) on the profile.
- **Guards** preventing deletion of holidays/groups in active use.

---

## 2. ROLES & ACCESS
Gated by **`hr.holiday`** (view/add/edit/delete). Super-admin bypasses. Branch users see their own branch's holidays + client-level + global. Employees view their own group's calendar (no Holiday grant needed for that read).

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                        HOLIDAY SETUP & USE                         │
└───────────────────────────────────────────────────────────────────┘
   HR
    │  create Holiday Group (e.g. "Indian Employees")
    ▼
   add Holidays to the group  (or Excel import)
    │   • name, date, type, recurring?, description
    │   • recurring holidays repeat every year
    ▼
   assign employees to the group (Employee form → Holiday List)
    │
    ▼
   EMPLOYEE sees the group's calendar (profile Holidays tab)
    │
    ├─ ATTENDANCE: holiday days excluded from compliance; shown as "Holiday"
    └─ PAYROLL: holiday days credited as PAID (never LOP), capped to working days
```

### 3.1 Holiday types
Public · Restricted · Company · Regional · Optional.

### 3.2 Recurring holidays
A recurring holiday is stored once; on read (calendar, payroll, attendance) its date is re-anchored to the requested year.

### 3.3 Guards
- A **holiday** can't be deleted while its group is assigned to employees.
- A **group** can't be deleted while employees are assigned; deleting an empty group ungroups (keeps) its holidays.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Holiday admin (`HrHoliday.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Holidays              [Template] [Import] [Manage Groups] [+ Add] │
│  [Search] [Type ▼] [Year ▼] [Group ▼]                             │
│  Sr│Holiday ID│Name│Group│Date│Day│Type│Actions                   │
└───────────────────────────────────────────────────────────────────┘
```
Add/edit modal: Name, Group (Active only), Type, Date (from tomorrow), Description. Manage Groups modal: group CRUD (name/description), with holiday counts. Delete disabled when the group is in use. Excel: template download + import (created/skipped/error counts).

### 4.2 Employee Holidays tab (`HolidayCalendarPanel.tsx`)
Year stepper + **List** (Name + recurring badge, Date, Type) and **Calendar** (month grid highlighting holidays). "No Holiday Calendar assigned" when the employee has no group.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Employees inherit holidays from their assigned group (one group each) |
| 2 | Holiday codes `HOL-###`, group codes `HGRP-####` (auto) |
| 3 | Duplicate holiday date within a group is rejected |
| 4 | Recurring holidays repeat each year (re-anchored on read) |
| 5 | Holidays are paid (never LOP) in payroll, capped to working days |
| 6 | Holidays are excluded from attendance compliance |
| 7 | Can't delete a holiday/group while the group is assigned to employees |
| 8 | Import accepts ≤1000 rows; unknown group names are rejected |
| 9 | `is_recurring` is set via Excel import only |

---

## 6. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Recurring toggle | Only settable via Excel import (not the add/edit modal) |
| Data integrity | Holidays/groups have no DB foreign keys |
| Off-day rules | List views don't exclude weekends; payroll/attendance do |

---

*Related documents: HOLIDAY_TECHNICAL_DOCUMENTATION.md · HOLIDAY_CODE_WALKTHROUGH.md · HOLIDAY_API_DOCUMENTATION.md*
