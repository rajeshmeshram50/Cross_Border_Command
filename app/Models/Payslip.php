<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Self-contained snapshot of one employee's pay for one run. Reproducible by
 * design — nothing here is recomputed from live employee data on read.
 */
class Payslip extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'payroll_run_id', 'payroll_period_id', 'employee_id',
        'employee_code', 'employee_name', 'department', 'designation', 'employee_type',
        'working_days', 'present_days', 'paid_days', 'lop_days', 'late_lop_days',
        'paid_leave_days', 'unpaid_leave_days', 'late_marks', 'missing_punches',
        'overtime_hours', 'att_source',
        'earnings', 'deductions',
        'gross_earnings', 'basic', 'overtime_amount', 'bonus_amount',
        'pf_employee', 'esi', 'pt', 'tds', 'lop_amount',
        'advance_recovery', 'loan_recovery', 'other_deductions', 'total_deductions',
        'net_pay',
        'status', 'hold_reason', 'exceptions',
        'bank_account_number', 'ifsc_code', 'bank_verified',
        'created_by',
    ];

    protected $casts = [
        'earnings'          => 'array',
        'deductions'        => 'array',
        'exceptions'        => 'array',
        'working_days'      => 'decimal:2',
        'present_days'      => 'decimal:2',
        'paid_days'         => 'decimal:2',
        'lop_days'          => 'decimal:2',
        'late_lop_days'     => 'decimal:2',
        'paid_leave_days'   => 'decimal:2',
        'unpaid_leave_days' => 'decimal:2',
        'overtime_hours'    => 'decimal:2',
        'gross_earnings'    => 'decimal:2',
        'basic'             => 'decimal:2',
        'overtime_amount'   => 'decimal:2',
        'bonus_amount'      => 'decimal:2',
        'pf_employee'       => 'decimal:2',
        'esi'               => 'decimal:2',
        'pt'                => 'decimal:2',
        'tds'               => 'decimal:2',
        'lop_amount'        => 'decimal:2',
        'advance_recovery'  => 'decimal:2',
        'loan_recovery'     => 'decimal:2',
        'other_deductions'  => 'decimal:2',
        'total_deductions'  => 'decimal:2',
        'net_pay'           => 'decimal:2',
        'bank_verified'     => 'boolean',
        'late_marks'        => 'integer',
        'missing_punches'   => 'integer',
    ];

    public function run(): BelongsTo
    {
        return $this->belongsTo(PayrollRun::class, 'payroll_run_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function period(): BelongsTo
    {
        return $this->belongsTo(PayrollPeriod::class, 'payroll_period_id');
    }
}
