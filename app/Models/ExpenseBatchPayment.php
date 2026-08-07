<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A single consolidated payout settling several approved expense claims of one
 * employee at once (one UTR + one proof; one itemised Zoho expense).
 */
class ExpenseBatchPayment extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'employee_id',
        'reference_number', 'payment_type', 'total_amount', 'note',
        'proof_path', 'proof_name',
        'zoho_status', 'zoho_synced_at', 'zoho_expense_id',
        'paid_by',
    ];

    protected $casts = [
        'total_amount'   => 'decimal:2',
        'zoho_synced_at' => 'datetime',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'employee_id');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(ExpenseClaimPayment::class, 'batch_payment_id');
    }
}
