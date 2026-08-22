<?php

namespace App\Support;

use App\Models\EmployeeExit;
use Illuminate\Support\Facades\Schema;

/**
 * The single definition of "this employee's exit is IN PROGRESS".
 *
 * Why this exists
 * ---------------
 * An exit under way leaves `employees.status` on 'Active' — the status only
 * flips at ExitController::complete(). So no status filter anywhere can see a
 * mid-exit employee, and each screen that cared had to re-derive it from
 * `employee_exits` by hand. Three places did, and all three disagreed:
 *
 *   · ExitController::employeeIdsExiting()  exit_type NOT NULL + status Open + not rehired
 *   · SalaryStructureController::employees() just "not rehired" — so CLOSED and
 *     COMPLETED exits were also badged "Exit in progress", which is why a tenant
 *     with historic exits saw the badge on nearly every row.
 *   · PayrollService                        did not check at all — payroll only
 *     ever looked at last_working_day.
 *
 * The Exit module's own reading (exit_type set, case still Open, not rehired) is
 * the canonical one and is what this class implements. Everything that needs the
 * answer now asks here.
 *
 * A rehired exit is spent history, not a live case — someone brought back
 * mid-notice is not exiting any more (same rule as the reporting-manager picker
 * and NoticePeriodGuard::activeExit).
 */
class ExitInProgress
{
    /**
     * Employee ids (of $employeeIds, or of $clientId when no ids are given) whose
     * exit case is currently open. Empty when the table has not been migrated.
     */
    public static function employeeIds(?int $clientId = null, ?array $employeeIds = null): array
    {
        if (!Schema::hasTable('employee_exits')) {
            return [];
        }
        if ($employeeIds !== null && empty($employeeIds)) {
            return [];
        }

        return EmployeeExit::query()
            ->when($clientId !== null, fn ($q) => $q->where('client_id', $clientId))
            ->when($employeeIds !== null, fn ($q) => $q->whereIn('employee_id', $employeeIds))
            ->whereNotNull('exit_type')
            ->where('exit_case_status', 'Open')
            ->whereNull('rehired_at')
            ->pluck('employee_id')
            ->map(fn ($v) => (int) $v)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * employee_id => EmployeeExit for the open cases among $employeeIds — for
     * callers that need the last working day / exit type, not just the id set.
     */
    public static function map(array $employeeIds): array
    {
        if (empty($employeeIds) || !Schema::hasTable('employee_exits')) {
            return [];
        }

        return EmployeeExit::query()
            ->whereIn('employee_id', $employeeIds)
            ->whereNotNull('exit_type')
            ->where('exit_case_status', 'Open')
            ->whereNull('rehired_at')
            ->orderBy('id')
            ->get(['employee_id', 'exit_type', 'notice_date', 'last_working_day'])
            ->keyBy('employee_id')
            ->all();
    }
}
