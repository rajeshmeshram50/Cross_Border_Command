<?php

namespace App\Models\Inventory;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Concerns\BelongsToTenant;
use App\Models\Masters\Countries;
use App\Models\Masters\States;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Inventory · a warehouse, ours or a third party's.
 *
 * wh_type decides the whole downstream flow: an own site is zoned, racked and
 * scanned to a shelf; a 3PL is a summary drop with no structure beneath it.
 */
class Warehouse extends Model
{
    use BelongsToTenant;

    protected $table = 'inventory_warehouses';

    public const TYPE_OWN = 'own';
    public const TYPE_TPL = 'tpl';
    public const TYPES    = [self::TYPE_OWN, self::TYPE_TPL];

    protected $fillable = [
        'client_id',
        'branch_id',
        'wh_name',
        'wh_type',
        'area_sqft',
        'address',
        'country_id',
        'state_id',
        'state_name',
        'city',
        'pincode',
        'map_url',
        'contact_person',
        'contact_dial',
        'contact_mobile',
        'contact_email',
        'card_path',
        'card_name',
        'status',
        'created_by',
        'updated_by',
    ];

    protected $casts = [
        'area_sqft' => 'decimal:2',
        'status'    => 'integer',
    ];

    /** The screen's WH-014. Derived, so it can never drift from the row. */
    protected $appends = ['wh_code'];

    public function getWhCodeAttribute(): string
    {
        return 'WH-' . str_pad((string) $this->id, 3, '0', STR_PAD_LEFT);
    }

    /** 'WH-014' or '14' back to 14; anything else is not a warehouse code. */
    public static function idFromCode(?string $code): ?int
    {
        if (!preg_match('/(\d+)\s*$/', (string) $code, $m)) return null;
        return (int) $m[1];
    }

    public function country(): BelongsTo
    {
        return $this->belongsTo(Countries::class, 'country_id');
    }
    public function state(): BelongsTo
    {
        return $this->belongsTo(States::class, 'state_id');
    }

    /**
     * The master name for India, the typed one for anywhere else — the form
     * only offers the States master when the country is India.
     */
    public function stateLabel(): ?string
    {
        return $this->state?->name ?: $this->state_name;
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function zones(): HasMany
    {
        return $this->hasMany(Zone::class, 'warehouse_id');
    }
    public function racks(): HasMany
    {
        return $this->hasMany(Rack::class, 'warehouse_id');
    }

    public function isOwn(): bool
    {
        return $this->wh_type === self::TYPE_OWN;
    }
    public function isActive(): bool
    {
        return (int) $this->status === 1;
    }
}
