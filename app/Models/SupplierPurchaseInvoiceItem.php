<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SupplierPurchaseInvoiceItem extends Model
{
    protected $fillable = [
        'supplier_purchase_invoice_id',
        'product_id', 'product_code',
        'pi_product_name', 'pi_quantity',
        'po_product_name', 'po_quantity', 'rate_po',
        'product_name', 'quantity', 'missing_qty', 'hsn_code', 'rate',
        'gst_pct', 'cgst_pct', 'sgst_pct', 'cgst_amount', 'sgst_amount', 'cost', 'line_no',
    ];

    protected $casts = [
        'pi_quantity' => 'decimal:4',
        'po_quantity' => 'decimal:4',
        'rate_po' => 'decimal:4',
        'quantity' => 'decimal:4',
        'missing_qty' => 'decimal:4',
        'rate' => 'decimal:4',
        'gst_pct' => 'decimal:2',
        'cgst_pct' => 'decimal:2',
        'sgst_pct' => 'decimal:2',
        'cgst_amount' => 'decimal:2',
        'sgst_amount' => 'decimal:2',
        'cost' => 'decimal:2',
    ];

    public function supplierPurchaseInvoice(): BelongsTo { return $this->belongsTo(SupplierPurchaseInvoice::class); }
}
