<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One recorded payment against a Direct SPI (see the spi_payments migration).
 * SPI-scoped: the amount subtracts from the SPI's net-payable balance.
 */
class SpiPayment extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'supplier_purchase_invoice_id',
        'amount', 'bank_name', 'utr_cheque_number', 'utr_cheque_date',
        'attachment_path', 'balance_after', 'status', 'created_by', 'zoho_payment_id', 'zoho_applied_amount',
    ];

    protected $casts = [
        'utr_cheque_date' => 'date',
        'amount' => 'decimal:2',
        'balance_after' => 'decimal:2',
    ];

    protected $appends = ['attachment_url'];

    public function supplierPurchaseInvoice(): BelongsTo { return $this->belongsTo(SupplierPurchaseInvoice::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    /** Resolved public URL for the proof-of-payment attachment. */
    public function getAttachmentUrlAttribute(): ?string
    {
        $p = $this->attachment_path;
        return $p ? file_url($p) : null;
    }
}
