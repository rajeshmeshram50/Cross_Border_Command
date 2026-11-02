<?php

namespace App\Services\Inventory;

use Illuminate\Support\Facades\DB;

/**
 * Can a warehouse hold what an invoice's boxes need?
 *
 * Cold-chain and hazardous live at the ZONE level, never on the warehouse — a
 * warehouse "has" a capability only when it owns an active zone flagged for it.
 * A box needs the capability when one of its product flags carries that
 * behaviour (inventory_product_flags.behaviour), the same source the putaway
 * engine reads. A Third Party warehouse has no zones and is never checked.
 */
class WarehouseCapabilityService
{
    /** Human labels for a missing capability, in message order. */
    public const LABELS = [
        'cold_chain' => 'a cold-chain zone',
        'hazardous'  => 'a hazardous-goods zone',
    ];

    /** What the invoice's boxes collectively require: cold_chain / hazardous. */
    public function requiredFor(int $spiId): array
    {
        $flagIds = collect(DB::table('p2p_spi_boxes')
            ->where('supplier_invoice_id', $spiId)
            ->whereNull('deleted_at')
            ->pluck('flags'))
            ->flatMap(function ($raw) {
                $arr = is_array($raw) ? $raw : (json_decode((string) $raw, true) ?: []);
                return is_array($arr) ? $arr : [];
            })
            ->map(fn ($v) => (int) $v)->unique()->filter()->values();

        $behaviours = $flagIds->isEmpty() ? collect()
            : DB::table('inventory_product_flags')->whereIn('id', $flagIds)->pluck('behaviour');

        return [
            'cold_chain' => $behaviours->contains('cold_chain'),
            'hazardous'  => $behaviours->contains('hazardous'),
        ];
    }

    /** What an own warehouse can hold — an active zone flagged for it. */
    public function capabilitiesOf(int $warehouseId): array
    {
        $zones = DB::table('inventory_zones')
            ->where('warehouse_id', $warehouseId)
            ->where('status', 1);

        return [
            'cold_chain' => (clone $zones)->where('cold_chain', 1)->exists(),
            'hazardous'  => (clone $zones)->where('hazardous', 1)->exists(),
        ];
    }

    /** Capability labels the warehouse is missing for an already-known need. */
    public function missingGiven(array $need, ?int $warehouseId): array
    {
        if (!$warehouseId) return [];
        $have = $this->capabilitiesOf($warehouseId);

        $missing = [];
        foreach (['cold_chain', 'hazardous'] as $cap) {
            if (($need[$cap] ?? false) && !$have[$cap]) $missing[] = self::LABELS[$cap];
        }
        return $missing;
    }

    /** Capability labels the warehouse is missing for this invoice — empty = ok. */
    public function missingFor(int $spiId, ?int $warehouseId): array
    {
        return $this->missingGiven($this->requiredFor($spiId), $warehouseId);
    }
}
