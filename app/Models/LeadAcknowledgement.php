<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LeadAcknowledgement extends Model
{
    protected $fillable = [
        'client_id', 'lead_id', 'lead_ack_reason_id',
        'opportunity_type', 'dq_status', 'reason_snapshot',
        'created_by',
    ];

    public function lead(): BelongsTo
    {
        return $this->belongsTo(Lead::class);
    }

    public function reason(): BelongsTo
    {
        return $this->belongsTo(LeadAckReason::class, 'lead_ack_reason_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
