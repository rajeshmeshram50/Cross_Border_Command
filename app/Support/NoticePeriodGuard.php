<?php

namespace App\Support;

use App\Models\Employee;
use App\Models\EmployeeExit;
use App\Models\LeaveRequest;
use App\Models\Masters\LeaveTypes;
use Carbon\Carbon;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Log;

/**
 * Notice-period rules — the single source of truth for "is this employee
 * serving notice, and what does that change about their leave?".
 *
 * An employee is on notice once an exit case is open and today falls inside
 * its notice window (notice start → last working day). While there:
 *
 *   1. PAID leave cannot be taken. The point of a notice period is that it is
 *      served; paid leave would let the employee draw salary for days they
 *      never worked and still leave on the agreed date. Refused at request
 *      time rather than parked for an approver who cannot grant it.
 *   2. UNPAID leave IS allowed, but every day of it pushes the LAST WORKING
 *      DAY out by a day — the notice period still has to be served in full,
 *      so a day not worked is a day added to the end.
 *
 * Rule 2 fires on FINAL approval (not on request), and is reversed if that
 * approved leave is later cancelled — see applyExtension / revertExtension.
 *
 * CALENDAR DAYS, deliberately
 * ---------------------------
 * The notice period is counted in CALENDAR days end to end:
 *   · Saturdays and Sundays are part of the notice period. The last working
 *     day is NOT pushed out because a weekend falls inside it.
 *   · Company holidays are part of the notice period too. A holiday inside
 *     the window does NOT extend it either.
 *   · An extension therefore adds CALENDAR days (addDays), and the resulting
 *     last working day is left exactly where it lands — it is never rolled
 *     forward off a weekend or a holiday.
 * This matches how the exit wizard derives the notice-period end date
 * (notice start + notice_period_days, calendar) so the two can't disagree.
 *
 * Note the asymmetry, which is intended: a leave request's `days` counts only
 * CHARGEABLE days (LeaveRequestController::computeLeaveDays excludes weekly
 * offs and holidays), so 2 unpaid days spanning a weekend adds 2 calendar days
 * — the employee owes back the 2 days of notice they didn't serve, not the
 * weekend that was already counted as served.
 *
 * Dates are compared in the display timezone (IST): the app runs in UTC, so a
 * raw now()->toDateString() reports YESTERDAY for the first 5.5h of every IST
 * day and would let a notice period that starts today read as not-yet-started.
 * Mirrors ProbationGuard, which guards the other end of the lifecycle.
 */
class NoticePeriodGuard
{
    public const DISPLAY_TZ = 'Asia/Kolkata';

    /**
     * The OPEN exit case putting this employee on notice as of $asOf, or null.
     *
     * "Open" means the case has not been completed — a closed case is a past
     * exit and must not gate anything. The window runs from the notice start
     * date to the last working day inclusive; a case with no last working day
     * yet is treated as open-ended (notice has started, the end is still being
     * agreed), which is exactly when this policy matters most.
     */
    public static function activeExit(?Employee $employee, ?Carbon $asOf = null): ?EmployeeExit
    {
        if (!$employee) {
            return null;
        }

        $row = EmployeeExit::where('employee_id', $employee->id)
            ->whereNotNull('notice_date')
            ->where(fn ($q) => $q->whereNull('exit_case_status')->orWhere('exit_case_status', '!=', 'Closed'))
            ->orderByDesc('id')
            ->first();

        if (!$row) {
            return null;
        }

        $today = ($asOf ?: Carbon::now(self::DISPLAY_TZ))->copy()->startOfDay();
        $start = Carbon::parse($row->notice_date)->startOfDay();
        if ($today->lt($start)) {
            return null;   // notice hasn't started yet
        }
        if ($row->last_working_day && $today->gt(Carbon::parse($row->last_working_day)->startOfDay())) {
            return null;   // already past the last working day
        }

        return $row;
    }

    /** Is the employee serving notice right now? */
    public static function isOnNoticePeriod(?Employee $employee, ?Carbon $asOf = null): bool
    {
        if (self::activeExit($employee, $asOf)) {
            return true;
        }
        // Fallback for an employee flipped to "Notice Period" on the employee
        // master without an exit case behind it — the status alone still means
        // they are serving notice, so the policy applies.
        return $employee && strcasecmp((string) $employee->status, 'Notice Period') === 0;
    }

    /**
     * Is this leave type unpaid? Two columns can say so — the explicit
     * paid/unpaid flag, and the category ("Unpaid Leave"). Either is enough;
     * anything else is treated as PAID, which is the safe default here because
     * the paid branch is the one that gets blocked.
     */
    public static function isUnpaidType(?LeaveTypes $type): bool
    {
        if (!$type) {
            return false;
        }
        return strcasecmp((string) $type->paid_unpaid, 'Unpaid') === 0
            || strcasecmp((string) $type->type, 'Unpaid Leave') === 0;
    }

    /** Last working day as "28 Aug 2026", or null when none is set. */
    public static function lastWorkingDayLabel(?Employee $employee): ?string
    {
        $row = self::activeExit($employee);
        return $row && $row->last_working_day
            ? Carbon::parse($row->last_working_day)->format('j M Y')
            : null;
    }

    /**
     * Rule 1 — reject a PAID leave request with 422 while the employee is
     * serving notice. Unpaid leave passes through (and will extend the exit
     * date on approval, per Rule 2).
     *
     * @param  bool  $isSelf  Whether the target employee IS the caller — only
     *                        changes the wording (you vs. this employee).
     */
    public static function assertLeaveAllowed(?Employee $employee, ?LeaveTypes $type, bool $isSelf = true): void
    {
        if (!self::isOnNoticePeriod($employee) || self::isUnpaidType($type)) {
            return;
        }

        $lwd     = self::lastWorkingDayLabel($employee);
        $until   = $lwd ? " (serving notice until {$lwd})" : '';
        $message = $isSelf
            ? "You are serving your notice period{$until}, so paid leave cannot be applied for. You may apply for unpaid leave — note that each unpaid day extends your last working day by a day."
            : "This employee is serving their notice period{$until}, so paid leave cannot be granted. Only unpaid leave is allowed, and each unpaid day extends their last working day by a day.";

        throw new HttpResponseException(response()->json([
            'message' => $message,
            'errors'  => ['notice_period' => ['Paid leave is not allowed during the notice period.']],
        ], 422));
    }

    /**
     * Rule 2 — an approved UNPAID leave during notice pushes the last working
     * day out by its length, so the notice period is still served in full.
     *
     * Fractional days round UP: the last working day is a date, so half a day
     * of unpaid leave still moves it by one. The number of days applied is
     * recorded on the request so cancelling it can put the date back exactly.
     *
     * CALENDAR days are added and the result is left where it falls — if the
     * new last working day lands on a Sunday or a company holiday it STAYS
     * there. Rolling it forward would extend the notice period for a
     * non-working day, which the policy explicitly does not do.
     *
     * Returns the days added (0 when the rule doesn't apply). Never throws —
     * an exit-date update must not fail an otherwise valid approval.
     */
    public static function applyExtension(LeaveRequest $leave, ?Employee $employee): int
    {
        try {
            if ($leave->notice_extension_days !== null) {
                return 0;   // already applied — approving is idempotent
            }
            $exit = self::activeExit($employee);
            if (!$exit || !$exit->last_working_day) {
                return 0;
            }
            $type = $leave->relationLoaded('leaveType') ? $leave->leaveType : LeaveTypes::find($leave->leave_type_id);
            if (!self::isUnpaidType($type)) {
                return 0;
            }
            $days = (int) ceil((float) $leave->days);
            if ($days <= 0) {
                return 0;
            }

            $exit->last_working_day = Carbon::parse($exit->last_working_day)->addDays($days)->toDateString();
            $exit->save();

            $leave->notice_extension_days = $days;
            $leave->save();

            return $days;
        } catch (\Throwable $e) {
            Log::warning('Notice-period last-working-day extension failed', [
                'leave_request_id' => $leave->id,
                'error'            => $e->getMessage(),
            ]);
            return 0;
        }
    }

    /**
     * Undo what applyExtension() added — used when an approved unpaid leave is
     * cancelled. Without this the exit date would drift further out on every
     * approve/cancel cycle.
     */
    public static function revertExtension(LeaveRequest $leave, ?Employee $employee): int
    {
        try {
            $days = (int) ($leave->notice_extension_days ?? 0);
            if ($days <= 0) {
                return 0;
            }
            // Reverting must NOT go through activeExit(): pulling the last
            // working day back can move it before today, at which point the
            // employee no longer reads as "on notice" and the row would stop
            // resolving. Address the case directly instead.
            $exit = $employee
                ? EmployeeExit::where('employee_id', $employee->id)->orderByDesc('id')->first()
                : null;
            if ($exit && $exit->last_working_day) {
                $exit->last_working_day = Carbon::parse($exit->last_working_day)->subDays($days)->toDateString();
                $exit->save();
            }
            $leave->notice_extension_days = null;
            $leave->save();

            return $days;
        } catch (\Throwable $e) {
            Log::warning('Notice-period last-working-day revert failed', [
                'leave_request_id' => $leave->id,
                'error'            => $e->getMessage(),
            ]);
            return 0;
        }
    }
}
