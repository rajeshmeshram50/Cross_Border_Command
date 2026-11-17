<?php

namespace App\Models\P2p;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class SourcingProductSupplier extends Model
{
    use SoftDeletes;

    protected $table = 'p2p_sourcing_product_suppliers';

    protected $fillable = [
        'sourcing_product_id', 'supplier_id', 'source',
        'name', 'segment', 'contact', 'mobile', 'email',
        'gmaps', 'address', 'country', 'state', 'state_code', 'city', 'card_path',

        'origin', 'currency_code', 'price', 'gst_percentage', 'gst_type',
        'cgst_amount', 'sgst_amount', 'igst_amount', 'gst_amount', 'total_amount',
        'exchange_rate', 'inr_amount', 'price_valid_till', 'mapped_by',
    ];

    protected $casts = [
        'price'            => 'decimal:2',
        'gst_percentage'   => 'decimal:2',
        'cgst_amount'      => 'decimal:2',
        'sgst_amount'      => 'decimal:2',
        'igst_amount'      => 'decimal:2',
        'gst_amount'       => 'decimal:2',
        'total_amount'     => 'decimal:2',
        'exchange_rate'    => 'decimal:4',
        'inr_amount'       => 'decimal:2',
        'price_valid_till' => 'date',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(SourcingProduct::class, 'sourcing_product_id');
    }
}
