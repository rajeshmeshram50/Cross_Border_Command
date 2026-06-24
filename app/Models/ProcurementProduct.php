<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProcurementProduct extends Model
{
    protected $fillable = [
        'procurement_id', 'lead_product_id', 'product_id', 'vendor_id',
        'qty', 'target_price', 'attachments',
    ];

    protected $casts = [
        'attachments'  => 'array',
        'qty'          => 'decimal:3',
        'target_price' => 'decimal:2',
    ];

    public function procurement(): BelongsTo
    {
        return $this->belongsTo(Procurement::class);
    }

    public function leadProduct(): BelongsTo
    {
        return $this->belongsTo(LeadProduct::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /** Recorded sourced supplier for this line (nullable). */
    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class);
    }
}
