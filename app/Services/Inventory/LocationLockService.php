<?php

namespace App\Services\Inventory;

use App\Models\Inventory\LocationLock;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Inventory · take and give back the exclusive hold on a location.
 *
 * The race between two operators reaching for the same shelf is settled by the
 * database, not here: uq_loc_lock_live is UNIQUE on (location_type,
 * location_id) WHERE released_at IS NULL, so one insert wins and the other
 * comes back as a constraint violation. Checking first and inserting after
 * would leave a window between the two in which both callers believe they hold
 * it.
 *
 * Expiry is swept lazily, on the way in. A reaper command can do the same on a
 * schedule, but a lock that blocks the very next request must not wait for it.
 */
class LocationLockService
{
    /** How long a screen may hold a location without saying it is still there. */
    public const IDLE_MINUTES = 30;

    /**
     * Take the location, or fail saying who has it.
     *
     * @return array{0: ?LocationLock, 1: ?LocationLock} the lock taken, or the one in the way
     */
    public function acquire(
        string $type,
        int $locationId,
        int $warehouseId,
        int $clientId,
        ?int $branchId,
        ?int $userId,
        ?string $sessionId = null,
        string $reason = LocationLock::REASON_PUTAWAY,
        ?string $heldForType = null,
        ?int $heldForId = null,
        ?int $ttlMinutes = null,
    ): array {
        $this->reapExpired($type, $locationId);

        try {
            $lock = LocationLock::create([
                'client_id'         => $clientId,
                'branch_id'         => $branchId,
                'location_type'     => $type,
                'location_id'       => $locationId,
                'warehouse_id'      => $warehouseId,
                'held_by'           => $userId,
                'held_for_type'     => $heldForType,
                'held_for_id'       => $heldForId,
                'session_id'        => $sessionId,
                'reason'            => $reason,
                'acquired_at'       => now(),
                'last_heartbeat_at' => now(),
                'expires_at'        => now()->addMinutes($ttlMinutes ?? self::IDLE_MINUTES),
                'created_by'        => $userId,
                'updated_by'        => $userId,
            ]);

            return [$lock, null];
        } catch (QueryException $e) {
            // 23505 — unique_violation: somebody else holds it.
            if ($e->getCode() !== '23505') throw $e;

            return [null, $this->held($type, $locationId)];
        }
    }

    /** The same user re-entering their own lock keeps it rather than being refused. */
    public function acquireOrExtend(
        string $type, int $locationId, int $warehouseId, int $clientId, ?int $branchId,
        ?int $userId, ?string $sessionId = null, string $reason = LocationLock::REASON_PUTAWAY,
        ?string $heldForType = null, ?int $heldForId = null, ?int $ttlMinutes = null,
    ): array {
        $existing = $this->held($type, $locationId);

        if ($existing && (int) $existing->held_by === (int) $userId) {
            $this->heartbeat($existing, $ttlMinutes);

            return [$existing, null];
        }

        return $this->acquire($type, $locationId, $warehouseId, $clientId, $branchId,
            $userId, $sessionId, $reason, $heldForType, $heldForId, $ttlMinutes);
    }

    public function heartbeat(LocationLock $lock, ?int $ttlMinutes = null): LocationLock
    {
        $lock->forceFill([
            'last_heartbeat_at' => now(),
            'expires_at'        => now()->addMinutes($ttlMinutes ?? self::IDLE_MINUTES),
        ])->save();

        return $lock;
    }

    public function release(LocationLock $lock, string $reason, ?int $userId = null): LocationLock
    {
        $lock->forceFill([
            'released_at'     => now(),
            'released_reason' => $reason,
            'updated_by'      => $userId,
        ])->save();

        return $lock;
    }

    /** Whoever is holding this location now, expiry already swept. */
    public function held(string $type, int $locationId): ?LocationLock
    {
        $this->reapExpired($type, $locationId);

        return LocationLock::where('location_type', $type)
            ->where('location_id', $locationId)
            ->live()
            ->first();
    }

    /**
     * Which of these locations are held, for greying out a whole tree in one
     * query rather than one per shelf.
     *
     * @return array<int, array{held_by:?int,expires_at:?string}> keyed by location id
     */
    public function heldMap(string $type, array $locationIds): array
    {
        if (!$locationIds) return [];

        $this->reapExpiredIn($type, $locationIds);

        return LocationLock::where('location_type', $type)
            ->whereIn('location_id', $locationIds)
            ->live()
            ->get(['location_id', 'held_by', 'expires_at'])
            ->mapWithKeys(fn (LocationLock $l) => [(int) $l->location_id => [
                'held_by'    => $l->held_by,
                'expires_at' => optional($l->expires_at)->toDateTimeString(),
            ]])
            ->all();
    }

    /** A lock nobody renewed is not a lock. Swept on the way past. */
    public function reapExpired(string $type, int $locationId): int
    {
        return $this->reapExpiredIn($type, [$locationId]);
    }

    public function reapExpiredIn(string $type, array $locationIds): int
    {
        if (!$locationIds) return 0;

        return DB::table('inventory_location_locks')
            ->where('location_type', $type)
            ->whereIn('location_id', $locationIds)
            ->whereNull('released_at')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', now())
            ->update([
                'released_at'     => now(),
                'released_reason' => LocationLock::RELEASED_EXPIRED,
                'updated_at'      => now(),
            ]);
    }
}
