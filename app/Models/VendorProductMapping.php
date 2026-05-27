<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;


class VendorProductMapping extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'vendor_id', 'product_id', 'created_by',
        'batch_serial_lot',
        'purchase_price', 'gst_percentage', 'gst_amount', 'total_amount',
    ];

    protected $casts = [
        'purchase_price' => 'decimal:2',
        'gst_percentage' => 'decimal:2',
        'gst_amount'     => 'decimal:2',
        'total_amount'   => 'decimal:2',
    ];

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
