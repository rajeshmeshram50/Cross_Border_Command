<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LeadAckReason extends Model
{
    public const TYPE_QUALIFIED       = 'qualified';
    public const TYPE_DISQUALIFIED    = 'disqualified';
    public const TYPE_CLARITY_PENDING = 'clarity_pending';

    public const STATUS_ACTIVE   = 'active';
    public const STATUS_INACTIVE = 'inactive';

    public const DQ_POSITIVE = 'positive';
    public const DQ_NEGATIVE = 'negative';

    public const TYPES   = [self::TYPE_QUALIFIED, self::TYPE_DISQUALIFIED, self::TYPE_CLARITY_PENDING];
    public const STATUSES = [self::STATUS_ACTIVE, self::STATUS_INACTIVE];
    public const DQ_VALUES = [self::DQ_POSITIVE, self::DQ_NEGATIVE];

    protected $fillable = [
        'client_id',
        'opportunity_type',
        'reason',
        'status',
        'dq_status',
        'created_by',
        'updated_by',
    ];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
