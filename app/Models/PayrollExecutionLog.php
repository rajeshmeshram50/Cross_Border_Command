<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PayrollExecutionLog extends Model
{
    protected $table = 'payroll_execution_logs';

    protected $fillable = [
        'client_id', 'branch_id',
        'payroll_run_id', 'payroll_period_id', 'month', 'year', 'period_label',
        'run_by_employee_id', 'run_by_employee_code', 'run_by_name',
        'executed_by_user_id', 'executed_by_user_name',
        'status', 'failure_reason', 'executed_at',
        'batch_ref', 'employees_paid', 'employees_held', 'total_amount',
    ];

    protected $casts = [
        'executed_at'    => 'datetime',
        'month'          => 'integer',
        'year'           => 'integer',
        'employees_paid' => 'integer',
        'employees_held' => 'integer',
        'total_amount'   => 'decimal:2',
    ];
}
