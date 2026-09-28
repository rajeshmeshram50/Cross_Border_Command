<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One row per supplier: the currency it trades in, and every purchase order
 * raised in that currency. Zoho Books pins a contact to one currency for life
 * and refuses a transaction in any other, so every later PO has to match.
 */
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

    /** Written into Zoho Books already, so the currency can no longer be undone there. */
    public function isSynced(): bool
    {
        return $this->zoho_synced === self::SYNCED_YES;
    }
}
