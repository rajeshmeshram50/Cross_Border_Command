# HRMS Bug Tickets — Attendance · Leave · Payroll · Holiday

| Ticket | Module | Issue (one line) | Where | Severity |
|---|---|---|---|---|
| HRMS-ATT-01 | Attendance | Future dates with no punch show "Absent" (even future weekly-offs) instead of blank/"—" in the attendance view. | app/Http/Controllers/Api/AttendanceController.php:725 | Medium |
| HRMS-LEV-01 | Leave | Leave types with a blank `paid_unpaid` default to "Paid", so an unconfigured leave type never deducts salary in payroll. | app/Services/PayrollService.php:1012 | High |
| HRMS-PAY-01 | Payroll | Professional Tax always uses the Maharashtra slab — employee work state (`state_id`) is ignored for every tenant. | app/Services/PayrollService.php:1043 | High |
| HRMS-HOL-01 | Holiday | Holiday paid-day credit skips only Sunday (hardcoded) and ignores the employee's actual `weekly_off`, so a holiday on a non-Sunday weekly-off is wrongly paid. | app/Services/PayrollService.php:921 | Medium |
