<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Central CLM → Segment master row.
 *
 * One trade / business segment (Tobacco, Rice, Food Grade Ethanol, …)
 * with its regulatory tier + buyer/consignee rule. Powers the
 * `/clm/segment` listing page; downstream masters (KYC, DD, Trade
 * Licences, Quality docs) eventually reference these rows.
 */
class ClmSegment extends Model
{
    public const REG_HIGHLY = 'highly';
    public const REG_LESS   = 'less';
    public const REG_VALUES = [self::REG_HIGHLY, self::REG_LESS];

    public const BC_ALLOWED     = 'allowed';
    public const BC_NOT_ALLOWED = 'not_allowed';
    public const BC_VALUES      = [self::BC_ALLOWED, self::BC_NOT_ALLOWED];

    public const STATUS_ACTIVE   = 'active';
    public const STATUS_INACTIVE = 'inactive';
    public const STATUSES        = [self::STATUS_ACTIVE, self::STATUS_INACTIVE];

    protected $fillable = [
        'client_id', 'code', 'name',
        'regulatory_status', 'buyer_consignee', 'status',
        'created_by', 'updated_by',
    ];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
