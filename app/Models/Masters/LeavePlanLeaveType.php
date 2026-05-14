<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Pivot row carrying the per-(plan, type) Setup configuration. Lives
 * as a full Eloquent model (not just a withPivot bag) so we can hydrate
 * it directly when persisting the 6-tab Setup popup payload.
 */
class LeavePlanLeaveType extends Model
{
    protected $table = 'leave_plan_leave_types';

    protected $fillable = [
        'leave_plan_id',
        'leave_type_id',
        'config_json',
        'quota_summary',
        'eoy_summary',
        'is_setup',
    ];

    protected $casts = [
        'config_json' => 'array',
        'is_setup' => 'boolean',
    ];

    public function leavePlan(): BelongsTo
    {
        return $this->belongsTo(LeavePlans::class, 'leave_plan_id');
    }

    public function leaveType(): BelongsTo
    {
        return $this->belongsTo(LeaveTypes::class, 'leave_type_id');
    }
}
