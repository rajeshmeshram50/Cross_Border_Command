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
 * Inventory · a rack inside a racked zone.
 *
 * warehouse_id is stored beside zone_id although the zone knows it: the grid
 * and the put-away scan both filter racks by warehouse, and that saves a join
 * on every row.
 */
class Rack extends Model
{
    use BelongsToTenant;

    protected $table = 'inventory_racks';

    /** Square feet per square metre, and square centimetres per square foot. */
    private const SQFT_PER_SQM  = 10.7639;
    private const SQCM_PER_SQFT = 929.0304;

    protected $fillable = [
        'client_id', 'branch_id', 'warehouse_id', 'zone_id',
        'rack_name', 'cold_chain', 'hazardous',
        'dim_unit', 'length', 'width', 'height', 'area_sqft',
        'status', 'created_by', 'updated_by',
    ];

    protected $casts = [
        'cold_chain' => 'integer',
        'hazardous'  => 'integer',
        'length'     => 'decimal:2',
        'width'      => 'decimal:2',
        'height'     => 'decimal:2',
        'area_sqft'  => 'decimal:2',
        'status'     => 'integer',
    ];

    protected $appends = ['rack_code', 'height_cm'];

    public function getRackCodeAttribute(): string
    {
        return 'RK-' . str_pad((string) $this->id, 3, '0', STR_PAD_LEFT);
    }

    public static function idFromCode(?string $code): ?int
    {
        if (!preg_match('/(\d+)\s*$/', (string) $code, $m)) return null;

        return (int) $m[1];
    }

    /** Shelves are measured against the rack in centimetres whatever unit was typed. */
    public function getHeightCmAttribute(): float
    {
        return round((float) $this->height * ($this->dim_unit === 'm' ? 100 : 1), 2);
    }

    /** Footprint in square feet from the dimensions as typed. */
    public static function areaSqft(?float $length, ?float $width, ?string $unit): ?float
    {
        if (!$length || !$width) return null;
        $area = $length * $width;

        return round($unit === 'm' ? $area * self::SQFT_PER_SQM : $area / self::SQCM_PER_SQFT, 2);
    }

    public function client(): BelongsTo    { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo    { return $this->belongsTo(Branch::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class, 'warehouse_id'); }
    public function zone(): BelongsTo      { return $this->belongsTo(Zone::class, 'zone_id'); }
    public function createdBy(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    public function shelves(): HasMany { return $this->hasMany(Shelf::class, 'rack_id'); }

    public function isActive(): bool { return (int) $this->status === 1; }
}
