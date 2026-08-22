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
     * The EDIT-FREEZE reading: has an exit actually been STARTED against this
     * employee?
     *
     * Deliberately broader than employeeIds() above, and the difference is the
     * point. employeeIds() answers "is this a live exit case payroll/salary
     * must treat specially", which needs an exit_type — the thing those
     * screens compute from. Freezing the profile has to bite EARLIER than
     * that: the moment HR opens the exit and saves anything at all, the record
     * is evidence in a live case and must stop moving underneath it. Someone
     * who has filled in a notice date but not yet picked Resignation vs
     * Termination has unquestionably initiated an exit.
     *
     * The signals mirror EmployeeController::sqlExitInitiated() exactly — the
     * same rule the Exit Management "In Progress" tab is cut from — so what HR
     * sees badged as in-progress is precisely what refuses to be edited. If
     * either side changes, the screen and the guard disagree and the freeze
     * becomes unexplainable to whoever hits it.
     *
     * Scoped to OPEN cases only. A Closed / completed case means the person
     * has left, `employees.status` has flipped to a terminal value, and
     * EmployeeController::update() already refuses on isDisabled() with the
     * Reactivate instruction — a second guard there would only replace a
     * useful message with a vaguer one.
     */
    public static function initiatedFor(int $employeeId): ?EmployeeExit
    {
        if (!Schema::hasTable('employee_exits')) {
            return null;
        }

        return self::initiatedQuery()->where('employee_id', $employeeId)->first();
    }

    /**
     * Same reading as initiatedFor(), for a page of employees at a time — one
     * query, so the HR list can badge/freeze 25 rows without 25 lookups.
     */
    public static function initiatedIds(?array $employeeIds = null): array
    {
        if (!Schema::hasTable('employee_exits')) {
            return [];
        }
        if ($employeeIds !== null && empty($employeeIds)) {
            return [];
        }

        return self::initiatedQuery()
            ->when($employeeIds !== null, fn ($q) => $q->whereIn('employee_id', $employeeIds))
            ->pluck('employee_id')
            ->map(fn ($v) => (int) $v)
            ->unique()
            ->values()
            ->all();
    }

    /** The shared WHERE behind initiatedFor() / initiatedIds(). */
    private static function initiatedQuery()
    {
        return EmployeeExit::query()
            ->whereNull('rehired_at')
            ->where('exit_case_status', 'Open')
            ->where(fn ($w) => $w
                /* Empty string, not just NULL: the exit form posts '' for an
                   unpicked select, and sqlExitInitiated() reads that as unset
                   via COALESCE. A bare whereNotNull would freeze every record
                   that had the exit drawer merely opened and closed again. */
                ->where('exit_type', '<>', '')
                ->orWhereNotNull('notice_date')
                ->orWhereNotNull('last_working_day')
                ->orWhere('current_stage', '>=', 1));
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
