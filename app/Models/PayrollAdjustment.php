<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An approved-gated payroll adjustment: overtime / bonus / incentive (added to
 * pay) or a one-off deduction. Only `approved` rows affect payroll (Rule 4/10).
 */
class PayrollAdjustment extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'employee_id',
        'month', 'year',
        'type', 'label', 'amount', 'hours', 'rate',
        'status', 'approved_by', 'approved_at', 'reason',
        'created_by',
    ];

    protected $casts = [
        'month'       => 'integer',
        'year'        => 'integer',
        'amount'      => 'decimal:2',
        'hours'       => 'decimal:2',
        'rate'        => 'decimal:2',
        'approved_at' => 'datetime',
    ];

    public const TYPES = ['overtime', 'bonus', 'incentive', 'deduction'];
    public const EARNING_TYPES = ['overtime', 'bonus', 'incentive'];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
