<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Central CLM → Authority master row.
 *
 * Referenced (by name string) from every downstream document master so
 * the prototype's mix of formal + descriptive authority values stays
 * intact. The free-text relationship is intentional — see the migration
 * comment on clm_kyc_documents for the reasoning.
 */
class ClmAuthority extends Model
{
    public const STATUS_ACTIVE   = 'active';
    public const STATUS_INACTIVE = 'inactive';
    public const STATUSES        = [self::STATUS_ACTIVE, self::STATUS_INACTIVE];

    protected $fillable = [
        'client_id', 'code', 'name', 'description', 'status',
        'created_by', 'updated_by',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
}
