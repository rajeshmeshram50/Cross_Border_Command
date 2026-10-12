<?php

namespace App\Models\Inventory;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Inventory · a zone inside a warehouse.
 *
 * rack_mode is the fork. A racked zone owns racks and leaves every capacity
 * column null; an unracked one has no shelf to scan, so it states its own
 * capacity — litres for a fridge, dimensions for an open floor.
 *
 * This is the only level that holds a temperature range. A rack and a shelf
 * each carry a cold_chain flag saying whether they may use it, nothing more.
 */
class Zone extends Model
{
    use BelongsToTenant;

    protected $table = 'inventory_zones';

    public const MODE_RACK   = 'rack';
    public const MODE_NORACK = 'norack';
    public const MODES       = [self::MODE_RACK, self::MODE_NORACK];

    public const STORAGE_REGULAR = 'regular';
    public const STORAGE_FRIDGE  = 'fridge';
    public const STORAGE_MODES   = [self::STORAGE_REGULAR, self::STORAGE_FRIDGE];

    public const PURPOSES = [
        'Receiving / Inward', 'Bulk Storage', 'Pick Face / Forward Picking',
        'Quarantine / QA Hold', 'Returns', 'Dispatch / Staging', 'Other',
    ];

    protected $fillable = [
        'client_id', 'branch_id', 'warehouse_id',
        'zone_name', 'rack_mode', 'area_sqft', 'purpose',
        'cold_chain', 'temp_min_c', 'temp_max_c', 'hazardous',
        'storage_mode', 'capacity_litres',
        'dim_unit', 'length', 'width', 'height',
        'usable_pct', 'floor_area', 'volume', 'usable_volume',
        'status', 'created_by', 'updated_by',
    ];

    protected $casts = [
        'area_sqft'       => 'decimal:2',
        'cold_chain'      => 'integer',
        'hazardous'       => 'integer',
        'temp_min_c'      => 'decimal:2',
        'temp_max_c'      => 'decimal:2',
        'capacity_litres' => 'decimal:2',
        'length'          => 'decimal:2',
        'width'           => 'decimal:2',
        'height'          => 'decimal:2',
        'usable_pct'      => 'decimal:2',
        'floor_area'      => 'decimal:2',
        'volume'          => 'decimal:3',
        'usable_volume'   => 'decimal:3',
        'status'          => 'integer',
    ];

    protected $appends = ['zone_code'];

    public function getZoneCodeAttribute(): string
    {
        return 'ZN-' . str_pad((string) $this->id, 3, '0', STR_PAD_LEFT);
    }

    public static function idFromCode(?string $code): ?int
    {
        if (!preg_match('/(\d+)\s*$/', (string) $code, $m)) return null;
        return (int) $m[1];
    }

    public function client(): BelongsTo    { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo    { return $this->belongsTo(Branch::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class, 'warehouse_id'); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    public function racks(): HasMany { return $this->hasMany(Rack::class, 'zone_id'); }

    public function isRacked(): bool { return $this->rack_mode === self::MODE_RACK; }
    public function isActive(): bool { return (int) $this->status === 1; }
}
