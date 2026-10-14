<?php

namespace App\Models\Inventory;

use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Inventory · everything that was done to a put-away, in the order it happened.
 *
 * The scan log knows about scans and nothing else, but a placement is final —
 * the shelf is locked and the location cannot be changed — and a record that
 * cannot be undone has to be able to say how it came about. A location
 * assigned, Change pressed, a task raised then cancelled, a manual
 * confirmation taken on somebody's word: none of those is a scan.
 *
 * APPEND ONLY. No updated_at, no soft delete, no update() anywhere. A log you
 * can edit answers nothing it is asked; corrections are new rows.
 */
class PutawayActivityLog extends Model
{
    use BelongsToTenant;

    protected $table = 'inventory_putaway_activity_logs';

    /** Only created_at exists — there is nothing to update. */
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
