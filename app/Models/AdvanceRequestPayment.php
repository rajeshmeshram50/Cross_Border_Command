<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One settlement installment against an approved advance request. An advance can
 * be paid in parts (partial payments) until its sanctioned amount is met — each
 * "Record Payment" adds a row here. Mirrors ExpenseClaimPayment.
 */
class AdvanceRequestPayment extends Model
{
    use SoftDeletes;

    protected $table = 'advance_request_payments';

    protected $fillable = [
        'client_id', 'branch_id', 'advance_request_id',
        'amount', 'payment_type', 'note',
        'proof_path', 'proof_name',
        'paid_by', 'paid_at',
    ];

    protected $casts = [
        'amount'  => 'decimal:2',
        'paid_at' => 'datetime',
    ];

    public function advance(): BelongsTo
    {
        return $this->belongsTo(AdvanceRequest::class, 'advance_request_id');
    }

    public function payer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'paid_by');
    }
}
