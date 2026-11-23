<?php

namespace App\Events;

use App\Models\CtcContract;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

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

    public function broadcastOn(): array
    {
        return [new PrivateChannel("clm.approvals.{$this->clientId}")];
    }

    public function broadcastAs(): string
    {
        return 'approval.updated';
    }

    public function broadcastWith(): array
    {
        return ['contract_id' => $this->contractId, 'status' => $this->status];
    }
}
