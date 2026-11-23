<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayrollPayment extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'payroll_run_id', 'payroll_period_id',
        'mode', 'status', 'employee_count', 'total_amount',
        'company_name', 'bank_name',
        'prepared_by_name', 'verified_by_name', 'approved_by_name', 'approved_at',
        'run_by_employee_id',
        'batch_ref', 'paid_at', 'created_by',
    ];

    protected $casts = [
        'employee_count' => 'integer',
        'total_amount'   => 'decimal:2',
        'approved_at'    => 'datetime',
        'paid_at'        => 'datetime',
    ];

    public function run(): BelongsTo
    {
        return $this->belongsTo(PayrollRun::class, 'payroll_run_id');
    }
}
