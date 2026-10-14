<?php

namespace App\Services\Inventory;

use App\Models\Inventory\PutawayActivityLog;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · one way in to the put-away activity trail.
 *
 * A service rather than calls to the model scattered about, because every
 * writer has to agree on the same three things: the tenancy on the row, the
 * actor, and the shape of the location snapshot. Snapshots, not ids — the
 * trail has to stay readable after a zone is renamed or a shelf retired.
 */
class PutawayActivityLogger
{
    /**
     * @param array<string,mixed> $attrs  occupancy_id · putaway_id · task_id · box_id ·
     *                                    from_location · to_location · meta · device_id
     */
    public function log(
        string $event,
        string $subjectType,
        int $subjectId,
        int $clientId,
        ?int $branchId,
        ?int $actorId,
        array $attrs = [],
        string $actorType = 'user',
    ): PutawayActivityLog {
        return PutawayActivityLog::create(array_merge([
            'client_id'    => $clientId,
            'branch_id'    => $branchId,
            'subject_type' => $subjectType,
            'subject_id'   => $subjectId,
            'event'        => $event,
            'actor_type'   => $actorType,
            'actor_id'     => $actorId,
            'created_by'   => $actorId,
            'created_at'   => now(),
        ], $attrs));
    }

    /**
     * The address as it reads today, for from_location / to_location.
     *
     * Codes as well as names: a name is what the trail is read by, a code is
     * what was printed on the label somebody scanned.
     */
    public function snapshot(?int $warehouseId, ?int $zoneId, ?int $rackId, ?int $shelfId): array
    {
        $pick = fn (string $table, ?int $id, string $nameCol) => $id
            ? (array) DB::table($table)->where('id', $id)->first(['id', $nameCol . ' as name', 'code'])
            : null;

        $shelf = null;
        if ($shelfId) {
            $row = DB::table('inventory_shelves')->where('id', $shelfId)->first(['id', 'shelf_name', 'level_no']);
            // A shelf has no code column — it is its rack's code plus the level.
            $shelf = $row ? ['id' => $row->id, 'name' => $row->shelf_name, 'level_no' => $row->level_no] : null;
        }

        return array_filter([
            'warehouse' => $pick('inventory_warehouses', $warehouseId, 'wh_name'),
            'zone'      => $pick('inventory_zones', $zoneId, 'zone_name'),
            'rack'      => $rackId ? (array) DB::table('inventory_racks')->where('id', $rackId)->first(['id', 'rack_name as name', 'code']) : null,
            'shelf'     => $shelf,
        ]);
    }
}
