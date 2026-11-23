<?php

namespace App\Models\P2p;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PoGstApproval extends Model
{
    public const STATUS_PENDING  = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';

    protected $table = 'p2p_po_gst_approvals';

    protected $fillable = [
        'purchase_order_id', 'supplier_invoice_id', 'requested_by', 'requested_to', 'request_note', 'requested_at',
        'status', 'reason', 'decided_at',
    ];

    protected $casts = ['requested_at' => 'datetime', 'decided_at' => 'datetime'];

    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id'); }
    public function supplierInvoice(): BelongsTo { return $this->belongsTo(SupplierInvoice::class, 'supplier_invoice_id'); }
    public function requester(): BelongsTo     { return $this->belongsTo(User::class, 'requested_by'); }
    public function approver(): BelongsTo      { return $this->belongsTo(User::class, 'requested_to'); }
}
