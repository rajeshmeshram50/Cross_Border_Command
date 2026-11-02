<?php

namespace App\Models\P2p;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One payment released against an approved payment request — a row of the Payment History.
 * Tenant-scoped through BelongsToTenant (client + branch from the request).
 */
class PoPayment extends Model
{
    use BelongsToTenant, SoftDeletes;

    protected $table = 'p2p_po_payments';

    protected $fillable = [
        'client_id', 'branch_id', 'purchase_order_id', 'payment_request_id',
        /* The invoice this payment belongs to. Set WITH a purchase_order_id when
           the payment was released from an invoice under an order, and set
           ALONE for a Direct SPI, which has no order. Missing from fillable, a
           Direct-SPI payment saved with neither parent: the ledger stayed at
           zero and the duplicate-UTR message had no document to name. */
        'supplier_invoice_id',
        'amount', 'bank_name', 'utr_cheque_number', 'utr_cheque_date', 'proof_path', 'proof_name',
        'zoho_payment_id', 'zoho_applied_amount', 'zoho_sync_status', 'zoho_synced_at', 'zoho_error',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'amount'          => 'decimal:2',
        'utr_cheque_date' => 'date',
        'zoho_applied_amount' => 'decimal:2',
        'zoho_synced_at'  => 'datetime',
    ];

    public function purchaseOrder(): BelongsTo  { return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id'); }
    public function paymentRequest(): BelongsTo { return $this->belongsTo(PoPaymentRequest::class, 'payment_request_id'); }
}
