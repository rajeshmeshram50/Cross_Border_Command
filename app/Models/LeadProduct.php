<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Lead ↔ Product mapping row. One per (lead, product). See the
 * migration for column intent. Mutated by the matrix-detail toolbar's
 * Product Directory + Add Product flows.
 */
class LeadProduct extends Model
{
    protected $fillable = [
        'client_id', 'lead_id', 'product_id',
        'currency', 'quantity', 'target_price', 'notes',
        'sourcing_status', 'procurement_done',
        'created_by',
    ];

    protected $casts = [
        'quantity'         => 'decimal:3',
        'target_price'     => 'decimal:2',
        'procurement_done' => 'boolean',
    ];

    public function lead(): BelongsTo
    {
        return $this->belongsTo(Lead::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
