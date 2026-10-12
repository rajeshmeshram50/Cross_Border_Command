<?php

namespace App\Models\Inventory;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Concerns\BelongsToTenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Inventory · one level inside a rack, and the thing an SPI box is scanned onto.
 *
 * used_weight_kg and boxes_count belong to the put-away, not to this master —
 * the form writes them as 0 and never touches them again. Occupancy (Available
 * / Full) is read off used vs max rather than stored, so it cannot go stale.
 */
class Shelf extends Model
{
    use BelongsToTenant;

    protected $table = 'inventory_shelves';

    public const TYPES = [
        'Standard Shelf', 'Cold Shelf', 'Heavy Duty Shelf',
        'Cantilever Shelf', 'Mesh Shelf', 'Wire Deck Shelf',
    ];

    public const PURPOSES = [
        'Fast-Moving Picking', 'Bulk / Reserve Storage', 'Small Parts & Bins',
        'Cold Chain Stock', 'Hazardous Goods', 'Returns / QC Hold',
        'Kitting & Assembly', 'Dispatch Staging', 'Other',
    ];

    protected $fillable = [
        'client_id', 'branch_id', 'rack_id',
        'shelf_name', 'level_no', 'shelf_type', 'max_weight_kg', 'purpose',
        'cold_chain', 'hazardous',
        'dim_unit', 'length', 'width', 'height', 'area', 'volume', 'height_cm',
        'used_weight_kg', 'boxes_count',
        'status', 'created_by', 'updated_by',
    ];

    protected $casts = [
        'level_no'       => 'integer',
        'max_weight_kg'  => 'decimal:2',
        'cold_chain'     => 'integer',
        'hazardous'      => 'integer',
        'length'         => 'decimal:2',
        'width'          => 'decimal:2',
        'height'         => 'decimal:2',
        'area'           => 'decimal:2',
        'volume'         => 'decimal:3',
        'height_cm'      => 'decimal:2',
        'used_weight_kg' => 'decimal:2',
        'boxes_count'    => 'integer',
        'status'         => 'integer',
    ];

    protected $appends = ['shelf_code', 'load_pct', 'occupancy'];

    /** RK-001-SH-01 — the rack code plus the level. */
    public function getShelfCodeAttribute(): string
    {
        $rack = 'RK-' . str_pad((string) $this->rack_id, 3, '0', STR_PAD_LEFT);

        return $rack . '-SH-' . str_pad((string) $this->level_no, 2, '0', STR_PAD_LEFT);
    }

    public function getLoadPctAttribute(): int
    {
        $max = (float) $this->max_weight_kg;

        return $max > 0 ? (int) round((float) $this->used_weight_kg / $max * 100) : 0;
    }

    /** Derived from the load, so it cannot contradict used_weight_kg. */
    public function getOccupancyAttribute(): string
    {
        if ((int) $this->status !== 1)          return 'inactive';
        if ((float) $this->used_weight_kg <= 0) return 'empty';

        return $this->load_pct >= 100 ? 'full' : 'partial';
    }

    public function client(): BelongsTo    { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo    { return $this->belongsTo(Branch::class); }
    public function rack(): BelongsTo      { return $this->belongsTo(Rack::class, 'rack_id'); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    public function isActive(): bool { return (int) $this->status === 1; }
}
