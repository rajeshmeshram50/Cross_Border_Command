<?php

namespace App\Services\Inventory;

use Illuminate\Support\Facades\DB;

class WarehouseCapabilityService
{
    public const LABELS = [
        'cold_chain' => 'a cold-chain zone',
        'hazardous'  => 'a hazardous-goods zone',
    ];

    public function requiredFor(int $spiId): array
    {
        $boxes = DB::table('p2p_spi_boxes')
            ->where('supplier_invoice_id', $spiId)
            ->whereNull('deleted_at')
            ->get(['flags', 'temp_min_c', 'temp_max_c']);

        $flagIds = $boxes->flatMap(function ($b) {
            $arr = is_array($b->flags) ? $b->flags : (json_decode((string) $b->flags, true) ?: []);
            return is_array($arr) ? $arr : [];
        })->map(fn ($v) => (int) $v)->unique()->filter()->values();

        $behaviours = $flagIds->isEmpty() ? collect()
            : DB::table('inventory_product_flags')->whereIn('id', $flagIds)->pluck('behaviour');

        $ranges = [];
        foreach ($boxes as $b) {
            $min = $b->temp_min_c === null ? null : (float) $b->temp_min_c;
            $max = $b->temp_max_c === null ? null : (float) $b->temp_max_c;
            if ($min === null && $max === null) continue;
            $ranges[$min . '|' . $max] = ['min' => $min, 'max' => $max];
        }

        return [
            'cold_chain'  => $behaviours->contains('cold_chain'),
            'hazardous'   => $behaviours->contains('hazardous'),
            'temp_ranges' => array_values($ranges),
        ];
    }

    public function capabilitiesOf(int $warehouseId): array
    {
        $zones = DB::table('inventory_zones')
            ->where('warehouse_id', $warehouseId)
            ->where('status', 1)
            ->get(['cold_chain', 'hazardous', 'temp_min_c', 'temp_max_c']);

        $cold = false; $haz = false; $coldRanges = [];
        foreach ($zones as $z) {
            if ((int) $z->cold_chain === 1) {
                $cold = true;
                $coldRanges[] = [
                    'min' => $z->temp_min_c === null ? null : (float) $z->temp_min_c,
                    'max' => $z->temp_max_c === null ? null : (float) $z->temp_max_c,
                ];
            }
            if ((int) $z->hazardous === 1) $haz = true;
        }

        return ['cold_chain' => $cold, 'hazardous' => $haz, 'cold_ranges' => $coldRanges];
    }

    public function missingGiven(array $need, ?int $warehouseId): array
    {
        if (!$warehouseId) return [];
        $have = $this->capabilitiesOf($warehouseId);

        $missing = [];

        if (($need['hazardous'] ?? false) && !$have['hazardous']) {
            $missing[] = self::LABELS['hazardous'];
        }

        if (($need['cold_chain'] ?? false) && !$have['cold_chain']) {
            $missing[] = self::LABELS['cold_chain'];
        } else {
            foreach (($need['temp_ranges'] ?? []) as $rng) {
                if (!$this->rangeCovered($rng, $have['cold_ranges'])) {
                    $missing[] = 'a cold zone for ' . $this->rangeLabel($rng);
                }
            }
        }

        return $missing;
    }

    public function missingFor(int $spiId, ?int $warehouseId): array
    {
        return $this->missingGiven($this->requiredFor($spiId), $warehouseId);
    }

    private function rangeCovered(array $rng, array $zones): bool
    {
        foreach ($zones as $z) {
            if ($z['min'] === null && $z['max'] === null) continue;
            if ($rng['min'] !== null && $z['min'] !== null && $z['min'] > $rng['min']) continue;
            if ($rng['max'] !== null && $z['max'] !== null && $z['max'] < $rng['max']) continue;
            return true;
        }
        return false;
    }

    private function rangeLabel(array $rng): string
    {
        $fmt = function ($v) {
            $s = rtrim(rtrim(number_format((float) $v, 1, '.', ''), '0'), '.');
            return $s === '' || $s === '-0' ? '0' : $s;
        };
        $min = $rng['min']; $max = $rng['max'];
        if ($min !== null && $max !== null) {
            return ($min == $max ? $fmt($min) : $fmt($min) . '…' . $fmt($max)) . ' °C';
        }
        return $max !== null ? '≤ ' . $fmt($max) . ' °C' : '≥ ' . $fmt($min) . ' °C';
    }
}
