<?php

namespace App\Support;

use App\Models\Employee;
use Illuminate\Http\Exceptions\HttpResponseException;

/**
 * Blocks self-service HR submissions until the employee is fully onboarded.
 *
 * An employee whose onboarding is still in flight has no settled org context —
 * no leave plan assigned, no approval chain snapshotted, often no department or
 * reporting manager. Records raised in that state are unroutable, so the
 * submission is rejected outright rather than parked in a broken approval
 * queue.
 *
 * The SPA already locks a mid-onboarding employee to the Inbox
 * (`onboarding_pending` in AuthController::me → App.tsx), but /profile is an
 * allowed page and carries the Leave / Expense Claim / Advance Request forms —
 * which is how the gap was reachable (CBC #84, #85). This guard is the
 * server-side backstop: it holds for a direct API call too.
 *
 * "Complete" matches the definition used everywhere else in the codebase —
 * `onboarding_stage_completed >= 6` (see AttendanceController, EmployeeController,
 * AnnouncementController).
 */
class OnboardingGuard
{
    /** HR signs off six onboarding stages; the sixth is activation. */
    public const COMPLETE_STAGE = 6;

    public static function stage(?Employee $employee): int
    {
        return max(0, min(self::COMPLETE_STAGE, (int) ($employee->onboarding_stage_completed ?? 0)));
    }

    public static function isComplete(?Employee $employee): bool
    {
        if (!$employee) return false;
        return (int) ($employee->onboarding_stage_completed ?? 0) >= self::COMPLETE_STAGE;
    }

    /**
     * Reject with 422 unless the employee has finished onboarding.
     *
     * @param  string  $action  Verb phrase for the message, e.g. "raise a leave request".
     * @param  bool    $isSelf  Whether the target employee IS the caller — only
     *                          changes the wording (you vs. this employee).
     */
    public static function assertComplete(?Employee $employee, string $action, bool $isSelf = true): void
    {
        if (self::isComplete($employee)) return;

        $stage = self::stage($employee);
        $progress = "Onboarding is at stage {$stage} of " . self::COMPLETE_STAGE . '.';

        $message = $isSelf
            ? "You cannot {$action} until your onboarding is complete. {$progress} "
                . 'Your HR team finishes the remaining stages.'
            : "This employee cannot {$action} until their onboarding is complete. {$progress}";

        throw new HttpResponseException(response()->json([
            'message' => $message,
            'errors'  => ['onboarding' => ['Onboarding is not complete.']],
        ], 422));
    }
}
