<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One notice-period recovery payment submitted by an exiting employee.
 *
 * Raised from the employee's own Payroll Details tab, verified and approved by
 * HR on the exit wizard's Notice Period Payment stage. Approving a row is what
 * settles the recovery — see ExitNoticePaymentController.
 */
class ExitNoticePayment extends Model
{
    use SoftDeletes;

    protected $table = 'exit_notice_payments';

    protected $fillable = [
        'client_id', 'branch_id', 'employee_id', 'employee_exit_id',
        'amount_due', 'amount', 'payment_mode', 'bank_name',
        'utr_cheque_number', 'payment_date',
        'attachment_path', 'attachment_name', 'employee_note',
        'status', 'verified_by', 'verified_at', 'verification_remarks',
        'created_by',
    ];

    protected $casts = [
        'amount_due'   => 'float',
        'amount'       => 'float',
        'payment_date' => 'date',
        'verified_at'  => 'datetime',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function exit(): BelongsTo
    {
        return $this->belongsTo(EmployeeExit::class, 'employee_exit_id');
    }

    public function verifier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by');
    }
}
