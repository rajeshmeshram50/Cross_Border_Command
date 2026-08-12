<?php

namespace App\Support;

use App\Models\Employee;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;

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

    /**
     * The employee's onboarding signing status, measured against what was
     * actually SENT rather than against every template that matched them.
     *
     * The matched list is a menu: HR picks which agreements a given hire needs.
     * So four matching templates with two dispatched is a complete onboarding
     * once those two come back signed — the other two were a decision, not an
     * omission.
     *
     * A document counts as SENT once a signing run exists in any state other
     * than Cancelled, and as SIGNED once one of its runs reaches 'Completed'
     * (every signer in the workflow has acted).
     *
     * @return array{matched: int, sent: int, awaiting: array<int, string>}
     */
    public static function onboardingSigningStatus(Employee $employee): array
    {
        $templates = HrTemplateMatch::onboardingTemplatesFor($employee);
        if ($templates->isEmpty()) return ['matched' => 0, 'sent' => 0, 'awaiting' => []];

        $runs = DB::table('hr_document_signatures')
            ->where('employee_id', $employee->id)
            ->select('template_id', 'status')
            ->get();

        $sent   = array_flip($runs->where('status', '!=', 'Cancelled')->pluck('template_id')->filter()->unique()->all());
        $signed = array_flip($runs->where('status', '=', 'Completed')->pluck('template_id')->filter()->unique()->all());

        /* Template names are not unique — two "code of conduct" rows exist for
           different role types — so the code goes in the message or HR cannot
           tell which of the two the wizard is still waiting on. */
        $awaiting = $templates
            ->filter(fn ($t) => isset($sent[$t->id]) && !isset($signed[$t->id]))
            ->map(fn ($t) => trim((string) $t->code) !== ''
                ? sprintf('%s (%s)', $t->name, $t->code)
                : (string) $t->name)
            ->values()
            ->all();

        return [
            'matched'  => $templates->count(),
            'sent'     => $templates->filter(fn ($t) => isset($sent[$t->id]))->count(),
            'awaiting' => $awaiting,
        ];
    }

    /**
     * Refuse to stamp onboarding complete while an agreement HR sent is still
     * waiting on its signers.
     *
     * Only DISPATCHED agreements are checked. Sending nothing is a valid
     * outcome — HR decides which of the matching templates a given hire needs,
     * and "none of them" is one of the answers. There is deliberately no
     * "at least one must go out" rule.
     *
     * The wizard gates this in the UI, but the macro watermark is just an
     * integer on the employee PUT — anything that posts
     * onboarding_stage_completed = 6 lands here, and the wizard's own stage-5
     * gate had been commented out long enough for real rows to reach stage 6
     * mid-signature. This is the backstop that makes the rule hold whatever
     * the caller.
     */
    public static function assertDocumentsSigned(Employee $employee): void
    {
        ['sent' => $sent, 'awaiting' => $awaiting] = self::onboardingSigningStatus($employee);

        if (empty($awaiting)) return;

        $count = count($awaiting);
        throw new HttpResponseException(response()->json([
            'message' => "Onboarding can't be completed — {$count} of the {$sent} document"
                . ($sent > 1 ? 's' : '') . ' sent for signature '
                . ($count > 1 ? 'have' : 'has') . ' not come back signed: '
                . implode(', ', $awaiting) . '.',
            'errors'  => ['onboarding_stage_completed' => $awaiting],
        ], 422));
    }
}
