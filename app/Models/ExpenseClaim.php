<?php

namespace App\Models;

use App\Models\Masters\ExpenseCategories;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ExpenseClaim extends Model
{
    protected $table = 'expense_claims';

    protected $fillable = [
        'client_id', 'branch_id', 'claim_no',
        'employee_id', 'manager_id',
        'category_id', 'category_name',
        'currency', 'project', 'payment_method',
        'title', 'amount', 'expense_date', 'vendor', 'purpose',
        'attachments',
        'status', 'manager_status', 'manager_acted_at', 'manager_comment',
        'hr_status', 'hr_user_id', 'hr_acted_at', 'hr_comment',
        'created_by',
    ];

    protected $casts = [
        'amount'           => 'decimal:2',
        'expense_date'     => 'date',
        'manager_acted_at' => 'datetime',
        'hr_acted_at'      => 'datetime',
        'attachments'      => 'array',
    ];

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
