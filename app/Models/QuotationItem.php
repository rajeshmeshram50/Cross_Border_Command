<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Sales Matrix → Quotation line item.
 *
 * `amount` is computed server-side as `quantity * rate * (1 + tax_pct/100)`
 * inside QuotationController so the value is never trusted from the
 * client. The Quotation model's recomputeTotals() then aggregates these
 * back onto the header sub_total / grand_total.
 *
 * product_name + hsn_code are snapshotted on insert so the saved
 * quotation reads stably even if the source Product row is later
 * renamed or archived. product_id stays as a soft FK for analytics
 * roll-ups but doesn't carry an integrity constraint.
 */
class QuotationItem extends Model
{
    use HasFactory;

    protected $fillable = [
        'quotation_id',
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

    public function quotation(): BelongsTo
    {
        return $this->belongsTo(Quotation::class);
    }

    /** Single source of truth for the line total. Used by the
     *  controller before insert/update so the row's `amount` matches
     *  whatever (quantity / rate / tax_pct) trio was submitted. */
    public static function computeAmount(float $qty, float $rate, float $taxPct): float
    {
        $base = $qty * $rate;
        $withTax = $base * (1 + ($taxPct / 100));
        return round($withTax, 2);
    }
}
