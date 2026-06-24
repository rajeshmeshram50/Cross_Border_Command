<?php

namespace App\Models\P2p;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * P2P · Bulk Sourcing — a product line within a sourcing target.
 */
class SourcingProduct extends Model
{
    use SoftDeletes;

    protected $table = 'p2p_sourcing_products';

    protected $fillable = [
        'sourcing_target_id', 'source', 'product_id',
        'code', 'name', 'segment', 'hsn', 'target_price',
        'clarity_type', 'clarity_value', 'status',
    ];

    public function target(): BelongsTo
    {
        return $this->belongsTo(SourcingTarget::class, 'sourcing_target_id');
    }

    public function suppliers(): HasMany
    {
        return $this->hasMany(SourcingProductSupplier::class, 'sourcing_product_id');
    }
}
