<?php

namespace App\Models\Inventory;

use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PutawayActivityLog extends Model
{
    use BelongsToTenant;

    protected $table = 'inventory_putaway_activity_logs';

    public const UPDATED_AT = null;

    public const ASSIGNED          = 'assigned';
    public const REASSIGNED        = 'reassigned';
    public const TASK_CREATED      = 'task_created';
    public const TASK_CANCELLED    = 'task_cancelled';
    public const SCAN_PASSED       = 'scan_passed';
    public const SCAN_FAILED       = 'scan_failed';
    public const CONFIRMED_MANUAL  = 'confirmed_manual';
    public const CONFIRMED_DEVICE  = 'confirmed_device';
    public const RELEASED          = 'released';
    public const LOCK_ACQUIRED     = 'lock_acquired';
    public const LOCK_RELEASED     = 'lock_released';

    protected $fillable = [
        'client_id', 'branch_id',
        'subject_type', 'subject_id',
        'occupancy_id', 'putaway_id', 'task_id', 'box_id',
        'event', 'from_location', 'to_location',
        'actor_type', 'actor_id', 'device_id', 'meta',
        'created_by', 'created_at',
    ];

    protected $casts = [
        'from_location' => 'array',
        'to_location'   => 'array',
        'meta'          => 'array',
        'created_at'    => 'datetime',
    ];

    public function actor(): BelongsTo { return $this->belongsTo(User::class, 'actor_id'); }
}
