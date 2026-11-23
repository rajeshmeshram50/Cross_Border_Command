<?php

namespace App\Models;

use App\Models\Masters\Countries;
use App\Models\Masters\States;
use App\Support\MasterBundleCache;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class VendorAddress extends Model
{
    protected $fillable = [
        'vendor_id', 'address_type',
        'address_line', 'country_id', 'state_id', 'state_code',
        'city', 'pincode',
        'google_location',
        'contact_name', 'designation', 'contact_no', 'email',
        'whatsapp_enabled',
        'attachment_path',
        'is_primary',
    ];

    protected $casts = [
        'whatsapp_enabled' => 'boolean',
        'is_primary'       => 'boolean',
    ];

    protected static function booted(): void
    {
        static::saved(fn () => MasterBundleCache::bump());
        static::deleted(fn () => MasterBundleCache::bump());
    }

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class);
    }

    public function country(): BelongsTo
    {
        return $this->belongsTo(Countries::class, 'country_id');
    }

    public function state(): BelongsTo
    {
        return $this->belongsTo(States::class, 'state_id');
    }
}
