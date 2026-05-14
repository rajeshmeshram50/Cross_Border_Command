<?php

namespace App\Notifications;

use App\Models\Employee;
use App\Models\LeaveRequest;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Single notification class that handles every leave-request transition.
 * The `kind` argument routes to the right subject/body template so we
 * don't end up with 5 nearly-identical classes.
 *
 * Channels: mail + database (so a future bell-icon inbox can read from
 * notifications table without re-implementing the templates).
 *
 * Kinds:
 *   - submitted_to_approver — sent to the current-level approver when a
 *     request is created OR advances to a new level
 *   - cc_submitted          — sent to colleagues in notify.employee_ids
 *     when the request is filed
 *   - approved              — sent to the requester after the FINAL
 *     level approves
 *   - rejected              — sent to the requester when any level rejects
 *   - cancelled             — sent to the current-level approver (so they
 *     can drop the item from their queue)
 */
class LeaveRequestNotification extends Notification
{
    use Queueable;

    public function __construct(
        public LeaveRequest $request,
        public string $kind,
        public ?string $extraComment = null,
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $r = $this->request->fresh(['leaveType', 'employee']);
        $type = $r?->leaveType?->name ?? 'Leave';
        $employee = $r?->employee;
        $employeeName = $employee
            ? trim($employee->display_name ?: trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')))
            : 'An employee';
        $from = optional($r?->from_date)->format('d M Y');
        $to   = optional($r?->to_date)->format('d M Y');
        $days = (float) ($r?->days ?? 0);
        $dayLabel = $days == 1 ? '1 day' : ($days . ' days');
        $reason = $r?->reason;
        $rangeLine = $from === $to ? $from : "{$from} – {$to}";

        $mail = (new MailMessage())
            ->subject($this->subjectFor($employeeName, $type))
            ->greeting('Hello,');

        switch ($this->kind) {
            case 'submitted_to_approver':
                $mail->line("**{$employeeName}** has submitted a leave request that needs your review.")
                    ->line("**Leave type:** {$type}")
                    ->line("**Dates:** {$rangeLine} ({$dayLabel})")
                    ->when($reason, fn($m, $reason) => $m->line("**Reason:** " . $reason))
                    ->action('Review Request', $this->actionUrl());
                break;

            case 'cc_submitted':
                $mail->line("**{$employeeName}** has applied for leave and added you as a colleague to notify.")
                    ->line("**Leave type:** {$type}")
                    ->line("**Dates:** {$rangeLine} ({$dayLabel})")
                    ->when($reason, fn($m, $reason) => $m->line("**Note from {$employeeName}:** " . $reason))
                    ->line('No action is required from you — this is informational.');
                break;

            case 'approved':
                $mail->line("Your leave request has been **approved**.")
                    ->line("**Leave type:** {$type}")
                    ->line("**Dates:** {$rangeLine} ({$dayLabel})")
                    ->when($this->extraComment, fn($m, $c) => $m->line("**Approver comment:** " . $c))
                    ->action('View Details', $this->actionUrl());
                break;

            case 'rejected':
                $mail->line("Your leave request was **rejected**.")
                    ->line("**Leave type:** {$type}")
                    ->line("**Dates:** {$rangeLine} ({$dayLabel})")
                    ->when($this->extraComment, fn($m, $c) => $m->line("**Reason:** " . $c))
                    ->line('Please reach out to your manager for clarification.');
                break;

            case 'cancelled':
                $mail->line("**{$employeeName}** has cancelled their leave request.")
                    ->line("**Leave type:** {$type}")
                    ->line("**Dates:** {$rangeLine} ({$dayLabel})")
                    ->line('You can remove this item from your approval queue.');
                break;

            default:
                $mail->line("Leave request update for {$employeeName}.")
                    ->line("**Leave type:** {$type}")
                    ->line("**Dates:** {$rangeLine} ({$dayLabel})");
        }

        return $mail
            ->salutation('— Cross Border Command');
    }

    private function subjectFor(string $employeeName, string $type): string
    {
        return match ($this->kind) {
            'submitted_to_approver' => "Action required: {$employeeName} requested {$type}",
            'cc_submitted'          => "FYI: {$employeeName} applied for {$type}",
            'approved'              => "Your {$type} request is approved",
            'rejected'              => "Your {$type} request was rejected",
            'cancelled'             => "{$employeeName} cancelled their leave request",
            default                 => "Leave request update — {$type}",
        };
    }

    /**
     * Deep link the recipient should follow. Currently a generic /hr/leave
     * destination — once we have stable per-request URLs we'll wire those.
     */
    private function actionUrl(): string
    {
        $base = rtrim(config('app.url') ?? '', '/');
        $path = match ($this->kind) {
            'submitted_to_approver', 'cancelled' => '/hr/leave-approvals',
            default                              => '/hr/leave',
        };
        return $base . $path;
    }

    /**
     * Resolve a Notifiable (a User) from an Employee record. The mailer
     * needs `routeNotificationForMail()` on the notifiable, which User
     * already provides. We return the User attached to an Employee, or
     * a synthetic notifiable that just carries the raw email when the
     * employee has no linked user account yet.
     */
    public static function notifiableFromEmployee(Employee $employee): mixed
    {
        if ($employee->user_id) {
            $user = \App\Models\User::find($employee->user_id);
            if ($user && $user->email) return $user;
        }
        if (!empty($employee->email)) {
            return new \Illuminate\Notifications\AnonymousNotifiable;
        }
        return null;
    }
}
