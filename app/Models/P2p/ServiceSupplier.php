<?php

namespace App\Models\P2p;

use App\Models\Vendor;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
}
