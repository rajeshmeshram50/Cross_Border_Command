<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One execution of the payroll engine against a period. The status ladder
 * (draft → generated → approved → paid) is the locking mechanism (Rule 14/15).
 */
class PayrollRun extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'payroll_period_id',
        'status',
        'total_employees', 'employees_on_hold',
        'total_gross', 'total_deductions', 'total_net',
        'generated_by', 'generated_at',
        'approved_by', 'approved_at',
        'paid_by', 'paid_at',
        'notes', 'created_by',
    ];

    protected $casts = [
        'total_employees'   => 'integer',
        'employees_on_hold' => 'integer',
        'total_gross'       => 'decimal:2',
        'total_deductions'  => 'decimal:2',
        'total_net'         => 'decimal:2',
        'generated_at'      => 'datetime',
        'approved_at'       => 'datetime',
        'paid_at'           => 'datetime',
    ];

    public function period(): BelongsTo
    {
        return $this->belongsTo(PayrollPeriod::class, 'payroll_period_id');
    }

    public function payslips(): HasMany
    {
        return $this->hasMany(Payslip::class);
    }

    /** A run can be (re)generated only while it's draft or generated. */
    public function isEditable(): bool
    {
        return in_array($this->status, ['draft', 'generated'], true);
    }

    public function isLocked(): bool
    {
        return in_array($this->status, ['approved', 'paid'], true);
    }
}
