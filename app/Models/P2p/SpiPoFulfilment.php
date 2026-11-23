<?php

namespace App\Models\P2p;

use App\Models\Concerns\BelongsToTenant;
use App\Models\Product;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SpiPoFulfilment extends Model
{
    use BelongsToTenant;

    protected $table = 'p2p_spi_po_fulfilments';

    public const UPDATED_AT = null;

    public const EVENT_INVOICED  = 'invoiced';
    public const EVENT_REVISED   = 'revised';
    public const EVENT_CANCELLED = 'cancelled';

    public const EVENTS = ['invoiced', 'revised', 'cancelled'];

    protected $fillable = [
        'client_id', 'branch_id',
        'purchase_order_id', 'purchase_order_item_id', 'product_id',
        'supplier_invoice_id', 'supplier_invoice_item_id',
        'event', 'po_qty', 'previous_qty', 'current_qty', 'change_qty', 'pending_after',
        'changed_by',
    ];

    protected $casts = [
        'po_qty'        => 'decimal:3',
        'previous_qty'  => 'decimal:3',
        'current_qty'   => 'decimal:3',
        'change_qty'    => 'decimal:3',
        'pending_after' => 'decimal:3',
    ];

    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id'); }
    public function poItem(): BelongsTo        { return $this->belongsTo(PurchaseOrderItem::class, 'purchase_order_item_id'); }
    public function invoice(): BelongsTo       { return $this->belongsTo(SupplierInvoice::class, 'supplier_invoice_id'); }
    public function invoiceItem(): BelongsTo   { return $this->belongsTo(SupplierInvoiceItem::class, 'supplier_invoice_item_id'); }
    public function product(): BelongsTo       { return $this->belongsTo(Product::class); }
    public function changedBy(): BelongsTo     { return $this->belongsTo(User::class, 'changed_by'); }

    public function isCredit(): bool
    {
        return (float) $this->change_qty < 0;
    }
}
