<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A payroll cycle. See the create_payroll_periods migration for the rules it
 * encodes (attendance finalization gate + period lock).
 */
class PayrollPeriod extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id',
        'month', 'year', 'label', 'period_start', 'period_end', 'working_days',
        'attendance_finalized', 'attendance_finalized_at', 'attendance_finalized_by',
        'status', 'locked_at', 'created_by',
    ];

    protected $casts = [
        'period_start'         => 'date',
        'period_end'           => 'date',
        'working_days'         => 'integer',
        'month'                => 'integer',
        'year'                 => 'integer',
        'attendance_finalized' => 'boolean',
        'attendance_finalized_at' => 'datetime',
        'locked_at'            => 'datetime',
    ];

    public function runs(): HasMany
    {
        return $this->hasMany(PayrollRun::class);
    }

    public function payslips(): HasMany
    {
        return $this->hasMany(Payslip::class);
    }

    /** The current (non-superseded) run for this period, if any. */
    public function activeRun()
    {
        return $this->runs()->latest('id')->first();
    }
}
