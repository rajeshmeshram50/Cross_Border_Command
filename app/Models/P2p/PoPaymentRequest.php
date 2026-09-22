<?php

namespace App\Models\P2p;

use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One payment request raised on a PO — a row of the Payment Requests History.
 * Tenant-scoped through BelongsToTenant (client + branch from the request).
 */
class PoPaymentRequest extends Model
{
    use BelongsToTenant;

    public const STATUS_PENDING  = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';

    public const PAYMENT_TYPES = ['Advance Payment', 'Partial Payment', 'Final Payment', 'Balance Payment'];

    protected $table = 'p2p_po_payment_requests';

    protected $fillable = [
        'client_id', 'branch_id', 'purchase_order_id',
        'code', 'payment_type', 'percentage', 'requested_amount', 'reason',
        'requested_by', 'requested_to', 'requested_at',
        'status', 'approved_amount', 'decision_note', 'decided_at', 'paid_amount',
    ];

    protected $casts = [
        'percentage'       => 'decimal:2',
        'requested_amount' => 'decimal:2',
        'approved_amount'  => 'decimal:2',
        'paid_amount'      => 'decimal:2',
        'requested_at'     => 'datetime',
        'decided_at'       => 'datetime',
    ];

    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id'); }
    public function requester(): BelongsTo     { return $this->belongsTo(User::class, 'requested_by'); }
    public function approver(): BelongsTo      { return $this->belongsTo(User::class, 'requested_to'); }
    public function payments(): HasMany        { return $this->hasMany(PoPayment::class, 'payment_request_id'); }
}
