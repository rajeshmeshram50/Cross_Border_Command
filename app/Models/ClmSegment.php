<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
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
    use BelongsToTenant;

    /**
     * SegmentGuard remembers name -> id answers for the life of a request (see
     * SegmentGuard::resolveIds). Writing a segment can invalidate one, so the
     * memo is dropped here rather than relying on every write path to remember
     * — a request that renames a segment and then resolves that name would
     * otherwise read the answer from before the rename.
     *
     * Eloquent writes only; a raw DB::table('clm_segments') write bypasses this
     * and must call SegmentGuard::forgetResolved() itself.
     */
    protected static function booted(): void
    {
        static::saved(static fn () => \App\Support\SegmentGuard::forgetResolved());
        static::deleted(static fn () => \App\Support\SegmentGuard::forgetResolved());
    }

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
        'client_id', 'branch_id', 'code', 'name',
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
