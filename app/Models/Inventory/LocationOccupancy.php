<?php

namespace App\Models\Inventory;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Inventory · what is standing in a location right now.
 *
 * One row per occupant while it is there, closed rather than deleted when it
 * leaves. This is the authority on how full a location is; the counters on
 * inventory_shelves and inventory_zones are a cache of it.
 *
 * RESERVED IS NOT A DRAFT. Capacity is taken when the location is assigned,
 * not when the box is confirmed, because a Zebra task can sit open for hours
 * and the shelf must not read as free meanwhile.
 *
 *   reserved  held for this occupant; nobody else may take the space
 *   occupied  physically there, attested by a device or a person
 *   released  gone; the row stays as history
 *
 * occupant_type keeps it open to whatever occupies a shelf next — an SPI box
 * today, a GRN box or a sales return later.
 */
class LocationOccupancy extends Model
{
    use BelongsToTenant;

    protected $table = 'inventory_location_occupancy';

    public const RESERVED = 'reserved';
    public const OCCUPIED = 'occupied';
    public const RELEASED = 'released';
    /** The two states that consume capacity. Released does not. */
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

    /** Still consuming capacity — reserved or occupied, never released. */
    public function scopeLive(Builder $q): Builder
    {
        return $q->whereIn('status', self::LIVE);
    }

    public function isLive(): bool
    {
        return in_array($this->status, self::LIVE, true);
    }

    /** The level this row occupies: a shelf when there is one, else the zone. */
    public function locationType(): string
    {
        return $this->shelf_id ? 'shelf' : 'zone';
    }

    public function locationId(): int
    {
        return (int) ($this->shelf_id ?: $this->zone_id);
    }
}
