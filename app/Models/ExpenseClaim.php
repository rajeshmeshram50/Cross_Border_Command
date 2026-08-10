<?php

namespace App\Models;

use App\Models\Masters\ExpenseCategories;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class ExpenseClaim extends Model
{
    protected $table = 'expense_claims';

    protected $fillable = [
        'client_id', 'branch_id', 'claim_no',
        'employee_id', 'employee_name', 'manager_id',
        'category_id', 'category_name',
        'currency', 'project', 'payment_method',
        'title', 'amount', 'expense_date', 'vendor', 'purpose',
        'attachments',
        'status', 'manager_status', 'manager_acted_at', 'manager_acted_by', 'manager_comment',
        'hr_status', 'hr_user_id', 'hr_acted_at', 'hr_comment',
        'created_by',
        // Settlement (post-approval payment)
        'sanctioned_amount', 'deduction_amount', 'deduction_reason', 'deductions',
        'additions', 'addition_amount',
        'total_paid', 'settlement_status', 'settled_at', 'reimbursement_emailed_at',
    ];

    protected $casts = [
        'amount'           => 'decimal:2',
        'expense_date'     => 'date',
        'manager_acted_at' => 'datetime',
        'hr_acted_at'      => 'datetime',
        'attachments'      => 'array',
        'sanctioned_amount' => 'decimal:2',
        'deduction_amount'  => 'decimal:2',
        'deductions'        => 'array',
        'additions'         => 'array',
        'addition_amount'   => 'decimal:2',
        'total_paid'        => 'decimal:2',
        'settled_at'        => 'datetime',
        'reimbursement_emailed_at' => 'datetime',
    ];

    public function payments(): HasMany
    {
        return $this->hasMany(ExpenseClaimPayment::class)->orderBy('id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'employee_id');
    }

    public function manager(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'manager_id');
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(ExpenseCategories::class, 'category_id');
    }

    /** The company advance this claim reimburses, if any (reverse of
     *  advance_requests.settle_reimbursement_claim_id). */
    public function reimbursedAdvance(): HasOne
    {
        return $this->hasOne(AdvanceRequest::class, 'settle_reimbursement_claim_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function hrUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'hr_user_id');
    }

    /** The user who acted at the reporting-manager stage (any logged-in
     *  approver — assigned manager, branch admin, etc.). */
    public function managerActor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'manager_acted_by');
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
