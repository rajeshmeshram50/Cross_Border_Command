<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class VendorCurrencyLock extends Model
{
    use BelongsToTenant;

    protected $table = 'vendor_currency_locks';

    public const SYNCED_YES = 'yes';
    public const SYNCED_NO  = 'no';

    protected $fillable = [
        'client_id', 'branch_id', 'vendor_id', 'supplier_code',
        'po_ids', 'po_codes', 'currency_code', 'zoho_synced',
    ];

    protected $casts = [
        'po_ids'   => 'array',
        'po_codes' => 'array',
    ];

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(Vendor::class);
    }

    public function isSynced(): bool
    {
        return $this->zoho_synced === self::SYNCED_YES;
    }
}
