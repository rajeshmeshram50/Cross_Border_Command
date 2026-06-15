<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One row per lead ownership event — see the
 * lead_assignment_histories migration for the column rationale.
 */
class LeadAssignmentHistory extends Model
{
    protected $table = 'lead_assignment_histories';

    public $timestamps = false; // created_at only, stamped explicitly

    public const ACTION_GENERATED  = 'generated';
    public const ACTION_ASSIGNED   = 'assigned';
    public const ACTION_REASSIGNED = 'reassigned';

    protected $fillable = [
        'client_id',
        'branch_id',
        'lead_id',
        'opp_code',
        'action',
        'assignee_user_id',
        'assignee_name',
        'previous_user_id',
        'previous_name',
        'assigned_by_user_id',
        'assigned_by_name',
        'platform',
        'source',
        'description',
        'created_at',
    ];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }

    public function lead(): BelongsTo
    {
        return $this->belongsTo(Lead::class);
    }

    public function assignedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_by_user_id');
    }
}
