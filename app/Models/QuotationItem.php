<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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

    public static function computeAmount(float $qty, float $rate, float $taxPct): float
    {
        $base = $qty * $rate;
        $withTax = $base * (1 + ($taxPct / 100));
        return round($withTax, 2);
    }
}
