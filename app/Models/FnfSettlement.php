<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Rule 21 — a saved Full & Final settlement.
 *
 * Like Payslip, this is a snapshot: `breakdown` holds the figures as computed
 * at save time and is never recomputed on read, so a settlement that has been
 * approved or paid stays exactly as it was agreed.
 */
class FnfSettlement extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'employee_id', 'employee_exit_id',
        'employee_code', 'employee_name', 'last_working_day', 'exit_type',
        'inputs', 'breakdown',
        'total_earnings', 'total_deductions', 'net_settlement',
        'status', 'notes',
        'created_by', 'approved_by', 'approved_at', 'paid_by', 'paid_at',
    ];

    protected $casts = [
        'inputs'           => 'array',
        'breakdown'        => 'array',
        'last_working_day' => 'date',
        'total_earnings'   => 'decimal:2',
        'total_deductions' => 'decimal:2',
        'net_settlement'   => 'decimal:2',
        'approved_at'      => 'datetime',
        'paid_at'          => 'datetime',
    ];

    /** Only a draft may be recomputed or edited. */
    public function isEditable(): bool
    {
        return $this->status === 'draft';
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
