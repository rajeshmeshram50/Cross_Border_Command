<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One settlement installment against an approved expense claim. A claim can be
 * paid in parts (partial payments) until its sanctioned amount is met — each
 * "Record Payment" adds a row here.
 */
class ExpenseClaimPayment extends Model
{
    use SoftDeletes;

    protected $table = 'expense_claim_payments';

    protected $fillable = [
        'client_id', 'branch_id', 'expense_claim_id',
        'amount', 'category_id', 'category_name',
        'payment_type', 'expense_type', 'note',
        'proof_path', 'proof_name',
        'zoho_status', 'zoho_synced_at', 'zoho_expense_id',
        'paid_by', 'paid_at',
    ];

    protected $casts = [
        'amount'         => 'decimal:2',
        'paid_at'        => 'datetime',
        'zoho_synced_at' => 'datetime',
    ];

    public function claim(): BelongsTo
    {
        return $this->belongsTo(ExpenseClaim::class, 'expense_claim_id');
    }

    public function payer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'paid_by');
    }

    /**
     * Live link to the expense-category master so the category name is always
     * read fresh from `category_id` — the stored `category_name` is kept only as
     * a fallback for a since-deleted category, never preferred on read.
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(\App\Models\Masters\ExpenseCategories::class, 'category_id');
    }
}
