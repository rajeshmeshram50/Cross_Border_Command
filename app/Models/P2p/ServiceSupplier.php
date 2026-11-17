<?php

namespace App\Models\P2p;

use App\Models\Vendor;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A supplier (vendor) mapped to a service with its price.
 *   domestic      ₹ price + GST % (gst_amount / total_amount computed)
 *   international price in currency_code, no GST, inr_amount = price × exchange_rate
 * Amounts are always computed server-side (App\Support\SupplierPricing).
 */
class ServiceSupplier extends Model
{
    protected $table = 'p2p_service_suppliers';

    protected $fillable = [
        'service_id', 'vendor_id', 'origin', 'currency_code',
        'price', 'exchange_rate', 'inr_amount', 'gst_percentage', 'gst_amount', 'total_amount',
        'remarks', 'status', 'created_by', 'updated_by',
    ];

    public const STATUSES = ['active', 'inactive'];

    protected $casts = [
        'price'          => 'decimal:2',
        'gst_percentage' => 'decimal:2',
        'gst_amount'     => 'decimal:2',
        'total_amount'   => 'decimal:2',
        'exchange_rate'  => 'decimal:4',
        'inr_amount'     => 'decimal:2',
    ];

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class, 'service_id');
    }

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class, 'vendor_id')->withTrashed();
    }

    /** Recompute the GST amount and total from price + GST %. */
    public static function amounts(float $price, float $gstPct): array
    {
        $price = round($price, 2);
        $gst   = round($price * $gstPct / 100, 2);
        return ['price' => $price, 'gst_percentage' => $gstPct, 'gst_amount' => $gst, 'total_amount' => round($price + $gst, 2)];
    }
}
