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
        // Google Maps link for the premises — see the 2026_08_25 migration.
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

    // Country, state, GST state code, city and contact person feed the cached
    // master bundles (supplier pickers) — refresh them on every change.
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
