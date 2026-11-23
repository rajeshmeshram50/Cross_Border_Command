<?php

namespace App\Services\Inventory;

use App\Models\Inventory\LocationLock;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

class LocationLockService
{
    public const IDLE_MINUTES = 30;

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
            $lock = DB::transaction(fn () => LocationLock::create([
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
            ]));

            return [$lock, null];
        } catch (QueryException $e) {
            if (($e->getCode() !== '23505') && !str_contains((string) $e->getMessage(), 'uq_loc_lock_live')) throw $e;

            return [null, $this->held($type, $locationId)];
        }
    }

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

    public function held(string $type, int $locationId): ?LocationLock
    {
        $this->reapExpired($type, $locationId);

        return LocationLock::where('location_type', $type)
            ->where('location_id', $locationId)
            ->live()
            ->first();
    }

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
