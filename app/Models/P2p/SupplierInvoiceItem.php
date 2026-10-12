<?php

namespace App\Models\P2p;

use App\Models\Product;
use App\Models\ProformaInvoiceItem;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Stage 02 · one SPI line and the 3-way match behind it: what the PI promised
 * (qty_pi), what the PO ordered (qty_po), what the supplier billed (qty_spi).
 * They differ, and that difference IS the match.
 *
 * No client_id of its own — always reached through its tenant-scoped invoice.
 */
class SupplierInvoiceItem extends Model
{
    use SoftDeletes;

    protected $table = 'p2p_supplier_invoice_items';

    protected $fillable = [
        'supplier_invoice_id', 'line_no',
        'pi_item_id', 'po_item_id', 'product_id',
        'description', 'hsn_code', 'uom',
        'qty_pi', 'qty_po', 'qty_spi', 'po_line_total',
        'extra_qty',
        'rate', 'taxable_amount',
        'gst_pct', 'cgst_amount', 'sgst_amount', 'igst_amount', 'line_total',
    ];

    protected $casts = [
        'line_no'        => 'integer',
        'qty_pi'         => 'decimal:3',
        'qty_po'         => 'decimal:3',
        'qty_spi'        => 'decimal:3',
        'extra_qty'      => 'decimal:3',
        'po_line_total'  => 'decimal:2',
        'rate'           => 'decimal:4',
        'taxable_amount' => 'decimal:2',
        'gst_pct'        => 'decimal:2',
        'cgst_amount'    => 'decimal:2',
        'sgst_amount'    => 'decimal:2',
        'igst_amount'    => 'decimal:2',
        'line_total'     => 'decimal:2',
    ];

    /**
     * Same-row arithmetic, so it rides along in every JSON response and the
     * frontend never recomputes it. NOT an aggregate — nothing here queries
     * another table, which is why this one belongs on the model.
     */
    protected $appends = ['missing_qty'];

    /**
     * Ordered but not billed. Derived, never stored: qty_po is already a
     * snapshot taken at save time, so this stays correct even after the PO is
     * revised. Its opposite, extra_qty, IS stored — nothing else records
     * over-supply.
     */
    public function getMissingQtyAttribute(): float
    {
        if ($this->qty_po === null) return 0.0;   // standalone: no order to fall short of

        return max(0, round((float) $this->qty_po - (float) $this->qty_spi, 3));
    }

    public function invoice(): BelongsTo  { return $this->belongsTo(SupplierInvoice::class, 'supplier_invoice_id'); }
    public function piItem(): BelongsTo   { return $this->belongsTo(ProformaInvoiceItem::class, 'pi_item_id'); }
    public function poItem(): BelongsTo   { return $this->belongsTo(PurchaseOrderItem::class, 'po_item_id'); }
    public function product(): BelongsTo  { return $this->belongsTo(Product::class); }
    public function boxItems(): HasMany   { return $this->hasMany(SpiBoxItem::class, 'supplier_invoice_item_id'); }

    /**
     * Billed a product the PO never ordered — or billed on a standalone
     * invoice. Either way it consumes no PO quantity and writes no row to
     * p2p_spi_po_fulfilments.
     */
    public function isUnmapped(): bool
    {
        return $this->po_item_id === null;
    }

    /** Short by this much against the PO. Negative means over-billed. */
    public function variance(): ?float
    {
        return $this->qty_po === null ? null : round((float) $this->qty_spi - (float) $this->qty_po, 3);
    }
}
