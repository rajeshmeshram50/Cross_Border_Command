<?php

namespace App\Models\Inventory;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LocationLock extends Model
{
    use BelongsToTenant;

    protected $table = 'inventory_location_locks';

    public const ZONE  = 'zone';
    public const RACK  = 'rack';
    public const SHELF = 'shelf';
    public const TYPES = [self::ZONE, self::RACK, self::SHELF];

    public const REASON_PUTAWAY     = 'putaway';
    public const REASON_STOCKTAKE   = 'stocktake';
    public const REASON_MAINTENANCE = 'maintenance';

    public const RELEASED_COMPLETED = 'completed';
    public const RELEASED_CANCELLED = 'cancelled';
    public const RELEASED_REASSIGNED = 'reassigned';
    public const RELEASED_EXPIRED   = 'expired';
    public const RELEASED_FORCED    = 'force_released';

    protected $fillable = [
        'client_id', 'branch_id',
        'location_type', 'location_id', 'warehouse_id',
        'held_by', 'held_for_type', 'held_for_id', 'session_id', 'reason',
        'acquired_at', 'last_heartbeat_at', 'expires_at',
        'released_at', 'released_reason',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'acquired_at'       => 'datetime',
        'last_heartbeat_at' => 'datetime',
        'expires_at'        => 'datetime',
        'released_at'       => 'datetime',
    ];

    public function client(): BelongsTo    { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo    { return $this->belongsTo(Branch::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class, 'warehouse_id'); }
    public function heldBy(): BelongsTo    { return $this->belongsTo(User::class, 'held_by'); }

    public function scopeLive(Builder $q): Builder
    {
        return $q->whereNull('released_at');
    }

    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }
}
