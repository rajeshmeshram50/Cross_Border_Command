<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Consignee KYC document (Company Due Diligence + Trade Licence).
 *
 * `kind` distinguishes which sub-tab the row belongs to:
 *   'dd' → Company Due Diligence
 *   'tl' → Trade Licence
 *
 * Owner KYC uses {@see ConsigneeOwner} instead (different shape — no
 * license number, three identity-proof file slots).
 */
class ConsigneeDocument extends Model
{
    public const KIND_DD = 'dd';
    public const KIND_TL = 'tl';

    protected $fillable = [
        'consignee_id', 'kind',
        'name', 'license_number', 'issuing_authority',
        'issue_date', 'expiry_date',
        'attachment_path', 'description',
        'status', 'created_by',
    ];

    protected $casts = [
        'issue_date'  => 'date:Y-m-d',
        'expiry_date' => 'date:Y-m-d',
    ];

    public function consignee(): BelongsTo
    {
        return $this->belongsTo(Consignee::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
