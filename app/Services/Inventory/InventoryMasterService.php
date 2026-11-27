<?php

namespace App\Services\Inventory;

use App\Models\Inventory\Rack;
use App\Models\Inventory\Shelf;
use App\Models\Inventory\Warehouse;
use App\Models\Inventory\Zone;

class InventoryMasterService
{
    public function freeWarehouseAreaSqft(Warehouse $warehouse, ?int $exceptZoneId = null): float
    {
        $used = Zone::where('warehouse_id', $warehouse->id)
            ->when($exceptZoneId, fn ($q) => $q->where('id', '!=', $exceptZoneId))
            ->sum('area_sqft');

        return round(max(0, (float) $warehouse->area_sqft - (float) $used), 2);
    }

    public function freeZoneAreaSqft(Zone $zone, ?int $exceptRackId = null): float
    {
        $used = Rack::where('zone_id', $zone->id)
            ->when($exceptRackId, fn ($q) => $q->where('id', '!=', $exceptRackId))
            ->sum('area_sqft');

        return round(max(0, (float) $zone->area_sqft - (float) $used), 2);
    }

    public function freeRackHeightCm(Rack $rack, ?int $exceptShelfId = null): float
    {
        $used = Shelf::where('rack_id', $rack->id)
            ->when($exceptShelfId, fn ($q) => $q->where('id', '!=', $exceptShelfId))
            ->sum('height_cm');

        return round(max(0, $rack->height_cm - (float) $used), 2);
    }

    public function nextShelfLevel(Rack $rack): int
    {
        return ((int) Shelf::where('rack_id', $rack->id)->max('level_no')) + 1;
    }

    public function toCm(?float $value, ?string $unit): float
    {
        return (float) $value * ($unit === 'm' ? 100 : 1);
    }
}
