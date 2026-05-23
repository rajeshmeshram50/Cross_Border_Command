<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Sales Matrix → Proforma Invoice line item.
 *
 * Same line-total contract as QuotationItem — `amount` is the
 * server-computed `qty * rate * (1 + tax_pct/100)`. Renamed
 * computeAmount() lives on the parent helper to keep the math in
 * one place.
 */
class ProformaInvoiceItem extends Model
{
    use HasFactory;

    protected $fillable = [
        'proforma_invoice_id',
        'product_id',
        'product_name', 'hsn_code',
        'quantity', 'unit', 'rate', 'tax_pct',
        'amount',
        'line_no',
    ];

    protected $casts = [
        'quantity' => 'decimal:4',
        'rate'     => 'decimal:4',
        'tax_pct'  => 'decimal:2',
        'amount'   => 'decimal:2',
    ];

    public function proformaInvoice(): BelongsTo
    {
        return $this->belongsTo(ProformaInvoice::class);
    }

    /** Single source of truth for the line total. */
    public static function computeAmount(float $qty, float $rate, float $taxPct): float
    {
        $base = $qty * $rate;
        $withTax = $base * (1 + ($taxPct / 100));
        return round($withTax, 2);
    }
}
