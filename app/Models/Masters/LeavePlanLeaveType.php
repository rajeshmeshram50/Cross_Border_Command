<?php

namespace App\Models\Masters;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
