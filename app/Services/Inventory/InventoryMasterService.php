<?php

namespace App\Services\Inventory;

use App\Models\Inventory\Rack;
use App\Models\Inventory\Shelf;
use App\Models\Inventory\Warehouse;
use App\Models\Inventory\Zone;

/**
 * Inventory masters · the capacity arithmetic the four levels share.
 *
 * It lives here rather than in the controllers because the same question is
 * asked twice at each level — once to validate a save, once to tell the screen
 * how much room is left — and the two answers must come from one sum.
 *
 * Each level fits inside the one above:
 *   zones  fit in the warehouse area   (square feet)
 *   racks  fit in the zone area        (square feet)
 *   shelves stack inside the rack      (centimetres of height)
 */
class InventoryMasterService
{
    /**
     * Square feet still unclaimed by zones in this warehouse.
     *
     * $exceptZoneId is the row being edited: without it a zone could never be
     * saved twice, because its own area would count against itself.
     */
    public function freeWarehouseAreaSqft(Warehouse $warehouse, ?int $exceptZoneId = null): float
    {
        $used = Zone::where('warehouse_id', $warehouse->id)
            ->when($exceptZoneId, fn ($q) => $q->where('id', '!=', $exceptZoneId))
            ->sum('area_sqft');

        return round(max(0, (float) $warehouse->area_sqft - (float) $used), 2);
    }

    /** Square feet still unclaimed by racks in this zone. */
    public function freeZoneAreaSqft(Zone $zone, ?int $exceptRackId = null): float
    {
        $used = Rack::where('zone_id', $zone->id)
            ->when($exceptRackId, fn ($q) => $q->where('id', '!=', $exceptRackId))
            ->sum('area_sqft');

        return round(max(0, (float) $zone->area_sqft - (float) $used), 2);
    }

    /** Centimetres of rack height not yet taken by shelves. */
    public function freeRackHeightCm(Rack $rack, ?int $exceptShelfId = null): float
    {
        $used = Shelf::where('rack_id', $rack->id)
            ->when($exceptShelfId, fn ($q) => $q->where('id', '!=', $exceptShelfId))
            ->sum('height_cm');

        return round(max(0, $rack->height_cm - (float) $used), 2);
    }

    /** The next free level, so the screen does not have to guess. */
    public function nextShelfLevel(Rack $rack): int
    {
        return ((int) Shelf::where('rack_id', $rack->id)->max('level_no')) + 1;
    }

    /**
     * A length in the unit as typed, in centimetres — the unit every
     * shelf-against-rack comparison is made in.
     */
    public function toCm(?float $value, ?string $unit): float
    {
        return (float) $value * ($unit === 'm' ? 100 : 1);
    }
}
