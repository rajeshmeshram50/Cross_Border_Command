<?php

namespace App\Models\P2p;

use App\Models\Product;
use App\Models\ProformaInvoiceItem;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * Stage 02 · one PO line matched against the exact PI line it orders from.
 * No client_id of its own — always reached through its tenant-scoped PO.
 */
class PurchaseOrderItem extends Model
{
    protected $table = 'p2p_purchase_order_items';

    protected $fillable = [
        'purchase_order_id', 'line_no',
        'pi_item_id', 'product_id', 'description',
        'quantity', 'rate', 'gst_pct',
        'taxable_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'line_total',
        'created_by',
    ];

    protected $casts = [
        'line_no'        => 'integer',
        'quantity'       => 'decimal:3',
        'rate'           => 'decimal:2',
        'gst_pct'        => 'decimal:2',
        'taxable_amount' => 'decimal:2',
        'cgst_amount'    => 'decimal:2',
        'sgst_amount'    => 'decimal:2',
        'igst_amount'    => 'decimal:2',
        'line_total'     => 'decimal:2',
    ];

    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class, 'purchase_order_id'); }
    public function piItem(): BelongsTo        { return $this->belongsTo(ProformaInvoiceItem::class, 'pi_item_id'); }
    public function product(): BelongsTo       { return $this->belongsTo(Product::class); }
    public function inspection(): HasOne       { return $this->hasOne(PoPhysicalInspection::class, 'purchase_order_item_id'); }
}
