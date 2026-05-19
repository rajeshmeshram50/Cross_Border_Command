<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductVendorMap extends Model
{
    use HasFactory;

    protected $fillable = [
        'product_id',
        'vendor_code', 'vendor_name', 'vendor_website',
        'contact_person', 'contact_no', 'email', 'designation',
        'attachment_path',
        'purchase_price', 'gst_percentage', 'gst_amount', 'total_amount',
        'map_date', 'remarks',
    ];

    protected $casts = [
        'purchase_price' => 'decimal:2',
        'gst_percentage' => 'decimal:2',
        'gst_amount'     => 'decimal:2',
        'total_amount'   => 'decimal:2',
        'map_date'       => 'date',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
