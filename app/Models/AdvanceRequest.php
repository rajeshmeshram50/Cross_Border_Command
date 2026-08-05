<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Recoverable salary / travel / medical advance — mirrors ExpenseClaim
 * with advance-specific form fields and the same two-stage approval
 * surface (manager_status + hr_status).
 */
class AdvanceRequest extends Model
{
    protected $table = 'advance_requests';

    protected $fillable = [
        'client_id', 'branch_id', 'advance_no',
        'employee_id', 'manager_id',
        'advance_type', 'advance_type_other',
        'amount', 'used_for', 'requested_date', 'recovery_start', 'expected_use_date',
        'recovery_mode', 'recovery_months', 'monthly_emi',
        'reason', 'attachments',
        'status', 'manager_status', 'manager_acted_at', 'manager_comment',
        'hr_status', 'hr_user_id', 'hr_acted_at', 'hr_comment',
        'created_by',
        // Settlement (post-approval payout) — mirrors ExpenseClaim.
        'sanctioned_amount', 'deduction_amount', 'deduction_reason', 'deductions',
        'additions', 'addition_amount',
        'total_paid', 'settlement_status', 'settled_at',
        'employee_settled_at', 'employee_settle_note',
        'settle_actual_amount', 'settle_type', 'settle_balance',
        'settle_proof_path', 'settle_proof_name', 'settle_items',
        'settle_declared_type', 'settle_target_amount',
        'settle_reimbursement_claim_id', 'settle_reimbursed_at',
        'settle_returned_at', 'settle_return_method', 'settle_return_proof_path', 'settle_return_proof_name',
        'settle_return_payments',
        'settle_return_recovery_start', 'settle_return_recovery_mode', 'settle_return_recovery_months',
        'settle_return_monthly', 'settle_return_scheduled_at',
    ];

    protected $casts = [
        'amount'           => 'decimal:2',
        'monthly_emi'      => 'decimal:2',
        'requested_date'   => 'date',
        'recovery_start'   => 'date',
        'expected_use_date'=> 'date',
        'manager_acted_at' => 'datetime',
        'hr_acted_at'      => 'datetime',
        'attachments'      => 'array',
        'recovery_months'  => 'integer',
        // Settlement
        'sanctioned_amount' => 'decimal:2',
        'deduction_amount'  => 'decimal:2',
        'deductions'        => 'array',
        'additions'         => 'array',
        'addition_amount'   => 'decimal:2',
        'total_paid'        => 'decimal:2',
        'settled_at'        => 'datetime',
        'employee_settled_at' => 'datetime',
        'settle_actual_amount' => 'decimal:2',
        'settle_balance'       => 'decimal:2',
        'settle_items'         => 'array',
        'settle_target_amount' => 'decimal:2',
        'settle_reimbursed_at' => 'datetime',
        'settle_returned_at'   => 'datetime',
        'settle_return_payments' => 'array',
        'settle_return_recovery_start'  => 'date',
        'settle_return_recovery_months' => 'integer',
        'settle_return_monthly'         => 'decimal:2',
        'settle_return_scheduled_at'    => 'datetime',
    ];

    public function payments(): HasMany
    {
        return $this->hasMany(AdvanceRequestPayment::class)->orderBy('id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'employee_id');
    }

    public function manager(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'manager_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function hrUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'hr_user_id');
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
