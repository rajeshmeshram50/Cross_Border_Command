<?php

namespace App\Events;

use App\Models\CtcContract;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Real-time signal that a Case-to-Case agreement's approval state changed
 * (submitted for approval, resubmitted, approved, rejected, clarification
 * raised / answered). Broadcast on a TENANT-scoped private channel so only
 * that client's approvers receive it — their approver / sent lists refetch
 * live instead of needing a manual page refresh.
 *
 * Implements ShouldBroadcast (QUEUED) rather than ShouldBroadcastNow: a
 * synchronous broadcast makes a blocking HTTP call to Reverb inside the
 * request, so an unreachable/slow broadcast server (cURL error 35 → :9000)
 * hung approve/reject/resubmit and surfaced as request failures. Queuing turns
 * broadcast() into a fast local DB-queue push; the worker (queue:listen /
 * queue:work, part of `composer dev`) delivers it out-of-band so a broadcast
 * outage can never stall or fail the user's action. If no worker runs, the SPA
 * still refetches on window focus (its dropped-socket safety net), so real-time
 * degrades gracefully instead of breaking the request.
 */
class CtcApprovalUpdated implements ShouldBroadcast
{
    use Dispatchable, SerializesModels;

    public int $clientId;
    public int $contractId;
    public string $status;

    public function __construct(CtcContract $contract)
    {
        $this->clientId   = (int) $contract->client_id;
        $this->contractId = (int) $contract->id;
        $this->status     = (string) ($contract->approval_status ?? '');
    }

    /** @return array<int, PrivateChannel> */
    public function broadcastOn(): array
    {
        return [new PrivateChannel("clm.approvals.{$this->clientId}")];
    }

    public function broadcastAs(): string
    {
        return 'approval.updated';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        // Tiny payload — the client just refetches the list on receipt.
        return ['contract_id' => $this->contractId, 'status' => $this->status];
    }
}
