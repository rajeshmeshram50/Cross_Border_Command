<?php

namespace App\Models;

use App\Models\Masters\LeavePlans;
use App\Models\Masters\LeaveTypes;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LeaveRequest extends Model
{
    protected $table = 'leave_requests';

    protected $fillable = [
        'client_id',
        'branch_id',
        'employee_id',
        'leave_type_id',
        'leave_plan_id',
        'from_date',
        'to_date',
        'days',
        'day_type',
        'reason',
        'attachment_path',
        'notify',
        'handover_required',
        'cover_person_id',
        'handover_notes',
        'critical_tasks',
        'avail_on_call',
        'emergency_number',
        'avail_note',
        'status',
        'approved_by',
        'approved_at',
        'approver_comment',
        'approval_chain',
        'current_approval_level',
        'created_by',
    ];

    protected $casts = [
        'from_date' => 'date',
        'to_date' => 'date',
        'days' => 'decimal:2',
        'notify' => 'array',
        'handover_required' => 'boolean',
        'avail_on_call' => 'boolean',
        'approved_at' => 'datetime',
        'approval_chain' => 'array',
        'current_approval_level' => 'integer',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function leaveType(): BelongsTo
    {
        return $this->belongsTo(LeaveTypes::class, 'leave_type_id');
    }

    public function leavePlan(): BelongsTo
    {
        return $this->belongsTo(LeavePlans::class, 'leave_plan_id');
    }

    public function coverPerson(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'cover_person_id');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
