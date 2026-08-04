<?php

namespace App\Support;

use App\Models\Employee;
use Carbon\Carbon;
use Illuminate\Http\Exceptions\HttpResponseException;

/**
 * Probation rules — the single source of truth for "is this employee still on
 * probation, and what does that block?".
 *
 * A new hire serves a probation period (policy captured at hire, e.g.
 * "3-Month Probation"). `employees.probation_end_date` is derived from the
 * joining date + policy when the employee is saved (see
 * resources/js/utils/probation.ts) and is NULL when there is no probation, so
 * one column answers the question with no per-row date maths here.
 *
 * While on probation:
 *   1. Leave policy does not apply — no leave request can be raised.
 *   2. Notice period does not apply — an exit is immediate, with no
 *      notice-period end date gating the last working day.
 *
 * Separately, an employee who leaves within EARLY_EXIT_DAYS of joining is not
 * put through payroll at all.
 *
 * Dates are compared in the display timezone (IST): the app runs in UTC, so a
 * raw now()->toDateString() reports YESTERDAY for the first 5.5h of every IST
 * day and would let a just-ended probation still read as active.
 */
class ProbationGuard
{
    public const DISPLAY_TZ = 'Asia/Kolkata';

    /**
     * Exit inside this many days of joining (inclusive, counting the joining
     * day itself) means payroll is skipped entirely for that employee.
     * Joined the 1st + last working day the 15th = 15 days → skipped;
     * last working day the 16th = 16 days → paid normally.
     */
    public const EARLY_EXIT_DAYS = 15;

    public static function endDate(?Employee $employee): ?Carbon
    {
        if (!$employee || empty($employee->probation_end_date)) {
            return null;
        }
        return Carbon::parse($employee->probation_end_date)->startOfDay();
    }

    /**
     * On probation while today is on or before the probation end date. No end
     * date (no probation, or a policy of "No Probation") → false.
     */
    public static function isOnProbation(?Employee $employee, ?Carbon $asOf = null): bool
    {
        $end = self::endDate($employee);
        if (!$end) {
            return false;
        }
        $today = ($asOf ?: Carbon::now(self::DISPLAY_TZ))->copy()->startOfDay();

        return $today->lte($end);
    }

    /** Probation end as "28 Aug 2026", or null when not on probation. */
    public static function endDateLabel(?Employee $employee): ?string
    {
        return self::endDate($employee)?->format('j M Y');
    }

    /**
     * Rule 1 — reject a leave request with 422 while the employee is on
     * probation. The leave policy simply does not apply yet, so the request is
     * refused outright rather than parked for an approver who cannot grant it.
     *
     * @param  bool  $isSelf  Whether the target employee IS the caller — only
     *                        changes the wording (you vs. this employee).
     */
    public static function assertCanRaiseLeave(?Employee $employee, bool $isSelf = true): void
    {
        if (!self::isOnProbation($employee)) {
            return;
        }

        $until   = self::endDateLabel($employee);
        $suffix  = $until ? " Leave can be applied from {$until}." : '';
        $message = $isSelf
            ? "You are on probation and cannot apply for leave.{$suffix}"
            : "This employee is on probation, so the leave policy does not apply yet.{$suffix}";

        throw new HttpResponseException(response()->json([
            'message' => $message,
            'errors'  => ['probation' => ['Employee is on probation.']],
        ], 422));
    }

    /**
     * Rule 2 — notice period is waived on probation, so an exit can be
     * effective immediately (the last working day is not pushed out to
     * notice start + notice_period_days).
     */
    public static function noticePeriodApplies(?Employee $employee): bool
    {
        return !self::isOnProbation($employee);
    }

    /**
     * Tenure in whole days from joining to the last working day, counting the
     * joining day itself (joined 1st, left 15th = 15 days). NULL when either
     * date is missing, or when the last working day precedes joining.
     */
    public static function tenureDays(?Employee $employee, $lastWorkingDay): ?int
    {
        if (!$employee || empty($employee->date_of_joining) || empty($lastWorkingDay)) {
            return null;
        }
        $join = Carbon::parse($employee->date_of_joining)->startOfDay();
        $lwd  = Carbon::parse($lastWorkingDay)->startOfDay();
        if ($lwd->lt($join)) {
            return null;
        }
        return $join->diffInDays($lwd) + 1;
    }

    /**
     * Rule 3 — left within EARLY_EXIT_DAYS of joining, so payroll must not be
     * processed for them at all.
     */
    public static function isEarlyExit(?Employee $employee, $lastWorkingDay): bool
    {
        $tenure = self::tenureDays($employee, $lastWorkingDay);

        return $tenure !== null && $tenure <= self::EARLY_EXIT_DAYS;
    }
}
