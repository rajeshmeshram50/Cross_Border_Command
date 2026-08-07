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
 * EARLY EXIT — resigned within EARLY_EXIT_DAYS of joining
 * ------------------------------------------------------
 * A separate carve-out that stands on its own, because probation is not
 * guaranteed: an employee hired under a "No Probation" policy has no probation
 * end date at all, and without this rule someone who quit on day 8 would still
 * be charged a full notice period. Someone who resigns that early:
 *   · serves NO notice period — nothing is recovered from them and nothing is
 *     paid to them in lieu (noticePeriodApplies), and
 *   · is not put through payroll at all (isEarlyExit → PayrollService).
 *
 * The waiver is keyed on the RESIGNATION date, not the last working day: the
 * last working day is DERIVED from whether a notice period applies, so keying
 * the waiver on it would be circular. Payroll still honours either date (see
 * isEarlyExit) so a case with no resignation date recorded is not missed.
 *
 * Dates are compared in the display timezone (IST): the app runs in UTC, so a
 * raw now()->toDateString() reports YESTERDAY for the first 5.5h of every IST
 * day and would let a just-ended probation still read as active.
 */
class ProbationGuard
{
    public const DISPLAY_TZ = 'Asia/Kolkata';

    /**
     * Resigning/leaving inside this many days of joining (inclusive, counting
     * the joining day itself) waives the notice period and skips payroll
     * entirely for that employee. Joined the 1st + resigned the 15th = 15 days
     * → waived/skipped; the 16th = 16 days → normal notice, paid normally.
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
     * Rule 2 — notice period is waived on probation, AND for an employee who
     * resigned within EARLY_EXIT_DAYS of joining. Either way the exit can be
     * effective immediately: the last working day is not pushed out to notice
     * start + notice_period_days, and no notice settlement (recovery or pay in
     * lieu) can arise, because there is no notice period to leave unserved.
     *
     * @param  mixed  $resignationDate  The exit case's notice/resignation date.
     *                Omit it to test the probation half alone.
     */
    public static function noticePeriodApplies(?Employee $employee, $resignationDate = null): bool
    {
        return !self::isOnProbation($employee)
            && !self::isEarlyResignation($employee, $resignationDate);
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
     * Resigned within EARLY_EXIT_DAYS of joining — the trigger for the notice
     * waiver. Null/blank resignation date → false (nothing to measure against),
     * so a case where HR hasn't recorded one yet keeps the normal notice rules.
     */
    public static function isEarlyResignation(?Employee $employee, $resignationDate): bool
    {
        $tenure = self::tenureDays($employee, $resignationDate);

        return $tenure !== null && $tenure <= self::EARLY_EXIT_DAYS;
    }

    /**
     * Rule 3 — left within EARLY_EXIT_DAYS of joining, so payroll must not be
     * processed for them at all.
     *
     * EITHER date can trigger it. The resignation date is the policy's own
     * trigger; the last working day is kept as a fallback so a termination or a
     * legacy case with no notice date recorded is still caught, and so an exit
     * whose last day was pulled back inside the window is caught too.
     *
     * @param  mixed  $resignationDate  Optional; omitted for callers that only
     *                                  hold the last working day.
     */
    public static function isEarlyExit(?Employee $employee, $lastWorkingDay, $resignationDate = null): bool
    {
        $tenure = self::tenureDays($employee, $lastWorkingDay);

        return ($tenure !== null && $tenure <= self::EARLY_EXIT_DAYS)
            || self::isEarlyResignation($employee, $resignationDate);
    }
}
