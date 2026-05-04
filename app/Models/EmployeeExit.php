<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One Stage-1 exit record per employee. The 6-stage exit wizard reads
 * + writes this row; later stages may add a child table for clearance
 * line items, asset returns, etc. Eager-load `manager` to render the
 * Reporting Manager pill without a second round-trip.
 */
class EmployeeExit extends Model
{
    protected $fillable = [
        'employee_id', 'client_id', 'branch_id',
        'exit_type', 'initiated_by', 'reason_for_exit', 'other_reason',
        'notice_date', 'last_working_day',
        'reporting_manager_id', 'comments',
        'business_impact', 'replacement_required',
        'created_by',
    ];

    protected $casts = [
        'notice_date'      => 'date',
        'last_working_day' => 'date',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function manager(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'reporting_manager_id');
    }
}
