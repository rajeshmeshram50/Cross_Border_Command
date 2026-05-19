<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Sales Matrix → Productivity Tracker meeting row.
 *
 * Lifecycle:
 *   In Progress (default on create) → Done / Postponed / Cancelled
 *
 * Two types:
 *   virtual   — link populated, venue null (Zoom / Google Meet / Teams / …)
 *   physical  — venue populated, link null (Office Visit / Client Site / Trade Fair)
 *
 * Code is auto-numbered per (client_id, branch_id):
 *   virtual  → M-001, M-002, …
 *   physical → P-001, P-002, …
 *
 * Allocation lives in SalesTodoController so the same atomic next-code
 * logic can be reused on store + restore. The composite unique index on
 * (client_id, branch_id, code) protects against race conditions when two
 * requests try to allocate the same code simultaneously.
 */
class SalesMeeting extends Model
{
    use SoftDeletes;

    protected $table = 'sales_meetings';

    public const TYPE_VIRTUAL  = 'virtual';
    public const TYPE_PHYSICAL = 'physical';
    public const TYPES         = [self::TYPE_VIRTUAL, self::TYPE_PHYSICAL];

    public const STATUS_IN_PROGRESS = 'In Progress';
    public const STATUS_DONE        = 'Done';
    public const STATUS_POSTPONED   = 'Postponed';
    public const STATUS_CANCELLED   = 'Cancelled';
    public const STATUSES           = [
        self::STATUS_IN_PROGRESS,
        self::STATUS_DONE,
        self::STATUS_POSTPONED,
        self::STATUS_CANCELLED,
    ];

    protected $fillable = [
        'client_id', 'branch_id',
        'created_by_user_id', 'employee_id',
        'code',
        'opp_id', 'customer', 'email', 'contact',
        'platform',
        'date', 'start_time', 'end_time',
        'link', 'venue', 'agenda',
        'status', 'type',
    ];

    protected $casts = [
        'date' => 'date',
    ];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
