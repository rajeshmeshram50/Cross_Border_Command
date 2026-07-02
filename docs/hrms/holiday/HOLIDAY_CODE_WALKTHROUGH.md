# HOLIDAY MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Holiday
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: create group → add holidays → assign employee → employee view → payroll/attendance integration. Files: `HolidayController.php`, `HolidayGroupController.php`, `ScopesHolidayTenant.php`, `PayrollService.php`, `AttendanceController.php`, `HrHoliday.tsx`.

---

## 1. GROUPS

### `HolidayGroupController::store()`
```php
$this->authorizeAction($request, 'can_add');            // hr.holiday
$data = $this->validatePayload($request);               // name unique (ci) per tenant; status
[$clientId,$branchId] = $this->resolveOwnership($request);
DB::transaction(fn() => HolidayGroup::create($data + ['code'=>$this->allocateCode(...), // HGRP-#### lock
                                                      'client_id'=>$clientId,'branch_id'=>$branchId, ...]));
```

### `destroy()`
```php
if (Employee::where('holiday_group_id',$id)->count() > 0) abort(422);   // in use
DB::transaction(function () use ($id, $row) {
    DB::table('holidays')->where('holiday_group_id',$id)->update(['holiday_group_id'=>null]); // ungroup
    $row->delete();                                                     // soft delete
});
```

---

## 2. HOLIDAYS

### `HolidayController::store()`
```php
$this->authorizeAction($request, 'can_add');
$data = $this->validatePayload($request);   // name, date, type, is_recurring, description;
                                            // duplicate-date guard within (client,branch,group)
DB::transaction(fn() => Holiday::create($data + ['code'=>$this->allocateCode(...),  // HOL-### lock
                                                 'created_by'=>..., 'updated_by'=>...]));
```

### `destroy()` — group-in-use guard
```php
$this->assertGroupNotInUse($row);   // 422 if the holiday's group is assigned to ≥1 employee
$row->delete();                      // soft
```

### `import()`
```php
// build case-insensitive name→id map of THIS tenant's groups
// per row: resolve group (unknown name → reject); parse date (Excel serial + many formats);
//          de-dupe by (group|date) vs DB and within batch; normalise type; partial import
return response()->json(['created'=>..., 'skipped'=>..., 'errors'=>[...]]);
```

### `my()` — recurring shift
```php
foreach ($holidays as $h) if ($h->is_recurring)
    $h->date = Carbon::create($requestedYear, $storedMonth, $storedDay);
// filter to rows whose (shifted) year == requestedYear, re-sort by date
```

---

## 3. TENANT SCOPING (trait `ScopesHolidayTenant`)
```php
resolveOwnership(): super_admin → body; client_admin/user → [client_id,null]; branch_user/employee → [client_id,branch_id]
applyScope(): super_admin all; client_admin/user → null-client OR own client (+ switcher branch);
              branch_user/employee → globals + client-level + own branch only
```

---

## 4. EMPLOYEE ASSIGNMENT & VIEW

### Assignment (`HrEmployees.tsx` → `EmployeeController::update`)
```tsx
// Employee form "Holiday List (Group)" → sends holiday_group_id (numeric) + holiday_list (group name)
```

### View (`EmployeeController::holidays`)
```php
// authorizeViewOrSelf (employee can view own; manager/admin can view any without hr.holiday)
$group = $employee->holidayGroup;
// return the group's holidays for ?year, recurring-shifted (same logic as HolidayController::my)
```

---

## 5. INTEGRATIONS

### Payroll (`PayrollService::holidayAggregates`)
```php
if (!$employee->holiday_group_id) return 0.0;
$rows = DB::table('holidays')->where('holiday_group_id',$groupId)->whereNull('deleted_at')->get(['date','is_recurring']);
// recurring re-anchored to $start->year; drop dates outside window; EXCLUDE Sundays; dedupe → count
// caller: paidDays = min(effectiveWorkingDays, present + paidLeave + holidayDays)  → paid, never LOP
```

### Attendance (`AttendanceController::holidayDatesForGroups`)
```php
// [group_id => [Y-m-d => true]] (recurring re-anchored); excluded from trackedWorkingDays;
// surfaced as status "Holiday" when the day would otherwise be Absent/Weekly Off
```

---

## 6. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Group → holidays (one group per employee) | schema | Simple regional calendars |
| Recurring re-anchor | my / holidays / payroll / attendance | Annual holidays repeat |
| In-use delete guards | destroy | Protect assigned calendars |
| Row-locked codes | allocateCode | Unique HOL-###/HGRP-#### |
| Import de-dupe | import | Safe bulk load |

---

## 7. NOTES & CAVEATS
- No DB foreign keys on holidays/holiday_groups.
- Recurring-shift logic exists in 4 places (kept in sync); payroll/attendance also exclude off-days.
- `is_recurring` set via import only.
- Employee holiday view bypasses the `hr.holiday` grant (uses employee/self gate).
- DB is PostgreSQL.

---

*Related documents: HOLIDAY_TECHNICAL_DOCUMENTATION.md · HOLIDAY_FUNCTIONAL_DOCUMENTATION.md · HOLIDAY_API_DOCUMENTATION.md*
