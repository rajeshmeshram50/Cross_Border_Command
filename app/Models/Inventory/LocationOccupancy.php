<?php

namespace App\Models\Inventory;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LocationOccupancy extends Model
{
    use BelongsToTenant;

    protected $table = 'inventory_location_occupancy';

    public const RESERVED = 'reserved';
    public const OCCUPIED = 'occupied';
    public const RELEASED = 'released';
    public const LIVE     = [self::RESERVED, self::OCCUPIED];

    public const TYPE_SPI_BOX = 'spi_box';

    protected $fillable = [
        'client_id', 'branch_id',
        'warehouse_id', 'zone_id', 'rack_id', 'shelf_id',
        'occupant_type', 'occupant_id', 'box_code',
        'weight_kg', 'volume_cm3', 'footprint_cm2',
        'status', 'reserved_at', 'placed_at', 'placed_by',
        'released_at', 'released_reason',
        'created_by', 'updated_by',
    ];

    protected $casts = [
        'reserved_at'   => 'datetime',
        'placed_at'     => 'datetime',
        'released_at'   => 'datetime',
        'weight_kg'     => 'decimal:3',
        'volume_cm3'    => 'decimal:2',
        'footprint_cm2' => 'decimal:2',
    ];

    public function client(): BelongsTo    { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo    { return $this->belongsTo(Branch::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class, 'warehouse_id'); }
    public function zone(): BelongsTo      { return $this->belongsTo(Zone::class, 'zone_id'); }
    public function rack(): BelongsTo      { return $this->belongsTo(Rack::class, 'rack_id'); }
    public function shelf(): BelongsTo     { return $this->belongsTo(Shelf::class, 'shelf_id'); }
    public function placedBy(): BelongsTo  { return $this->belongsTo(User::class, 'placed_by'); }

    public function scopeLive(Builder $q): Builder
    {
        return $q->whereIn('status', self::LIVE);
    }

    public function isLive(): bool
    {
        return in_array($this->status, self::LIVE, true);
    }

    public function locationType(): string
    {
        return $this->shelf_id ? 'shelf' : 'zone';
    }

    public function locationId(): int
    {
        return (int) ($this->shelf_id ?: $this->zone_id);
    }
}
