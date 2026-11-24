<?php

namespace App\Notifications;

use App\Models\P2p\SourcingTarget;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

class SourcingTargetAssignedNotification extends Notification
{
    use Queueable;

    public function __construct(public SourcingTarget $target)
    {
        $this->afterCommit();
    }

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        $t = $this->target;
        $count = $t->products()->count();
        $items = $count === 1 ? '1 product' : "{$count} products";

        return [
            'kind'        => 'sourcing_target_assigned',
            'target_id'   => $t->id,
            'code'        => $t->code,
            'due_date'    => optional($t->due_date)->toDateString(),
            'assigned_by' => $t->created_by_name,
            'subject'     => "Sourcing target {$t->code} assigned to you",
            'message'     => "{$items} to source" . ($t->created_by_name ? " · assigned by {$t->created_by_name}" : ''),
            'action_url'  => '/p2p/sourcing-tracker',
        ];
    }
}
