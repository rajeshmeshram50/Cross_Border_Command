<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A single attendance-correction request raised by an employee for a past day.
 * Lifecycle (Pending → Approved/Rejected/Cancelled) and the snapshotted
 * approval_chain mirror LeaveRequest so the two flows stay consistent.
 */
class AttendanceRegularization extends Model
{
    protected $table = 'attendance_regularizations';

    protected $fillable = [
        'client_id',
        'branch_id',
        'employee_id',
        'attendance_id',
        'regularization_date',
        'mode',
        'type',
        'work_locations',
        'punches',
        // Snapshot of the day's punches as they stood BEFORE approval replaced
        // them — the "before" half of the correction's audit trail.
        'original_punches',
        'original_summary',
        'reason',
        'status',
        'approval_chain',
        'current_approval_level',
        'approved_by',
        'approved_at',
        'approver_comment',
        'created_by',
    ];

    protected $casts = [
        'regularization_date'    => 'date',
        'work_locations'         => 'array',
        'punches'                => 'array',
        'original_punches'       => 'array',
        'approval_chain'         => 'array',
        'current_approval_level' => 'integer',
        'approved_at'            => 'datetime',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function attendance(): BelongsTo
    {
        return $this->belongsTo(Attendance::class);
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
