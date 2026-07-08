<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PurchaseOrderItem extends Model
{
    protected $fillable = [
        'purchase_order_id', 'product_id', 'product_code',
        'pi_product_name', 'pi_quantity',
        'product_name', 'quantity', 'rate', 'gst_pct', 'cgst_pct', 'sgst_pct',
        'cgst_amount', 'sgst_amount', 'cost', 'line_no',
    ];

    protected $casts = [
        'pi_quantity' => 'decimal:4',
        'quantity' => 'decimal:4',
        'rate' => 'decimal:4',
        'gst_pct' => 'decimal:2',
        'cgst_pct' => 'decimal:2',
        'sgst_pct' => 'decimal:2',
        'cgst_amount' => 'decimal:2',
        'sgst_amount' => 'decimal:2',
        'cost' => 'decimal:2',
    ];

    public function purchaseOrder(): BelongsTo { return $this->belongsTo(PurchaseOrder::class); }
}
