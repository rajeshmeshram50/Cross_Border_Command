<?php

namespace App\Models\P2p;

use App\Models\Product;
use App\Models\ProformaInvoiceItem;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

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

    protected $appends = ['missing_qty'];

    public function getMissingQtyAttribute(): float
    {
        $ordered = $this->qty_po ?? $this->qty_pi;
        if ($ordered === null) return 0.0;

        return max(0, round((float) $ordered - (float) $this->qty_spi, 3));
    }

    public function invoice(): BelongsTo  { return $this->belongsTo(SupplierInvoice::class, 'supplier_invoice_id'); }
    public function piItem(): BelongsTo   { return $this->belongsTo(ProformaInvoiceItem::class, 'pi_item_id'); }
    public function poItem(): BelongsTo   { return $this->belongsTo(PurchaseOrderItem::class, 'po_item_id'); }
    public function product(): BelongsTo  { return $this->belongsTo(Product::class); }
    public function boxItems(): HasMany   { return $this->hasMany(SpiBoxItem::class, 'supplier_invoice_item_id'); }

    public function isUnmapped(): bool
    {
        return $this->po_item_id === null;
    }

    public function variance(): ?float
    {
        return $this->qty_po === null ? null : round((float) $this->qty_spi - (float) $this->qty_po, 3);
    }
}
