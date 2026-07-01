<?php

namespace App\Notifications;

use App\Models\Employee;
use App\Models\LeaveRequest;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
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
 *   - escalated_to_hr       — sent to HR (branch_user / client_admin) when the
 *     requester's reporting manager is unavailable (on leave / disabled /
 *     unassigned) so the request doesn't deadlock — HR may act in their place
 */
class LeaveRequestNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public LeaveRequest $request,
        public string $kind,
        public ?string $extraComment = null,
    ) {
        // Defer queued sends until after the surrounding DB transaction
        // commits — otherwise a queue worker can race ahead and try to
        // load a leave_request that hasn't been written yet.
        $this->afterCommit();
    }

    public function via(object $notifiable): array
    {
        // 'database' powers the in-app bell-icon inbox; 'mail' goes
        // through SMTP. AnonymousNotifiable (employees with no User row)
        // only supports mail — Laravel skips the database channel for
        // those automatically.
        return ['mail', 'database'];
    }

    /**
     * Payload stored in the notifications table — drives the bell-icon
     * dropdown UI. Kept compact (no full leave_request) so the json
     * column doesn't bloat for tenants with thousands of notifications.
     */
    public function toArray(object $notifiable): array
    {
        $r = $this->request;
        $emp = $r->employee()->first();
        $type = $r->leaveType()->first();
        $employeeName = $emp
            ? trim($emp->display_name ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? '')))
            : null;
        return [
            'kind'           => $this->kind,
            'request_id'     => $r->id,
            'employee_id'    => $r->employee_id,
            'employee_name'  => $employeeName,
            'leave_type'     => $type?->name,
            'leave_type_id'  => $r->leave_type_id,
            'from_date'      => optional($r->from_date)->toDateString(),
            'to_date'        => optional($r->to_date)->toDateString(),
            'days'           => (float) $r->days,
            'status'         => $r->status,
            'comment'        => $this->extraComment,
            'action_url'     => $this->actionUrl(),
            'subject'        => $this->subjectFor($employeeName ?? 'An employee', $type?->name ?? 'Leave'),
        ];
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

            case 'escalated_to_hr':
                $mail->line("**{$employeeName}**'s reporting manager is currently unavailable (on approved leave or inactive), so this leave request needs **HR** to review it.")
                    ->line("**Leave type:** {$type}")
                    ->line("**Dates:** {$rangeLine} ({$dayLabel})")
                    ->when($reason, fn($m, $reason) => $m->line("**Reason:** " . $reason))
                    ->line('You can approve or reject it in the manager\'s place.')
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
            'escalated_to_hr'       => "HR action needed: {$employeeName}'s manager is away — {$type} request",
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
            'submitted_to_approver', 'escalated_to_hr', 'cancelled' => '/hr/leave-approvals',
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
