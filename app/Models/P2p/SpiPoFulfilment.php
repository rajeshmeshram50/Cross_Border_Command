<?php

namespace App\Models\P2p;

use App\Models\Concerns\BelongsToTenant;
use App\Models\Product;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Append-only ledger of what each SPI has invoiced against a PO line.
 *
 * One PO line can be invoiced by many SPIs. Editing an old SPI APPENDS a
 * correction (change_qty -5) rather than rewriting the rows after it, so
 * nothing ever needs replaying and every row keeps what was true when written.
 *
 * AUDIT ONLY. Open quantity is computed from the live items —
 * poi.quantity - SUM(sii.qty_spi) — exactly as PurchaseOrderController already
 * computes what a PI line has committed, with p2p_po_item_qty_histories
 * sitting beside it purely for history. Two sources for one number is how they
 * drift; this one is never the source.
 */
class SpiPoFulfilment extends Model
{
    use BelongsToTenant;

    protected $table = 'p2p_spi_po_fulfilments';

    /** Append-only: created_at only, so Eloquent must not write updated_at. */
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

    /** Gave quantity back to the PO rather than consuming it. */
    public function isCredit(): bool
    {
        return (float) $this->change_qty < 0;
    }
}
