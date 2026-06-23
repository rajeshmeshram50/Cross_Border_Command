<?php

namespace App\Models\P2p;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * P2P · Bulk Sourcing — a supplier mapped to a sourcing product.
 */
class SourcingProductSupplier extends Model
{
    use SoftDeletes;

    protected $table = 'p2p_sourcing_product_suppliers';

    protected $fillable = [
        'sourcing_product_id', 'supplier_id', 'source',
        'name', 'segment', 'contact', 'mobile', 'email',
        'gmaps', 'address', 'country', 'state', 'state_code', 'city',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(SourcingProduct::class, 'sourcing_product_id');
    }
}
