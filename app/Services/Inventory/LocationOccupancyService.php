<?php

namespace App\Services\Inventory;

use App\Models\Inventory\LocationOccupancy;
use Illuminate\Support\Facades\DB;

class LocationOccupancyService
{
    public function reserve(
        array $place,
        string $occupantType,
        int $occupantId,
        int $clientId,
        ?int $branchId,
        ?string $boxCode = null,
        float $weightKg = 0,
        ?float $volumeCm3 = null,
        ?float $footprintCm2 = null,
        ?int $actorId = null,
    ): LocationOccupancy {
        $row = LocationOccupancy::create([
            'client_id'     => $clientId,
            'branch_id'     => $branchId,
            'warehouse_id'  => $place['warehouse_id'],
            'zone_id'       => $place['zone_id'],
            'rack_id'       => $place['rack_id'] ?? null,
            'shelf_id'      => $place['shelf_id'] ?? null,
            'occupant_type' => $occupantType,
            'occupant_id'   => $occupantId,
            'box_code'      => $boxCode,
            'weight_kg'     => $weightKg,
            'volume_cm3'    => $volumeCm3,
            'footprint_cm2' => $footprintCm2,
            'status'        => LocationOccupancy::RESERVED,
            'reserved_at'   => now(),
            'created_by'    => $actorId,
            'updated_by'    => $actorId,
        ]);

        $this->sync($row);

        return $row;
    }

    public function occupy(LocationOccupancy $row, ?int $actorId = null): LocationOccupancy
    {
        $row->forceFill([
            'status'     => LocationOccupancy::OCCUPIED,
            'placed_at'  => now(),
            'placed_by'  => $actorId,
            'updated_by' => $actorId,
        ])->save();

        return $row;
    }

    public function release(LocationOccupancy $row, string $reason, ?int $actorId = null): LocationOccupancy
    {
        $row->forceFill([
            'status'          => LocationOccupancy::RELEASED,
            'released_at'     => now(),
            'released_reason' => $reason,
            'updated_by'      => $actorId,
        ])->save();

        $this->sync($row);

        return $row;
    }

    public function liveFor(string $occupantType, int $occupantId): ?LocationOccupancy
    {
        return LocationOccupancy::where('occupant_type', $occupantType)
            ->where('occupant_id', $occupantId)
            ->live()
            ->first();
    }

    public function shelfLoads(array $shelfIds): array
    {
        if (!$shelfIds) return [];

        return DB::table('inventory_location_occupancy')
            ->selectRaw('shelf_id, coalesce(sum(weight_kg),0) w, coalesce(sum(volume_cm3),0) v, count(*) n')
            ->whereIn('shelf_id', $shelfIds)
            ->whereIn('status', LocationOccupancy::LIVE)
            ->groupBy('shelf_id')
            ->get()
            ->mapWithKeys(fn ($r) => [(int) $r->shelf_id => [
                'weight_kg'  => (float) $r->w,
                'volume_cm3' => (float) $r->v,
                'boxes'      => (int) $r->n,
            ]])
            ->all();
    }

    public function zoneLoads(array $zoneIds, bool $directOnly = false): array
    {
        if (!$zoneIds) return [];

        return DB::table('inventory_location_occupancy')
            ->selectRaw('zone_id, coalesce(sum(weight_kg),0) w, coalesce(sum(volume_cm3),0) v,
                         coalesce(sum(footprint_cm2),0) f, count(*) n')
            ->whereIn('zone_id', $zoneIds)
            ->whereIn('status', LocationOccupancy::LIVE)
            ->when($directOnly, fn ($q) => $q->whereNull('shelf_id'))
            ->groupBy('zone_id')
            ->get()
            ->mapWithKeys(fn ($r) => [(int) $r->zone_id => [
                'weight_kg'     => (float) $r->w,
                'volume_cm3'    => (float) $r->v,
                'footprint_cm2' => (float) $r->f,
                'boxes'         => (int) $r->n,
            ]])
            ->all();
    }

    public function sync(LocationOccupancy $row): void
    {
        if ($row->shelf_id) {
            $this->syncShelf((int) $row->shelf_id);
            return;
        }

        $this->syncZone((int) $row->zone_id);
    }

    public function syncShelf(int $shelfId): void
    {
        $load = $this->shelfLoads([$shelfId])[$shelfId] ?? ['weight_kg' => 0, 'boxes' => 0];

        DB::table('inventory_shelves')->where('id', $shelfId)->update([
            'used_weight_kg' => $load['weight_kg'],
            'boxes_count'    => $load['boxes'],
            'updated_at'     => now(),
        ]);
    }

    public function syncZone(int $zoneId): void
    {
        $load = $this->zoneLoads([$zoneId], directOnly: true)[$zoneId]
            ?? ['weight_kg' => 0, 'volume_cm3' => 0, 'footprint_cm2' => 0, 'boxes' => 0];

        DB::table('inventory_zones')->where('id', $zoneId)->update([
            'used_weight_kg' => $load['weight_kg'],
            'used_volume'    => $load['volume_cm3'] / 1_000_000,
            'used_area_sqft' => $load['footprint_cm2'] / 929.0304,
            'boxes_count'    => $load['boxes'],
            'updated_at'     => now(),
        ]);
    }
}
